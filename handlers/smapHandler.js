const dataApi = require("../config/dataLoader");
const serverConfig = require("../config/serverConfig");
const playerService = require("../services/playerService");

function rollSmapDrops(smap, player, teamIndexs) {
  const dropList = [];
  if (smap.coin) dropList.push({ entityId: 101, count: smap.coin });
  if (smap.actionPoint) {
    dropList.push({ entityId: 100, count: smap.actionPoint });
  }
  if (Array.isArray(smap.showEntityIds)) {
    for (const eid of smap.showEntityIds) {
      if (eid && Math.random() < 0.65) {
        dropList.push({ entityId: eid, count: 1 });
      }
    }
  }
  if (Array.isArray(smap.specifyDropEntityIds) && Array.isArray(smap.specifyDropValues)) {
    for (let i = 0; i < smap.specifyDropEntityIds.length; i++) {
      const eid = smap.specifyDropEntityIds[i];
      const val = smap.specifyDropValues[i] || 1;
      if (eid) dropList.push({ entityId: eid, count: val });
    }
  }
  // Role EXP to participating team (fallback to all if none passed)
  if (smap.roleExp) {
    const idxs = Array.isArray(teamIndexs) && teamIndexs.length > 0
      ? teamIndexs.map(String)
      : Object.keys(player.team.roles || {});
    for (const idx of idxs) {
      const r = player.team.roles && player.team.roles[idx];
      if (r) playerService.addRoleExp(r, smap.roleExp, player);
    }
  }
  return dropList;
}

function calcTotalStarCount(smapStarMap) {
  let total = 0;
  for (const t of Object.values(smapStarMap || {})) {
    for (const bmap of Object.values(t || {})) {
      for (const st of Object.values(bmap || {})) {
        total += Number(st || 0);
      }
    }
  }
  return total;
}

