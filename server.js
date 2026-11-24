const http = require("http");
const settings = require("./config/serverSettings");
require("./config/dataLoader");
const { db, markDirty, saveDb, scheduleSaveDb } = require("./db/database");
const {
  Package,
  Message,
  computeAcceptKey,
  encodeWsFrame,
  parseWsFrames
} = require("./net/pomeloProtocol");
const { createHttpHandler } = require("./handlers/httpHandler");
const { handleConnectorRoute } = require("./handlers/connectorHandler");
const { handleSmapRoute } = require("./handlers/smapHandler");
const { handleTeamRoute } = require("./handlers/teamHandler");
const { handleBagRoute } = require("./handlers/bagHandler");
const { handleShopAndPointRoute } = require("./handlers/shopAndPointHandler");
const { handlePlayerRoute } = require("./handlers/playerHandler");
const { handlePveAndPvpRoute } = require("./handlers/pveAndPvpHandler");
const { handleSocialAndGuildRoute } = require("./handlers/socialAndGuildHandler");
const { handleGmAndBtRoute } = require("./handlers/gmAndBtHandler");
const hotfixMirrorService = require("./services/hotfixMirrorService");

const liveLogs = [];
const MAX_LIVE_LOGS = 400;

function addLiveLog(type, msg) {
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  liveLogs.push({ time, type, msg: String(msg) });
  if (liveLogs.length > MAX_LIVE_LOGS) liveLogs.shift();
}

const connectedSockets = new Set();

function sendPomeloPackage(socket, pkgType, bodyBuf) {
  if (!socket || socket.destroyed) return;
  const pkg = Package.encode(pkgType, bodyBuf);
  socket.write(encodeWsFrame(pkg, 0x02));
}

function sendPomeloResponse(socket, msgId, bodyObj) {
  const payload = Buffer.from(JSON.stringify(bodyObj || {}), "utf-8");
  const msg = Message.encode(msgId, Message.TYPE_RESPONSE, 0, null, payload);
  sendPomeloPackage(socket, Package.TYPE_DATA, msg);
}

function sendPomeloPush(socket, route, bodyObj) {
  const payload = Buffer.from(JSON.stringify(bodyObj || {}), "utf-8");
  const msg = Message.encode(0, Message.TYPE_PUSH, 0, route, payload);
  sendPomeloPackage(socket, Package.TYPE_DATA, msg);
}

function pushToPlayer(playerId, route, data) {
  for (const sock of connectedSockets) {
    if (sock._session && Number(sock._session.playerId) === Number(playerId)) {
      sendPomeloPush(sock, route, data);
    }
  }
}

function pushToAll(route, data) {
  for (const sock of connectedSockets) {
    if (sock._session && sock._session.playerId) {
      sendPomeloPush(sock, route, data);
    }
  }
}

function dispatchRoute(route, msg, session, reqHeaders) {
  // 1. Gate & Connector routes
  const connRes = handleConnectorRoute(route, msg, session, reqHeaders);
  if (connRes) return connRes;

  const player = session.playerId ? db.players[String(session.playerId)] : null;
  if (!player) {
    return { code: 500, msg: "Session not bound to player" };
  }

  // 2. Gameplay routes
  const handlers = [
    () => handleSmapRoute(route, msg, player),
    () => handleTeamRoute(route, msg, player),
    () => handleBagRoute(route, msg, player),
    () => handleShopAndPointRoute(route, msg, player),
    () => handlePlayerRoute(route, msg, player, pushToAll),
    () => handlePveAndPvpRoute(route, msg, player),
    () => handleSocialAndGuildRoute(route, msg, player),
    () => handleGmAndBtRoute(route, msg, player)
  ];

  for (const fn of handlers) {
    const res = fn();
    if (res) {
      markDirty("players");
      scheduleSaveDb();
      return res;
    }
  }

  // 3. Safe fallback so client request queue never stalls
  addLiveLog("ERR", `Unhandled route: ${route} msg=${JSON.stringify(msg).slice(0, 200)}`);
  return { code: 200, _temp: { route, list: [], entityCountMap: {} } };
}

const httpHandler = createHttpHandler({
  liveLogs,
  addLiveLog,
  connectedSockets,
  pushToPlayer
});

const server = http.createServer((req, res) => {
  httpHandler(req, res).catch((err) => {
    console.error("[HTTP] Error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: 500, msg: err.message }));
    }
  });
});

