import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";

const app = express();

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const dataDir = path.resolve(process.env.DATA_DIR ?? "/opt/render/project/data");
const capesDir = path.join(dataDir, "capes");
const indexFile = path.join(dataDir, "index.json");

const maxCapeBytes = Number.parseInt(process.env.MAX_CAPE_SIZE ?? "1048576", 10);
const jsonLimitBytes = Math.ceil(maxCapeBytes * 1.5) + 64 * 1024;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sha256Pattern = /^[0-9a-f]{64}$/i;
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const startedAt = Date.now();

app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: `${jsonLimitBytes}b` }));

app.get("/", (req, res) => {
  return res.json(statusPayload());
});
app.get("/status", async (req, res) => {
  try {
    const metadata = await readIndex();

    const totalPlayers = Object.keys(metadata).length;

    const visibleCapes = Object.values(metadata).filter(
      entry => entry?.visible === true
    ).length;

    return res.type("html").send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>AdaptiveCaps Status</title>
<style>
body{
background:#0f1720;
color:white;
font-family:Arial,sans-serif;
display:flex;
justify-content:center;
align-items:center;
height:100vh;
margin:0;
}
.card{
background:#182331;
padding:30px;
border-radius:16px;
width:500px;
box-shadow:0 0 20px rgba(0,0,0,.3);
}
h1{
margin-top:0;
color:#31b7ff;
}
</style>
</head>
<body>
<div class="card">
<h1>AdaptiveCaps Relay</h1>
<p>Status: Online</p>
<p>Version: 1.0.0</p>
<p>Uptime: ${Math.floor((Date.now() - startedAt) / 1000)} segundos</p>
<p>Registered Players: ${totalPlayers}</p>
<p>Visible Capes: ${visibleCapes}</p>
</div>
</body>
</html>
    `);
  } catch (error) {
    return handleError(res, error);
  }
});
app.get("/api/v1", (req, res) => {
  return res.json(statusPayload());
});
app.get("/health", (req, res) => {
  return res.json(healthPayload());
});
app.get("/cape-image/:uuid.png", async (req, res) => {
  try {
    const uuid = normalizeUuid(req.params.uuid);
    const metadata = await readIndex();
    const entry = metadata[uuid];

    if (!entry || !entry.visible || !sha256Pattern.test(entry.hash)) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const file = path.join(capesDir, uuid, `${entry.hash}.png`);
    const png = await fs.readFile(file);

    validatePng(png);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=60");

    return res.status(200).send(png);
  } catch (error) {
    return handleError(res, error);
  }
});

app.get("/capes", async (req, res) => {
  try {
    const metadata = await readIndex();

    const capes = Object.values(metadata)
      .filter(entry => entry?.visible === true && entry?.hash)
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));

const cards = capes.map(entry => {
  const updated = entry.updatedAt
    ? new Date(entry.updatedAt).toLocaleString("pt-BR")
    : "Desconhecido";

  return `
    <div class="cape-card">
      <a href="/cape-image/${entry.uuid}.png" target="_blank">
        <img src="/cape-image/${entry.uuid}.png" alt="Cape ${escapeHtml(entry.username || entry.uuid)}">
      </a>
      <h2>${escapeHtml(entry.username || "unknown")}</h2>
      <p class="muted">Atualizada: ${escapeHtml(updated)}</p>
      <p class="hash">Hash: ${escapeHtml(String(entry.hash || "").slice(0, 12))}...</p>
    </div>
  `;
}).join("");

    return res.type("html").send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>AdaptiveCaps Gallery</title>
<style>
body{
background:#0f1720;
color:white;
font-family:Arial,sans-serif;
margin:0;
padding:30px;
}
h1{
color:#31b7ff;
}
.grid{
display:grid;
grid-template-columns:repeat(auto-fill,minmax(180px,1fr));
gap:20px;
}
.cape-card{
background:#182331;
padding:18px;
border-radius:14px;
text-align:center;
box-shadow:0 0 20px rgba(0,0,0,.25);
}
.cape-card img{
max-width:128px;
image-rendering:pixelated;
background:#263548;
border-radius:8px;
padding:10px;
}
.cape-card h2{
font-size:18px;
margin:12px 0 6px;
}
.cape-card p{
font-size:11px;
color:#aeb9c8;
word-break:break-all;
}
.muted{
color:#aeb9c8;
font-size:12px;
}

.hash{
font-size:10px;
color:#718096;
word-break:break-all;
}

.cape-card a{
display:inline-block;
}

.cape-card img:hover{
transform:scale(1.08);
transition:.15s;
}
</style>
</head>
<body>
<h1>AdaptiveCaps Gallery</h1>
<div class="grid">
${cards || "<p>Nenhuma capa visível encontrada.</p>"}
</div>
</body>
</html>
    `);
  } catch (error) {
    return handleError(res, error);
  }
});
app.get("/api/v1/health", (req, res) => {
  return res.json(healthPayload());
});

