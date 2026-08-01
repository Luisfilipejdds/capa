import crypto from "node:crypto";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import sharp from "sharp";

const app = express();
const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");

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
const featuredFile = path.join(dataDir, "featured.json");
const featuredCapesMax = 10;

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

const MODRINTH_URL = "https://modrinth.com/mod/adaptivecaps/versions";
const CURSEFORGE_URL = "https://www.curseforge.com/minecraft/mc-mods/adaptivecaps/files/all?page=1&pageSize=20&showAlphaFiles=show";
const SPONSOR_URL = "https://streethosting.com.br/aff/32";
const DISCORD_USERNAME = "luisfilipejdds7";

// Design compartilhado por todas as paginas HTML do site (publico e admin),
// pra tudo ter a mesma cara em vez de cada rota reinventar seu proprio CSS.
const SITE_STYLES = `
:root{
  --bg:#0a0e16;
  --bg-alt:#0f1520;
  --surface:#141b28;
  --surface-2:#1a2333;
  --border:#232e42;
  --text:#e8edf5;
  --text-muted:#8b97ac;
  --accent:#31b7ff;
  --accent-2:#8b5cf6;
  --success:#22c55e;
  --danger:#ef4444;
  --radius:16px;
  --radius-sm:10px;
  --shadow:0 8px 30px rgba(0,0,0,.35);
}
*{box-sizing:border-box;}
body{
  margin:0;
  background:
    radial-gradient(1200px 600px at 15% -10%, rgba(49,183,255,.12), transparent 60%),
    radial-gradient(1000px 500px at 100% 0%, rgba(139,92,246,.10), transparent 55%),
    var(--bg);
  color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  min-height:100vh;
}
a{color:inherit;}
.nav{
  position:sticky;
  top:0;
  z-index:20;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  padding:14px 28px;
  background:rgba(10,14,22,.7);
  backdrop-filter:blur(14px);
  -webkit-backdrop-filter:blur(14px);
  box-shadow:0 1px 0 0 rgba(49,183,255,.18), 0 12px 24px -18px rgba(0,0,0,.6);
}
.nav-brand{
  display:flex;
  align-items:center;
  gap:11px;
  font-weight:800;
  font-size:19px;
  letter-spacing:-.2px;
  text-decoration:none;
}
.nav-brand .brand-text{
  background:linear-gradient(135deg,#fff,var(--accent) 70%,var(--accent-2));
  -webkit-background-clip:text;
  background-clip:text;
  color:transparent;
}
.nav-brand .logo-img{
  width:36px;height:36px;
  border-radius:10px;
  display:block;
  object-fit:cover;
  box-shadow:0 4px 16px -4px rgba(49,183,255,.6);
}
.nav-links{
  position:relative;
  display:flex;
  gap:4px;
  flex-wrap:wrap;
  background:rgba(255,255,255,.03);
  border:1px solid var(--border);
  padding:4px;
  border-radius:999px;
}
.nav-indicator{
  position:absolute;
  top:4px;
  bottom:4px;
  left:0;
  width:0;
  border-radius:999px;
  background:rgba(49,183,255,.12);
  border:1px solid rgba(49,183,255,.35);
  box-shadow:0 0 16px -2px rgba(49,183,255,.4);
  opacity:0;
  pointer-events:none;
  transition:transform .38s cubic-bezier(.22,1,.36,1), width .38s cubic-bezier(.22,1,.36,1), opacity .2s;
}
.nav-links a{
  position:relative;
  z-index:1;
  padding:8px 16px;
  border-radius:999px;
  font-size:14px;
  font-weight:600;
  text-decoration:none;
  color:var(--text-muted);
  transition:color .15s;
}
.nav-links a:hover{
  color:var(--text);
}
.nav-links a.active{
  color:var(--accent);
}
.container{
  max-width:1080px;
  margin:0 auto;
  padding:48px 24px 80px;
}
.hero{
  text-align:center;
  padding:36px 0 8px;
}
.hero h1{
  font-size:42px;
  margin:0 0 12px;
  background:linear-gradient(135deg,var(--accent),var(--accent-2));
  -webkit-background-clip:text;
  background-clip:text;
  color:transparent;
}
.hero p{
  color:var(--text-muted);
  font-size:16px;
  max-width:560px;
  margin:0 auto;
}
h2.section-title{
  font-size:22px;
  margin:56px 0 20px;
  display:flex;
  align-items:center;
  gap:10px;
}
h2.section-title .bar{
  width:4px;height:20px;border-radius:2px;
  background:linear-gradient(180deg,var(--accent),var(--accent-2));
}
.card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
}
.stat-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
  gap:16px;
}
.stat-tile{
  padding:20px;
  text-align:center;
}
.stat-tile .value{
  font-size:28px;
  font-weight:700;
  color:var(--accent);
}
.stat-tile .label{
  margin-top:6px;
  font-size:13px;
  color:var(--text-muted);
}
.ban-timer{
  margin-top:6px;
  font-size:11px;
  font-weight:600;
  color:var(--text-muted);
}
.stat-tile-danger .ban-timer{color:var(--danger);opacity:.85;}
.status-banner{
  display:flex;
  align-items:center;
  gap:16px;
  padding:22px 26px;
  margin-bottom:28px;
}
.status-pulse{
  position:relative;
  width:16px;height:16px;
  border-radius:50%;
  background:#22c55e;
  box-shadow:0 0 0 rgba(34,197,94,.55);
  animation:status-pulse-anim 2s infinite;
  flex-shrink:0;
}
@keyframes status-pulse-anim{
  0%{box-shadow:0 0 0 0 rgba(34,197,94,.55);}
  70%{box-shadow:0 0 0 10px rgba(34,197,94,0);}
  100%{box-shadow:0 0 0 0 rgba(34,197,94,0);}
}
.status-banner-title{
  font-size:20px;
  font-weight:700;
  color:#22c55e;
}
.status-banner-sub{
  margin-top:4px;
  font-size:13px;
  color:var(--text-muted);
}
.stat-tile-icon{
  text-align:left;
}
.stat-tile-icon .icon{
  width:40px;height:40px;
  border-radius:10px;
  background:rgba(49,183,255,.12);
  color:var(--accent);
  display:flex;align-items:center;justify-content:center;
  margin-bottom:14px;
}
.stat-tile-icon .icon svg{width:20px;height:20px;}
.stat-tile-icon .value{font-size:24px;}
.stat-tile-danger .icon{
  background:rgba(239,68,68,.12);
  color:var(--danger);
}
.stat-tile-danger .value{color:var(--danger);}
.feature-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  gap:18px;
}
.feature-card{
  padding:22px;
}
.feature-card .icon{
  width:40px;height:40px;
  border-radius:10px;
  background:rgba(49,183,255,.12);
  color:var(--accent);
  display:flex;align-items:center;justify-content:center;
  margin-bottom:14px;
}
.feature-card .icon svg{width:20px;height:20px;}
.feature-card h3{
  font-size:16px;
  margin:0 0 8px;
  color:var(--accent);
}
.feature-card p{
  margin:0;
  font-size:13px;
  color:var(--text-muted);
  line-height:1.5;
}
.cape-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(170px,1fr));
  gap:18px;
}
.cape-card{
  padding:16px;
  text-align:center;
  transition:transform .15s, box-shadow .15s;
}
.cape-card:hover{
  transform:translateY(-4px);
  box-shadow:0 14px 34px rgba(0,0,0,.45);
}
.cape-card img{
  max-width:120px;
  image-rendering:pixelated;
  background:var(--surface-2);
  border-radius:10px;
  padding:10px;
}
.cape-card h3{
  font-size:15px;
  margin:12px 0 4px;
}
.cape-card .muted{
  font-size:11px;
  color:var(--text-muted);
  word-break:break-all;
}
.cape-card .hash{
  font-size:10px;
  color:#5b6779;
  word-break:break-all;
}
.cape-card img{cursor:pointer;}
.cape-modal-backdrop{
  display:none;
  position:fixed;
  inset:0;
  background:rgba(3,6,12,.78);
  z-index:1000;
  align-items:center;
  justify-content:center;
  padding:24px;
}
.cape-modal-backdrop.open{display:flex;}
.cape-modal{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
  max-width:640px;
  width:100%;
  max-height:85vh;
  overflow-y:auto;
  padding:24px;
  position:relative;
}
.cape-modal-close{
  position:absolute;
  top:14px;
  right:14px;
  width:32px;
  height:32px;
  border-radius:8px;
  border:1px solid var(--border);
  background:var(--surface-2);
  color:var(--text-muted);
  font-size:16px;
  cursor:pointer;
  line-height:1;
}
.cape-modal-close:hover{color:#fff;border-color:var(--accent);}
.cape-modal h2{
  font-size:18px;
  margin:0 0 4px;
  padding-right:36px;
}
.cape-modal .muted{font-size:12px;color:var(--text-muted);margin-bottom:18px;}
.cape-modal-section-title{
  font-size:12px;
  text-transform:uppercase;
  letter-spacing:.5px;
  color:var(--text-muted);
  margin:18px 0 10px;
}
.cape-modal-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(120px,1fr));
  gap:14px;
}
.cape-modal-item{text-align:center;}
.cape-modal-item img{
  width:100%;
  max-width:140px;
  image-rendering:pixelated;
  background:var(--surface-2);
  border-radius:10px;
  padding:8px;
  border:1px solid var(--border);
}
.cape-modal-item span{
  display:block;
  margin-top:6px;
  font-size:11px;
  color:var(--text-muted);
}
.player-card{
  padding:20px;
  text-align:center;
}
.player-card h3{
  font-size:16px;
  margin:0 0 8px;
}
.btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:12px 22px;
  border-radius:999px;
  font-weight:700;
  font-size:14px;
  text-decoration:none;
  border:none;
  cursor:pointer;
  transition:.15s;
}
.btn-primary{
  background:linear-gradient(135deg,var(--accent),var(--accent-2));
  color:#08101c;
}
.btn-primary:hover{filter:brightness(1.08);}
.btn-outline{
  background:transparent;
  border:1px solid var(--border);
  color:var(--text);
}
.btn-outline:hover{background:var(--surface-2);}
.btn-danger{
  background:#c0392b;
  color:white;
}
.btn-danger:hover{background:var(--danger);}
.btn-danger:disabled,.btn-outline:disabled{
  background:#3a4457;
  color:#94a1b5;
  cursor:default;
}
.btn-block{width:100%;}
.download-row{
  display:flex;
  gap:14px;
  flex-wrap:wrap;
  justify-content:center;
  margin-top:18px;
}
.compat-row{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  justify-content:center;
  margin-top:22px;
}
.compat-chip{
  display:flex;
  align-items:center;
  gap:6px;
  padding:6px 12px;
  border-radius:999px;
  border:1px solid var(--border);
  background:var(--surface);
  font-size:12px;
  font-weight:600;
  color:var(--text-muted);
}
.compat-chip .dot{
  width:6px;height:6px;border-radius:50%;
  background:var(--accent);
}
.tutorial-steps{
  display:grid;
  gap:14px;
}
.step{
  display:flex;
  gap:16px;
  padding:20px;
  align-items:flex-start;
}
.step .num{
  flex:none;
  width:34px;height:34px;
  border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-weight:700;
  background:rgba(49,183,255,.12);
  color:var(--accent);
  border:1px solid rgba(49,183,255,.3);
}
.step h4{margin:2px 0 6px;font-size:16px;}
.step p{margin:0;color:var(--text-muted);font-size:14px;line-height:1.5;}
.rules-list{
  display:grid;
  gap:12px;
  padding:22px;
}
.rules-list li{
  display:flex;
  gap:10px;
  color:var(--text-muted);
  font-size:14px;
  line-height:1.5;
}
.rules-list li::before{
  content:"—";
  color:var(--danger);
  font-weight:700;
}
.nav-left{
  display:flex;
  align-items:center;
  gap:14px;
  flex-wrap:wrap;
}
.lang-switch{
  display:flex;
  gap:4px;
  flex-wrap:wrap;
  padding-left:12px;
  border-left:1px solid var(--border);
}
.lang-switch button{
  width:26px;height:20px;
  padding:0;
  border-radius:4px;
  border:1px solid var(--border);
  background:transparent;
  cursor:pointer;
  opacity:.55;
  transition:.15s;
  display:flex;align-items:center;justify-content:center;
  overflow:hidden;
}
.lang-switch button svg{
  width:100%;height:100%;
  display:block;
}
.lang-switch button:hover{
  opacity:1;
}
.lang-switch button.active{
  opacity:1;
  border-color:rgba(49,183,255,.6);
  box-shadow:0 0 0 2px rgba(49,183,255,.25);
}
.msg,.empty{color:var(--text-muted);}
.center{text-align:center;}
.search-box{
  width:100%;
  max-width:360px;
  margin:0 auto 28px;
  display:block;
  padding:12px 16px;
  border-radius:999px;
  border:1px solid var(--border);
  background:var(--surface);
  color:var(--text);
  font-size:14px;
}
.search-box:focus{outline:none;border-color:var(--accent);}
.contact-card{
  display:flex;
  align-items:center;
  gap:18px;
  padding:24px;
  flex-wrap:wrap;
}
.contact-card .discord-icon{
  flex:none;
  width:48px;height:48px;
  border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  background:rgba(88,101,242,.15);
  border:1px solid rgba(88,101,242,.35);
}
.contact-card .discord-icon svg{width:26px;height:26px;}
.contact-card .info{flex:1;min-width:200px;}
.contact-card h3{margin:0 0 4px;font-size:16px;}
.contact-card p{margin:0;font-size:13px;color:var(--text-muted);}
.contact-card .username-row{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
}
.contact-card .username{
  font-family:monospace;
  font-size:14px;
  background:var(--surface-2);
  padding:6px 12px;
  border-radius:8px;
  border:1px solid var(--border);
}
.footer{
  text-align:center;
  color:var(--text-muted);
  font-size:13px;
  padding:40px 24px 28px;
  border-top:1px solid var(--border);
  margin-top:20px;
}
.footer .sponsor{
  margin-top:10px;
  font-size:12px;
}
.footer .sponsor a{
  color:var(--accent);
  text-decoration:none;
  font-weight:600;
}
.footer .sponsor a:hover{
  text-decoration:underline;
}
@media(max-width:640px){
  .hero h1{font-size:30px;}
  .nav{
    flex-wrap:wrap;
    justify-content:center;
    row-gap:10px;
    padding:12px 16px;
  }
  .nav-left{justify-content:center;}
  .nav-links{
    order:1;
    width:100%;
    justify-content:center;
  }
  .container{padding:32px 16px 60px;}
  .download-row{flex-direction:column;align-items:stretch;}
}
`;

