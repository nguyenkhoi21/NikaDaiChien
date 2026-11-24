const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILES = {
  accounts: path.join(DATA_DIR, "accounts.json"),
  players: path.join(DATA_DIR, "players.json"),
  guilds: path.join(DATA_DIR, "guilds.json"),
  arena: path.join(DATA_DIR, "arena.json"),
  meta: path.join(DATA_DIR, "meta.json")
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      if (raw.trim()) return JSON.parse(raw);
    }
  } catch (e) {
    console.error(`[DB] Failed reading ${file}:`, e.message);
  }
  return fallback;
}

function atomicWriteJson(file, obj) {
  ensureDir();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

const db = {
  accounts: readJson(FILES.accounts, {}),
  players: readJson(FILES.players, {}),
  guilds: readJson(FILES.guilds, {}),
  arena: readJson(FILES.arena, { ranks: [], reports: {}, nextReportId: 1 }),
  meta: readJson(FILES.meta, { nextUid: 10001, nextPlayerId: 100001, nextGuildId: 1001 }),
  dirty: { accounts: false, players: false, guilds: false, arena: false, meta: false }
};

let saveTimer = null;

function markDirty(...keys) {
  for (const k of keys) {
    if (k in db.dirty) db.dirty[k] = true;
  }
}

function saveDb(force = false) {
  for (const k of Object.keys(FILES)) {
    if (force || db.dirty[k]) {
      try {
        atomicWriteJson(FILES[k], db[k]);
        db.dirty[k] = false;
      } catch (e) {
        console.error(`[DB] Failed saving ${k}:`, e.message);
      }
    }
  }
}

function scheduleSaveDb() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveDb(false);
  }, 1500);
  if (saveTimer.unref) saveTimer.unref();
}

function allocUid() {
  const uid = db.meta.nextUid++;
  markDirty("meta");
  return uid;
}

function allocPlayerId() {
  const id = db.meta.nextPlayerId++;
  markDirty("meta");
  return id;
}

function allocGuildId() {
  const id = db.meta.nextGuildId++;
  markDirty("meta");
  return id;
}

function findPlayerByNameOrId(query) {
  if (query === undefined || query === null) return null;
  const q = String(query).trim();
  if (db.players[q]) return db.players[q];
  for (const id of Object.keys(db.players)) {
    const p = db.players[id];
    if (String(p.id) === q || String(p.name) === q || String(p.userName) === q || String(p.userId) === q) {
      return p;
    }
  }
  return null;
}

function getPlayersByUserId(userId, oldServerId) {
  const out = [];
  for (const id of Object.keys(db.players)) {
    const p = db.players[id];
    if (Number(p.userId) === Number(userId) && (oldServerId == null || Number(p.oldServerId) === Number(oldServerId))) {
      out.push(p);
    }
  }
  return out;
}

module.exports = {
  db,
  markDirty,
  saveDb,
  scheduleSaveDb,
  allocUid,
  allocPlayerId,
  allocGuildId,
  findPlayerByNameOrId,
  getPlayersByUserId
};
