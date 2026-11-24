const dataApi = require("../config/dataLoader");
const { db, markDirty } = require("../db/database");
const playerService = require("../services/playerService");

function getRobotSquad(rank) {
  const names = ["Buggy Pirates", "Alvida Crew", "Kuro Pirates", "Don Krieg", "Arlong Crew", "Baroque Works", "CP9", "Thriller Bark", "Marine HQ", "Yonko Fleet"];
  const botId = Math.max(1, Math.min(9999, Number(rank || 100)));
  const lv = Math.max(10, Math.min(95, 100 - Math.floor(rank / 10)));
  return {
    playerId: botId,
    playerName: `${names[botId % names.length]} #${botId}`,
    playerLevel: lv,
    rank: Number(rank),
    totalPower: lv * 1200,
    serverId: 1,
    playerPhotoInfo: { photoImgId: 1001 + (botId % 10), shipImgId: 901, frameId: 0, titleImgId: 0 },
    roles: {
      1: { idx: "1", kindId: 100101, level: lv, star: 3, attr: { hp: lv * 500, atk: lv * 45, def: lv * 30, mdef: lv * 30, hit: 100, dodge: 0, crit: 10 } }
    }
  };
}

function handlePveAndPvpRoute(route, msg, player) {
  if (route.startsWith("logic.arenaHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };
    if (action === "info") {
      sync._temp.rank = player.arena.rank;
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
      sync.arena = { defenseTeamIndexs: player.arena.defenseTeamIndexs, defenseShipIndexs: player.arena.defenseShipIndexs };
      return sync;
    }
    if (action === "defenseTeam") {
      sync._temp.playerInfo = getRobotSquad(100);
      return sync;
    }
    if (action === "choose") {
      sync._temp.defenderInfo = getRobotSquad(100);
      return sync;
    }
    if (action === "challenge") {
      player.arena.remainingChallengeTimes = Math.max(0, (player.arena.remainingChallengeTimes || 5) - 1);
      if (msg.isWin) {
        player.arena.rank = Math.max(1, (player.arena.rank || 500) - 5);
        if (player.arena.rank < player.arena.topRank) player.arena.topRank = player.arena.rank;
        sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 103, count: 50 }, { entityId: 102, count: 50 }], sync);
      } else {
        sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 103, count: 20 }], sync);
      }
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
      player.expedition.passId = 0;
      player.expedition.status = 1;
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
    if (action === "pass") {
      player.endless.topPassId = (player.endless.topPassId || 0) + 1;
      sync.endless = player.endless;
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 101, count: 30000 }, { entityId: 102, count: 50 }], sync);
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
    const list = Object.values(db.players)
      .sort((a, b) => (b.power || 0) - (a.power || 0))
      .slice(0, 50)
      .map((p, i) => ({
        rank: i + 1,
        playerId: p.id,
        playerName: p.name,
        playerLevel: p.level,
        totalPower: p.power,
        playerPhotoInfo: p.photoInfo
      }));
    return { code: 200, _temp: { route, list } };
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
