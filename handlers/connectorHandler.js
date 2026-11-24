const settings = require("../config/serverSettings");
const { zipBase64 } = require("../net/pomeloProtocol");
const {
  db,
  markDirty,
  saveDb,
  allocPlayerId,
  getPlayersByUserId
} = require("../db/database");
const { createPlayerRecord, sanitizePlayerForClient } = require("../models/playerFactory");

function handleConnectorRoute(route, msg, session, reqHeaders) {
  if (route === "gate.gateHandler.queryEntry") {
    let host = settings.DEFAULT_LAN_IP;
    let port = settings.PORT;
    const xfProto = String((reqHeaders && reqHeaders["x-forwarded-proto"]) || "").split(",")[0].trim().toLowerCase();
    if (settings.PUBLIC_HOST) {
      const parts = settings.PUBLIC_HOST.split(":");
      host = parts[0];
      port = parts[1] ? Number(parts[1]) : 443;
    } else if (process.env.RENDER_EXTERNAL_HOSTNAME) {
      host = process.env.RENDER_EXTERNAL_HOSTNAME;
      port = 443;
    } else if (reqHeaders && reqHeaders.host) {
      const parts = reqHeaders.host.split(":");
      host = parts[0];
      port = parts[1] ? Number(parts[1]) : (xfProto === "https" ? 443 : settings.PORT);
    }
    return { code: 200, host, port: String(port) };
  }

  if (route === "connector.entryHandler.entry") {
    const token = String(msg.token || "");
    let matchedAcc = null;
    for (const acc of Object.values(db.accounts)) {
      if (acc.token === token) {
        matchedAcc = acc;
        break;
      }
    }
    // Fallback: parse tok_<uid>_<ts> if token was from previous restart
    let uid = matchedAcc ? matchedAcc.uid : null;
    if (!uid && token.startsWith("tok_")) {
      const parts = token.split("_");
      uid = Number(parts[1]) || null;
    }
    session.uid = uid || 10001;
    session.userName = matchedAcc ? matchedAcc.userName : `user_${session.uid}`;
    session.serverId = Number(msg.serverId || settings.SERVER_ID);
    session.oldServerId = Number(msg.oldServerId || settings.OLD_SERVER_ID);
    return { code: 200 };
  }

  if (route === "connector.playerHandler.getPlayers") {
    const list = getPlayersByUserId(session.uid, session.oldServerId).map((p) => ({
      id: p.id,
      name: p.name,
      level: p.level,
      serverId: p.serverId,
      oldServerId: p.oldServerId,
      photoInfo: p.photoInfo
    }));
    return { code: 200, players: list };
  }

  if (route === "connector.playerHandler.createPlayer") {
    const existing = getPlayersByUserId(session.uid, session.oldServerId);
    let player = existing[0];
    if (!player) {
      const playerId = allocPlayerId();
      player = createPlayerRecord({
        playerId,
        userId: session.uid,
        userName: session.userName || String(msg.name || `Pirate_${playerId}`),
        name: String(msg.name || session.userName || `Pirate_${playerId}`),
        serverId: session.serverId,
        oldServerId: session.oldServerId
      });
      db.players[String(player.id)] = player;
      markDirty("players");
      saveDb();
    }
    session.playerId = player.id;
    sanitizePlayerForClient(player);
    return { code: 200, player: zipBase64(player) };
  }

  if (route === "connector.playerHandler.entry") {
    const targetId = String(msg.playerId || "");
    let player = db.players[targetId];
    if (!player) {
      const list = getPlayersByUserId(session.uid);
      player = list[0];
    }
    if (!player) {
      return { code: 500, msg: "Player not found" };
    }
    session.playerId = player.id;
    player.lastLoginTime = Date.now();
    sanitizePlayerForClient(player);
    markDirty("players");
    return { code: 200, player: zipBase64(player) };
  }

  return null;
}

module.exports = { handleConnectorRoute };