function pageShell({ title, activeNav, body, extraHead = "" }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR" translate="no">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google" content="notranslate">
<title>${title}</title>
<link rel="icon" type="image/png" href="/assets/logo.png">
<style>${SITE_STYLES}</style>
${extraHead}
</head>
<body>
<nav class="nav">
  <div class="nav-left">
    <a class="nav-brand" href="/">
      <img class="logo-img" src="/assets/logo.png" alt="AdaptiveCaps">
      <span class="brand-text">AdaptiveCaps</span>
    </a>
    <div class="lang-switch" id="lang-switch">
      <button data-lang="pt-BR" title="Português" aria-label="Português">
        <svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="14" fill="#009739"/><polygon points="10,1.5 18.5,7 10,12.5 1.5,7" fill="#FEDD00"/><circle cx="10" cy="7" r="3.2" fill="#002776"/></svg>
      </button>
      <button data-lang="en" title="English" aria-label="English">
        <svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="14" fill="#B22234"/><g fill="#fff"><rect y="1.08" width="20" height="1.08"/><rect y="3.23" width="20" height="1.08"/><rect y="5.38" width="20" height="1.08"/><rect y="7.54" width="20" height="1.08"/><rect y="9.69" width="20" height="1.08"/><rect y="11.85" width="20" height="1.08"/></g><rect width="8" height="7.54" fill="#3C3B6E"/></svg>
      </button>
      <button data-lang="es" title="Español" aria-label="Español">
        <svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="14" fill="#AA151B"/><rect y="3.5" width="20" height="7" fill="#F1BF00"/></svg>
      </button>
      <button data-lang="fr" title="Français" aria-label="Français">
        <svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg"><rect width="6.67" height="14" fill="#0055A4"/><rect x="6.67" width="6.67" height="14" fill="#fff"/><rect x="13.33" width="6.67" height="14" fill="#EF4135"/></svg>
      </button>
      <button data-lang="de" title="Deutsch" aria-label="Deutsch">
        <svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="4.67" fill="#000"/><rect y="4.67" width="20" height="4.67" fill="#DD0000"/><rect y="9.33" width="20" height="4.67" fill="#FFCE00"/></svg>
      </button>
    </div>
  </div>
  <div class="nav-links" id="nav-links">
    <span class="nav-indicator" id="nav-indicator"></span>
    <a href="/" data-i18n="navHome" ${activeNav === "home" ? 'class="active"' : ""}>${escapeHtml(SITE_I18N["pt-BR"].navHome)}</a>
    <a href="/status" data-i18n="navStatus" ${activeNav === "status" ? 'class="active"' : ""}>${escapeHtml(SITE_I18N["pt-BR"].navStatus)}</a>
    <a href="/capes" data-i18n="navGallery" ${activeNav === "capes" ? 'class="active"' : ""}>${escapeHtml(SITE_I18N["pt-BR"].navGallery)}</a>
  </div>
</nav>
<script>
const I18N = ${JSON.stringify(SITE_I18N)};
const onLanguageChange = [];

function applyLanguage(lang) {
  const dict = I18N[lang] || I18N["pt-BR"];

  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    const key = el.getAttribute("data-i18n");
    if (dict[key] !== undefined) el.textContent = dict[key];
  });
  document.querySelectorAll("[data-i18n-feature]").forEach(function (el) {
    const parts = el.getAttribute("data-i18n-feature").split(":");
    const feature = dict.features && dict.features[Number(parts[0])];
    if (feature && feature[parts[1]] !== undefined) el.textContent = feature[parts[1]];
  });
  document.querySelectorAll("[data-i18n-group]").forEach(function (el) {
    const parts = el.getAttribute("data-i18n-group").split(":");
    const group = dict.tutorialGroups && dict.tutorialGroups[Number(parts[0])];
    if (!group) return;
    if (parts.length === 2 && parts[1] === "groupTitle") {
      el.textContent = group.groupTitle;
    } else if (parts.length === 3) {
      const step = group.steps && group.steps[Number(parts[1])];
      if (step && step[parts[2]] !== undefined) el.textContent = step[parts[2]];
    }
  });
  document.querySelectorAll("[data-i18n-rule]").forEach(function (el) {
    const index = Number(el.getAttribute("data-i18n-rule"));
    if (dict.rules && dict.rules[index] !== undefined) el.textContent = dict.rules[index];
  });

  document.documentElement.lang = lang;
  document.querySelectorAll("#lang-switch button").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
  try { localStorage.setItem("adaptivecaps_lang", lang); } catch {}

  onLanguageChange.forEach(function (cb) {
    try { cb(lang, dict); } catch {}
  });
}

document.querySelectorAll("#lang-switch button").forEach(function (btn) {
  btn.addEventListener("click", function () { applyLanguage(btn.dataset.lang); });
});

function formatDurationShort(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m " + (s % 60) + "s";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h " + (m % 60) + "m";
  const d = Math.floor(h / 24);
  return d + "d " + (h % 24) + "h";
}

function updateBanTimers() {
  const lang = document.documentElement.lang || "pt-BR";
  const dict = I18N[lang] || I18N["pt-BR"];
  document.querySelectorAll("[data-last-ban]").forEach(function (el) {
    const lastBan = Number(el.getAttribute("data-last-ban"));
    if (!lastBan) {
      el.textContent = dict.banTimerNone;
      return;
    }
    const elapsed = (Date.now() - lastBan) / 1000;
    el.textContent = dict.banTimerFormat.replace("{time}", formatDurationShort(elapsed));
  });
}

onLanguageChange.push(updateBanTimers);
document.addEventListener("DOMContentLoaded", updateBanTimers);
setInterval(updateBanTimers, 1000);

document.addEventListener("DOMContentLoaded", function () {
  // Precisa esperar o DOM terminar de parsear: esse script roda antes do
  // conteudo da pagina (\${body}) no HTML, entao os elementos com data-i18n
  // ainda nao existem se a gente tentar aplicar o idioma salvo na hora.
  try {
    const savedLang = localStorage.getItem("adaptivecaps_lang");
    if (savedLang && I18N[savedLang]) applyLanguage(savedLang);
  } catch {}
});

(function () {
  var nav = document.getElementById("nav-links");
  var indicator = document.getElementById("nav-indicator");
  if (!nav || !indicator) return;
  var links = Array.prototype.slice.call(nav.querySelectorAll("a"));

  function moveIndicatorTo(el, animate) {
    if (!el) {
      indicator.style.opacity = "0";
      return;
    }
    var navRect = nav.getBoundingClientRect();
    var rect = el.getBoundingClientRect();
    var x = rect.left - navRect.left;
    if (!animate) indicator.style.transition = "none";
    indicator.style.opacity = "1";
    indicator.style.width = rect.width + "px";
    indicator.style.transform = "translateX(" + x + "px)";
    if (!animate) {
      void indicator.offsetWidth;
      indicator.style.transition = "";
    }
  }

  moveIndicatorTo(nav.querySelector("a.active"), false);

  links.forEach(function (link) {
    link.addEventListener("click", function (event) {
      if (link.classList.contains("active")) return;
      event.preventDefault();
      moveIndicatorTo(link, true);
      setTimeout(function () {
        window.location.href = link.href;
      }, 280);
    });
  });

  window.addEventListener("resize", function () {
    moveIndicatorTo(nav.querySelector("a.active"), false);
  });
})();
</script>
${body}
<div class="footer">
  AdaptiveCaps Relay
  <div class="sponsor">Hospedagem parceira: <a href="${escapeHtml(SPONSOR_URL)}" target="_blank" rel="noopener sponsored">StreetHosting</a></div>
</div>
</body>
</html>`;
}

app.disable("x-powered-by");
app.set("trust proxy", true);
app.use("/assets", express.static(assetsDir, { maxAge: "7d" }));
app.use(express.json({ limit: `${jsonLimitBytes}b` }));

function computeStats(metadata, totalCapeFiles, storageSizeMb) {
  const totalPlayers = Object.keys(metadata).length;
  const visibleCapes = Object.values(metadata).filter(entry => entry?.visible === true).length;
  const bannedEntries = Object.values(metadata).filter(entry => entry?.banned === true);
  const bannedPlayers = bannedEntries.length;
  const lastBanAt = bannedEntries.reduce((max, entry) => {
    const value = Number(entry.bannedAt);
    return Number.isSafeInteger(value) && value > max ? value : max;
  }, 0);
  return {
    ok: true,
    version: packageVersion,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    totalPlayers,
    visibleCapes,
    bannedPlayers,
    lastBanAt,
    totalCapeFiles,
    storageSizeMb: Number(storageSizeMb)
  };
}

app.get("/api/v1/stats", async (req, res) => {
  try {
    const metadata = await readIndex();
    const totalCapeFiles = await countCapeFiles();
    const storageSizeMb = await getStorageSizeMb();
    return res.status(200).json(computeStats(metadata, totalCapeFiles, storageSizeMb));
  } catch (error) {
    return handleError(res, error);
  }
});

app.get("/", async (req, res) => {
  try {
    const metadata = await readIndex();
    const totalCapeFiles = await countCapeFiles();
    const storageSizeMb = await getStorageSizeMb();
    const stats = computeStats(metadata, totalCapeFiles, storageSizeMb);
    const featuredUuids = await readFeaturedUuids();
    const previewCapes = getFeaturedCapes(metadata, featuredUuids);
    return res.type("html").send(renderHomePage(stats, previewCapes));
  } catch (error) {
    return handleError(res, error);
  }
});
app.get("/status", async (req, res) => {
  try {
    const metadata = await readIndex();
    const totalCapeFiles = await countCapeFiles();
    const storageSizeMb = await getStorageSizeMb();
    const stats = computeStats(metadata, totalCapeFiles, storageSizeMb);
    return res.type("html").send(renderStatusPage(stats));
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

function listVisibleCapes(metadata) {
  return Object.values(metadata)
    .filter(entry => entry?.visible === true && entry?.hash)
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
    .map(entry => ({
      uuid: String(entry.uuid ?? ""),
      username: String(entry.username ?? ""),
      updatedAt: Number.isSafeInteger(entry.updatedAt) ? entry.updatedAt : 0,
      hash: String(entry.hash ?? ""),
      hasOriginal: Boolean(entry.originalFile),
      originalFormat: String(entry.originalFormat ?? ""),
      originalSize: Number.isSafeInteger(entry.originalSize) ? entry.originalSize : 0
    }));
}

app.get("/api/v1/admin/capes", async (req, res) => {
  try {
    requireAdmin(req);
    const metadata = await readIndex();
    return res.status(200).json({ ok: true, capes: listVisibleCapes(metadata) });
  } catch (error) {
    return handleError(res, error);
  }
});
app.get("/api/v1/admin/featured", async (req, res) => {
  try {
    requireAdmin(req);
    const uuids = await readFeaturedUuids();
    return res.status(200).json({ ok: true, uuids });
  } catch (error) {
    return handleError(res, error);
  }
});
app.post("/api/v1/admin/featured", async (req, res) => {
  try {
    requireAdmin(req);
    const body = req.body ?? {};
    const rawUuids = Array.isArray(body.uuids) ? body.uuids : [];

    if (rawUuids.length > featuredCapesMax) {
      throw httpError(400, "too_many_featured");
    }

    const seen = new Set();
    const uuids = [];

    for (const rawUuid of rawUuids) {
      const uuid = String(rawUuid ?? "").toLowerCase();
      if (!uuidPattern.test(uuid) || seen.has(uuid)) {
        continue;
      }
      seen.add(uuid);
      uuids.push(uuid);
    }

    await updateFeaturedUuids(current => {
      current.length = 0;
      current.push(...uuids);
    });

    console.info(`[FEATURED] admin definiu ${uuids.length} capa(s) em destaque`);
    return res.status(200).json({ ok: true, uuids });
  } catch (error) {
    return handleError(res, error);
  }
});
// Galeria publica (sem token, sem opcao de banir) - a mesma lista de capas
// visiveis, mas sem qualquer acao administrativa exposta.
app.get("/api/v1/capes/gallery", async (req, res) => {
  try {
    const metadata = await readIndex();
    return res.status(200).json({ ok: true, capes: listVisibleCapes(metadata) });
  } catch (error) {
    return handleError(res, error);
  }
});
app.get("/capes", (req, res) => {
  // Publica de proposito: so visualizacao, sem prompt de token e sem botao de
  // banir. A acao de banir fica isolada em /admincape (exige token), assim
  // ninguem precisa (nem tem motivo pra) salvar um link com token pra ver a
  // galeria publica.
  const t = SITE_I18N["pt-BR"];
  const body = `
