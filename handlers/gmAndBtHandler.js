const serverConfig = require("../config/serverConfig");
const { createRoleRecord, recalcPlayerPower } = require("../models/playerFactory");
const playerService = require("../services/playerService");

function handleGmAndBtRoute(route, msg, player) {
  if (route.startsWith("logic.gmHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };

    if (action === "addItem") {
      const kindId = Number(msg.kindId);
      const count = Number(msg.itemCount || 1);
      playerService.addEntity(player, kindId, count, msg.extra || {}, sync);
      sync._temp.entityCountMap = { [kindId]: count };
      return sync;
    }

    if (action === "addRole") {
      const kindId = Number(msg.kindId);
      const idx = String(player.team.nextRoleIdx++);
      const role = createRoleRecord(idx, kindId, 5, player);
      if (!role) return { code: 500, msg: "Role not found" };
      player.team.roles[idx] = role;
      recalcPlayerPower(player);
      sync.team = { roles: { [idx]: role }, friendshipAttr: player.team.friendshipAttr };
      sync.power = player.power;
      return sync;
    }

    if (action === "removeRole") {
      const idx = String(msg.teamIndex);
      if (player.team.roles[idx]) {
        delete player.team.roles[idx];
        recalcPlayerPower(player);
        sync.team = { roles: { [idx]: null }, friendshipAttr: player.team.friendshipAttr };
        sync.power = player.power;
      }
      return sync;
    }

    return sync;
  }

  if (route.startsWith("logic.btHandler.")) {
    const action = route.split(".")[2];
    const sync = { code: 200, _temp: { route } };

    if (action === "buyShopItem") {
      const items = (player.gm.shop && player.gm.shop[player.gm.level]) || [];
      const item = items.find((x) => Number(x.id) === Number(msg.shopId)) || items[0];
      const drops = item ? serverConfig.DROP.FUNS.getDropListByDesc(item.dropDesc) : [{ entityId: 101, count: 1000000 }];
      player.gm.gmShopDailyBuyTimesMap[msg.shopId] = (player.gm.gmShopDailyBuyTimesMap[msg.shopId] || 0) + 1;
      sync.gm = { gmShopDailyBuyTimesMap: player.gm.gmShopDailyBuyTimesMap };
      sync._temp.entityCountMap = playerService.addDropList(player, drops, sync);
      return sync;
    }

    if (action === "buyAllDailyShopItems") {
      const items = (player.gm.shop && player.gm.shop[Number(msg.gmLevel || 0)]) || [];
      const drops = [];
      for (const it of items) {
        drops.push(...serverConfig.DROP.FUNS.getDropListByDesc(it.dropDesc));
        player.gm.gmShopDailyBuyTimesMap[it.id] = (player.gm.gmShopDailyBuyTimesMap[it.id] || 0) + 1;
      }
      sync.gm = { gmShopDailyBuyTimesMap: player.gm.gmShopDailyBuyTimesMap };
      sync._temp.entityCountMap = playerService.addDropList(player, drops, sync);
      return sync;
    }

    if (action === "receiveGmActiveReward" || action === "receiveGmDailyReward" || action === "receiveGmCardDailyReward") {
      sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: 102, count: 5000 }, { entityId: 120, count: 10 }], sync);
      return sync;
    }

    return sync;
  }

  return null;
}

module.exports = { handleGmAndBtRoute };
