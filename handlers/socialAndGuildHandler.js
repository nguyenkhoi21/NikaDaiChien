const { db, markDirty, allocGuildId } = require("../db/database");
const playerService = require("../services/playerService");

function handleSocialAndGuildRoute(route, msg, player) {
  if (route.startsWith("logic.mailHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };
    const mails = player.extra.mails || [];

    if (action === "read") {
      const m = mails.find((x) => String(x._id) === String(msg.mailId));
      if (m) m.status = 2;
      sync.extra = { mails };
      return sync;
    }

    if (action === "receive") {
      const m = mails.find((x) => String(x._id) === String(msg.mailId));
      const allDrops = [];
      if (m && m.status !== 3) {
        m.status = 3;
        if (Array.isArray(m.dropList)) allDrops.push(...m.dropList);
      }
      sync._temp.entityCountMap = playerService.addDropList(player, allDrops, sync);
      player.extra.mails = mails.filter((x) => x.status !== 3);
      sync.extra = { mails: player.extra.mails };
      return sync;
    }

    if (action === "receiveAll") {
      const allDrops = [];
      for (const m of mails) {
        if (Array.isArray(m.dropList)) allDrops.push(...m.dropList);
        m.status = 3;
      }
      sync._temp.entityCountMap = playerService.addDropList(player, allDrops, sync);
      player.extra.mails = [];
      sync.extra = { mails: [] };
      return sync;
    }

    if (action === "removeAllRead") {
      player.extra.mails = mails.filter((x) => x.status === 1);
      sync.extra = { mails: player.extra.mails };
      return sync;
    }

    return sync;
  }

  if (route.startsWith("logic.guildHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };

    if (action === "create") {
      if (player.guildId) return { code: 500, msg: "Already in guild" };
      if (!playerService.reduceEntity(player, 102, 500, sync)) return { code: 500, msg: "Not enough gems" };
      const gid = allocGuildId();
      const guild = {
        id: gid,
        name: String(msg.name || "StrawHat"),
        badgeId: Number(msg.badgeId || 1),
        level: 1,
        activePoint: 0,
        notice: "Welcome to our guild!",
        joinRequireType: 1,
        joinRequireLevel: 1,
        chairmanId: player.id,
        chairmanAtime: Date.now(),
        members: [
          {
            playerId: player.id,
            playerName: player.name,
            level: player.level,
            power: player.power,
            role: 1,
            contribution: 0,
            photoInfo: player.photoInfo
          }
        ],
        applies: []
      };
      db.guilds[String(gid)] = guild;
      player.guildId = gid;
      player.guildName = guild.name;
      markDirty("guilds");
      sync.guildId = gid;
      sync.guildName = guild.name;
      sync._temp.guild = guild;
      return sync;
    }

    if (action === "info") {
      const guild = player.guildId ? db.guilds[String(player.guildId)] : null;
      sync._temp.guild = guild || null;
      return sync;
    }

    if (action === "list") {
      sync._temp.list = Object.values(db.guilds);
      return sync;
    }

    if (action === "worship") {
      const type = Number(msg.type || 1);
      const ap = type === 3 ? 120 : type === 2 ? 50 : 25;
      playerService.addEntity(player, 99, ap, {}, sync);
      sync._temp.entityCountMap = { 99: ap };
      return sync;
    }

    if (action === "openBox") {
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 101, count: 50000 }, { entityId: 107, count: 100 }], sync);
      return sync;
    }

    if (action === "drum") {
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 107, count: 300 }], sync);
      return sync;
    }

    if (action === "upgradeSkill") {
      const t = msg.type || "hp";
      player.guildSkill[t] = (player.guildSkill[t] || 0) + 1;
      sync.guildSkill = player.guildSkill;
      return sync;
    }

    return sync;
  }

  if (route.startsWith("logic.friendHandler.")) {
    return {
      code: 200,
      _temp: {
        route,
        list: player.friend.list || [],
        infoMap: player.friend.infoMap || {},
        recommendList: [],
        requestList: []
      }
    };
  }

  if (
    route === "chat.chatHandler.getGuildLast" ||
    route.startsWith("logic.guildBossHandler.") ||
    route.startsWith("logic.guildBattleHandler.") ||
    route.startsWith("logic.newGuildBattleHandler.") ||
    route.startsWith("logic.activityGuildBattleHandler.") ||
    route.startsWith("logic.prestigeBattleHandler.") ||
    route.startsWith("logic.teamBattleHandler.") ||
    route.startsWith("logic.doubleBattleHandler.") ||
    route.startsWith("logic.worshipBattleHandler.") ||
    route.startsWith("logic.allServerBattleHandler.")
  ) {
    return { code: 200, _temp: { route, list: [], openInfo: {}, teams: [], teamInfo: {} } };
  }

  return null;
}

module.exports = { handleSocialAndGuildRoute };