app.post("/api/v1/capes/:uuid", async (req, res) => {
  try {
    const uuid = normalizeUuid(req.params.uuid);
    const body = req.body ?? {};
    const bodyUuid = normalizeUuid(body.uuid);

    if (bodyUuid !== uuid) {
      throw httpError(400, "uuid_mismatch");
    }

    const visible = Boolean(body.visible);
    const username = sanitizeUsername(body.username);
    const updatedAt =
      Number.isSafeInteger(body.updatedAt) && body.updatedAt > 0
        ? body.updatedAt
        : Date.now();

    const metadata = await readIndex();

    if (!visible) {
      metadata[uuid] = {
        uuid,
        username,
        hash: "",
        visible: false,
        updatedAt
      };

      await writeIndex(metadata);

      console.info(
        `[VISIBILITY] ${username || "unknown"} (${uuid.substring(0, 4)}****) invisible`
      );

      return res.status(200).json(toCapeResponse(metadata[uuid], ""));
    }

    const hash = String(body.hash ?? "").toLowerCase();

    if (!sha256Pattern.test(hash)) {
      throw httpError(400, "invalid_hash");
    }

    const png = decodeCape(body.capePngBase64);
    const computedHash = crypto.createHash("sha256").update(png).digest("hex");

    if (computedHash !== hash) {
      throw httpError(400, "hash_mismatch");
    }

    const playerDir = path.join(capesDir, uuid);
    await fs.mkdir(playerDir, { recursive: true });
    await fs.writeFile(path.join(playerDir, `${hash}.png`), png);

    await deleteOldPlayerCapes(uuid, hash);
    
    metadata[uuid] = {
      uuid,
      username,
      hash,
      visible: true,
      updatedAt
    };

    await writeIndex(metadata);

    console.info(
      `[UPLOAD] ${username || "unknown"} (${uuid.substring(0, 4)}****) size=${png.length}`
    );

    return res.status(200).json(toCapeResponse(metadata[uuid], png.toString("base64")));
  } catch (error) {
    return handleError(res, error);
  }
});
    
app.get("/api/v1/capes/bulk", async (req, res) => {
  try {
    const raw = String(req.query.uuids ?? "").trim();

    if (!raw) {
      return res.status(200).json({ capes: [] });
    }

    const uuids = raw
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(value => uuidPattern.test(value))
      .slice(0, 40);

    const capes = [];

    for (const uuid of uuids) {
      const cape = await loadCape(uuid);

      if (cape) {
        capes.push(cape);
      }
    }

    return res.status(200).json({ capes });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get("/api/v1/capes/:uuid", async (req, res) => {
  try {
    const rawUuid = String(req.params.uuid ?? "").toLowerCase();

    if (!uuidPattern.test(rawUuid)) {
      return res.status(404).json({
        ok: false,
        error: "not_found"
      });
    }

    const uuid = normalizeUuid(rawUuid);
    const cape = await loadCape(uuid);

    if (!cape) {
      throw httpError(404, "not_found");
    }

    return res.status(200).json(cape);
  } catch (error) {
    return handleError(res, error);
  }
});

app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      ok: false,
      error: "payload_too_large"
    });
  }

  return handleError(res, error);
});

