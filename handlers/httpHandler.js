const fs = require("fs");
const path = require("path");
const { URLSearchParams } = require("url");
const settings = require("../config/serverSettings");
const dataApi = require("../config/dataLoader");
const {
  db,
  markDirty,
  saveDb,
  allocUid,
  findPlayerByNameOrId,
  getPlayersByUserId
} = require("../db/database");
const { recalcPlayerPower, createRoleRecord } = require("../models/playerFactory");
const playerService = require("../services/playerService");
const hotfixMirrorService = require("../services/hotfixMirrorService");

function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function parseFormOrJson(bodyStr) {
  if (!bodyStr) return {};
  const trimmed = bodyStr.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {}
  }
  const sp = new URLSearchParams(bodyStr);
  const out = {};
  for (const [k, v] of sp.entries()) out[k] = v;
  return out;
}

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function getEffectiveHostAndPort(req) {
  const hostHeader = (req && req.headers && req.headers.host) || "";
  const xfProto = String((req && req.headers && req.headers["x-forwarded-proto"]) || "").split(",")[0].trim().toLowerCase();
  if (settings.PUBLIC_HOST) {
    const parts = settings.PUBLIC_HOST.split(":");
    return { host: parts[0], port: parts[1] ? Number(parts[1]) : 443, proto: "https" };
  }
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    return { host: process.env.RENDER_EXTERNAL_HOSTNAME, port: 443, proto: "https" };
  }
  if (hostHeader) {
    const parts = hostHeader.split(":");
    const proto = xfProto || (parts[1] === "443" ? "https" : "http");
    const port = parts[1] ? Number(parts[1]) : (proto === "https" ? 443 : settings.PORT);
    return { host: parts[0], port, proto };
  }
  return { host: settings.DEFAULT_LAN_IP, port: settings.PORT, proto: "http" };
}

