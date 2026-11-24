const { db } = require("../db/database");
const { zipBase64 } = require("../net/pomeloProtocol");
const playerService = require("../services/playerService");

function getRobotSquad(rank) {
  const names = ["Buggy Pirates", "Alvida Crew", "Kuro Pirates", "Don Krieg", "Arlong Crew", "Baroque Works", "CP9", "Thriller Bark", "Marine HQ", "Yonko Fleet"];
  const botId = Math.max(1, Math.min(9999, Number(rank || 100)));
  const lv = Math.max(10, Math.min(95, 100 - Math.floor(botId / 10)));
  const heroIds = [100101, 102601, 102001, 101601, 101801];
  const roles = heroIds.slice(0, 3).map((kid, idx) => ({
    kindId: kid + (idx % 2),
    level: lv,
    star: 2,
    skills: { [String(kid + (idx % 2))]: { kindId: kid + (idx % 2), level: 1 } },
    attr: {
      hp: lv * 500,
      atk: lv * 45,
      def: lv * 30,
      mdef: lv * 30,
      hit: 100,
      dodge: 0,
      crit: 10,
      hpRecover: 0,
      mpRecover: 0
    },
    power: lv * 400
  }));
  const totalPower = roles.reduce((s, r) => s + r.power, 0);
  return {
    playerId: botId,
    serverId: 1,
    playerName: `${names[botId % names.length]} #${botId}`,
    playerLevel: lv,
    rank: Number(rank || botId),
    totalPower,
    winTimes: 10,
    ships: [],
    shipsMap: { "1": [], "2": [], "3": [] },
    playerPhotoInfo: { photoImgId: 1001 + (botId % 10), shipImgId: 900 },
    roles
  };
}

function buildPlayerBattleTeam(player, teamIndexs, shipIndexs) {
  const rIdxs = Array.isArray(teamIndexs) && teamIndexs.length > 0
    ? teamIndexs.map(String)
    : Object.keys((player.team && player.team.roles) || {}).slice(0, 5);
  const roles = [];
  for (const idx of rIdxs) {
    const r = player.team && player.team.roles && player.team.roles[idx];
    if (r) roles.push(r);
  }
  const sIdxs = Array.isArray(shipIndexs) ? shipIndexs.map(String) : [];
  const ships = [];
  for (const idx of sIdxs) {
    const sh = player.bag && player.bag.items && player.bag.items[idx];
    if (sh) ships.push(sh);
  }
  return {
    userId: player.userId,
    sid: "connector-server-1",
    serverId: player.serverId,
    playerId: player.id,
    playerPhotoInfo: player.photoInfo,
    playerName: player.name,
    playerLevel: player.level,
    guildName: player.guildName || null,
    guildId: player.guildId || 0,
    roles,
    ships
  };
}

