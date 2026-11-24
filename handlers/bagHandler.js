const dataApi = require("../config/dataLoader");
const serverConfig = require("../config/serverConfig");
const playerService = require("../services/playerService");

function handleBagRoute(route, msg, player) {
  if (!route.startsWith("logic.bagHandler.")) return null;
  const action = route.split(".")[2];
  const sync = { code: 200, _temp: { route } };

  if (action === "sell") {
    const idx = String(msg.bagIndex);
    const it = player.bag.items[idx];
    if (!it) return { code: 500, msg: "Item not found" };
    const cnt = Number(msg.count || it.count || 1);
    const meta = dataApi.findEntityById(it.kindId);
    const price = (meta && meta.price) || 100;
    playerService.reduceBagByIdx(player, idx, cnt, sync);
    playerService.addEntity(player, 101, price * cnt, {}, sync);
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

  if (action === "composeItem" || action === "composeArtifact" || action === "composeFruit" || action === "composeShip" || action === "composeCapsule") {
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
    const sh = player.team.ships[String(msg.shipIndex)] || { idx: String(msg.shipIndex), kindId: 901, level: 1, star: 1, experience: 0, skillLevel: 1 };
    sh.level = (sh.level || 1) + 1;
    player.team.ships[sh.idx] = sh;
    sync.team = { ships: { [sh.idx]: sh } };
    return sync;
  }

  if (action === "upgradeShip" || action === "upgradeShipStar" || action === "upgradeShipSkill") {
    const sh = player.team.ships[String(msg.shipIndex)];
    if (sh) {
      if (action === "upgradeShip") sh.level = (sh.level || 1) + 1;
      if (action === "upgradeShipStar") sh.star = (sh.star || 1) + 1;
      if (action === "upgradeShipSkill") sh.skillLevel = (sh.skillLevel || 1) + 1;
      sync.team = { ships: { [sh.idx]: sh } };
    }
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