<div class="container">
  <div class="hero">
    <h1 id="title" data-i18n="capesPageTitle">${escapeHtml(t.capesPageTitle)}</h1>
    <p data-i18n="capesPageDesc">${escapeHtml(t.capesPageDesc)}</p>
  </div>
  <input class="search-box" id="search" type="text" placeholder="${escapeHtml(t.searchPlaceholder)}">
  <label class="center" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:20px;font-size:13px;color:var(--text-muted);cursor:pointer">
    <input type="checkbox" id="original-only" checked>
    <span id="original-only-label" data-i18n="originalOnlyLabel">${escapeHtml(t.originalOnlyLabel)}</span>
  </label>
  <div id="content" class="cape-grid" style="margin-top:8px"><p class="msg center">${escapeHtml(t.loadingText)}</p></div>
</div>
<div class="cape-modal-backdrop" id="cape-modal-backdrop">
  <div class="cape-modal">
    <button class="cape-modal-close" id="cape-modal-close" aria-label="Close">&times;</button>
    <h2 id="cape-modal-username"></h2>
    <p class="muted" id="cape-modal-updated"></p>
    <p class="cape-modal-section-title" data-i18n="capeModalEquippedLabel">${escapeHtml(t.capeModalEquippedLabel)}</p>
    <div class="cape-modal-grid" id="cape-modal-equipped"></div>
    <p class="cape-modal-section-title" data-i18n="capeModalSlotsLabel">${escapeHtml(t.capeModalSlotsLabel)}</p>
    <div class="cape-modal-grid" id="cape-modal-slots"></div>
  </div>
</div>
<script>
const LOCALE_MAP = { "pt-BR": "pt-BR", en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE" };
let allCapes = [];
let lastQuery = "";
let capesDict = I18N[document.documentElement.lang] || I18N["pt-BR"];
let capeModalRequestId = 0;

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

async function loadCapes() {
  const content = document.getElementById("content");
  content.innerHTML = '<p class="msg center">' + escapeHtml(capesDict.loadingText) + '</p>';

  try {
    const response = await fetch("/api/v1/capes/gallery");
    if (!response.ok) {
      content.innerHTML = '<p class="msg center">' + escapeHtml(capesDict.errorLoadingText) + response.status + ').</p>';
      return;
    }

    const data = await response.json();
    allCapes = data.capes || [];
    renderCapes(currentFiltered());
  } catch (error) {
    content.innerHTML = '<p class="msg center">Erro: ' + escapeHtml(error.message) + '</p>';
  }
}

function renderCapes(capes) {
  document.getElementById("title").textContent = capesDict.capesPageTitle + " (" + capes.length + ")";
  const content = document.getElementById("content");

  if (capes.length === 0) {
    content.innerHTML = '<p class="msg center">' + escapeHtml(capesDict.noneFoundText) + '</p>';
    return;
  }

  const locale = LOCALE_MAP[document.documentElement.lang] || "pt-BR";

  content.innerHTML = capes.map(function (entry) {
    const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString(locale) : capesDict.unknownDate;
    // Miniatura do card usa sempre o PNG ja renderizado (pequeno) - usar o
    // arquivo original aqui (que pode ter varios MB, ex: GIFs) gerava um pico
    // de rede gigante toda vez que alguem abria a galeria publica.
    const imageUrl = "/cape-image/" + entry.uuid + ".png";
    return (
      '<div class="card cape-card">' +
      '<img src="' + imageUrl + '" alt="Cape ' + escapeHtml(entry.username || entry.uuid) + '" loading="lazy" ' +
      'data-uuid="' + escapeHtml(entry.uuid) + '" data-username="' + escapeHtml(entry.username || entry.uuid) + '" ' +
      'data-image="' + escapeHtml(imageUrl) + '" data-updated="' + escapeHtml(updated) + '">' +
      "<h3>" + escapeHtml(entry.username || "unknown") + "</h3>" +
      '<p class="muted">' + escapeHtml(capesDict.updatedLabel) + escapeHtml(updated) + "</p>" +
      '<p class="hash">' + escapeHtml(String(entry.hash || "").slice(0, 12)) + "...</p>" +
      "</div>"
    );
  }).join("");
}

document.getElementById("content").addEventListener("click", function (event) {
  const img = event.target.closest(".cape-card img");
  if (!img) {
    return;
  }
  openCapeModal(img.dataset.uuid, img.dataset.username, img.dataset.image, img.dataset.updated);
});

function capeMimeFromType(type) {
  return String(type || "").toUpperCase() === "GIF" ? "image/gif" : "image/png";
}

function renderCapeModalItem(imageSrc, label) {
  return (
    '<div class="cape-modal-item">' +
    '<a href="' + imageSrc + '" target="_blank"><img src="' + imageSrc + '" alt="' + escapeHtml(label) + '"></a>' +
    "<span>" + escapeHtml(label) + "</span>" +
    "</div>"
  );
}

async function openCapeModal(uuid, username, equippedImageUrl, updated) {
  const requestId = ++capeModalRequestId;
  document.getElementById("cape-modal-username").textContent = username;
  document.getElementById("cape-modal-updated").textContent = capesDict.updatedLabel + updated;
  document.getElementById("cape-modal-equipped").innerHTML = renderCapeModalItem(equippedImageUrl, capesDict.capeModalEquippedLabel);
  document.getElementById("cape-modal-slots").innerHTML = '<p class="msg" style="grid-column:1/-1">' + escapeHtml(capesDict.capeModalLoadingSlots) + "</p>";
  document.getElementById("cape-modal-backdrop").classList.add("open");

  try {
    const response = await fetch("/api/v1/library/" + encodeURIComponent(uuid));
    if (requestId !== capeModalRequestId) {
      return; // modal foi trocado/fechado antes dessa resposta chegar
    }
    const slotsContainer = document.getElementById("cape-modal-slots");
    if (!response.ok) {
      slotsContainer.innerHTML = '<p class="msg" style="grid-column:1/-1">' + escapeHtml(capesDict.capeModalNoSlots) + "</p>";
      return;
    }
    const data = await response.json();
    const slots = Array.isArray(data.slots) ? data.slots : [];
    if (slots.length === 0) {
      slotsContainer.innerHTML = '<p class="msg" style="grid-column:1/-1">' + escapeHtml(capesDict.capeModalNoSlots) + "</p>";
      return;
    }
    slotsContainer.innerHTML = slots
      .slice()
      .sort((a, b) => (a.slot || 0) - (b.slot || 0))
      .map(function (slot) {
        const src = "data:" + capeMimeFromType(slot.type) + ";base64," + slot.fileBase64;
        const label = capesDict.capeModalSlotLabel + (slot.slot || "?") + (slot.name && slot.name !== "Slot " + slot.slot ? " - " + slot.name : "");
        return renderCapeModalItem(src, label);
      })
      .join("");
  } catch (error) {
    if (requestId !== capeModalRequestId) {
      return;
    }
    document.getElementById("cape-modal-slots").innerHTML = '<p class="msg" style="grid-column:1/-1">' + escapeHtml(capesDict.capeModalNoSlots) + "</p>";
  }
}

function closeCapeModal() {
  capeModalRequestId++;
  document.getElementById("cape-modal-backdrop").classList.remove("open");
}

document.getElementById("cape-modal-close").addEventListener("click", closeCapeModal);
document.getElementById("cape-modal-backdrop").addEventListener("click", function (event) {
  if (event.target.id === "cape-modal-backdrop") {
    closeCapeModal();
  }
});
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    closeCapeModal();
  }
});

function currentFiltered() {
  let result = allCapes;
  if (document.getElementById("original-only").checked) {
    result = result.filter(entry => entry.hasOriginal);
  }
  if (lastQuery) {
    result = result.filter(entry => String(entry.username || "").toLowerCase().includes(lastQuery));
  }
  return result;
}

document.getElementById("search").addEventListener("input", function (event) {
  lastQuery = event.target.value.trim().toLowerCase();
  renderCapes(currentFiltered());
});

document.getElementById("original-only").addEventListener("change", function () {
  renderCapes(currentFiltered());
});

onLanguageChange.push(function (lang, dict) {
  capesDict = dict;
  document.getElementById("search").placeholder = dict.searchPlaceholder;
  renderCapes(currentFiltered());
});

loadCapes();
</script>`;
  return res.type("html").send(pageShell({ title: "AdaptiveCaps - Galeria", activeNav: "capes", body }));
});
app.get("/admincape", (req, res) => {
  // Mesmo padrao de /banned: o token de admin nunca fica no HTML nem na URL,
  // e pedido via prompt() e mantido so em memoria no navegador.
  const body = `
<div class="container">
  <div class="hero">
    <h1 id="title">Admin - Capas</h1>
    <p>Área restrita. Requer o token de admin para listar, banir e destacar capas na home.</p>
  </div>
  <div class="card center" id="featured-bar" style="padding:16px;margin-bottom:24px;display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap">
    <span id="featured-count">Destaques selecionados: 0/${featuredCapesMax}</span>
    <button class="btn btn-primary" id="save-featured-btn">Salvar destaques</button>
  </div>
  <div id="content" class="cape-grid"><p class="msg center">Carregando...</p></div>
</div>
<script>
let adminToken = "";
const FEATURED_MAX = ${featuredCapesMax};
let featuredUuids = new Set();

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function updateFeaturedCount() {
  document.getElementById("featured-count").textContent = "Destaques selecionados: " + featuredUuids.size + "/" + FEATURED_MAX;
  document.querySelectorAll(".featured-checkbox").forEach(function (checkbox) {
    if (!checkbox.checked) {
      checkbox.disabled = featuredUuids.size >= FEATURED_MAX;
    }
  });
}

async function loadCapes() {
  adminToken = window.prompt("Token de admin:") || "";
  if (!adminToken) {
    document.getElementById("content").innerHTML = '<p class="msg center">Token não informado.</p>';
    return;
  }

  const content = document.getElementById("content");
  content.innerHTML = '<p class="msg center">Carregando...</p>';

  try {
    const [capesResponse, featuredResponse] = await Promise.all([
      fetch("/api/v1/admin/capes", { headers: { "x-admin-token": adminToken } }),
      fetch("/api/v1/admin/featured", { headers: { "x-admin-token": adminToken } })
    ]);

    if (capesResponse.status === 403 || featuredResponse.status === 403) {
      content.innerHTML = '<p class="msg center">Token inválido.</p>';
      adminToken = "";
      return;
    }
    if (!capesResponse.ok) {
      content.innerHTML = '<p class="msg center">Falha ao carregar (status ' + capesResponse.status + ').</p>';
      return;
    }

    const capesData = await capesResponse.json();
    const featuredData = featuredResponse.ok ? await featuredResponse.json() : { uuids: [] };
    featuredUuids = new Set(featuredData.uuids || []);
    renderCapes(capesData.capes || []);
  } catch (error) {
    content.innerHTML = '<p class="msg center">Erro ao carregar: ' + escapeHtml(error.message) + '</p>';
  }
}

function renderCapes(capes) {
  document.getElementById("title").textContent = "Admin - Capas (" + capes.length + ")";
  const content = document.getElementById("content");

  if (capes.length === 0) {
    content.innerHTML = '<p class="msg center">Nenhuma capa visível encontrada.</p>';
    return;
  }

  content.innerHTML = capes.map(function (entry) {
    const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString("pt-BR") : "Desconhecido";
    const originalInfo = entry.hasOriginal
      ? (entry.originalFormat || "unknown").toUpperCase() + " • " + (entry.originalSize || 0) + " bytes"
      : "Sem original salvo";
    const imageUrl = entry.hasOriginal ? "/original-image/" + entry.uuid : "/cape-image/" + entry.uuid + ".png";
    const checked = featuredUuids.has(entry.uuid) ? "checked" : "";
    return (
      '<div class="card cape-card">' +
      '<a href="' + imageUrl + '" target="_blank">' +
      '<img src="' + imageUrl + '" alt="Cape ' + escapeHtml(entry.username || entry.uuid) + '">' +
      "</a>" +
      "<h3>" + escapeHtml(entry.username || "unknown") + "</h3>" +
      '<p class="muted">Atualizada: ' + escapeHtml(updated) + "</p>" +
      '<p class="muted">Original: ' + escapeHtml(originalInfo) + "</p>" +
      '<p class="hash">' + escapeHtml(String(entry.hash || "").slice(0, 12)) + "...</p>" +
      '<label style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:12px;font-size:13px;color:var(--text-muted)">' +
      '<input type="checkbox" class="featured-checkbox" data-uuid="' + escapeHtml(entry.uuid) + '" ' + checked + '> Destacar na home' +
      "</label>" +
      '<button class="btn btn-danger btn-block" style="margin-top:10px" data-uuid="' + escapeHtml(entry.uuid) + '" data-name="' + escapeHtml(entry.username || entry.uuid) + '">Banir capa</button>' +
      "</div>"
    );
  }).join("");

  content.querySelectorAll("button[data-uuid]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      banCape(btn.dataset.uuid, btn.dataset.name, btn);
    });
  });

  content.querySelectorAll(".featured-checkbox").forEach(function (checkbox) {
    checkbox.addEventListener("change", function () {
      const uuid = checkbox.dataset.uuid;
      if (checkbox.checked) {
        featuredUuids.add(uuid);
      } else {
        featuredUuids.delete(uuid);
      }
      updateFeaturedCount();
    });
  });

  updateFeaturedCount();
}

