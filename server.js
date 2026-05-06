import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || "/opt/render/project/data";
const MAX_CAPE_SIZE = Number(process.env.MAX_CAPE_SIZE || 1048576);

const CAPES_DIR = path.join(DATA_DIR, "capes");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

fs.mkdirSync(CAPES_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "5mb" }));

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HASH_REGEX = /^[a-fA-F0-9]{64}$/;

const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 60;

  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }

  record.count++;
  rateLimitMap.set(ip, record);

  return record.count > maxRequests;
}

function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return {};
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveIndex(index) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isPng(buffer) {
  return (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function safeCapeResponse(meta) {
  const filePath = path.join(CAPES_DIR, meta.uuid, `${meta.hash}.png`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const capePngBase64 = fs.readFileSync(filePath).toString("base64");

  return {
    uuid: meta.uuid,
    username: meta.username || "",
    hash: meta.hash,
    visible: meta.visible !== false,
    capePngBase64,
    updatedAt: meta.updatedAt || Date.now()
  };
}

app.use((req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";

  if (isRateLimited(ip)) {
    return res.status(429).json({
      ok: false,
      error: "rate_limited"
    });
  }

  next();
});

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "AdaptiveCapes Relay",
    status: "online"
  });
});

app.get("/api/v1", (req, res) => {
  res.json({
    ok: true,
    service: "AdaptiveCapes Relay",
    version: "1.0.0",
    status: "online"
  });
});

app.post("/api/v1/capes/:uuid", (req, res) => {
  try {
    const uuid = String(req.params.uuid || "").toLowerCase();
    const body = req.body || {};

    if (!UUID_REGEX.test(uuid)) {
      return res.status(400).json({ ok: false, error: "invalid_uuid" });
    }

    if (!body.uuid || String(body.uuid).toLowerCase() !== uuid) {
      return res.status(400).json({ ok: false, error: "uuid_mismatch" });
    }

    const username = String(body.username || "");
    const hash = String(body.hash || "").toLowerCase();
    const visible = body.visible !== false;
    const updatedAt = Number(body.updatedAt || Date.now());
    const capePngBase64 = String(body.capePngBase64 || "");

    if (!HASH_REGEX.test(hash)) {
      return res.status(400).json({ ok: false, error: "invalid_hash" });
    }

    if (!capePngBase64) {
      return res.status(400).json({ ok: false, error: "missing_cape" });
    }

    const buffer = Buffer.from(capePngBase64, "base64");

    if (!buffer || buffer.length <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_base64" });
    }

    if (buffer.length > MAX_CAPE_SIZE) {
      return res.status(413).json({ ok: false, error: "cape_too_large" });
    }

    if (!isPng(buffer)) {
      return res.status(400).json({ ok: false, error: "invalid_png" });
    }

    const realHash = sha256(buffer);

    if (realHash !== hash) {
      return res.status(400).json({
        ok: false,
        error: "hash_mismatch"
      });
    }

    const playerDir = path.join(CAPES_DIR, uuid);
    fs.mkdirSync(playerDir, { recursive: true });

    const filePath = path.join(playerDir, `${hash}.png`);
    fs.writeFileSync(filePath, buffer);

    const index = loadIndex();

    index[uuid] = {
      uuid,
      username,
      hash,
      visible,
      updatedAt,
      size: buffer.length
    };

    saveIndex(index);

    console.log(`[AdaptiveCapes] Saved cape uuid=${uuid} hash=${hash} size=${buffer.length}`);

    return res.status(201).json({
      ok: true,
      uuid,
      hash,
      visible
    });
  } catch (error) {
    console.error("[AdaptiveCapes] Upload error:", error.message);

    return res.status(500).json({
      ok: false,
      error: "internal_error"
    });
  }
});

app.get("/api/v1/capes/:uuid", (req, res) => {
  try {
    const uuid = String(req.params.uuid || "").toLowerCase();

    if (!UUID_REGEX.test(uuid)) {
      return res.status(400).json({ ok: false, error: "invalid_uuid" });
    }

    const index = loadIndex();
    const meta = index[uuid];

    if (!meta || meta.visible === false) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const response = safeCapeResponse(meta);

    if (!response) {
      return res.status(404).json({ ok: false, error: "file_not_found" });
    }

    return res.json(response);
  } catch (error) {
    console.error("[AdaptiveCapes] Get cape error:", error.message);

    return res.status(500).json({
      ok: false,
      error: "internal_error"
    });
  }
});

app.get("/api/v1/capes/bulk", (req, res) => {
  try {
    const uuidsParam = String(req.query.uuids || "");
    const uuids = uuidsParam
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter((u) => UUID_REGEX.test(u))
      .slice(0, 40);

    const index = loadIndex();
    const capes = [];

    for (const uuid of uuids) {
      const meta = index[uuid];

      if (!meta || meta.visible === false) continue;

      const response = safeCapeResponse(meta);

      if (response) {
        capes.push(response);
      }
    }

    return res.json({ capes });
  } catch (error) {
    console.error("[AdaptiveCapes] Bulk error:", error.message);

    return res.status(500).json({
      ok: false,
      error: "internal_error"
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "route_not_found"
  });
});

app.listen(PORT, () => {
  console.log(`[AdaptiveCapes] Relay online on port ${PORT}`);
  console.log(`[AdaptiveCapes] DATA_DIR=${DATA_DIR}`);
  console.log(`[AdaptiveCapes] MAX_CAPE_SIZE=${MAX_CAPE_SIZE}`);
});
