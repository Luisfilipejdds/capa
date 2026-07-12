import crypto from "node:crypto";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import sharp from "sharp";

const app = express();

const packageVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
).version;

const adminToken = process.env.ADMIN_TOKEN ?? "";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const dataDir = path.resolve(process.env.DATA_DIR ?? "/opt/render/project/data");
const capesDir = path.join(dataDir, "capes");
const indexFile = path.join(dataDir, "index.json");
const libraryDir = path.join(dataDir, "library");
const libraryIndexFile = path.join(dataDir, "libraryIndex.json");

const maxCapeBytes = Number.parseInt(process.env.MAX_CAPE_SIZE ?? "1048576", 10);
const maxOriginalBytes = Number.parseInt(process.env.MAX_ORIGINAL_SIZE ?? "31457280", 10);
const maxLibrarySlotBytes = Number.parseInt(process.env.MAX_LIBRARY_SLOT_SIZE ?? "6291456", 10);
const librarySlotCount = 5;
const jsonLimitBytes = Math.ceil(Math.max(maxCapeBytes + maxOriginalBytes, maxLibrarySlotBytes * librarySlotCount) * 1.5) + 64 * 1024;

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

    const totalCapeFiles = await countCapeFiles();
    const storageSizeMb = await getStorageSizeMb();
    
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
<p>Version: ${packageVersion}</p>
<p>Uptime: ${Math.floor((Date.now() - startedAt) / 1000)} segundos</p>
<p>Registered Players: ${totalPlayers}</p>
<p>Visible Capes: ${visibleCapes}</p>
<p>Total Cape Files: ${totalCapeFiles}</p>
<p>Stored Data Size: ${storageSizeMb} MB</p>
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
app.get("/original-image/:uuid", async (req, res) => {
  try {
    const uuid = normalizeUuid(req.params.uuid);
    const metadata = await readIndex();
    const entry = metadata[uuid];

    if (!entry || !entry.visible || !entry.originalFile) {
      return res.status(404).json({ ok: false, error: "original_not_found" });
    }

    const file = path.join(capesDir, uuid, entry.originalFile);
    const original = await fs.readFile(file);
    const format = String(entry.originalFormat || "png").toLowerCase();

    const contentTypes = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif"
    };

    res.setHeader("Content-Type", contentTypes[format] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=60");

    return res.status(200).send(original);
  } catch (error) {
    return handleError(res, error);
  }
});
app.get("/cape-image/:uuid.png", async (req, res) => {
  try {
    const uuid = normalizeUuid(req.params.uuid);
    const metadata = await readIndex();
    const entry = metadata[uuid];

    if (!entry || !entry.visible || !sha256Pattern.test(entry.hash)) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

let file;

const possibleFiles = [
  entry.renderFile ? path.join(capesDir, uuid, entry.renderFile) : null,
  path.join(capesDir, uuid, "renders", `${entry.hash}.png`),
  path.join(capesDir, uuid, `${entry.hash}.png`)
].filter(Boolean);

for (const possibleFile of possibleFiles) {
  try {
    await fs.access(possibleFile);
    file = possibleFile;
    break;
  } catch {
    // tenta o próximo caminho
  }
}

if (!file) {
  return res.status(404).json({
    ok: false,
    error: "cape_file_not_found"
  });
}
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
    const isAdmin = Boolean(adminToken) && req.query.admin === adminToken;

    const capes = Object.values(metadata)
      .filter(entry => entry?.visible === true && entry?.hash)
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));

const cards = capes.map(entry => {
  const updated = entry.updatedAt
    ? new Date(entry.updatedAt).toLocaleString("pt-BR")
    : "Desconhecido";
const originalInfo = entry.originalFile
  ? `${String(entry.originalFormat || "unknown").toUpperCase()} • ${entry.originalSize || 0} bytes`
  : "Sem original salvo";
  const banButton = isAdmin
    ? `<button class="ban-btn" data-uuid="${escapeHtml(entry.uuid)}" data-name="${escapeHtml(entry.username || entry.uuid)}">Banir capa</button>`
    : "";
  return `
    <div class="cape-card">
<a href="${entry.originalFile ? `/original-image/${entry.uuid}` : `/cape-image/${entry.uuid}.png`}" target="_blank">
  <img src="${entry.originalFile ? `/original-image/${entry.uuid}` : `/cape-image/${entry.uuid}.png`}" alt="Cape ${escapeHtml(entry.username || entry.uuid)}">
</a>
      <h2>${escapeHtml(entry.username || "unknown")}</h2>
      <p class="muted">Atualizada: ${escapeHtml(updated)}</p>
      <p class="muted">Original: ${escapeHtml(originalInfo)}</p>
      <p class="hash">Hash: ${escapeHtml(String(entry.hash || "").slice(0, 12))}...</p>
      ${banButton}
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

.ban-btn{
margin-top:10px;
background:#c0392b;
color:white;
border:none;
padding:8px 14px;
border-radius:8px;
font-size:12px;
cursor:pointer;
}

.ban-btn:hover{
background:#e74c3c;
}
</style>
</head>
<body>
<h1>AdaptiveCaps Gallery</h1>
<div class="grid">
${cards || "<p>Nenhuma capa visível encontrada.</p>"}
</div>
${isAdmin ? `<script>
const ADMIN_TOKEN = ${JSON.stringify(adminToken)};
async function banCape(uuid, name) {
  if (!confirm("Banir a capa de " + name + "? Isso apaga os arquivos do servidor e bloqueia novos envios ate desbanir.")) {
    return;
  }
  try {
    const response = await fetch("/api/v1/admin/ban/" + uuid + "?admin=" + encodeURIComponent(ADMIN_TOKEN), { method: "POST" });
    if (!response.ok) {
      alert("Falha ao banir (status " + response.status + ").");
      return;
    }
    location.reload();
  } catch (error) {
    alert("Erro ao banir: " + error.message);
  }
}
document.querySelectorAll(".ban-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    banCape(btn.dataset.uuid, btn.dataset.name);
  });
});
</script>` : ""}
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
const aiCooldowns = new Map();

app.post("/api/v1/ai/generate-cape", async (req, res) => {
  try {
    const body = req.body ?? {};

    const uuid = normalizeUuid(body.uuid);
    const username = sanitizeUsername(body.username);
    const prompt = String(body.prompt ?? "").trim().slice(0, 180);
    const style = String(body.style ?? "minecraft").trim().slice(0, 40);
    const mainColor = String(body.mainColor ?? "").trim().slice(0, 30);
    const quality = String(body.quality ?? "standard").trim().slice(0, 30);

    if (!prompt) {
      throw httpError(400, "missing_prompt");
    }

    const now = Date.now();
    const lastUse = aiCooldowns.get(uuid) ?? 0;

    if (now - lastUse < 30000) {
      throw httpError(429, "ai_cooldown");
    }

    aiCooldowns.set(uuid, now);

    const promptUsed = buildAiCapePrompt(prompt, style, mainColor, quality);
    const generatedImage = await generateFluxImage(promptUsed, quality);
    const capePng = await convertAiImageToCape(generatedImage);

    console.info(
      `[AI] ${username || "unknown"} (${uuid.substring(0, 4)}****) prompt="${prompt}"`
    );

    return res.status(200).json({
      ok: true,
      capePngBase64: capePng.toString("base64"),
      width: 64,
      height: 32,
      promptUsed,
      createdAt: Date.now()
    });
  } catch (error) {
    return handleError(res, error);
  }
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

    if (metadata[uuid]?.banned) {
      throw httpError(
        403,
        "banned",
        "Sua capa foi removida do Cloud Sync por um moderador. Voce ainda pode usar qualquer capa localmente (so voce vai ve-la), mas ela nao vai sincronizar nem aparecer para outros jogadores. Para pedir revisao, chame @luisfilipejdds no Discord."
      );
    }

    if (!visible) {
      metadata[uuid] = {
        ...(metadata[uuid] ?? {}),
        uuid,
        username,
        visible: false,
        updatedAt
      };

      await writeIndex(metadata);
      console.info(`[VISIBILITY] ${username || "unknown"} (${uuid.substring(0, 4)}****) invisible`);
      return res.status(200).json(toCapeResponse(metadata[uuid], ""));
    }

    const hash = String(body.hash ?? "").toLowerCase();

    if (!sha256Pattern.test(hash)) {
      throw httpError(400, "invalid_hash");
    }

    const renderPng = decodeCape(body.capePngBase64);
    const computedHash = crypto.createHash("sha256").update(renderPng).digest("hex");

    if (computedHash !== hash) {
      throw httpError(400, "hash_mismatch");
    }

    const playerDir = path.join(capesDir, uuid);
    const originalsDir = path.join(playerDir, "originals");
    const rendersDir = path.join(playerDir, "renders");

    await fs.mkdir(originalsDir, { recursive: true });
    await fs.mkdir(rendersDir, { recursive: true });

    await fs.writeFile(path.join(rendersDir, `${hash}.png`), renderPng);

    let originalHash = "";
    let originalFile = "";
    let originalFormat = "";
    let originalSize = 0;

    if (typeof body.originalImageBase64 === "string" && body.originalImageBase64.length > 0) {
      const original = decodeOriginalImage(body.originalImageBase64);
      originalHash = crypto.createHash("sha256").update(original).digest("hex");
      originalFormat = sanitizeOriginalFormat(body.originalFormat);
      originalFile = `${originalHash}.${originalFormat}`;
      originalSize = original.length;

      await fs.writeFile(path.join(originalsDir, originalFile), original);
    }

    await deleteOldPlayerCapes(uuid, hash, originalFile);

    metadata[uuid] = {
      uuid,
      username,
      hash,
      renderHash: hash,
      renderFile: `renders/${hash}.png`,
      originalHash,
      originalFile: originalFile ? `originals/${originalFile}` : "",
      originalFormat,
      originalSize,
      visible: true,
      updatedAt
    };

    await writeIndex(metadata);

    console.info(`[UPLOAD] ${username || "unknown"} (${uuid.substring(0, 4)}****) render=${renderPng.length} original=${originalSize}`);

    return res.status(200).json(toCapeResponse(metadata[uuid], renderPng.toString("base64")));
  } catch (error) {
    return handleError(res, error);
  }
});

app.post("/api/v1/admin/ban/:uuid", async (req, res) => {
  try {
    requireAdmin(req);
    const uuid = normalizeUuid(req.params.uuid);
    const metadata = await readIndex();
    const existing = metadata[uuid] ?? {};

    await purgePlayerFiles(uuid);

    metadata[uuid] = {
      uuid,
      username: existing.username ?? "",
      visible: false,
      banned: true,
      bannedAt: Date.now(),
      hash: "",
      renderFile: "",
      originalHash: "",
      originalFile: "",
      originalFormat: "",
      originalSize: 0,
      updatedAt: Date.now()
    };

    await writeIndex(metadata);
    console.info(`[BAN] ${metadata[uuid].username || "unknown"} (${uuid.substring(0, 4)}****) banido pelo admin`);
    return res.status(200).json({ ok: true, uuid, banned: true });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post("/api/v1/admin/unban/:uuid", async (req, res) => {
  try {
    requireAdmin(req);
    const uuid = normalizeUuid(req.params.uuid);
    const metadata = await readIndex();
    const entry = metadata[uuid];

    if (!entry) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    metadata[uuid] = { ...entry, banned: false };
    await writeIndex(metadata);
    console.info(`[UNBAN] ${entry.username || "unknown"} (${uuid.substring(0, 4)}****) desbanido pelo admin`);
    return res.status(200).json({ ok: true, uuid, banned: false });
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
app.get("/api/v1/capes/usernames", async (req, res) => {
  try {
    const metadata = await readIndex();

    const usernames = Array.from(
      new Set(
        Object.values(metadata)
          .filter(entry => entry?.visible === true && entry?.username)
          .map(entry => String(entry.username))
      )
    ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));

    return res.status(200).json({ ok: true, usernames: usernames.slice(0, limit) });
  } catch (error) {
    return handleError(res, error);
  }
});
app.get("/api/v1/capes/by-name/:username", async (req, res) => {
  try {
    const username = sanitizeUsername(req.params.username).toLowerCase();
    const metadata = await readIndex();

    const entry = Object.values(metadata).find(value =>
      value?.username &&
      String(value.username).toLowerCase() === username &&
      value.visible === true
    );

    if (!entry) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    return res.status(200).json({
      ok: true,
      uuid: entry.uuid,
      username: entry.username
    });
  } catch (error) {
    return handleError(res, error);
  }
});
app.get("/api/v1/capes/:uuid/original", async (req, res) => {
  try {
    const uuid = normalizeUuid(req.params.uuid);
    const metadata = await readIndex();
    const entry = metadata[uuid];

    if (!entry || !entry.visible || !entry.originalFile) {
      return res.status(404).json({ ok: false, error: "original_not_found" });
    }

    const file = path.join(capesDir, uuid, entry.originalFile);
    const original = await fs.readFile(file);

    return res.status(200).json({
      ok: true,
      uuid: entry.uuid,
      username: entry.username,
      originalImageBase64: original.toString("base64"),
      originalFormat: entry.originalFormat || "png",
      originalSize: entry.originalSize || original.length,
      updatedAt: entry.updatedAt || 0
    });
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

app.post("/api/v1/library/:uuid", async (req, res) => {
  try {
    const uuid = normalizeUuid(req.params.uuid);
    const body = req.body ?? {};
    const bodyUuid = normalizeUuid(body.uuid);

    if (bodyUuid !== uuid) {
      throw httpError(400, "uuid_mismatch");
    }

    const rawSlots = Array.isArray(body.slots) ? body.slots : [];

    if (rawSlots.length > librarySlotCount) {
      throw httpError(400, "too_many_slots");
    }

    const playerDir = path.join(libraryDir, uuid);
    await fs.mkdir(playerDir, { recursive: true });

    const storedSlots = [];
    const keepFiles = new Set();

    for (const rawSlot of rawSlots) {
      const slotNumber = Number.parseInt(rawSlot?.slot, 10);

      if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > librarySlotCount) {
        continue;
      }

      const file = decodeLibraryFile(rawSlot?.fileBase64);
      const format = sanitizeOriginalFormat(rawSlot?.type);
      const fileName = `slot-${slotNumber}.${format}`;

      await fs.writeFile(path.join(playerDir, fileName), file);
      keepFiles.add(fileName);

      storedSlots.push({
        slot: slotNumber,
        name: sanitizeSlotName(rawSlot?.name, slotNumber),
        type: format === "gif" ? "GIF" : "PNG",
        file: fileName,
        size: file.length
      });
    }

    // Remove arquivos de slots que foram substituidos (formato trocado) ou apagados
    await cleanupDir(playerDir, file => !keepFiles.has(file));

    const updatedAt =
      Number.isSafeInteger(body.updatedAt) && body.updatedAt > 0 ? body.updatedAt : Date.now();
    const username = sanitizeUsername(body.username);

    const index = await readLibraryIndex();
    index[uuid] = { uuid, username, updatedAt, slots: storedSlots };
    await writeLibraryIndex(index);

    console.info(`[LIBRARY] upload ${username || "unknown"} (${uuid.substring(0, 4)}****) slots=${storedSlots.length}`);

    return res.status(200).json({ ok: true, uuid, updatedAt, slotCount: storedSlots.length });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get("/api/v1/library/:uuid", async (req, res) => {
  try {
    const rawUuid = String(req.params.uuid ?? "").toLowerCase();

    if (!uuidPattern.test(rawUuid)) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const uuid = normalizeUuid(rawUuid);
    const index = await readLibraryIndex();
    const entry = index[uuid];

    if (!entry || !Array.isArray(entry.slots) || entry.slots.length === 0) {
      throw httpError(404, "not_found");
    }

    const playerDir = path.join(libraryDir, uuid);
    const slots = [];

    for (const slot of entry.slots) {
      try {
        const file = await fs.readFile(path.join(playerDir, slot.file));
        slots.push({
          slot: slot.slot,
          name: slot.name,
          type: slot.type,
          fileBase64: file.toString("base64")
        });
      } catch {
        // arquivo ausente/corrompido - pula esse slot em vez de falhar tudo
      }
    }

    return res.status(200).json({ ok: true, uuid, updatedAt: entry.updatedAt, slots });
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
  await fs.mkdir(libraryDir, { recursive: true });
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

let file;

const possibleFiles = [
  entry.renderFile ? path.join(capesDir, uuid, entry.renderFile) : null,
  path.join(capesDir, uuid, "renders", `${entry.hash}.png`),
  path.join(capesDir, uuid, `${entry.hash}.png`)
].filter(Boolean);

for (const possibleFile of possibleFiles) {
  try {
    await fs.access(possibleFile);
    file = possibleFile;
    break;
  } catch {
    // tenta o próximo
  }
}

if (!file) {
  throw httpError(404, "cape_file_not_found");
}

  const png = await fs.readFile(file);

  validatePng(png);

  const computedHash = crypto
    .createHash("sha256")
    .update(png)
    .digest("hex");

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
  await fs.mkdir(path.dirname(indexFile), {
    recursive: true
  });

  await fs.writeFile(
    indexFile,
    JSON.stringify(metadata, null, 2),
    "utf8"
  );
}

function decodeLibraryFile(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw httpError(400, "missing_fileBase64");
  }

  if (value.length > Math.ceil(maxLibrarySlotBytes * 1.4) + 16) {
    throw httpError(413, "slot_too_large");
  }

  if (value.length % 4 !== 0 || !base64Pattern.test(value)) {
    throw httpError(400, "invalid_base64");
  }

  const buffer = Buffer.from(value, "base64");

  if (buffer.length <= 0 || buffer.length > maxLibrarySlotBytes) {
    throw httpError(413, "slot_too_large");
  }

  return buffer;
}

function sanitizeSlotName(value, slotNumber) {
  const name = String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 32);

  return name.length > 0 ? name : `Slot ${slotNumber}`;
}

async function readLibraryIndex() {
  try {
    const raw = await fs.readFile(libraryIndexFile, "utf8");
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

async function writeLibraryIndex(index) {
  await fs.mkdir(path.dirname(libraryIndexFile), {
    recursive: true
  });

  await fs.writeFile(
    libraryIndexFile,
    JSON.stringify(index, null, 2),
    "utf8"
  );
}

async function countCapeFiles() {
  let total = 0;

  async function walk(dir) {
    let entries = [];

    try {
      entries = await fs.readdir(dir, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".png")) {
        total++;
      }
    }
  }

  await walk(capesDir);

  return total;
}
async function deleteOldPlayerCapes(uuid, activeHash, activeOriginalFile) {
  const playerDir = path.join(capesDir, uuid);
  const rendersDir = path.join(playerDir, "renders");
  const originalsDir = path.join(playerDir, "originals");

  await cleanupDir(rendersDir, file => file.endsWith(".png") && file.slice(0, -4) !== activeHash);
  await cleanupDir(originalsDir, file => file !== activeOriginalFile);
}

async function cleanupDir(dir, shouldDelete) {
  try {
    const files = await fs.readdir(dir);

    for (const file of files) {
      if (shouldDelete(file)) {
        await fs.rm(path.join(dir, file), {
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

async function purgePlayerFiles(uuid) {
  const playerDir = path.join(capesDir, uuid);
  await fs.rm(playerDir, { recursive: true, force: true });
}

function requireAdmin(req) {
  if (!adminToken) {
    throw httpError(503, "admin_disabled");
  }

  const provided = String(req.get("x-admin-token") ?? req.query.admin ?? "");
  const providedBuffer = Buffer.from(provided);
  const tokenBuffer = Buffer.from(adminToken);

  if (
    providedBuffer.length !== tokenBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, tokenBuffer)
  ) {
    throw httpError(403, "forbidden");
  }
}
function decodeOriginalImage(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw httpError(400, "missing_originalImageBase64");
  }

  const limit = Number.parseInt(process.env.MAX_ORIGINAL_SIZE ?? "31457280", 10);

  if (value.length > Math.ceil(limit * 1.4) + 16) {
    throw httpError(413, "original_too_large");
  }

  if (value.length % 4 !== 0 || !base64Pattern.test(value)) {
    throw httpError(400, "invalid_original_base64");
  }

  const buffer = Buffer.from(value, "base64");

  if (buffer.length <= 0 || buffer.length > limit) {
    throw httpError(413, "original_too_large");
  }

  return buffer;
}

function sanitizeOriginalFormat(value) {
  const format = String(value ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");

  if (["png", "jpg", "jpeg", "webp", "gif"].includes(format)) {
    return format === "jpeg" ? "jpg" : format;
  }

  return "png";
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
async function getStorageSizeMb() {
  let totalBytes = 0;

  async function scan(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scan(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalBytes += stats.size;
        }
      }
    } catch {
      // ignora erros
    }
  }

  await scan(capesDir);

  return (totalBytes / 1024 / 1024).toFixed(2);
}
function buildAiCapePrompt(prompt, style, mainColor, quality) {
  const parts = [
    "Minecraft cape texture",
    "64x32 pixel art cape layout",
    "cape back design",
    "sharp pixels",
    "clean centered composition",
    "high contrast",
    "no text",
    "no watermark",
    "no logo",
    "game texture style",
    prompt
  ];

  if (style) {
    parts.push(`${style} style`);
  }

  if (mainColor) {
    parts.push(`main color ${mainColor}`);
  }

  if (quality === "high") {
    parts.push("high detail");
  }

  return parts.join(", ");
}

// FLUX.1-schnell e destilado para poucos passos (1-4); mais steps nao melhora a
// qualidade de forma perceptivel, entao a diferenca real entre "standard" e "high"
// vem da resolucao gerada (mais resolucao = menos ruido ao reduzir para o tamanho
// da capa depois).
const AI_QUALITY_DIMENSIONS = {
  standard: { width: 768, height: 384 },
  high: { width: 1152, height: 576 }
};

async function generateFluxImage(prompt, quality) {
  const token = process.env.HF_TOKEN;

  if (!token) {
    throw httpError(500, "missing_hf_token");
  }

  const dimensions = AI_QUALITY_DIMENSIONS[quality] ?? AI_QUALITY_DIMENSIONS.standard;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let response;
    try {
      response = await fetch(
        "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              width: dimensions.width,
              height: dimensions.height,
              num_inference_steps: 4
            }
          })
        }
      );
    } catch (error) {
      if (error.name === "AbortError") {
        throw httpError(504, "ai_timeout", "A geracao demorou demais e foi cancelada. Tente novamente.");
      }
      throw httpError(502, "ai_provider_error");
    } finally {
      clearTimeout(timeout);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      // A API da Hugging Face retorna 503 com "estimated_time" enquanto um modelo
      // gratuito "acorda" de um cold start; vale a pena esperar e tentar uma vez.
      if (response.status === 503 && attempt === 1) {
        let waitSeconds = 8;
        try {
          const errorJson = await response.json();
          if (typeof errorJson?.estimated_time === "number") {
            waitSeconds = Math.min(20, Math.max(3, Math.ceil(errorJson.estimated_time)));
          }
        } catch {
          // corpo sem JSON valido — usa o tempo de espera padrao
        }
        console.info(`[AI] Modelo carregando na Hugging Face, aguardando ${waitSeconds}s antes de tentar de novo.`);
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
        continue;
      }

      const errorText = await response.text().catch(() => "");
      console.error("[AI] Hugging Face error:", response.status, errorText);
      throw httpError(502, "ai_provider_error");
    }

    if (contentType.includes("application/json")) {
      const json = await response.json();
      console.error("[AI] Unexpected JSON response:", json);
      throw httpError(502, "ai_invalid_response");
    }

    return Buffer.from(await response.arrayBuffer());
  }

  throw httpError(502, "ai_provider_error");
}

async function convertAiImageToCape(imageBuffer) {
  // Um passo de reducao suave (lanczos3) ate um multiplo limpo de 64x32 preserva
  // formas/cores com menos ruido do que ir direto pro tamanho final; o cliente
  // ainda faz um ultimo passo com vizinho-mais-proximo para o "look" de pixel art
  // nitido em 64x32 (ver CapeTextureManager.resize()).
  const capePng = await sharp(imageBuffer)
    .resize(256, 128, {
      fit: "cover",
      position: "center",
      kernel: sharp.kernel.lanczos3
    })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: false
    })
    .toBuffer();

  validatePng(capePng);

  return capePng;
}
function statusPayload() {
  return {
    ok: true,
    service: "AdaptiveCapes Relay",
    version: packageVersion,
    status: "online"
  };
}

function healthPayload() {
  return {
    ok: true,
    status: "ok",
    service: "adaptivecapes-relay",
    version: packageVersion,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startedAt) / 1000)
  };
}
function httpError(statusCode, message, publicMessage) {
  return Object.assign(new Error(message), {
    statusCode,
    publicMessage
  });
}

function handleError(res, error) {
  const status = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : 500;

  if (status >= 500) {
    console.error("=== ADAPTIVECAPS RELAY ERROR ===");
    console.error(error);
    console.error(error?.stack);
  }

  const payload = {
    ok: false,
    error: status >= 500 ? "internal_error" : error?.message ?? "internal_error"
  };

  if (status < 500 && error?.publicMessage) {
    payload.message = error.publicMessage;
  }

  return res.status(status).json(payload);
}
