const dataApi = require("../config/dataLoader");
const serverConfig = require("../config/serverConfig");
const { createShipItem, recalcShipItem, recalcPlayerPower } = require("../models/playerFactory");
const playerService = require("../services/playerService");

function handleBagRoute(route, msg, player) {
  if (!route.startsWith("logic.bagHandler.")) return null;
  const action = route.split(".")[2];
  const sync = { code: 200, _temp: { route } };

  if (action === "sell") {
    const idxs = Array.isArray(msg.bagIndexs) ? msg.bagIndexs : [msg.bagIndex];
    const counts = Array.isArray(msg.itemCounts) ? msg.itemCounts : [msg.count];
    let totalEarned = 0;
    let soldAny = false;
    for (let i = 0; i < idxs.length; i++) {
      const idx = String(idxs[i]);
      const it = player.bag.items[idx];
      if (!it) continue;
      const cnt = Math.max(1, Number(counts[i] || it.count || 1));
      const meta = dataApi.findEntityById(it.kindId);
      const price = (meta && meta.price) || 100;
      const taken = playerService.reduceBagByIdx(player, idx, Math.min(cnt, it.count), sync);
      if (taken) {
        totalEarned += price * taken.count;
        soldAny = true;
      }
    }
    if (!soldAny) return { code: 500, msg: "Item not found" };
    if (totalEarned > 0) playerService.addEntity(player, 101, totalEarned, {}, sync);
    return sync;
  }

  if (action === "composeRole") {
    const classId = Number(msg.classId);
    const soulMeta = dataApi.findSoulByClassId(classId);
    if (!soulMeta) return { code: 500, msg: "Soul not found" };
    const cost = serverConfig.ROLE.FUNS.getComposeRoleCost(soulMeta.star || 1);
    if (!playerService.reduceEntity(player, 101, cost.coin, sync)) return { code: 500, msg: "Not enough coins" };
    if (!playerService.reduceEntity(player, soulMeta.kindId, cost.soul, sync)) return { code: 500, msg: "Not enough souls" };
    playerService.addEntity(player, soulMeta.roleId, 1, { star: soulMeta.star || 1 }, sync);
    sync._temp.roleId = soulMeta.roleId;
    return sync;
  }

  if (action === "composeShip") {
    const fragmentId = Number(msg.fragmentId || msg.kindId || msg.entityId);
    if (!fragmentId) return { code: 500, msg: "Invalid ship fragment" };
    const fragMeta = dataApi.findEntityById(fragmentId);
    const shipKindId = (fragMeta && (fragMeta.shipId || fragMeta.composeId))
      || (fragmentId >= 9000 && fragmentId < 10000 ? Math.floor(fragmentId / 10) : fragmentId);

    const haveFrag = playerService.getBagItemCount(player, fragmentId);
    if (haveFrag > 0) {
      const reqCount = (fragMeta && fragMeta.composeCount) || Math.min(haveFrag, 20);
      playerService.reduceEntity(player, fragmentId, Math.min(haveFrag, reqCount), sync);
    }

    const idx = String(player.bag.lastIdx++);
    const ship = createShipItem(shipKindId, idx);
    player.bag.items[idx] = ship;
    sync.bag = sync.bag || { items: {}, lastIdx: player.bag.lastIdx };
    sync.bag.items[idx] = ship;
    sync.bag.lastIdx = player.bag.lastIdx;

    recalcPlayerPower(player);
    sync.coin = player.coin;
    sync.power = player.power;
    sync.topPower = player.topPower;
    sync._temp.entityCountMap = { [shipKindId]: 1 };
    return sync;
  }

  if (action === "composeItem" || action === "composeArtifact" || action === "composeFruit" || action === "composeCapsule") {
    const kindId = Number(msg.kindId || msg.entityId);
    if (kindId) {
      const meta = dataApi.findEntityById(kindId);
      if (meta && Array.isArray(meta.requiredIds)) {
        for (let i = 0; i < meta.requiredIds.length; i++) {
          const rid = meta.requiredIds[i];
          const rcnt = (meta.requiredCounts && meta.requiredCounts[i]) || 1;
          playerService.reduceEntity(player, rid, rcnt, sync);
        }
      }
      playerService.addEntity(player, kindId, Number(msg.count || 1), {}, sync);
      sync._temp.entityCountMap = { [kindId]: Number(msg.count || 1) };
    }
    return sync;
  }

  if (action === "addShipExperience") {
    const idx = String(msg.bagIndex || msg.shipIndex || "");
    const ship = player.bag.items[idx];
    if (!ship) return { code: 500, msg: "Ship not found" };
    if ((ship.level || 0) >= 100) return { code: 500, msg: "等级达到上限" };

    const addExp = Math.max(1, Number(msg.experience || 1000));
    const haveExpItem = playerService.getBagItemCount(player, 108);
    if (haveExpItem > 0) {
      playerService.reduceEntity(player, 108, Math.min(haveExpItem, addExp), sync);
    }

    ship.experience = (ship.experience || 0) + addExp;
    ship.nextLevelExp = ship.nextLevelExp || 75;
    while (ship.level < 100 && ship.experience >= ship.nextLevelExp) {
      ship.experience -= ship.nextLevelExp;
      ship.level += 1;
      recalcShipItem(ship);
    }
    recalcShipItem(ship);
    recalcPlayerPower(player);

    sync.bag = sync.bag || { items: {}, lastIdx: player.bag.lastIdx };
    sync.bag.items[idx] = ship;
    sync.bag.lastIdx = player.bag.lastIdx;
    sync.power = player.power;
    sync.topPower = player.topPower;
    return sync;
  }

  if (action === "upgradeShip" || action === "upgradeShipStar" || action === "upgradeShipSkill") {
    const idx = String(msg.bagIndex || msg.shipIndex || "");
    const ship = player.bag.items[idx];
    if (!ship) return { code: 500, msg: "Ship not found" };

    if (action === "upgradeShip") {
      if ((ship.level || 0) >= 100) return { code: 500, msg: "等级达到上限" };
      ship.level = (ship.level || 0) + 1;
    } else if (action === "upgradeShipStar") {
      ship.star = (ship.star || 1) + 1;
      ship.level = 0;
    } else if (action === "upgradeShipSkill") {
      ship.skillLevel = (ship.skillLevel || 1) + 1;
      const cost = 5000 * ship.skillLevel;
      if ((player.coin || 0) >= cost) {
        playerService.reduceEntity(player, 101, cost, sync);
      }
      sync.coin = player.coin;
    }

    recalcShipItem(ship);
    recalcPlayerPower(player);
    sync.bag = sync.bag || { items: {}, lastIdx: player.bag.lastIdx };
    sync.bag.items[idx] = ship;
    sync.bag.lastIdx = player.bag.lastIdx;
    sync.power = player.power;
    sync.topPower = player.topPower;
    return sync;
  }

  if (action === "decomposeStarSign") {
    for (const bidx of msg.bagIndexs || []) {
      playerService.reduceBagByIdx(player, bidx, 1, sync);
    }
    playerService.addEntity(player, serverConfig.CONSTS.ENTITY_ID.STAR_SIGN_COIN, 100, {}, sync);
    return sync;
  }

  return sync;
}

module.exports = { handleBagRoute };