function createHttpHandler({ liveLogs, addLiveLog, connectedSockets, pushToPlayer }) {
  return async function handleHttp(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // 0. Hotfix Mirror Proxy (/static/hotfix/android/{version,project}.manifest)
    if (pathname === "/static/hotfix/android/version.manifest" || pathname === "/static/hotfix/android/project.manifest") {
      const isProject = pathname.endsWith("project.manifest");
      await hotfixMirrorService.handleHotfixManifestRequest(req, res, { isProject });
      return;
    }

    if (pathname === "/api/hotfix/sync") {
      const force = parsedUrl.searchParams.get("force") === "1";
      try {
        const result = await hotfixMirrorService.checkAndSyncIfNeeded("manual-api", force);
        return sendJson(res, { ok: true, result, status: hotfixMirrorService.getHotfixStatus() });
      } catch (err) {
        return sendJson(res, { ok: false, error: err.message }, 500);
      }
    }

    // 1. Game Client Config & Notice
    if (pathname === "/user/clientConfig") {
      const { host, port, proto } = getEffectiveHostAndPort(req);
      const baseUrl = (proto === "https" && port === 443) || (proto === "http" && port === 80)
        ? `${proto}://${host}`
        : `${proto}://${host}:${port}`;
      return sendJson(res, {
        code: 200,
        cdnUrl: baseUrl,
        inReviewPackageInfos: [],
        runScriptInfo: {
          script:
            "buildExt.evolveSkillRoleClassIds.push(253);buildExt.evolveSkillRoleClassIds.push(254);var ALLOW_CLASS_IDS = require('serverConfig').WORLD_BOSS.CONSTS.ALLOW_CLASS_IDS;ALLOW_CLASS_IDS.push(253);ALLOW_CLASS_IDS.push(254);"
        },
        forceUpdate: null
      });
    }

    if (pathname === "/notice.json") {
      return sendJson(res, [
        {
          title: "Sunny Pirates Private Server",
          textList: [
            "Welcome to your $Private Server$!",
            "Use $/help$ in world chat or open $http://<server-ip>:8088/gm$ for the Web GM Panel.",
            "Starter perks: $VIP 15$, $100,000 Gems$, $5,000,000 Coins$."
          ]
        }
      ]);
    }

    if (pathname === "/user/languageFiles") {
      return sendJson(res, { code: 200, files: [] });
    }

    if (pathname === "/user/reportClientError") {
      const body = await readRequestBody(req);
      addLiveLog("CLIENT_ERR", body.slice(0, 500));
      return sendJson(res, { code: 200 });
    }

    // 2. Auth: /user/register, /user/login, /user/serverInfo, /sdk/*
    if (pathname === "/user/register") {
      const body = parseFormOrJson(await readRequestBody(req));
      const name = String(body.name || "").trim();
      const password = String(body.password || "");
      if (!name) return sendJson(res, { code: 500, msg: "Username required" });
      if (db.accounts[name]) {
        return sendJson(res, { code: 500, msg: "Account already exists" });
      }
      const uid = allocUid();
      const token = `tok_${uid}_${Date.now()}`;
      db.accounts[name] = { uid, userName: name, password, token, ctime: Date.now() };
      markDirty("accounts");
      saveDb();
      addLiveLog("HTTP", `Register user=${name} uid=${uid}`);
      return sendJson(res, { code: 200, uid, token, userName: name });
    }

    if (pathname === "/user/login") {
      const body = parseFormOrJson(await readRequestBody(req));
      const name = String(body.name || "").trim();
      const password = String(body.password || "");
      if (!name) return sendJson(res, { code: 500, msg: "Username required" });

      let acc = db.accounts[name];
      if (!acc) {
        if (!settings.AUTO_REGISTER_ON_LOGIN) {
          return sendJson(res, { code: 503, msg: "Account not registered" });
        }
        const uid = allocUid();
        acc = { uid, userName: name, password, token: "", ctime: Date.now() };
        db.accounts[name] = acc;
        markDirty("accounts");
      } else if (acc.password && password && acc.password !== password) {
        return sendJson(res, { code: 500, msg: "Wrong password" });
      }
      acc.token = `tok_${acc.uid}_${Date.now()}`;
      markDirty("accounts");
      saveDb();
      addLiveLog("HTTP", `Login user=${name} uid=${acc.uid}`);
      return sendJson(res, { code: 200, uid: acc.uid, token: acc.token, userName: name });
    }

    if (pathname === "/user/serverInfo") {
      const body = parseFormOrJson(await readRequestBody(req));
      const userName = String(body.userName || "").trim();
      const acc = db.accounts[userName];
      const existing = acc ? getPlayersByUserId(acc.uid) : [];
      const playerSummaries = existing.map((p) => ({
        playerId: p.id,
        id: p.id,
        name: p.name,
        level: p.level,
        serverId: p.serverId,
        oldServerId: p.oldServerId,
        photoInfo: p.photoInfo
      }));
      return sendJson(res, {
        code: 200,
        serverList: [
          {
            serverId: settings.SERVER_ID,
            oldServerId: settings.OLD_SERVER_ID,
            name: settings.SERVER_NAME,
            status: 1
          }
        ],
        players: playerSummaries
      });
    }

    if (pathname === "/sdk/verifyToken") {
      const body = parseFormOrJson(await readRequestBody(req));
      const userName = String(body.userName || body.uid || "guest");
      return sendJson(res, { code: 200, userName, accountId: userName });
    }

    if (pathname === "/sdk/delAccount") {
      return sendJson(res, { code: 200 });
    }

    // 3. Status & Live Logs
    if (pathname === "/status" || pathname === "/api/status") {
      return sendJson(res, {
        status: "online",
        game: "Sunny Pirates II (Nika Dai Chien)",
        online_sockets: connectedSockets.size,
        accounts: Object.keys(db.accounts).length,
        players: Object.keys(db.players).length,
        guilds: Object.keys(db.guilds).length,
        uptime_seconds: Math.floor(process.uptime()),
        hotfix: hotfixMirrorService.getHotfixStatus()
      });
    }

    if (pathname === "/api/logs" || pathname === "/logs.json") {
      return sendJson(res, { total: liveLogs.length, logs: liveLogs });
    }

    if (pathname === "/logs") {
      return sendHtml(res, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sunny Pirates - Live Logs</title>
<style>body{background:#0d1117;color:#c9d1d9;font-family:Consolas,monospace;padding:20px}h2{color:#58a6ff}#c{background:#161b22;border:1px solid #30363d;padding:12px;height:80vh;overflow:auto;font-size:13px}.REQ{color:#79c0ff}.RESP{color:#7ee787}.ERR,.CLIENT_ERR{color:#ff7b72}.HTTP{color:#d2a8ff}</style>
</head><body><h2>Sunny Pirates II - Live Server Logs</h2><p><a href="/gm" style="color:#58a6ff">Open GM Panel</a> | <a href="/status" style="color:#58a6ff">Status JSON</a></p><div id="c"></div>
<script>async function f(){const r=await fetch('/api/logs');const d=await r.json();const c=document.getElementById('c');c.innerHTML=d.logs.map(l=>'<div>['+l.time+'] <span class="'+l.type+'">['+l.type+']</span> '+l.msg.replace(/</g,'&lt;')+'</div>').join('');c.scrollTop=c.scrollHeight;}setInterval(f,1000);f();</script></body></html>`);
    }

    // 4. Web GM Panel & API
    if (pathname === "/gm" || pathname === "/") {
      const gmHtmlPath = path.join(__dirname, "..", "public", "gm.html");
      if (fs.existsSync(gmHtmlPath)) {
        return sendHtml(res, fs.readFileSync(gmHtmlPath, "utf-8"));
      }
      return sendHtml(res, "<h1>Sunny Pirates Private Server</h1><p><a href='/logs'>Live Logs</a></p>");
    }

    if (pathname === "/api/gm/catalog") {
      const roles = Object.values(dataApi.role.all())
        .filter((r) => r.kindName)
        .reduce((acc, r) => {
          // One entry per classId (highest/lowest color)
          if (!acc.seen[r.classId]) {
            acc.seen[r.classId] = true;
            acc.list.push({ kindId: r.kindId, classId: r.classId, name: r.kindName, group: r.group, color: r.color });
          }
          return acc;
        }, { seen: {}, list: [] }).list;

      const items = Object.values(dataApi.entity.all())
        .filter((e) => e.type !== "role" && e.kindName)
        .slice(0, 1500)
        .map((e) => ({ kindId: e.kindId, name: e.kindName, type: e.type, color: e.color }));

      return sendJson(res, { ok: true, roles, items });
    }

    if (pathname === "/api/gm/players") {
      const list = Object.values(db.players).map((p) => ({
        id: p.id,
        userName: p.userName,
        name: p.name,
        level: p.level,
        vip: p.vip.level,
        gem: p.gem,
        coin: p.coin,
        power: p.power,
        roleCount: Object.keys(p.team.roles || {}).length
      }));
      return sendJson(res, { ok: true, players: list });
    }

    if (pathname === "/api/gm/action" && req.method === "POST") {
      const body = parseFormOrJson(await readRequestBody(req));
      const p = findPlayerByNameOrId(body.playerId);
      if (!p) return sendJson(res, { ok: false, error: "Player not found" }, 404);

      const syncOut = {};
      const action = body.action;
      if (action === "addResources") {
        if (body.gem) playerService.addEntity(p, 102, Number(body.gem), {}, syncOut);
        if (body.coin) playerService.addEntity(p, 101, Number(body.coin), {}, syncOut);
        if (body.ap) playerService.addEntity(p, 99, Number(body.ap), {}, syncOut);
        if (body.exp) playerService.addEntity(p, 100, Number(body.exp), {}, syncOut);
        if (body.vipLevel !== undefined && body.vipLevel !== "") {
          p.vip.level = Math.max(0, Math.min(16, Number(body.vipLevel)));
          syncOut.vip = { level: p.vip.level, topUpGem: p.vip.topUpGem };
        }
      } else if (action === "addRole") {
        const kindId = Number(body.kindId);
        const star = Number(body.star || 5);
        const idx = String(p.team.nextRoleIdx++);
        const role = createRoleRecord(idx, kindId, star, p);
        if (!role) return sendJson(res, { ok: false, error: "Invalid role kindId" }, 400);
        p.team.roles[idx] = role;
        recalcPlayerPower(p);
        syncOut.team = { roles: { [idx]: role }, friendshipAttr: p.team.friendshipAttr };
        syncOut.power = p.power;
      } else if (action === "addItem") {
        playerService.addEntity(p, Number(body.kindId), Number(body.count || 1), {}, syncOut);
      } else if (action === "unlockAllMaps") {
        for (const sm of Object.values(dataApi.smap.all())) {
          if (!sm.bmap) continue;
          const t = sm.bmap.type;
          if (t === 1 || t === 2) {
            p.smapStarMap[t] = p.smapStarMap[t] || {};
            p.smapStarMap[t][sm.bmapId] = p.smapStarMap[t][sm.bmapId] || {};
            p.smapStarMap[t][sm.bmapId][sm.kindId] = 3;
          }
        }
        syncOut.smapStarMap = p.smapStarMap;
      } else if (action === "sendMail") {
        const mail = {
          _id: `gm_${Date.now()}`,
          senderId: 9999999999,
          senderName: "GM",
          title: String(body.title || "GM Gift"),
          body: String(body.body || "Gift from GM Panel"),
          ctime: Date.now(),
          status: 1,
          isSys: true,
          dropList: [{ entityId: Number(body.kindId || 102), count: Number(body.count || 10000) }]
        };
        p.extra.mails.unshift(mail);
        pushToPlayer(p.id, "onNewMail", { mail });
      }

      markDirty("players");
      saveDb();
      if (Object.keys(syncOut).length > 0) {
        pushToPlayer(p.id, "onSync", syncOut);
      }
      return sendJson(res, { ok: true, player: { id: p.id, name: p.name, gem: p.gem, coin: p.coin, level: p.level, vip: p.vip.level } });
    }

    return sendJson(res, { code: 404, msg: "Not Found", path: pathname }, 404);
  };
}

module.exports = { createHttpHandler, getEffectiveHostAndPort };