server.on("upgrade", (req, socket, head) => {
  const wsKey = req.headers["sec-websocket-key"];
  if (!wsKey) {
    socket.destroy();
    return;
  }
  const acceptKey = computeAcceptKey(wsKey);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  connectedSockets.add(socket);
  const session = { uid: null, userName: null, serverId: settings.SERVER_ID, oldServerId: settings.OLD_SERVER_ID, playerId: null };
  socket._session = session;

  const wsState = { buffer: head && head.length ? Buffer.from(head) : Buffer.alloc(0), fragOpcode: 0, fragChunks: [] };
  let hbTimer = null;

  const startHeartbeat = () => {
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = setInterval(() => {
      if (!socket.destroyed) {
        sendPomeloPackage(socket, Package.TYPE_HEARTBEAT, Buffer.alloc(0));
      }
    }, settings.HEARTBEAT_SECONDS * 1000);
    if (hbTimer.unref) hbTimer.unref();
  };

  socket.on("data", (chunk) => {
    parseWsFrames(wsState, chunk, (opcode, data) => {
      if (opcode === 0x08) {
        socket.end();
        return;
      }
      if (opcode === 0x09) {
        socket.write(encodeWsFrame(data, 0x0a));
        return;
      }
      if (opcode !== 0x01 && opcode !== 0x02) return;

      const pkgs = Package.decode(data);
      for (const pkg of pkgs) {
        if (pkg.type === Package.TYPE_HANDSHAKE) {
          const hs = {
            code: 200,
            sys: { heartbeat: settings.HEARTBEAT_SECONDS, dict: {}, protos: { version: 0, server: {}, client: {} } },
            user: {}
          };
          sendPomeloPackage(socket, Package.TYPE_HANDSHAKE, Buffer.from(JSON.stringify(hs), "utf-8"));
        } else if (pkg.type === Package.TYPE_HANDSHAKE_ACK) {
          startHeartbeat();
          sendPomeloPackage(socket, Package.TYPE_HEARTBEAT, Buffer.alloc(0));
        } else if (pkg.type === Package.TYPE_HEARTBEAT) {
          // Heartbeat ack received
        } else if (pkg.type === Package.TYPE_DATA) {
          const msg = Message.decode(pkg.body);
          let payload = {};
          if (msg.body && msg.body.length > 0) {
            try {
              payload = JSON.parse(msg.body.toString("utf-8"));
            } catch (_) {}
          }
          addLiveLog("REQ", `${session.playerId || session.uid || "anon"} -> ${msg.route} ${JSON.stringify(payload).slice(0, 180)}`);
          const resObj = dispatchRoute(msg.route, payload, session, req.headers);
          if (msg.type === Message.TYPE_REQUEST && msg.id > 0) {
            const keys = Object.keys(resObj || {}).join(",");
            addLiveLog("RESP", `${session.playerId || session.uid || "anon"} <- ${msg.route} (${keys})`);
            sendPomeloResponse(socket, msg.id, resObj);
          }
        }
      }
    });
  });

  socket.on("close", () => {
    if (hbTimer) clearInterval(hbTimer);
    connectedSockets.delete(socket);
    saveDb(false);
  });

  socket.on("error", () => {
    if (hbTimer) clearInterval(hbTimer);
    connectedSockets.delete(socket);
  });
});

setInterval(() => saveDb(false), 10000).unref();

if (require.main === module) {
  hotfixMirrorService.checkAndSyncIfNeeded("startup").catch(() => {});
  const syncTimer = setInterval(() => {
    hotfixMirrorService.checkAndSyncIfNeeded("periodic").catch(() => {});
  }, 60 * 60 * 1000);
  if (syncTimer.unref) syncTimer.unref();

  server.listen(settings.PORT, settings.HOST, () => {
    console.log("=======================================================");
    console.log("  Sunny Pirates II (Nika Dai Chien) Private Server!");
    console.log(`  LAN / HTTP   : http://${settings.DEFAULT_LAN_IP}:${settings.PORT}`);
    console.log(`  Pomelo WS    : ws://${settings.DEFAULT_LAN_IP}:${settings.PORT}`);
    console.log(`  Web GM Panel : http://localhost:${settings.PORT}/gm`);
    console.log(`  Live Logs    : http://localhost:${settings.PORT}/logs`);
    console.log("=======================================================");
  });
}

module.exports = { server, liveLogs, connectedSockets };