function handlePveAndPvpRoute(route, msg, player) {
  if (route.startsWith("logic.arenaHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };
    if (action === "info") {
      sync._temp.rank = player.arena.topRank || player.arena.rank || 10001;
      return sync;
    }
    if (action === "match") {
      const r = player.arena.rank || 500;
      sync._temp.smaller = getRobotSquad(Math.max(1, r - 3));
      sync._temp.middle = getRobotSquad(Math.max(2, r - 2));
      sync._temp.larger = getRobotSquad(Math.max(3, r - 1));
      return sync;
    }
    if (action === "setDefenseTeamIndexs") {
      player.arena.defenseTeamIndexs = msg.defenseTeamIndexs || ["1"];
      player.arena.defenseShipIndexs = msg.defenseShipIndexs || [];
      sync.arena = {
        defenseTeamIndexs: player.arena.defenseTeamIndexs,
        defenseShipIndexs: player.arena.defenseShipIndexs
      };
      return sync;
    }
    if (action === "defenseTeam") {
      const targetId = Number(msg.playerId || 100);
      const targetPlayer = db.players[String(targetId)];
      const defenseTeam = targetPlayer
        ? buildPlayerBattleTeam(targetPlayer, (targetPlayer.arena && targetPlayer.arena.defenseTeamIndexs) || [], [])
        : getRobotSquad(targetId);
      return {
        code: 200,
        _temp: {
          _decodeKeys: ["defenseTeam"],
          defenseTeam: zipBase64(defenseTeam),
          route
        }
      };
    }
    if (action === "choose") {
      const targetId = Number(msg.defenderId || 100);
      const targetPlayer = db.players[String(targetId)];
      const attackTeam = buildPlayerBattleTeam(player, msg.attackTeamIndexs, msg.attackShipIndexs);
      const defenseTeam = targetPlayer
        ? buildPlayerBattleTeam(targetPlayer, (targetPlayer.arena && targetPlayer.arena.defenseTeamIndexs) || [], [])
        : getRobotSquad(targetId);
      return {
        code: 200,
        _temp: {
          _decodeKeys: ["attackTeam", "defenseTeam"],
          attackTeam: zipBase64(attackTeam),
          defenseTeam: zipBase64(defenseTeam),
          route
        }
      };
    }
    if (action === "challenge") {
      const now = Date.now();
      player.arena.challengeTimes = (player.arena.challengeTimes || 0) + 1;
      player.arena.remainingChallengeTimes = Math.max(0, (player.arena.remainingChallengeTimes || 5) - 1);
      player.arena.nextChallengeTime = now + 600000;
      if (msg.isWin) {
        player.arena.winTimes = (player.arena.winTimes || 0) + 1;
        player.arena.rank = Math.max(1, (player.arena.rank || 500) - 5);
        if (!player.arena.topRank || player.arena.rank < player.arena.topRank) {
          player.arena.topRank = player.arena.rank;
        }
        sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 103, count: 50 }, { entityId: 102, count: 50 }], sync);
      } else {
        sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 103, count: 20 }], sync);
      }
      sync._temp.rank = player.arena.topRank || player.arena.rank;
      sync._temp.reportId = now;
      sync.arena = player.arena;
      return sync;
    }
    if (action === "buyChallengeTimes") {
      player.arena.remainingChallengeTimes += 5;
      player.vip.buyChallengeTimesTimes = (player.vip.buyChallengeTimesTimes || 0) + 1;
      sync.arena = player.arena;
      sync.vip = { buyChallengeTimesTimes: player.vip.buyChallengeTimesTimes };
      return sync;
    }
    if (action === "reportList") {
      sync._temp.list = [];
      return sync;
    }
    return sync;
  }

  if (route.startsWith("logic.arena3v3Handler.") || route.startsWith("logic.topArena3v3Handler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };
    if (action === "info") {
      sync._temp.rank = player.arena3v3.rank;
      sync._temp.playerInfoMap = {};
      return sync;
    }
    if (action === "match") {
      sync._temp.smaller = getRobotSquad(50);
      sync._temp.middle = getRobotSquad(40);
      sync._temp.larger = getRobotSquad(30);
      sync._temp.playerInfo = getRobotSquad(45);
      return sync;
    }
    if (action === "receive") {
      const coin = player.arena3v3.receiveCoin || 100;
      player.arena3v3.receiveCoin = 0;
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 106, count: coin }], sync);
      sync.arena3v3 = player.arena3v3;
      return sync;
    }
    if (action === "top50" || action === "reportList" || action === "worshipRank") {
      sync._temp.list = [];
      return sync;
    }
    return sync;
  }

  if (route.startsWith("logic.expeditionHandler.") || route.startsWith("logic.sixExpeditionHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };
    if (action === "reset") {
      player.vip.resetExpeditionTimes = (player.vip.resetExpeditionTimes || 0) + 1;
      player.expedition.passId = 0;
      player.expedition.status = 1;
      player.expedition.prePassId = 0;
      player.expedition.challengerInfo = { idx: 0, team: getRobotSquad(50) };
      player.expedition.selfInfo = {};
      sync.vip = { resetExpeditionTimes: player.vip.resetExpeditionTimes };
      sync.expedition = player.expedition;
      return sync;
    }
    if (action === "skip" || action === "receive") {
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 105, count: 200 }, { entityId: 101, count: 50000 }], sync);
      player.expedition.passId = Math.min(13, (player.expedition.passId || 0) + 1);
      sync.expedition = player.expedition;
      return sync;
    }
    if (action === "challenge") {
      player.expedition.passId = Math.min(13, (player.expedition.passId || 0) + 1);
      player.expedition.status = 2;
      sync.expedition = player.expedition;
      sync._temp.entityCountMap = {};
      return sync;
    }
    if (action === "info") {
      sync._temp.playerInfos = [getRobotSquad(10)];
      return sync;
    }
    return sync;
  }

  if (route.startsWith("logic.endlessHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };
    if (action === "begin") {
      return sync;
    }
    if (action === "pass") {
      const smapId = Number(msg.smapId || ((player.endless.passId || 40000) + 1));
      const bmapId = String(msg.bmapId || 401);
      player.endless.passId = smapId;
      player.endless.topPassId = Math.max(player.endless.topPassId || 0, smapId);
      player.endless.otherTopPassIdMap = player.endless.otherTopPassIdMap || {};
      player.endless.otherTopPassIdMap[bmapId] = smapId;
      sync.endless = player.endless;
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 101, count: 30000 }, { entityId: 60101, count: 1 }], sync);
      return sync;
    }
    if (action === "skip") {
      player.vip.endlessSkipTimes = (player.vip.endlessSkipTimes || 0) + 1;
      sync.vip = { endlessSkipTimes: player.vip.endlessSkipTimes };
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 101, count: 100000 }, { entityId: 102, count: 100 }], sync);
      return sync;
    }
    return sync;
  }

  if (route.startsWith("logic.rankHandler.")) {
    const isArena = route.endsWith(".arenaTop50");
    const sorted = Object.values(db.players).sort((a, b) =>
      isArena
        ? ((a.arena && a.arena.topRank) || 10001) - ((b.arena && b.arena.topRank) || 10001)
        : (b.power || 0) - (a.power || 0)
    );
    const list = sorted.slice(0, 50).map((p, i) => {
      const rank = isArena ? ((p.arena && p.arena.topRank) || i + 1) : i + 1;
      const value = isArena ? rank : (p.power || 0);
      return {
        serverId: p.serverId || 1,
        playerId: p.id,
        playerName: p.name,
        playerLevel: p.level,
        playerPhotoInfo: p.photoInfo,
        power: p.power || 0,
        guildName: p.guildName || "",
        rank,
        value,
        extValue: null
      };
    });
    const myIdx = sorted.findIndex((x) => Number(x.id) === Number(player.id));
    const myRank = myIdx >= 0 ? myIdx + 1 : 999;
    const myValue = isArena ? ((player.arena && player.arena.topRank) || myRank) : (player.power || 0);
    return {
      code: 200,
      _temp: {
        _decodeKeys: ["list"],
        myRank,
        myValue,
        extMyValue: null,
        list: zipBase64(list),
        route
      }
    };
  }

  if (
    route.startsWith("logic.eyeHandler.") ||
    route.startsWith("logic.tailHandler.") ||
    route.startsWith("logic.islandHandler.") ||
    route.startsWith("logic.practiceHandler.") ||
    route.startsWith("logic.sixPracticeHandler.") ||
    route.startsWith("logic.timePeakHandler.") ||
    route.startsWith("logic.worldBossHandler.") ||
    route.startsWith("logic.videoHandler.")
  ) {
    return {
      code: 200,
      _temp: {
        route,
        list: [],
        entityCountMap: {},
        openInfo: { rank: 1, dmg: 0, hp: 1000000, maxHp: 1000000 }
      }
    };
  }

  return null;
}

module.exports = { handlePveAndPvpRoute };
