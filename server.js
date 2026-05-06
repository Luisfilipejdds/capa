import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const dataDir = path.resolve(process.env.DATA_DIR ?? "/opt/render/project/data");
const capesDir = path.join(dataDir, "capes");
const indexFile = path.join(dataDir, "index.json");

const maxCapeBytes = Number.parseInt(
  process.env.MAX_CAPE_SIZE ?? process.env.MAX_CAPE_BYTES ?? "1048576",
  10
);
const jsonLimitBytes = Math.ceil(maxCapeBytes * 1.5) + 64 * 1024;

const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
);

const apiUserAgentPattern = /AdaptiveCapes\/[0-9.]+/i;
const apiRateLimitWindowMillis = Number.parseInt(process.env.API_RATE_WINDOW_MS ?? "60000", 10);
const maxApiRequestsPerWindow = Number.parseInt(process.env.API_RATE_LIMIT ?? "120", 10);
const maxUploadsPerWindow = Number.parseInt(process.env.UPLOAD_RATE_LIMIT ?? "8", 10);
const repeatBlockMillis = Number.parseInt(process.env.REPEAT_BLOCK_MS ?? "1500", 10);

const rateBuckets = new Map();
const repeatBuckets = new Map();

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/i;
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: `${jsonLimitBytes}b` }));
app.use(securityHeaders);
app.use("/api/v1/capes", apiSecurity);

app.get("/", (req, res) => {
  res.json(statusPayload());
});

app.get("/api/v1", (req, res) => {
  res.json(statusPayload());
});

app.get("/health", (req, res) => {
  res.json(statusPayload());
});

if (process.env.NODE_ENV === "development" && process.env.ENABLE_DEBUG === "true") {
  app.get("/api/v1/debug/list", async (req, res) => {
    const metadata = await readIndex();

    res.json({
      total: Object.keys(metadata).length,
      capes: Object.values(metadata).map(entry => ({
        uuid: entry.uuid,
        username: entry.username,
        visible: Boolean(entry.visible),
        updatedAt: entry.updatedAt
      }))
    });
  });
}

app.post("/api/v1/capes/:uuid([0-9a-fA-F-]{36})", async (req, res) => {
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

    metadata[uuid] = {
      uuid,
      username,
      hash,
      visible: true,
      updatedAt
    };

    await writeIndex(metadata);

    console.info(`AdaptiveCapes upload accepted uuid=${uuid} size=${png.length} visible=true`);

    return res.status(200).json(toCapeResponse(metadata[uuid], png.toString("base64")));
  } catch (error) {
    return handleError(res, error);
  }
});

app.get("/api/v1/capes/bulk", async (req, res) => {
  try {
    const raw = String(req.query.uuids ?? "").trim();

    if (!raw) {
      return res.json({ capes: [] });
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

    return res.json({ capes });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get("/api/v1/capes/:uuid([0-9a-fA-F-]{36})", async (req, res) => {
  try {
    const uuid = normalizeUuid(req.params.uuid);
    const cape = await