async function banCape(uuid, name, btn) {
  if (!window.confirm("Banir a capa de " + name + "? Isso apaga os arquivos do servidor e bloqueia novos envios até desbanir.")) {
    return;
  }
  btn.disabled = true;
  btn.textContent = "Banindo...";
  try {
    const response = await fetch("/api/v1/admin/ban/" + uuid, {
      method: "POST",
      headers: { "x-admin-token": adminToken }
    });
    if (!response.ok) {
      alert("Falha ao banir (status " + response.status + ").");
      btn.disabled = false;
      btn.textContent = "Banir capa";
      return;
    }
    loadCapes();
  } catch (error) {
    alert("Erro ao banir: " + error.message);
    btn.disabled = false;
    btn.textContent = "Banir capa";
  }
}

async function saveFeatured() {
  const btn = document.getElementById("save-featured-btn");
  btn.disabled = true;
  btn.textContent = "Salvando...";
  try {
    const response = await fetch("/api/v1/admin/featured", {
      method: "POST",
      headers: { "x-admin-token": adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ uuids: Array.from(featuredUuids) })
    });
    if (!response.ok) {
      alert("Falha ao salvar (status " + response.status + ").");
      return;
    }
    alert("Destaques salvos!");
  } catch (error) {
    alert("Erro ao salvar: " + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Salvar destaques";
  }
}

document.getElementById("save-featured-btn").addEventListener("click", saveFeatured);

loadCapes();
</script>`;
  return res.type("html").send(pageShell({ title: "AdaptiveCaps Admin - Capas", activeNav: "", body }));
});
app.get("/api/v1/admin/banned", async (req, res) => {
  try {
    requireAdmin(req);
    const metadata = await readIndex();
    const banned = Object.values(metadata)
      .filter(entry => entry?.banned === true)
      .sort((a, b) => Number(b.bannedAt ?? 0) - Number(a.bannedAt ?? 0))
      .map(entry => ({
        uuid: String(entry.uuid ?? ""),
        username: String(entry.username ?? ""),
        bannedAt: Number.isSafeInteger(entry.bannedAt) ? entry.bannedAt : 0
      }));

    return res.status(200).json({ ok: true, banned });
  } catch (error) {
    return handleError(res, error);
  }
});
app.get("/banned", (req, res) => {
  // O token de admin NUNCA e embutido nesta pagina nem passado por query string
  // (ficaria no historico do navegador e nos logs de acesso). O proprio admin
  // digita o token no navegador via prompt(); ele so existe em memoria do lado
  // do cliente e e enviado apenas como header em cada chamada.
  const body = `
<div class="container">
  <div class="hero">
    <h1 id="title">Jogadores Banidos</h1>
    <p>Área restrita. Requer o token de admin para listar e desbanir jogadores.</p>
  </div>
  <div id="content" class="cape-grid"><p class="msg center">Carregando...</p></div>
</div>
<script>
let adminToken = "";

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

async function loadBanned() {
  adminToken = window.prompt("Token de admin:") || "";
  if (!adminToken) {
    document.getElementById("content").innerHTML = '<p class="msg center">Token não informado.</p>';
    return;
  }

  const content = document.getElementById("content");
  content.innerHTML = '<p class="msg center">Carregando...</p>';

  try {
    const response = await fetch("/api/v1/admin/banned", { headers: { "x-admin-token": adminToken } });
    if (response.status === 403) {
      content.innerHTML = '<p class="msg center">Token inválido.</p>';
      adminToken = "";
      return;
    }
    if (!response.ok) {
      content.innerHTML = '<p class="msg center">Falha ao carregar (status ' + response.status + ').</p>';
      return;
    }

    const data = await response.json();
    renderBanned(data.banned || []);
  } catch (error) {
    content.innerHTML = '<p class="msg center">Erro ao carregar: ' + escapeHtml(error.message) + '</p>';
  }
}

function renderBanned(banned) {
  document.getElementById("title").textContent = "Jogadores Banidos (" + banned.length + ")";
  const content = document.getElementById("content");

  if (banned.length === 0) {
    content.innerHTML = '<p class="empty center">Nenhum jogador banido no momento.</p>';
    return;
  }

  content.innerHTML = banned.map(function (entry) {
    const bannedAt = entry.bannedAt ? new Date(entry.bannedAt).toLocaleString("pt-BR") : "Desconhecido";
    return (
      '<div class="card player-card">' +
      "<h3>" + escapeHtml(entry.username || "unknown") + "</h3>" +
      '<p class="hash">' + escapeHtml(entry.uuid) + "</p>" +
      '<p class="muted">Banido em: ' + escapeHtml(bannedAt) + "</p>" +
      '<button class="btn btn-outline btn-block" style="margin-top:12px;border-color:#1f9d55;color:#3ddc84" data-uuid="' + escapeHtml(entry.uuid) + '" data-name="' + escapeHtml(entry.username || entry.uuid) + '">Desbanir</button>' +
      "</div>"
    );
  }).join("");

  content.querySelectorAll("button[data-uuid]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      unbanPlayer(btn.dataset.uuid, btn.dataset.name, btn);
    });
  });
}

async function unbanPlayer(uuid, name, btn) {
  if (!window.confirm("Desbanir " + name + "?")) {
    return;
  }
  btn.disabled = true;
  btn.textContent = "Desbanindo...";
  try {
    const response = await fetch("/api/v1/admin/unban/" + uuid, {
      method: "POST",
      headers: { "x-admin-token": adminToken }
    });
    if (!response.ok) {
      alert("Falha ao desbanir (status " + response.status + ").");
      btn.disabled = false;
      btn.textContent = "Desbanir";
      return;
    }
    loadBanned();
  } catch (error) {
    alert("Erro ao desbanir: " + error.message);
    btn.disabled = false;
    btn.textContent = "Desbanir";
  }
}

loadBanned();
</script>`;
  return res.type("html").send(pageShell({ title: "AdaptiveCaps - Banidos", activeNav: "", body }));
});
app.get("/api/v1/health", (req, res) => {
  return res.json(healthPayload());
});
const aiCooldowns = new Map();

// Sem isso, aiCooldowns cresce para sempre (uma entrada por UUID que ja usou
// o gerador de IA alguma vez). O cooldown em si e de 30s, entao qualquer
// entrada mais velha que isso ja nao serve pra nada.
setInterval(() => {
  const cutoff = Date.now() - 30000;

  for (const [uuid, lastUse] of aiCooldowns) {
    if (lastUse < cutoff) {
      aiCooldowns.delete(uuid);
    }
  }
}, 5 * 60 * 1000).unref();

app.post("/api/v1/ai/generate-cape", async (req, res) => {
  try {
    const body = req.body ?? {};

    const uuid = normalizeUuid(body.uuid);
    const username = sanitizeUsername(body.username);
    // 300 (nao 180) de proposito: o mod (versoes ja instaladas) embrulha o
    // texto do jogador num template fixo de ~148 caracteres antes de mandar
    // pra ca, entao um prompt de usuario perto do limite de 96 chars do campo
    // de texto do mod resulta em ~244 caracteres. Cortar em 180 truncava esse
    // embrulho no meio, quebrando a deteccao/remocao dele em buildAiCapePrompt
    // e fazendo o "boilerplate" tecnico voltar a dominar o prompt final.
    const prompt = String(body.prompt ?? "").trim().slice(0, 300);
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

    // Leitura rapida (fora do lock) so para rejeitar cedo o caso comum de
    // "nao esta banido" antes de fazer qualquer I/O de arquivo. O status real
    // e reconferido dentro do lock, logo antes de gravar, la embaixo.
    const precheck = await readIndex();

    if (precheck[uuid]?.banned) {
      throw httpError(
        403,
        "banned",
        "Sua capa foi removida do Cloud Sync por um moderador. Você ainda pode usar qualquer capa localmente (só você vai vê-la), mas ela não vai sincronizar nem aparecer para outros jogadores. Para pedir revisão, chame @luisfilipejdds no Discord."
      );
    }

    if (!visible) {
      const entry = await updateIndexEntry(metadata => {
        metadata[uuid] = {
          ...(metadata[uuid] ?? {}),
          uuid,
          username,
          visible: false,
          updatedAt
        };
        return metadata[uuid];
      });

      console.info(`[VISIBILITY] ${username || "unknown"} (${uuid.substring(0, 4)}****) invisible`);
      return res.status(200).json(toCapeResponse(entry, ""));
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

    const animated = Boolean(body.animated) || originalFormat === "gif";
    const frameCount = Number.isSafeInteger(body.frameCount) && body.frameCount > 0 ? body.frameCount : 0;
    const fps = Number.isSafeInteger(body.fps) && body.fps > 0 ? body.fps : 0;

    const entry = await updateIndexEntry(metadata => {
      if (metadata[uuid]?.banned) {
        throw httpError(
          403,
          "banned",
          "Sua capa foi removida do Cloud Sync por um moderador. Você ainda pode usar qualquer capa localmente (só você vai vê-la), mas ela não vai sincronizar nem aparecer para outros jogadores. Para pedir revisão, chame @luisfilipejdds no Discord."
        );
      }

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
        animated,
        frameCount,
        fps,
        visible: true,
        updatedAt
      };
      return metadata[uuid];
    });

    console.info(`[UPLOAD] ${username || "unknown"} (${uuid.substring(0, 4)}****) render=${renderPng.length} original=${originalSize}`);

    return res.status(200).json(toCapeResponse(entry, renderPng.toString("base64")));
  } catch (error) {
    return handleError(res, error);
  }
});

app.post("/api/v1/admin/ban/:uuid", async (req, res) => {
  try {
    requireAdmin(req);
    const uuid = normalizeUuid(req.params.uuid);

    await purgePlayerFiles(uuid);

    const entry = await updateIndexEntry(metadata => {
      const existing = metadata[uuid] ?? {};

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
      return metadata[uuid];
    });

    console.info(`[BAN] ${entry.username || "unknown"} (${uuid.substring(0, 4)}****) banido pelo admin`);
    return res.status(200).json({ ok: true, uuid, banned: true });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post("/api/v1/admin/unban/:uuid", async (req, res) => {
  try {
    requireAdmin(req);
    const uuid = normalizeUuid(req.params.uuid);

    const entry = await updateIndexEntry(metadata => {
      const existing = metadata[uuid];

      if (!existing) {
        throw httpError(404, "not_found");
      }

      metadata[uuid] = { ...existing, banned: false };
      return metadata[uuid];
    });

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

    // Le o index uma unica vez (em vez de uma leitura+parse completa do
    // index.json por UUID) e busca os arquivos em paralelo. Tambem isola cada
    // entrada com catch: uma capa corrompida/com hash divergente nao pode
    // derrubar a resposta inteira e impedir que os outros jogadores da mesma
    // chamada recebam a capa deles.
    const metadata = await readIndex();
    const results = await Promise.all(
      uuids.map(uuid =>
        loadCape(uuid, metadata).catch(error => {
          console.error(`[BULK] falha ao carregar capa ${uuid}:`, error?.message ?? error);
          return null;
        })
      )
    );

    return res.status(200).json({ capes: results.filter(Boolean) });
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

    await updateLibraryIndexEntry(index => {
      index[uuid] = { uuid, username, updatedAt, slots: storedSlots };
      return index[uuid];
    });

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

async function loadCape(uuid, preloadedMetadata) {
  const metadata = preloadedMetadata ?? (await readIndex());
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
  await writeJsonAtomic(indexFile, metadata);
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
  await writeJsonAtomic(libraryIndexFile, index);
}

// Grava em um arquivo temporario no mesmo diretorio e so entao renomeia por cima
// do arquivo final. rename() e atomico no mesmo filesystem, entao um leitor
// concorrente sempre ve a versao antiga completa ou a nova completa - nunca um
// JSON pela metade. Sem isso, um upload grande (index.json cresce com o tempo)
// podia ser lido no meio da escrita por outra requisicao simultanea, quebrando
// com "Unexpected end of JSON input".
async function writeJsonAtomic(targetFile, data) {
  await fs.mkdir(path.dirname(targetFile), { recursive: true });

  const tempFile = `${targetFile}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await fs.writeFile(tempFile, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempFile, targetFile);
}