app.listen(port, "0.0.0.0", async () => {
  await fs.mkdir(capesDir, { recursive: true });
  console.log(`AdaptiveCapes Relay online on port ${port}`);
});

async function loadCape(uuid) {
  const metadata = await readIndex();
  const entry = metadata[uuid];

  if (!entry) {
    return null;
  }

  if (!entry.visible) {
    return toCapeResponse(entry, "");
  }

  if (!sha256Pattern.test(entry.hash)) {
    throw httpError(500, "corrupt_metadata");
  }

  const file = path.join(capesDir, uuid, `${entry.hash}.png`);
  const png = await fs.readFile(file);

  validatePng(png);

  const computedHash = crypto.createHash("sha256").update(png).digest("hex");

  if (computedHash !== entry.hash) {
    throw httpError(500, "stored_hash_mismatch");
  }

  return toCapeResponse(entry, png.toString("base64"));
}

async function readIndex() {
  try {
    const raw = await fs.readFile(indexFile, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }

    return {};
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeIndex(metadata) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(indexFile, JSON.stringify(metadata, null, 2));
}
async function deleteOldPlayerCapes(uuid, activeHash) {
  const playerDir = path.join(capesDir, uuid);

  try {
    const files = await fs.readdir(playerDir);

    for (const file of files) {
      if (!file.endsWith(".png")) {
        continue;
      }

      const hash = file.slice(0, -4);

      if (hash !== activeHash) {
        await fs.rm(path.join(playerDir, file), {
          force: true
        });
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function decodeCape(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw httpError(400, "missing_capePngBase64");
  }

  if (value.length > Math.ceil(maxCapeBytes * 1.4) + 16) {
    throw httpError(413, "cape_base64_too_large");
  }

  if (value.length % 4 !== 0 || !base64Pattern.test(value)) {
    throw httpError(400, "invalid_base64");
  }

  const png = Buffer.from(value, "base64");

  validatePng(png);

  return png;
}

function validatePng(png) {
  if (!Buffer.isBuffer(png) || png.length <= pngSignature.length) {
    throw httpError(400, "invalid_png");
  }

  if (png.length > maxCapeBytes) {
    throw httpError(413, "cape_too_large");
  }

  if (!png.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw httpError(400, "invalid_png_signature");
  }
}

function normalizeUuid(value) {
  const uuid = String(value ?? "").toLowerCase();

  if (!uuidPattern.test(uuid)) {
    throw httpError(400, "invalid_uuid");
  }

  return uuid;
}

function sanitizeUsername(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 16);
}

function toCapeResponse(entry, capePngBase64) {
  return {
    uuid: String(entry.uuid ?? ""),
    username: String(entry.username ?? ""),
    hash: String(entry.hash ?? ""),
    visible: Boolean(entry.visible),
    capePngBase64,
    updatedAt: Number.isSafeInteger(entry.updatedAt) ? entry.updatedAt : 0
  };
}
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusPayload() {
  return {
    ok: true,
    service: "AdaptiveCapes Relay",
    version: "1.0.0",
    status: "online"
  };
}

function healthPayload() {
  return {
    ok: true,
    status: "ok",
    service: "adaptivecapes-relay",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startedAt) / 1000)
  };
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), {
    statusCode
  });
}

function handleError(res, error) {
  const status = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : 500;

  if (status >= 500) {
    console.error(`AdaptiveCapes Relay internal error: ${error?.name ?? "Error"}`);
  }

  return res.status(status).json({
    ok: false,
    error: status >= 500 ? "internal_error" : error?.message ?? "internal_error"
  });
}
