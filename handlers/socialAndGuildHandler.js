const { db, markDirty, allocGuildId } = require("../db/database");
const { zipBase64 } = require("../net/pomeloProtocol");
const playerService = require("../services/playerService");

function formatGuildListSummary(g, rank) {
  return {
    id: g.id,
    name: g.name,
    badgeId: g.badgeId || 1,
    chairmanName: g.chairmanName || "Captain",
    activePoint: g.activePoint || 0,
    joinLevelLimit: g.joinLevelLimit || 1,
    joinRequireType: g.joinRequireType || 1,
    menberCount: (g.memberIds && g.memberIds.length) || (g.members && g.members.length) || 1,
    level: g.level || 1,
    maxMemberCount: g.maxMemberCount || 25,
    rank
  };
}

function normalizeGuildObj(g) {
  if (!g) return null;
  if (!Array.isArray(g.memberIds)) {
    g.memberIds = Array.isArray(g.members) ? g.members.map((m) => m.playerId) : [];
  }
  if (!g.chairmanName) {
    const ch = Array.isArray(g.members) ? g.members[0] : null;
    g.chairmanName = (ch && ch.playerName) || "Captain";
  }
  if (g.joinLevelLimit === undefined) g.joinLevelLimit = 1;
  if (!Array.isArray(g.logList)) g.logList = [];
  if (g.drumTimes === undefined) g.drumTimes = 0;
  if (g.openBoxTimes === undefined) g.openBoxTimes = 0;
  if (g.maxMemberCount === undefined) g.maxMemberCount = 25;
  return g;
}

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
      const now = Date.now();
      const guild = {
        id: gid,
        serverId: player.serverId || 1,
        name: String(msg.name || "StrawHat"),
        badgeId: Number(msg.badgeId || 1),
        level: 1,
        activePoint: 0,
        maxMemberCount: 25,
        notice: "Welcome to our guild!",
        joinRequireType: 1,
        joinLevelLimit: 1,
        joinRequireLevel: 1,
        chairmanId: player.id,
        chairmanName: player.name,
        chairmanAtime: now,
        ctime: now,
        atime: now,
        drumTimes: 0,
        openBoxTimes: 0,
        memberIds: [player.id],
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
        logList: [{ playerId: player.id, playerName: player.name, msg: "创建公会", ctime: now }],
        applies: []
      };
      db.guilds[String(gid)] = guild;
      player.guildId = gid;
      player.guildName = guild.name;
      markDirty("guilds");
      sync.guildId = gid;
      sync.guildName = guild.name;
      sync.guild = guild;
      return sync;
    }

    if (action === "info") {
      const guild = player.guildId ? normalizeGuildObj(db.guilds[String(player.guildId)]) : null;
      if (guild) sync.guild = guild;
      return sync;
    }

    if (action === "list") {
      let guilds = Object.values(db.guilds);
      if (guilds.length === 0) {
        const gid = allocGuildId();
        const now = Date.now();
        const npcGuild = {
          id: gid,
          serverId: player.serverId || 1,
          name: "StrawHat",
          badgeId: 1,
          level: 1,
          activePoint: 1000,
          maxMemberCount: 25,
          notice: "Welcome to StrawHat Fleet!",
          joinRequireType: 1,
          joinLevelLimit: 1,
          chairmanId: 999999,
          chairmanName: "Luffy",
          chairmanAtime: now,
          ctime: now,
          atime: now,
          drumTimes: 0,
          openBoxTimes: 0,
          memberIds: [],
          members: [],
          logList: [],
          applies: []
        };
        db.guilds[String(gid)] = npcGuild;
        markDirty("guilds");
        guilds = [npcGuild];
      }
      const list = guilds.map((g, i) => formatGuildListSummary(normalizeGuildObj(g), i + 1));
      return {
        code: 200,
        _temp: {
          _decodeKeys: ["list"],
          list: zipBase64(list),
          route
        }
      };
    }

    if (action === "applyJoin") {
      const gid = String(msg.guildId || "");
      const guild = normalizeGuildObj(db.guilds[gid]);
      if (!guild) return { code: 500, msg: "Guild not found" };
      if (!guild.memberIds.includes(player.id)) {
        guild.memberIds.push(player.id);
        guild.members.push({
          playerId: player.id,
          playerName: player.name,
          level: player.level,
          power: player.power,
          role: 3,
          contribution: 0,
          photoInfo: player.photoInfo
        });
        guild.logList.push({ playerId: player.id, playerName: player.name, msg: "加入公会", ctime: Date.now() });
      }
      player.guildId = guild.id;
      player.guildName = guild.name;
      player.joinGuildTimes = (player.joinGuildTimes || 0) + 1;
      markDirty("guilds");
      sync.guildId = guild.id;
      sync.guildName = guild.name;
      sync.joinGuildTimes = player.joinGuildTimes;
      return sync;
    }

    if (action === "worship") {
      const type = Number(msg.worshipType || msg.type || 1);
      const ap = type === 3 ? 120 : type === 2 ? 50 : 25;
      playerService.addEntity(player, 99, ap, {}, sync);
      sync._temp.entityCountMap = { 99: ap };
      return sync;
    }

    if (action === "openBox") {
      const guild = player.guildId ? normalizeGuildObj(db.guilds[String(player.guildId)]) : null;
      if (guild) {
        guild.openBoxTimes = (guild.openBoxTimes || 0) + 1;
        guild.activePoint = Math.max(0, (guild.activePoint || 100) - 5);
        markDirty("guilds");
        sync.guild = { openBoxTimes: guild.openBoxTimes, activePoint: guild.activePoint };
      }
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 102, count: 30 }, { entityId: 101, count: 50000 }], sync);
      return sync;
    }

    if (action === "drum") {
      const guild = player.guildId ? normalizeGuildObj(db.guilds[String(player.guildId)]) : null;
      if (guild) {
        guild.activePoint = (guild.activePoint || 0) + 60;
        guild.drumTimes = (guild.drumTimes || 0) + 1;
        markDirty("guilds");
        sync.guild = {
          activePoint: guild.activePoint,
          drumTimes: guild.drumTimes,
          level: guild.level || 1,
          maxMemberCount: guild.maxMemberCount || 25
        };
      }
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 107, count: 300 }], sync);
      return sync;
    }

    if (action === "upgradeSkill") {
      const key = String(msg.type || "HP").toUpperCase();
      const attrKey = key.toLowerCase();
      player.guildSkill = player.guildSkill || { levelMap: { HP: 0, ATK: 0, DEF: 0, MDEF: 0 }, attr: { hp: 0, atk: 0, def: 0, mdef: 0 } };
      player.guildSkill.levelMap[key] = (player.guildSkill.levelMap[key] || 0) + 1;
      player.guildSkill.attr[attrKey] = (player.guildSkill.attr[attrKey] || 0) + 100;
      sync.guildSkill = player.guildSkill;
      return sync;
    }

    return sync;
  }

  if (route.startsWith("logic.guildBattleHandler.openInfo")) {
    return {
      code: 200,
      _temp: {
        openInfo: { openTime: Date.now() + 3600000, isOpen: false },
        route
      }
    };
  }

  if (route.startsWith("logic.newGuildBattleHandler.openInfo")) {
    return {
      code: 200,
      _temp: {
        openInfo: {
          openTime: Date.now() + 3600000,
          isOpen: true,
          isReady: false,
          isHaveTarget: null,
          preBattleResult: null,
          defenseTeamInfo: { teamIndexs: [], shipIndexs: [] }
        },
        route
      }
    };
  }

  if (route.startsWith("logic.friendHandler.")) {
    const action = route.split(".")[2];
    if (action === "myFriendList") {
      return {
        code: 200,
        friend: player.friend,
        _temp: { list: [], route }
      };
    }
    if (action === "recommendList") {
      const now = Date.now();
      const others = Object.values(db.players)
        .filter((p) => Number(p.id) !== Number(player.id))
        .slice(0, 10)
        .map((p) => ({
          playerId: p.id,
          playerName: p.name,
          playerLevel: p.level,
          playerPhotoInfo: p.photoInfo,
          serverId: p.serverId || 1,
          atime: p.atime || now,
          isOnline: true
        }));
      return {
        code: 200,
        _temp: { list: others, route }
      };
    }
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
