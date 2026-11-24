const dataApi = require("../config/dataLoader");
const serverConfig = require("../config/serverConfig");
const { buildShopGoodsForType } = require("../models/playerFactory");
const playerService = require("../services/playerService");

function pickWeightedDrop(pool) {
  let total = 0;
  for (const d of pool) total += Number(d.weight || 1);
  let r = Math.random() * total;
  for (const d of pool) {
    r -= Number(d.weight || 1);
    if (r <= 0) return d;
  }
  return pool[0];
}

function getDropPool(classId) {
  const byGroup = dataApi.findDropByClassId(classId);
  if (!byGroup) return [];
  const all = [];
  for (const g of Object.keys(byGroup)) {
    for (const row of byGroup[g]) all.push(row);
  }
  return all;
}

function handleShopAndPointRoute(route, msg, player) {
  if (route.startsWith("logic.shopHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };

    if (action === "buy") {
      const shopRow = dataApi.shop.findById(Number(msg.kindId));
      if (!shopRow) return { code: 500, msg: "Shop item not found" };
      const st = shopRow.type;
      const itemMap = player.shop.goodsMap[st] || {};
      const entry = itemMap[shopRow.kindId];
      const moneyId = entry ? entry.moneyId : shopRow.requireEntityId;
      const price = entry ? entry.price : shopRow.price;
      const count = entry ? entry.count : (shopRow.minCount || 1);
      const entityId = entry ? entry.entityId : shopRow.entityId;

      if (!playerService.reduceEntity(player, moneyId, price, sync)) {
        return { code: 500, msg: "Not enough currency" };
      }
      if (entry && !shopRow.isUnlimit) {
        entry.isSaleOut = true;
        sync.shop = { goodsMap: { [st]: { [shopRow.kindId]: entry } } };
      }
      playerService.addEntity(player, entityId, count, {}, sync);
      sync._temp.entityCountMap = { [entityId]: count };
      return sync;
    }

    if (action === "refresh") {
      const st = Number(msg.type || 1);
      const times = (player.shop.refreshTimesMap[st] || 0) + 1;
      const costs = serverConfig.SHOP.CONSTS.REFRESH_COST_MONEY_MAP[st] || [0, 50];
      const cost = costs[times] || costs[costs.length - 1] || 50;
      const moneyId = serverConfig.SHOP.CONSTS.REFRESH_MONEY_ID_MAP[st] || 102;
      if (!playerService.reduceEntity(player, moneyId, cost, sync)) {
        return { code: 500, msg: "Not enough currency" };
      }
      player.shop.refreshTimesMap[st] = times;
      player.shop.goodsMap[st] = buildShopGoodsForType(st, player.level);
      sync.shop = {
        refreshTimesMap: { [st]: times },
        goodsMap: { [st]: player.shop.goodsMap[st] }
      };
      return sync;
    }

    return sync;
  }

  if (route.startsWith("logic.pointHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };
    const now = Date.now();

    if (action === "coin" || action === "coinTen") {
      const count = action === "coinTen" ? 10 : 1;
      const isFree = count === 1 && player.point.freeCoinTimes < serverConfig.POINT.CONSTS.COIN_DAILY_FREE_TIMES && now >= (player.point.nextCoinFreeTime || 0);
      if (isFree) {
        player.point.freeCoinTimes += 1;
        player.point.nextCoinFreeTime = now + serverConfig.POINT.CONSTS.COIN_FREE_TIME;
      } else {
        const cost = count === 10 ? serverConfig.POINT.CONSTS.COIN_TEN_COST : serverConfig.POINT.CONSTS.COIN_COST;
        if (!playerService.reduceEntity(player, 101, cost, sync)) {
          return { code: 500, msg: "Not enough coins" };
        }
      }
      const pool = getDropPool(player.point.coinTimes === 0 ? 101 : 102);
      const dropList = [];
      for (let i = 0; i < count; i++) {
        player.point.coinTimes = (player.point.coinTimes || 0) + 1;
        const picked = pool.length ? pickWeightedDrop(pool) : { entityId: 20002, count: 1, extra: {} };
        const d = { entityId: picked.entityId, count: picked.count || 1, extra: picked.extra || {} };
        dropList.push(d);
      }
      playerService.addDropList(player, dropList, sync);
      sync.point = player.point;
      sync._temp.dropList = dropList;
      return sync;
    }

    if (action === "gem" || action === "gemTen") {
      const count = action === "gemTen" ? 10 : 1;
      const ticketCount = playerService.getBagItemCount(player, serverConfig.POINT.CONSTS.GEM_TICKET_ID);
      const isFree = count === 1 && now >= (player.point.nextGemFreeTime || 0);
      if (isFree) {
        player.point.nextGemFreeTime = now + serverConfig.POINT.CONSTS.GEM_FREE_TIME;
      } else if (ticketCount >= count) {
        playerService.reduceEntity(player, serverConfig.POINT.CONSTS.GEM_TICKET_ID, count, sync);
      } else {
        const cost = count === 10 ? serverConfig.POINT.CONSTS.GEM_TEN_COST : serverConfig.POINT.CONSTS.GEM_COST;
        if (!playerService.reduceEntity(player, 102, cost, sync)) {
          return { code: 500, msg: "Not enough gems" };
        }
      }
      const pool = getDropPool(204);
      const rolePool = pool.filter((x) => {
        const em = dataApi.findEntityById(x.entityId);
        return em && em.type === "role";
      });
      const dropList = [];
      for (let i = 0; i < count; i++) {
        player.point.gemTimes = (player.point.gemTimes || 0) + 1;
        // Guarantee at least one hero on 10-pull or first pull
        const usePool = (i === count - 1 && rolePool.length) ? rolePool : (pool.length ? pool : [{ entityId: 100201, count: 1, extra: { star: 2 } }]);
        const picked = pickWeightedDrop(usePool);
        dropList.push({ entityId: picked.entityId, count: picked.count || 1, extra: picked.extra || {} });
      }
      playerService.addDropList(player, dropList, sync);
      sync.point = player.point;
      sync._temp.dropList = dropList;
      return sync;
    }

    if (action === "receivePointAward") {
      const reward = [{ entityId: 100101, count: 1, extra: { star: 3 } }];
      const entityCountMap = playerService.addDropList(player, reward, sync);
      sync._temp.entityCountMap = entityCountMap;
      return sync;
    }

    return sync;
  }

  return null;
}

module.exports = { handleShopAndPointRoute };