// fs.rename() torna cada escrita individual atomica, mas nao protege contra
// "lost update": duas requisicoes concorrentes (ex.: dois jogadores enviando
// capa ao mesmo tempo, ou um admin banindo enquanto outro jogador envia) cada
// uma le o index inteiro, mexe so na propria entrada, e escreve o index
// inteiro de volta - a segunda escrita apaga a mudanca da primeira porque
// partiu de uma copia desatualizada de todo o resto. Esse mutex serializa o
// ciclo ler-mudar-escrever para que cada atualizacao sempre parta do estado
// mais recente ja confirmado em disco.
function createMutex() {
  let tail = Promise.resolve();

  return function withLock(fn) {
    const run = tail.then(() => fn());
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

const indexLock = createMutex();
const libraryIndexLock = createMutex();
const featuredLock = createMutex();

async function updateIndexEntry(mutate) {
  return indexLock(async () => {
    const metadata = await readIndex();
    const result = await mutate(metadata);
    await writeIndex(metadata);
    return result;
  });
}

async function updateLibraryIndexEntry(mutate) {
  return libraryIndexLock(async () => {
    const index = await readLibraryIndex();
    const result = await mutate(index);
    await writeLibraryIndex(index);
    return result;
  });
}

async function readFeaturedUuids() {
  try {
    const raw = await fs.readFile(featuredFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(value => typeof value === "string") : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeFeaturedUuids(uuids) {
  await writeJsonAtomic(featuredFile, uuids);
}

async function updateFeaturedUuids(mutate) {
  return featuredLock(async () => {
    const uuids = await readFeaturedUuids();
    const result = await mutate(uuids);
    await writeFeaturedUuids(uuids);
    return result;
  });
}

// Retorna as capas escolhidas pelo admin para aparecer na home, na ordem em
// que foram escolhidas. Pula uuids que nao existem mais ou que deixaram de
// ser visiveis (banimento, capa apagada, etc.) sem quebrar a lista inteira.
// Se o admin nunca escolheu nada (ou todas as escolhas ficaram invalidas),
// cai de volta pras mais recentes - a home nunca fica vazia por omissao.
function getFeaturedCapes(metadata, featuredUuids) {
  const featured = featuredUuids
    .map(uuid => metadata[uuid])
    .filter(entry => entry?.visible === true && entry?.hash)
    .map(entry => ({
      uuid: String(entry.uuid ?? ""),
      username: String(entry.username ?? ""),
      updatedAt: Number.isSafeInteger(entry.updatedAt) ? entry.updatedAt : 0,
      hash: String(entry.hash ?? ""),
      hasOriginal: Boolean(entry.originalFile),
      originalFormat: String(entry.originalFormat ?? ""),
      originalSize: Number.isSafeInteger(entry.originalSize) ? entry.originalSize : 0
    }));

  if (featured.length > 0) {
    return featured.slice(0, featuredCapesMax);
  }

  return listVisibleCapes(metadata).slice(0, featuredCapesMax);
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

  // Somente header - query string ficaria no historico do navegador e nos logs
  // de acesso (mesmo motivo pelo qual /capes e /banned usam prompt() + header).
  const provided = String(req.get("x-admin-token") ?? "");
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
    animated: Boolean(entry.animated) || entry.originalFormat === "gif",
    frameCount: Number.isSafeInteger(entry.frameCount) ? entry.frameCount : 0,
    fps: Number.isSafeInteger(entry.fps) ? entry.fps : 0,
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
// Versoes antigas do mod ja embrulham o texto do jogador com o proprio
// boilerplate ("Minecraft cape texture, 64x32 pixel art layout, X theme,
// high contrast, clean centered design, no text, no watermark, sharp pixels,
// cape back design."). Se a gente colar OUTRO boilerplate por cima (como
// fazia antes) mais "anime style, main color purple" no final, o pedido real
// do jogador (ex.: "a house") fica espremido no meio de uma pilha de termos
// tecnicos repetidos e o estilo/cor no final acaba dominando tudo - testamos
// e o resultado era sempre uma variacao do mesmo desenho generico, ignorando
// o assunto pedido. Por isso: (1) se detectar esse embrulho antigo, extrai so
// o assunto real de dentro dele; (2) poe o assunto em PRIMEIRO lugar no
// prompt final, com o resto como modificador leve, nao dominante.
const LEGACY_CLIENT_WRAPPER =
  /^Minecraft cape texture,\s*64x32 pixel art layout,\s*(.+?)\s*theme,\s*high contrast,\s*clean centered design,\s*no text,\s*no watermark,\s*sharp pixels,\s*cape back design\.?$/i;

function buildAiCapePrompt(prompt, style, mainColor, quality) {
  const trimmed = String(prompt ?? "").trim();
  const legacyMatch = LEGACY_CLIENT_WRAPPER.exec(trimmed);
  // Limita o assunto DEPOIS de extrair (nao antes) - assim o limite de tamanho
  // nunca corta o fecho do embrulho legado e quebra a deteccao acima.
  const subject = (legacyMatch ? legacyMatch[1].trim() : trimmed).slice(0, 180);

  // Nao mencionamos a palavra "cape" aqui de proposito: o modelo tende a
  // interpretar isso literalmente como "desenhe um manto/capa vestida" (uma
  // peca de pano pendurada), em vez de tratar a imagem como um icone plano -
  // o que competia com o assunto pedido e as vezes produzia um pano/manto
  // generico por cima em vez do desenho em si.
  const parts = [
    subject,
    "flat 2D game icon texture, no garment, no clothing shape, no fabric folds or drapery",
    "64x32 pixel art, sharp pixels",
    "centered symmetrical design",
    "no text, no watermark, no logo"
  ];

  if (style) {
    parts.push(`${style} style`);
  }

  if (mainColor) {
    parts.push(`accented with ${mainColor}`);
  }

  if (quality === "high") {
    parts.push("high detail");
  }

  return parts.join(", ");
}

// FLUX.1-schnell via Hugging Face era rapido mas ignorava boa parte do prompt
// (destilado pra 1-4 steps). Tentamos FLUX.1-dev (mais fiel ao prompt) no
// mesmo provedor, mas a Hugging Face descontinuou esse modelo no tier gratis
// ("hf-inference") - retorna 410 deprecated. Pollinations.ai expoe o Flux de
// verdade (nao destilado) de graca e sem token/conta nenhuma, entao trocamos
// para la: melhor fidelidade ao prompt E sem dependencia de credencial.
const AI_QUALITY_DIMENSIONS = {
  standard: { width: 768, height: 384 },
  high: { width: 1152, height: 576 }
};

async function generateFluxImage(prompt, quality) {
  const dimensions = AI_QUALITY_DIMENSIONS[quality] ?? AI_QUALITY_DIMENSIONS.standard;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    // Seed aleatorio a cada chamada: sem isso, o mesmo prompt+dimensoes
    // sempre voltaria a mesma imagem (Pollinations usa a URL como chave).
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=${dimensions.width}&height=${dimensions.height}&model=flux&nologo=true&seed=${seed}`;

    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error) {
      clearTimeout(timeout);

      if (error.name === "AbortError") {
        if (attempt < 2) {
          continue;
        }
        throw httpError(504, "ai_timeout", "A geração demorou demais e foi cancelada. Tente novamente.");
      }

      if (attempt < 2) {
        continue;
      }
      throw httpError(502, "ai_provider_error");
    }
    clearTimeout(timeout);

    if (!response.ok) {
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      const errorText = await response.text().catch(() => "");
      console.error("[AI] Pollinations error:", response.status, errorText.slice(0, 300));
      throw httpError(502, "ai_provider_error");
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.startsWith("image/")) {
      const bodyText = await response.text().catch(() => "");
      console.error("[AI] Pollinations retornou resposta que não é imagem:", contentType, bodyText.slice(0, 300));

      if (attempt < 2) {
        continue;
      }
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
function formatUptime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDurationShort(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const STATUS_ICONS = {
  players: '<circle cx="12" cy="8" r="3.5"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"/>',
  capes: '<path d="M8 4.5 4.5 7v3.5H7V19h10v-8.5h2.5V7L16 4.5l-2 2h-4l-2-2z"/>',
  files: '<path d="M3 6.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  banned: '<path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z"/><path d="M9.3 9.3l5.4 5.4M14.7 9.3l-5.4 5.4"/>'
};

function statIcon(name) {
  return `<div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${STATUS_ICONS[name]}</svg></div>`;
}

function banTimerHtml(t, stats) {
  if (!stats.lastBanAt) {
    return `<div class="ban-timer" data-last-ban="0">${escapeHtml(t.banTimerNone)}</div>`;
  }
  const timeText = escapeHtml(t.banTimerFormat.replace("{time}", formatDurationShort(Math.floor((Date.now() - stats.lastBanAt) / 1000))));
  return `<div class="ban-timer" data-last-ban="${stats.lastBanAt}">${timeText}</div>`;
}

function renderStatusPage(stats) {
  const t = SITE_I18N["pt-BR"];
  const body = `
<div class="container">
  <div class="hero">
    <h1 data-i18n="statusPageTitle">${escapeHtml(t.statusPageTitle)}</h1>
    <p data-i18n="statusPageDesc">${escapeHtml(t.statusPageDesc)}</p>
  </div>

  <div class="card status-banner">
    <div class="status-pulse"></div>
    <div>
      <div class="status-banner-title" data-i18n="statOnline">${escapeHtml(t.statOnline)}</div>
      <div class="status-banner-sub">
        <span data-i18n="statVersion">${escapeHtml(t.statVersion)}</span> ${escapeHtml(stats.version)}
        &nbsp;·&nbsp;
        <span data-i18n="statUptime">${escapeHtml(t.statUptime)}</span> ${escapeHtml(formatUptime(stats.uptimeSeconds))}
      </div>
    </div>
  </div>

  <h2 class="section-title"><span class="bar"></span><span data-i18n="statsTitle">${escapeHtml(t.statsTitle)}</span></h2>
  <div class="stat-grid stat-grid-icons">
    <div class="card stat-tile stat-tile-icon">
      ${statIcon("players")}
      <div class="value">${stats.totalPlayers}</div>
      <div class="label" data-i18n="statPlayers">${escapeHtml(t.statPlayers)}</div>
    </div>
    <div class="card stat-tile stat-tile-icon">
      ${statIcon("capes")}
      <div class="value">${stats.visibleCapes}</div>
      <div class="label" data-i18n="statCapes">${escapeHtml(t.statCapes)}</div>
    </div>
    <div class="card stat-tile stat-tile-icon">
      ${statIcon("files")}
      <div class="value">${stats.totalCapeFiles}</div>
      <div class="label" data-i18n="statFiles">${escapeHtml(t.statFiles)}</div>
    </div>
    <div class="card stat-tile stat-tile-icon stat-tile-danger">
      ${statIcon("banned")}
      <div class="value">${stats.bannedPlayers}</div>
      <div class="label" data-i18n="statBanned">${escapeHtml(t.statBanned)}</div>
      ${banTimerHtml(t, stats)}
    </div>
  </div>

  <div class="center" style="margin-top:36px">
    <a class="btn btn-outline" href="/capes" data-i18n="viewGalleryBtn">${escapeHtml(t.viewGalleryBtn)}</a>
  </div>
</div>`;
  return pageShell({ title: "AdaptiveCaps - Status", activeNav: "status", body });
}

const SITE_I18N = {
  "pt-BR": {
    heroBadge: "Sincronização de capas em nuvem",
    heroTitle: "AdaptiveCaps",
    heroSubtitle: "Escolha, crie ou gere com IA a capa do seu personagem, e leve ela pra qualquer servidor que você jogar.",
    featuresTitle: "Recursos",
    features: [
      { title: "Gerador com IA", desc: "Descreva o que quiser e gere uma capa única, de graça." },
      { title: "Biblioteca com slots", desc: "Salve até 5 capas e troque entre elas quando quiser." },
      { title: "Sincronia em nuvem", desc: "Sua capa aparece em qualquer servidor que tenha o mod." },
      { title: "100% gratuito", desc: "Sem assinatura, sem anúncio, sem pegadinha." }
    ],
    statsTitle: "Status",
    statOnline: "Online",
    statPlayers: "Jogadores",
    statCapes: "Capas visíveis",
    statBanned: "Jogadores banidos",
    banTimerFormat: "há {time}",
    banTimerNone: "Nenhum banimento registrado",
    statStorage: "Dados armazenados",
    galleryTitle: "Algumas capas da comunidade",
    galleryDesc: "Uma amostra das capas que os jogadores deixaram públicas.",
    galleryCta: "Ver galeria completa",
    galleryEmpty: "Nenhuma capa pública ainda. Seja o primeiro a compartilhar a sua!",
    tutorialTitle: "Tutoriais",
    tutorialGroups: [
      {
        groupTitle: "1. Instalando o mod",
        steps: [
          { title: "Instale o mod loader", desc: "Baixe e instale o Fabric ou o NeoForge, de acordo com a versão do Minecraft que você usa." },
          { title: "Baixe o AdaptiveCaps", desc: "Pegue o arquivo do mod no Modrinth ou na CurseForge (links abaixo) e coloque na pasta \"mods\" da sua instalação." },
          { title: "Abra o jogo e o menu da capa", desc: "Entre em qualquer mundo/servidor e use a tecla de atalho do AdaptiveCaps (configurável em Opções > Controles) pra abrir a tela de personalização." }
        ]
      },
      {
        groupTitle: "2. Enviando uma imagem para a capa",
        steps: [
          { title: "Abra a aba de imagem", desc: "Na tela de personalização, vá na aba de enviar imagem (upload)." },
          { title: "Escolha o arquivo", desc: "Selecione uma imagem do seu computador (PNG, JPG, WEBP ou GIF animado)." },
          { title: "Aplique e confirme", desc: "O mod redimensiona a imagem automaticamente pro formato de capa (64x32). Confirme pra aplicar." },
          { title: "Ative a visibilidade", desc: "Marque a capa como \"visível\" pra ela sincronizar com a nuvem e aparecer pros outros jogadores." }
        ]
      },
      {
        groupTitle: "3. Gerando uma capa com IA",
        steps: [
          { title: "Abra a aba de IA", desc: "Na tela de personalização, vá na aba do gerador por IA." },
          { title: "Descreva o que você quer", desc: "Digite um texto curto descrevendo a ideia, tipo \"um dragão vermelho\" ou \"uma casa na floresta\"." },
          { title: "Escolha estilo, cor e qualidade", desc: "Ajuste as opções de estilo (anime, pixel art, fantasia, cyber), cor principal e qualidade pra guiar o resultado." },
          { title: "Gere e aguarde", desc: "Clique em gerar. Leva poucos segundos. Se não gostar do resultado, é só gerar de novo com outro texto ou opções." },
          { title: "Aplique a capa", desc: "Gostou do resultado? Aplique e ative a visibilidade pra sincronizar com a nuvem." }
        ]
      },
      {
        groupTitle: "4. Salvando capas na biblioteca (slots)",
        steps: [
          { title: "Abra a aba de biblioteca", desc: "Na tela de personalização, vá na aba de biblioteca/slots." },
          { title: "Salve a capa atual num slot", desc: "Você tem até 5 slots pra guardar capas diferentes (enviadas ou geradas por IA)." },
          { title: "Dê um nome ao slot", desc: "Nomeie cada slot pra lembrar qual capa é qual depois (ex.: \"Dragão\", \"Time X\")." },
          { title: "Troque de capa quando quiser", desc: "Selecione outro slot a qualquer momento pra trocar de capa na hora, sem precisar reenviar ou gerar de novo." },
          { title: "Seus slots ficam salvos na nuvem", desc: "Ao reinstalar o mod ou trocar de PC, seus slots salvos são restaurados automaticamente." }
        ]
      }
    ],
    rulesTitle: "Regras de uso",
    rules: [
      "Proibido usar imagens com conteúdo impróprio, sexual, ou de nudez.",
      "Proibido usar símbolos de ódio, discriminação ou apologia à violência.",
      "Proibido se passar por outro jogador, marca ou membro da equipe.",
      "Capas denunciadas podem ser banidas e removidas sem aviso prévio.",
      "Uso indevido pode levar ao banimento permanente do sistema de nuvem."
    ],
    downloadTitle: "Baixe o mod",
    downloadModrinth: "Baixar no Modrinth",
    downloadCurseforge: "Baixar na CurseForge",
    contactTitle: "Fale com o desenvolvedor",
    contactDesc: "Dúvidas, sugestões ou problemas? Me chama no Discord.",
    contactCopy: "Copiar usuário",
    contactCopied: "Copiado!",
    footer: "AdaptiveCaps Relay",
    navHome: "Início",
    navStatus: "Status",
    navGallery: "Galeria",
    statusPageTitle: "Status do AdaptiveCaps",
    statusPageDesc: "Informações em tempo real do servidor que sincroniza as capas do AdaptiveCaps.",
    statVersion: "Versão",
    statUptime: "Uptime",
    statFiles: "Arquivos de capa",
    viewGalleryBtn: "Ver galeria de capas",
    capesPageTitle: "Galeria de Capas",
    capesPageDesc: "Todas as capas que os jogadores deixaram públicas.",
    searchPlaceholder: "Buscar por nome do jogador...",
    originalOnlyLabel: "Mostrar só quem tem imagem original",
    loadingText: "Carregando...",
    errorLoadingText: "Falha ao carregar (status ",
    noneFoundText: "Nenhuma capa encontrada.",
    updatedLabel: "Atualizada: ",
    unknownDate: "Desconhecido",
    capeModalEquippedLabel: "Capa equipada",
    capeModalSlotsLabel: "Capas salvas em slots",
    capeModalNoSlots: "Nenhuma capa salva em slot.",
    capeModalLoadingSlots: "Carregando slots...",
    capeModalClose: "Fechar",
    capeModalSlotLabel: "Slot "
  },
  en: {
    heroBadge: "Cloud cape sync",
    heroTitle: "AdaptiveCaps",
    heroSubtitle: "Pick, create, or AI-generate your character's cape, and bring it to any server you play on.",
    featuresTitle: "Features",
    features: [
      { title: "AI generator", desc: "Describe anything and generate a unique cape, for free." },
      { title: "Slot library", desc: "Save up to 5 capes and switch between them anytime." },
      { title: "Cloud sync", desc: "Your cape shows up on any server that has the mod." },
      { title: "100% free", desc: "No subscription, no ads, no catch." }
    ],
    statsTitle: "Status",
    statOnline: "Online",
    statPlayers: "Players",
    statCapes: "Visible capes",
    statBanned: "Banned players",
    banTimerFormat: "{time} ago",
    banTimerNone: "No bans recorded",
    statStorage: "Stored data",
    galleryTitle: "Some capes from the community",
    galleryDesc: "A sample of the capes players have made public.",
    galleryCta: "See full gallery",
    galleryEmpty: "No public capes yet. Be the first to share yours!",
    tutorialTitle: "Tutorials",
    tutorialGroups: [
      {
        groupTitle: "1. Installing the mod",
        steps: [
          { title: "Install a mod loader", desc: "Download and install Fabric or NeoForge, matching your Minecraft version." },
          { title: "Download AdaptiveCaps", desc: "Get the mod file from Modrinth or CurseForge (links below) and put it in your \"mods\" folder." },
          { title: "Launch the game and open the cape menu", desc: "Join any world/server and use the AdaptiveCaps keybind (configurable in Options > Controls) to open the customization screen." }
        ]
      },
      {
        groupTitle: "2. Uploading an image to your cape",
        steps: [
          { title: "Open the image tab", desc: "In the customization screen, go to the image upload tab." },
          { title: "Choose the file", desc: "Select an image from your computer (PNG, JPG, WEBP, or animated GIF)." },
          { title: "Apply and confirm", desc: "The mod automatically resizes the image to the cape format (64x32). Confirm to apply it." },
          { title: "Turn on visibility", desc: "Mark the cape as \"visible\" so it syncs to the cloud and shows up for other players." }
        ]
      },
      {
        groupTitle: "3. Generating a cape with AI",
        steps: [
          { title: "Open the AI tab", desc: "In the customization screen, go to the AI generator tab." },
          { title: "Describe what you want", desc: "Type a short description of your idea, like \"a red dragon\" or \"a house in the forest\"." },
          { title: "Pick style, color, and quality", desc: "Adjust the style (anime, pixel art, fantasy, cyber), main color, and quality options to guide the result." },
          { title: "Generate and wait", desc: "Click generate. It takes a few seconds. Not happy with it? Just generate again with different text or options." },
          { title: "Apply the cape", desc: "Like the result? Apply it and turn on visibility to sync it to the cloud." }
        ]
      },
      {
        groupTitle: "4. Saving capes in the library (slots)",
        steps: [
          { title: "Open the library tab", desc: "In the customization screen, go to the library/slots tab." },
          { title: "Save the current cape to a slot", desc: "You get up to 5 slots to store different capes (uploaded or AI-generated)." },
          { title: "Name the slot", desc: "Give each slot a name so you remember which cape is which later (e.g. \"Dragon\", \"Team X\")." },
          { title: "Switch capes anytime", desc: "Select a different slot whenever you want to switch capes instantly, without re-uploading or regenerating." },
          { title: "Your slots are backed up to the cloud", desc: "If you reinstall the mod or switch computers, your saved slots are restored automatically." }
        ]
      }
    ],
    rulesTitle: "Usage rules",
    rules: [
      "No inappropriate, sexual, or nudity content in images.",
      "No hate symbols, discrimination, or glorification of violence.",
      "No impersonating other players, brands, or staff members.",
      "Reported capes may be banned and removed without prior notice.",
      "Misuse can lead to a permanent ban from the cloud system."
    ],
    downloadTitle: "Download the mod",
    downloadModrinth: "Download on Modrinth",
    downloadCurseforge: "Download on CurseForge",
    contactTitle: "Talk to the developer",
    contactDesc: "Questions, suggestions, or issues? Message me on Discord.",
    contactCopy: "Copy username",
    contactCopied: "Copied!",
    footer: "AdaptiveCaps Relay",
    navHome: "Home",
    navStatus: "Status",
    navGallery: "Gallery",
    statusPageTitle: "AdaptiveCaps Status",
    statusPageDesc: "Real-time info about the server that syncs AdaptiveCaps capes.",
    statVersion: "Version",
    statUptime: "Uptime",
    statFiles: "Cape files",
    viewGalleryBtn: "See cape gallery",
    capesPageTitle: "Cape Gallery",
    capesPageDesc: "All the capes players have made public.",
    searchPlaceholder: "Search by player name...",
    originalOnlyLabel: "Show only players with an original image",
    loadingText: "Loading...",
    errorLoadingText: "Failed to load (status ",
    noneFoundText: "No capes found.",
    updatedLabel: "Updated: ",
    unknownDate: "Unknown",
    capeModalEquippedLabel: "Equipped cape",
    capeModalSlotsLabel: "Capes saved in slots",
    capeModalNoSlots: "No cape saved in a slot.",
    capeModalLoadingSlots: "Loading slots...",
    capeModalClose: "Close",
    capeModalSlotLabel: "Slot "
  },
  es: {
    heroBadge: "Sincronización de capas en la nube",
    heroTitle: "AdaptiveCaps",
    heroSubtitle: "Elige, crea o genera con IA la capa de tu personaje, y llévala a cualquier servidor donde juegues.",
    featuresTitle: "Funciones",
    features: [
      { title: "Generador con IA", desc: "Describe lo que quieras y genera una capa única, gratis." },
      { title: "Biblioteca con slots", desc: "Guarda hasta 5 capas y cambia entre ellas cuando quieras." },
      { title: "Sincronización en la nube", desc: "Tu capa aparece en cualquier servidor que tenga el mod." },
      { title: "100% gratis", desc: "Sin suscripción, sin anuncios, sin trucos." }
    ],
    statsTitle: "Status",
    statOnline: "En línea",
    statPlayers: "Jugadores",
    statCapes: "Capas visibles",
    statBanned: "Jugadores baneados",
    banTimerFormat: "hace {time}",
    banTimerNone: "Sin baneos registrados",
    statStorage: "Datos almacenados",
    galleryTitle: "Algunas capas de la comunidad",
    galleryDesc: "Una muestra de las capas que los jugadores hicieron públicas.",
    galleryCta: "Ver galería completa",
    galleryEmpty: "Aún no hay capas públicas. ¡Sé el primero en compartir la tuya!",
    tutorialTitle: "Tutoriales",
    tutorialGroups: [
      {
        groupTitle: "1. Instalando el mod",
        steps: [
          { title: "Instala un mod loader", desc: "Descarga e instala Fabric o NeoForge, según tu versión de Minecraft." },
          { title: "Descarga AdaptiveCaps", desc: "Obtén el archivo del mod en Modrinth o CurseForge (enlaces abajo) y ponlo en tu carpeta \"mods\"." },
          { title: "Abre el juego y el menú de la capa", desc: "Entra a cualquier mundo/servidor y usa el atajo de AdaptiveCaps (configurable en Opciones > Controles) para abrir la pantalla de personalización." }
        ]
      },
      {
        groupTitle: "2. Subiendo una imagen a tu capa",
        steps: [
          { title: "Abre la pestaña de imagen", desc: "En la pantalla de personalización, ve a la pestaña de subir imagen." },
          { title: "Elige el archivo", desc: "Selecciona una imagen de tu computadora (PNG, JPG, WEBP o GIF animado)." },
          { title: "Aplica y confirma", desc: "El mod redimensiona la imagen automáticamente al formato de capa (64x32). Confirma para aplicarla." },
          { title: "Activa la visibilidad", desc: "Marca la capa como \"visible\" para que se sincronice con la nube y la vean otros jugadores." }
        ]
      },
      {
        groupTitle: "3. Generando una capa con IA",
        steps: [
          { title: "Abre la pestaña de IA", desc: "En la pantalla de personalización, ve a la pestaña del generador de IA." },
          { title: "Describe lo que quieres", desc: "Escribe una breve descripción de tu idea, como \"un dragón rojo\" o \"una casa en el bosque\"." },
          { title: "Elige estilo, color y calidad", desc: "Ajusta el estilo (anime, pixel art, fantasía, cyber), el color principal y la calidad para guiar el resultado." },
          { title: "Genera y espera", desc: "Haz clic en generar. Tarda unos segundos. ¿No te gustó? Genera de nuevo con otro texto u opciones." },
          { title: "Aplica la capa", desc: "¿Te gustó el resultado? Aplícalo y activa la visibilidad para sincronizarlo con la nube." }
        ]
      },
      {
        groupTitle: "4. Guardando capas en la biblioteca (slots)",
        steps: [
          { title: "Abre la pestaña de biblioteca", desc: "En la pantalla de personalización, ve a la pestaña de biblioteca/slots." },
          { title: "Guarda la capa actual en un slot", desc: "Tienes hasta 5 slots para guardar diferentes capas (subidas o generadas por IA)." },
          { title: "Nombra el slot", desc: "Dale un nombre a cada slot para recordar cuál capa es cuál después (ej.: \"Dragón\", \"Equipo X\")." },
          { title: "Cambia de capa cuando quieras", desc: "Selecciona otro slot en cualquier momento para cambiar de capa al instante, sin volver a subir o generar." },
          { title: "Tus slots quedan respaldados en la nube", desc: "Si reinstalas el mod o cambias de computadora, tus slots guardados se restauran automáticamente." }
        ]
      }
    ],
    rulesTitle: "Reglas de uso",
    rules: [
      "Prohibido usar imágenes con contenido inapropiado, sexual o desnudez.",
      "Prohibido usar símbolos de odio, discriminación o apología a la violencia.",
      "Prohibido suplantar a otro jugador, marca o miembro del staff.",
      "Las capas denunciadas pueden ser baneadas y eliminadas sin previo aviso.",
      "El mal uso puede llevar a un baneo permanente del sistema en la nube."
    ],
    downloadTitle: "Descarga el mod",
    downloadModrinth: "Descargar en Modrinth",
    downloadCurseforge: "Descargar en CurseForge",
    contactTitle: "Habla con el desarrollador",
    contactDesc: "¿Dudas, sugerencias o problemas? Escríbeme en Discord.",
    contactCopy: "Copiar usuario",
    contactCopied: "¡Copiado!",
    footer: "AdaptiveCaps Relay",
    navHome: "Inicio",
    navStatus: "Status",
    navGallery: "Galería",
    statusPageTitle: "Status de AdaptiveCaps",
    statusPageDesc: "Información en tiempo real del servidor que sincroniza las capas de AdaptiveCaps.",
    statVersion: "Versión",
    statUptime: "Uptime",
    statFiles: "Archivos de capa",
    viewGalleryBtn: "Ver galería de capas",
    capesPageTitle: "Galería de Capas",
    capesPageDesc: "Todas las capas que los jugadores hicieron públicas.",
    searchPlaceholder: "Buscar por nombre del jugador...",
    originalOnlyLabel: "Mostrar solo con imagen original",
    loadingText: "Cargando...",
    errorLoadingText: "Fallo al cargar (status ",
    noneFoundText: "No se encontraron capas.",
    updatedLabel: "Actualizada: ",
    unknownDate: "Desconocido",
    capeModalEquippedLabel: "Capa equipada",
    capeModalSlotsLabel: "Capas guardadas en slots",
    capeModalNoSlots: "Ninguna capa guardada en un slot.",
    capeModalLoadingSlots: "Cargando slots...",
    capeModalClose: "Cerrar",
    capeModalSlotLabel: "Slot "
  },
  fr: {
    heroBadge: "Synchronisation de capes dans le cloud",
    heroTitle: "AdaptiveCaps",
    heroSubtitle: "Choisissez, créez ou générez avec l'IA la cape de votre personnage, et emportez-la sur n'importe quel serveur.",
    featuresTitle: "Fonctionnalités",
    features: [
      { title: "Générateur IA", desc: "Décrivez ce que vous voulez et générez une cape unique, gratuitement." },
      { title: "Bibliothèque à emplacements", desc: "Sauvegardez jusqu'à 5 capes et changez entre elles à tout moment." },
      { title: "Synchronisation cloud", desc: "Votre cape apparaît sur n'importe quel serveur ayant le mod." },
      { title: "100% gratuit", desc: "Sans abonnement, sans pub, sans piège." }
    ],
    statsTitle: "Status",
    statOnline: "En ligne",
    statPlayers: "Joueurs",
    statCapes: "Capes visibles",
    statBanned: "Joueurs bannis",
    banTimerFormat: "il y a {time}",
    banTimerNone: "Aucun bannissement enregistré",
    statStorage: "Données stockées",
    galleryTitle: "Quelques capes de la communauté",
    galleryDesc: "Un aperçu des capes que les joueurs ont rendues publiques.",
    galleryCta: "Voir la galerie complète",
    galleryEmpty: "Pas encore de cape publique. Soyez le premier à partager la vôtre !",
    tutorialTitle: "Tutoriels",
    tutorialGroups: [
      {
        groupTitle: "1. Installer le mod",
        steps: [
          { title: "Installez un mod loader", desc: "Téléchargez et installez Fabric ou NeoForge, selon votre version de Minecraft." },
          { title: "Téléchargez AdaptiveCaps", desc: "Récupérez le fichier du mod sur Modrinth ou CurseForge (liens ci-dessous) et placez-le dans le dossier \"mods\"." },
          { title: "Lancez le jeu et ouvrez le menu de la cape", desc: "Rejoignez un monde/serveur et utilisez le raccourci AdaptiveCaps (configurable dans Options > Commandes) pour ouvrir l'écran de personnalisation." }
        ]
      },
      {
        groupTitle: "2. Envoyer une image sur votre cape",
        steps: [
          { title: "Ouvrez l'onglet image", desc: "Dans l'écran de personnalisation, allez dans l'onglet d'envoi d'image." },
          { title: "Choisissez le fichier", desc: "Sélectionnez une image depuis votre ordinateur (PNG, JPG, WEBP ou GIF animé)." },
          { title: "Appliquez et confirmez", desc: "Le mod redimensionne automatiquement l'image au format de cape (64x32). Confirmez pour l'appliquer." },
          { title: "Activez la visibilité", desc: "Marquez la cape comme \"visible\" pour qu'elle se synchronise avec le cloud et soit visible par les autres joueurs." }
        ]
      },
      {
        groupTitle: "3. Générer une cape avec l'IA",
        steps: [
          { title: "Ouvrez l'onglet IA", desc: "Dans l'écran de personnalisation, allez dans l'onglet du générateur IA." },
          { title: "Décrivez ce que vous voulez", desc: "Écrivez une courte description de votre idée, comme \"un dragon rouge\" ou \"une maison dans la forêt\"." },
          { title: "Choisissez style, couleur et qualité", desc: "Ajustez le style (anime, pixel art, fantastique, cyber), la couleur principale et la qualité pour guider le résultat." },
          { title: "Générez et patientez", desc: "Cliquez sur générer. Cela prend quelques secondes. Pas satisfait ? Régénérez avec un autre texte ou d'autres options." },
          { title: "Appliquez la cape", desc: "Le résultat vous plaît ? Appliquez-le et activez la visibilité pour le synchroniser avec le cloud." }
        ]
      },
      {
        groupTitle: "4. Sauvegarder des capes dans la bibliothèque (emplacements)",
        steps: [
          { title: "Ouvrez l'onglet bibliothèque", desc: "Dans l'écran de personnalisation, allez dans l'onglet bibliothèque/emplacements." },
          { title: "Sauvegardez la cape actuelle dans un emplacement", desc: "Vous avez jusqu'à 5 emplacements pour stocker différentes capes (envoyées ou générées par IA)." },
          { title: "Nommez l'emplacement", desc: "Donnez un nom à chaque emplacement pour vous souvenir de quelle cape il s'agit (ex. : \"Dragon\", \"Équipe X\")." },
          { title: "Changez de cape à tout moment", desc: "Sélectionnez un autre emplacement quand vous voulez changer de cape instantanément, sans renvoyer ni régénérer." },
          { title: "Vos emplacements sont sauvegardés dans le cloud", desc: "Si vous réinstallez le mod ou changez d'ordinateur, vos emplacements sauvegardés sont restaurés automatiquement." }
        ]
      }
    ],
    rulesTitle: "Règles d'utilisation",
    rules: [
      "Interdit d'utiliser des images au contenu inapproprié, sexuel ou de nudité.",
      "Interdit d'utiliser des symboles de haine, de discrimination ou faisant l'apologie de la violence.",
      "Interdit d'usurper l'identité d'un autre joueur, d'une marque ou d'un membre du staff.",
      "Les capes signalées peuvent être bannies et supprimées sans préavis.",
      "Un usage abusif peut entraîner un bannissement permanent du système cloud."
    ],
    downloadTitle: "Téléchargez le mod",
    downloadModrinth: "Télécharger sur Modrinth",
    downloadCurseforge: "Télécharger sur CurseForge",
    contactTitle: "Parlez au développeur",
    contactDesc: "Questions, suggestions ou problèmes ? Contactez-moi sur Discord.",
    contactCopy: "Copier le pseudo",
    contactCopied: "Copié !",
    footer: "AdaptiveCaps Relay",
    navHome: "Accueil",
    navStatus: "Status",
    navGallery: "Galerie",
    statusPageTitle: "Status AdaptiveCaps",
    statusPageDesc: "Informations en temps réel du serveur qui synchronise les capes AdaptiveCaps.",
    statVersion: "Version",
    statUptime: "Uptime",
    statFiles: "Fichiers de cape",
    viewGalleryBtn: "Voir la galerie de capes",
    capesPageTitle: "Galerie de Capes",
    capesPageDesc: "Toutes les capes que les joueurs ont rendues publiques.",
    searchPlaceholder: "Rechercher par nom de joueur...",
    originalOnlyLabel: "Afficher seulement avec une image originale",
    loadingText: "Chargement...",
    errorLoadingText: "Échec du chargement (status ",
    noneFoundText: "Aucune cape trouvée.",
    updatedLabel: "Mise à jour : ",
    unknownDate: "Inconnu",
    capeModalEquippedLabel: "Cape équipée",
    capeModalSlotsLabel: "Capes enregistrées dans les slots",
    capeModalNoSlots: "Aucune cape enregistrée dans un slot.",
    capeModalLoadingSlots: "Chargement des slots...",
    capeModalClose: "Fermer",
    capeModalSlotLabel: "Slot "
  },
  de: {
    heroBadge: "Cloud-Umhang-Synchronisierung",
    heroTitle: "AdaptiveCaps",
    heroSubtitle: "Wähle, erstelle oder generiere per KI den Umhang deiner Spielfigur und nimm ihn mit auf jeden Server.",
    featuresTitle: "Funktionen",
    features: [
      { title: "KI-Generator", desc: "Beschreibe, was du willst, und generiere kostenlos einen einzigartigen Umhang." },
      { title: "Slot-Bibliothek", desc: "Speichere bis zu 5 Umhänge und wechsle jederzeit zwischen ihnen." },
      { title: "Cloud-Synchronisierung", desc: "Dein Umhang erscheint auf jedem Server mit der Mod." },
      { title: "100% kostenlos", desc: "Kein Abo, keine Werbung, kein Haken." }
    ],
    statsTitle: "Status",
    statOnline: "Online",
    statPlayers: "Spieler",
    statCapes: "Sichtbare Umhänge",
    statBanned: "Gesperrte Spieler",
    banTimerFormat: "vor {time}",
    banTimerNone: "Keine Sperren erfasst",
    statStorage: "Gespeicherte Daten",
    galleryTitle: "Einige Umhänge der Community",
    galleryDesc: "Eine Auswahl der Umhänge, die Spieler öffentlich gemacht haben.",
    galleryCta: "Vollständige Galerie ansehen",
    galleryEmpty: "Noch keine öffentlichen Umhänge. Sei der Erste, der seinen teilt!",
    tutorialTitle: "Anleitungen",
    tutorialGroups: [
      {
        groupTitle: "1. Mod installieren",
        steps: [
          { title: "Mod-Loader installieren", desc: "Lade Fabric oder NeoForge passend zu deiner Minecraft-Version herunter und installiere es." },
          { title: "AdaptiveCaps herunterladen", desc: "Lade die Mod-Datei von Modrinth oder CurseForge (Links unten) herunter und lege sie in deinen \"mods\"-Ordner." },
          { title: "Spiel starten und Umhang-Menü öffnen", desc: "Betrete eine Welt/einen Server und benutze die AdaptiveCaps-Taste (einstellbar unter Optionen > Steuerung), um den Anpassungsbildschirm zu öffnen." }
        ]
      },
      {
        groupTitle: "2. Ein Bild auf deinen Umhang hochladen",
        steps: [
          { title: "Bild-Tab öffnen", desc: "Gehe im Anpassungsbildschirm zum Tab für Bild-Upload." },
          { title: "Datei auswählen", desc: "Wähle ein Bild von deinem Computer (PNG, JPG, WEBP oder animiertes GIF)." },
          { title: "Anwenden und bestätigen", desc: "Die Mod skaliert das Bild automatisch auf das Umhang-Format (64x32). Bestätige, um es anzuwenden." },
          { title: "Sichtbarkeit aktivieren", desc: "Markiere den Umhang als \"sichtbar\", damit er mit der Cloud synchronisiert und für andere Spieler sichtbar wird." }
        ]
      },
      {
        groupTitle: "3. Einen Umhang mit KI generieren",
        steps: [
          { title: "KI-Tab öffnen", desc: "Gehe im Anpassungsbildschirm zum Tab des KI-Generators." },
          { title: "Beschreibe, was du willst", desc: "Schreibe eine kurze Beschreibung deiner Idee, z. B. \"ein roter Drache\" oder \"ein Haus im Wald\"." },
          { title: "Stil, Farbe und Qualität wählen", desc: "Passe Stil (Anime, Pixel-Art, Fantasy, Cyber), Hauptfarbe und Qualität an, um das Ergebnis zu steuern." },
          { title: "Generieren und warten", desc: "Klicke auf Generieren. Es dauert nur wenige Sekunden. Gefällt es dir nicht? Generiere einfach mit anderem Text oder Optionen neu." },
          { title: "Umhang anwenden", desc: "Gefällt dir das Ergebnis? Wende es an und aktiviere die Sichtbarkeit, um es mit der Cloud zu synchronisieren." }
        ]
      },
      {
        groupTitle: "4. Umhänge in der Bibliothek speichern (Slots)",
        steps: [
          { title: "Bibliotheks-Tab öffnen", desc: "Gehe im Anpassungsbildschirm zum Tab Bibliothek/Slots." },
          { title: "Aktuellen Umhang in einem Slot speichern", desc: "Du hast bis zu 5 Slots, um verschiedene Umhänge zu speichern (hochgeladen oder per KI generiert)." },
          { title: "Slot benennen", desc: "Gib jedem Slot einen Namen, damit du später weißt, welcher Umhang welcher ist (z. B. \"Drache\", \"Team X\")." },
          { title: "Jederzeit Umhang wechseln", desc: "Wähle jederzeit einen anderen Slot, um sofort den Umhang zu wechseln, ohne erneut hochzuladen oder zu generieren." },
          { title: "Deine Slots werden in der Cloud gesichert", desc: "Wenn du die Mod neu installierst oder den Computer wechselst, werden deine gespeicherten Slots automatisch wiederhergestellt." }
        ]
      }
    ],
    rulesTitle: "Nutzungsregeln",
    rules: [
      "Keine Bilder mit unangemessenem, sexuellem oder nacktem Inhalt.",
      "Keine Hasssymbole, Diskriminierung oder Verherrlichung von Gewalt.",
      "Keine Nachahmung anderer Spieler, Marken oder Teammitglieder.",
      "Gemeldete Umhänge können ohne Vorankündigung gesperrt und entfernt werden.",
      "Missbrauch kann zu einer dauerhaften Sperre des Cloud-Systems führen."
    ],
    downloadTitle: "Mod herunterladen",
    downloadModrinth: "Auf Modrinth herunterladen",
    downloadCurseforge: "Auf CurseForge herunterladen",
    contactTitle: "Sprich mit dem Entwickler",
    contactDesc: "Fragen, Vorschläge oder Probleme? Schreib mir auf Discord.",
    contactCopy: "Benutzernamen kopieren",
    contactCopied: "Kopiert!",
    footer: "AdaptiveCaps Relay",
    navHome: "Start",
    navStatus: "Status",
    navGallery: "Galerie",
    statusPageTitle: "AdaptiveCaps Status",
    statusPageDesc: "Echtzeit-Informationen zum Server, der die AdaptiveCaps-Umhänge synchronisiert.",
    statVersion: "Version",
    statUptime: "Uptime",
    statFiles: "Umhang-Dateien",
    viewGalleryBtn: "Galerie ansehen",
    capesPageTitle: "Umhang-Galerie",
    capesPageDesc: "Alle Umhänge, die Spieler öffentlich gemacht haben.",
    searchPlaceholder: "Nach Spielername suchen...",
    originalOnlyLabel: "Nur mit Originalbild anzeigen",
    loadingText: "Wird geladen...",
    errorLoadingText: "Laden fehlgeschlagen (status ",
    noneFoundText: "Keine Umhänge gefunden.",
    updatedLabel: "Aktualisiert: ",
    unknownDate: "Unbekannt",
    capeModalEquippedLabel: "Ausgerüsteter Umhang",
    capeModalSlotsLabel: "In Slots gespeicherte Umhänge",
    capeModalNoSlots: "Kein Umhang in einem Slot gespeichert.",
    capeModalLoadingSlots: "Slots werden geladen...",
    capeModalClose: "Schließen",
    capeModalSlotLabel: "Slot "
  }
};

function renderHomePage(stats, previewCapes) {
  const t = SITE_I18N["pt-BR"];

  const capesHtml = previewCapes.length > 0
    ? previewCapes.map(entry => {
        // Mesma razao do /capes: miniatura sempre com o PNG renderizado, nunca
        // o arquivo original (pico de rede gigante na home a cada visita).
        const imageUrl = "/cape-image/" + entry.uuid + ".png";
        return (
          '<div class="cape-card">' +
          '<img src="' + imageUrl + '" alt="Cape ' + escapeHtml(entry.username || entry.uuid) + '" loading="lazy">' +
          '<h3>' + escapeHtml(entry.username || "unknown") + '</h3>' +
          '</div>'
        );
      }).join("")
    : `<p class="msg" data-i18n="galleryEmpty">${escapeHtml(t.galleryEmpty)}</p>`;

  const FEATURE_ICONS = [
    '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>',
    '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    '<path d="M17.5 18H6a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.7-2A4.5 4.5 0 0 1 17.5 18z"/>',
    '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5 5-5"/>'
  ];

  const featuresHtml = t.features.map((feature, index) => `
    <div class="card feature-card">
      <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${FEATURE_ICONS[index] ?? ""}</svg></div>
      <h3 data-i18n-feature="${index}:title">${escapeHtml(feature.title)}</h3>
      <p data-i18n-feature="${index}:desc">${escapeHtml(feature.desc)}</p>
    </div>`).join("");

  const tutorialHtml = t.tutorialGroups.map((group, groupIndex) => `
    <div class="tutorial-group" style="margin-bottom:32px">
      <h3 data-i18n-group="${groupIndex}:groupTitle" style="font-size:18px;margin:0 0 16px;color:var(--accent)">${escapeHtml(group.groupTitle)}</h3>
      <div class="tutorial-steps">
        ${group.steps.map((step, stepIndex) => `
        <div class="card step">
          <div class="num">${stepIndex + 1}</div>
          <div>
            <h4 data-i18n-group="${groupIndex}:${stepIndex}:title">${escapeHtml(step.title)}</h4>
            <p data-i18n-group="${groupIndex}:${stepIndex}:desc">${escapeHtml(step.desc)}</p>
          </div>
        </div>`).join("")}
      </div>
    </div>`).join("");

  const rulesHtml = t.rules.map((rule, index) => `<li data-i18n-rule="${index}">${escapeHtml(rule)}</li>`).join("");

  const body = `
<div class="container">
  <div class="hero">
    <p class="msg" data-i18n="heroBadge" style="text-transform:uppercase;letter-spacing:1px;font-size:12px;font-weight:700;color:var(--accent-2)">${escapeHtml(t.heroBadge)}</p>
    <h1 data-i18n="heroTitle">${escapeHtml(t.heroTitle)}</h1>
    <p data-i18n="heroSubtitle">${escapeHtml(t.heroSubtitle)}</p>
    <div class="download-row">
      <a class="btn btn-primary" href="${escapeHtml(MODRINTH_URL)}" target="_blank" rel="noopener" data-i18n="downloadModrinth">${escapeHtml(t.downloadModrinth)}</a>
      <a class="btn btn-outline" href="${escapeHtml(CURSEFORGE_URL)}" target="_blank" rel="noopener" data-i18n="downloadCurseforge">${escapeHtml(t.downloadCurseforge)}</a>
    </div>
    <div class="compat-row">
      <span class="compat-chip"><span class="dot"></span>Fabric</span>
      <span class="compat-chip"><span class="dot"></span>NeoForge</span>
    </div>
    <div class="compat-row" style="margin-top:8px">
      <span class="compat-chip">MC 1.21.4</span>
      <span class="compat-chip">MC 1.21.8</span>
      <span class="compat-chip">MC 1.21.11</span>
      <span class="compat-chip">MC 26.1</span>
      <span class="compat-chip">MC 26.2</span>
    </div>
  </div>

  <h2 class="section-title"><span class="bar"></span><span data-i18n="featuresTitle">${escapeHtml(t.featuresTitle)}</span></h2>
  <div class="feature-grid">${featuresHtml}</div>

  <h2 class="section-title"><span class="bar"></span><span data-i18n="statsTitle">${escapeHtml(t.statsTitle)}</span></h2>
  <div class="stat-grid">
    <div class="card stat-tile"><div class="value" data-i18n="statOnline">${escapeHtml(t.statOnline)}</div><div class="label">Status</div></div>
    <div class="card stat-tile"><div class="value">${stats.totalPlayers}</div><div class="label" data-i18n="statPlayers">${escapeHtml(t.statPlayers)}</div></div>
    <div class="card stat-tile"><div class="value">${stats.visibleCapes}</div><div class="label" data-i18n="statCapes">${escapeHtml(t.statCapes)}</div></div>
    <div class="card stat-tile stat-tile-danger">
      <div class="value">${stats.bannedPlayers}</div>
      <div class="label" data-i18n="statBanned">${escapeHtml(t.statBanned)}</div>
      ${banTimerHtml(t, stats)}
    </div>
  </div>

  <h2 class="section-title"><span class="bar"></span><span data-i18n="galleryTitle">${escapeHtml(t.galleryTitle)}</span></h2>
  <p class="msg" data-i18n="galleryDesc">${escapeHtml(t.galleryDesc)}</p>
  <a href="/capes" style="text-decoration:none">
    <div class="cape-grid" style="margin-top:18px">${capesHtml}</div>
  </a>
  <div class="center" style="margin-top:22px">
    <a class="btn btn-outline" href="/capes" data-i18n="galleryCta">${escapeHtml(t.galleryCta)}</a>
  </div>

  <h2 class="section-title"><span class="bar"></span><span data-i18n="tutorialTitle">${escapeHtml(t.tutorialTitle)}</span></h2>
  <div>${tutorialHtml}</div>

  <h2 class="section-title"><span class="bar"></span><span data-i18n="rulesTitle">${escapeHtml(t.rulesTitle)}</span></h2>
  <ul class="card rules-list">${rulesHtml}</ul>

  <div class="card contact-card" style="margin-top:56px">
    <div class="discord-icon">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#5865F2">
        <path d="M20.3 4.4A19.7 19.7 0 0 0 15.6 3c-.2.4-.5.9-.6 1.3a18.3 18.3 0 0 0-5.9 0c-.2-.4-.4-.9-.6-1.3-1.6.3-3.2.8-4.7 1.4C1 8.7.3 12.9.6 17c1.8 1.3 3.6 2.1 5.3 2.7.4-.6.8-1.2 1.1-1.9-.6-.2-1.2-.5-1.7-.9.1-.1.3-.2.4-.3 3.4 1.6 7 1.6 10.3 0 .1.1.3.2.4.3-.5.3-1.1.6-1.7.9.3.7.7 1.3 1.1 1.9 1.8-.6 3.6-1.4 5.3-2.7.4-4.7-.8-8.9-3.3-12.6ZM8.5 14.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/>
      </svg>
    </div>
    <div class="info">
      <h3 data-i18n="contactTitle">${escapeHtml(t.contactTitle)}</h3>
      <p data-i18n="contactDesc">${escapeHtml(t.contactDesc)}</p>
    </div>
    <div class="username-row">
      <span class="username" id="discord-username">${escapeHtml(DISCORD_USERNAME)}</span>
      <button class="btn btn-outline" id="copy-discord-btn" type="button" data-i18n="contactCopy">${escapeHtml(t.contactCopy)}</button>
    </div>
  </div>
</div>
<script>
const copyBtn = document.getElementById("copy-discord-btn");
if (copyBtn) {
  copyBtn.addEventListener("click", async function () {
    const username = document.getElementById("discord-username").textContent;
    const originalText = copyBtn.textContent;
    let copied = false;

    try {
      await navigator.clipboard.writeText(username);
      copied = true;
    } catch {
      try {
        const helper = document.createElement("textarea");
        helper.value = username;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.focus();
        helper.select();
        copied = document.execCommand("copy");
        document.body.removeChild(helper);
      } catch {
        copied = false;
      }
    }

    const dict = I18N[document.documentElement.lang] || I18N["pt-BR"];
    copyBtn.textContent = copied ? (dict.contactCopied || "Copiado!") : username;
    setTimeout(function () { copyBtn.textContent = originalText; }, 1800);
  });
}
</script>`;

  return pageShell({ title: "AdaptiveCaps", activeNav: "home", body });
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