function handleSmapRoute(route, msg, player) {
  if (!route.startsWith("logic.smapHandler.")) return null;
  const action = route.split(".")[2];
  const sync = { code: 200, _temp: { route } };

  if (action === "beginSmap") {
    const smap = dataApi.smap.findById(Number(msg.smapId));
    if (!smap) return { code: 500, msg: "Stage not found" };
    player._curSmapId = smap.kindId;
    return { code: 200, _temp: { showEntityIdsMap: {}, route } };
  }

  if (action === "endSmap") {
    const smapId = Number(msg.smapId || player._curSmapId || 10101);
    const star = Math.max(0, Math.min(3, Number(msg.star || 3)));
    const smap = dataApi.smap.findById(smapId);
    if (!smap || !smap.bmap) {
      sync._temp.entityCountMap = {};
      return sync;
    }
    const type = smap.bmap.type;
    const bmapId = smap.bmapId;

    if (star > 0) {
      if (smap.actionPoint) {
        playerService.reduceEntity(player, 99, smap.actionPoint, sync);
      }
      player.smapStarMap[type] = player.smapStarMap[type] || {};
      player.smapStarMap[type][bmapId] = player.smapStarMap[type][bmapId] || {};
      const prevStar = player.smapStarMap[type][bmapId][smapId] || 0;
      if (star > prevStar) {
        player.smapStarMap[type][bmapId][smapId] = star;
      }

      player.smapTimesMap[type] = player.smapTimesMap[type] || {};
      player.smapTimesMap[type][bmapId] = player.smapTimesMap[type][bmapId] || {};
      player.smapTimesMap[type][bmapId][smapId] = (player.smapTimesMap[type][bmapId][smapId] || 0) + 1;

      player.starCount = calcTotalStarCount(player.smapStarMap);
      if (type === 1 && smapId > (player.task.mapType1SmapId || 0)) {
        player.task.mapType1SmapId = smapId;
        sync.task = { mapType1SmapId: smapId };
      } else if (type === 2 && smapId > (player.task.mapType2SmapId || 0)) {
        player.task.mapType2SmapId = smapId;
        sync.task = { mapType2SmapId: smapId };
      }

      const drops = rollSmapDrops(smap, player, msg.teamIndexs);
      const entityCountMap = playerService.addDropList(player, drops, sync);
      sync.smapStarMap = player.smapStarMap;
      sync.smapTimesMap = player.smapTimesMap;
      sync.starCount = player.starCount;
      sync.team = { roles: player.team.roles, friendshipAttr: player.team.friendshipAttr };
      sync.power = player.power;
      sync.topPower = player.topPower;
      sync._temp.entityCountMap = entityCountMap;
    } else {
      sync._temp.entityCountMap = {};
    }
    return sync;
  }

  if (action === "skip") {
    const smapId = Number(msg.smapId || 10101);
    const times = Math.max(1, Math.min(20, Number(msg.times || 1)));
    const smap = dataApi.smap.findById(smapId);
    if (!smap || !smap.bmap) return { code: 500, msg: "Stage not found" };
    const type = smap.bmap.type;
    const bmapId = smap.bmapId;

    if (smap.actionPoint) {
      playerService.reduceEntity(player, 99, smap.actionPoint * times, sync);
    }

    const entityCountMapList = [];
    for (let i = 0; i < times; i++) {
      const drops = rollSmapDrops(smap, player, msg.teamIndexs);
      entityCountMapList.push(playerService.addDropList(player, drops, sync));
    }

    const extraDrop = [{ entityId: 20002, count: times }];
    const extraEntityCountMap = playerService.addDropList(player, extraDrop, sync);

    player.smapTimesMap[type] = player.smapTimesMap[type] || {};
    player.smapTimesMap[type][bmapId] = player.smapTimesMap[type][bmapId] || {};
    player.smapTimesMap[type][bmapId][smapId] = (player.smapTimesMap[type][bmapId][smapId] || 0) + times;

    sync.smapTimesMap = player.smapTimesMap;
    sync.team = { roles: player.team.roles, friendshipAttr: player.team.friendshipAttr };
    sync.power = player.power;
    sync.topPower = player.topPower;
    sync._temp.entityCountMapList = entityCountMapList;
    sync._temp.extraEntityCountMap = extraEntityCountMap;
    return sync;
  }

  if (action === "receiveBmapAward") {
    const bmapId = Number(msg.bmapId);
    const star = Number(msg.star);
    const bmap = dataApi.bmap.findById(bmapId);
    player.bmapBoxReceivedMap[bmapId] = player.bmapBoxReceivedMap[bmapId] || {};
    player.bmapBoxReceivedMap[bmapId][star] = true;

    let desc = "102x200,101x50000";
    if (bmap) {
      if (star <= 10 && bmap.box1) desc = bmap.box1;
      else if (star <= 20 && bmap.box2) desc = bmap.box2;
      else if (bmap.box3) desc = bmap.box3;
    }
    const drops = serverConfig.DROP.FUNS.getDropListByDesc(desc);
    const entityCountMap = playerService.addDropList(player, drops, sync);
    sync.bmapBoxReceivedMap = player.bmapBoxReceivedMap;
    sync._temp.entityCountMap = entityCountMap;
    return sync;
  }

  if (action === "resetSmapTimes") {
    const smap = dataApi.smap.findById(Number(msg.smapId));
    if (smap && smap.bmap) {
      const t = smap.bmap.type;
      player.smapTimesMap[t] = player.smapTimesMap[t] || {};
      player.smapTimesMap[t][smap.bmapId] = player.smapTimesMap[t][smap.bmapId] || {};
      player.smapTimesMap[t][smap.bmapId][smap.kindId] = 0;
      sync.smapTimesMap = player.smapTimesMap;
    }
    return sync;
  }

  if (action === "buyMapType5Times") {
    player.vip.buyMapType5Times = (player.vip.buyMapType5Times || 0) + 1;
    sync.vip = { buyMapType5Times: player.vip.buyMapType5Times };
    return sync;
  }

  return sync;
}

module.exports = { handleSmapRoute };
