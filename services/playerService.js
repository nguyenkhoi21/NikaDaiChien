const dataApi = require("../config/dataLoader");
const serverConfig = require("../config/serverConfig");
const {
  createRoleRecord,
  recalcRoleAttr,
  recalcPlayerPower
} = require("../models/playerFactory");

function getBagItemCount(player, kindId) {
  kindId = Number(kindId);
  if (kindId === serverConfig.CONSTS.ENTITY_ID.GEM) return player.gem || 0;
  if (kindId === serverConfig.CONSTS.ENTITY_ID.COIN) return player.coin || 0;
  if (kindId === serverConfig.CONSTS.ENTITY_ID.AP) return player.actionPoint || 0;
  if (kindId === serverConfig.CONSTS.ENTITY_ID.EXP) return player.experience || 0;
  if (kindId === serverConfig.CONSTS.ENTITY_ID.VIP_EXP) return (player.vip && player.vip.topUpGem) || 0;

  let total = 0;
  for (const idx of Object.keys(player.bag.items || {})) {
    const it = player.bag.items[idx];
    if (it && Number(it.kindId) === kindId) {
      total += Number(it.count || 0);
    }
  }
  return total;
}

function findBagItemByKindId(player, kindId) {
  kindId = Number(kindId);
  for (const idx of Object.keys(player.bag.items || {})) {
    const it = player.bag.items[idx];
    if (it && Number(it.kindId) === kindId) return it;
  }
  return null;
}

function getRoleByClassId(player, classId) {
  for (const idx of Object.keys(player.team.roles || {})) {
    const r = player.team.roles[idx];
    const meta = dataApi.findEntityById(r.kindId);
    if (meta && Number(meta.classId) === Number(classId)) return r;
  }
  return null;
}

function isStackableEntity(meta) {
  if (!meta) return true;
  if (meta.maxNum === 1) return false;
  return !["artifact", "capsule", "starSign"].includes(meta.type);
}

function syncVipFromExp(player) {
  const exp = (player.vip && player.vip.topUpGem) || 0;
  const rows = Object.values(dataApi.vip.all()).sort((a, b) => a.level - b.level);
  let newLv = player.vip.level || 0;
  for (const row of rows) {
    if (row.nextLevelTopUpGem && exp >= row.nextLevelTopUpGem && row.level + 1 > newLv) {
      newLv = row.level + 1;
    }
  }
  if (newLv > 16) newLv = 16;
  player.vip.level = newLv;
  return newLv;
}

function addPlayerExp(player, amount, syncOut = {}) {
  amount = Math.floor(Number(amount || 0));
  if (amount <= 0) return false;
  player.experience = (player.experience || 0) + amount;
  let leveled = false;
  while (player.level < serverConfig.PLAYER.CONSTS.MAX_LEVEL) {
    const row = dataApi.findExperienceByLevel(player.level);
    const need = row ? row.playerExp : 9999999;
    player.nextLevelExp = need;
    if (player.experience >= need && need > 0) {
      player.experience -= need;
      player.level += 1;
      const apInc = serverConfig.PLAYER.FUNS.getUpgradeIncreaseActionPoint(player.level);
      player.actionPoint = (player.actionPoint || 0) + apInc;
      const nextRow = dataApi.findExperienceByLevel(player.level);
      player.nextLevelExp = nextRow ? nextRow.playerExp : 9999999;
      leveled = true;
    } else {
      break;
    }
  }
  syncOut.experience = player.experience;
  syncOut.nextLevelExp = player.nextLevelExp;
  syncOut.actionPoint = player.actionPoint;
  if (leveled) syncOut.level = player.level;
  return leveled;
}

function addEntity(player, kindId, count = 1, extra = {}, syncOut = {}) {
  kindId = Number(kindId);
  count = Math.floor(Number(count || 1));
  if (!kindId || count <= 0) return;

  const EID = serverConfig.CONSTS.ENTITY_ID;
  if (kindId === EID.COIN) {
    player.coin = (player.coin || 0) + count;
    syncOut.coin = player.coin;
    return;
  }
  if (kindId === EID.GEM) {
    player.gem = (player.gem || 0) + count;
    syncOut.gem = player.gem;
    return;
  }
  if (kindId === EID.AP) {
    player.actionPoint = (player.actionPoint || 0) + count;
    syncOut.actionPoint = player.actionPoint;
    return;
  }
  if (kindId === EID.EXP) {
    addPlayerExp(player, count, syncOut);
    return;
  }
  if (kindId === EID.VIP_EXP) {
    player.vip.topUpGem = (player.vip.topUpGem || 0) + count;
    syncVipFromExp(player);
    syncOut.vip = { level: player.vip.level, topUpGem: player.vip.topUpGem };
    return;
  }

  const meta = dataApi.findEntityById(kindId);
  if (meta && meta.type === "role") {
    const existing = getRoleByClassId(player, meta.classId);
    const star = (extra && extra.star) || 1;
    if (!existing) {
      const idx = String(player.team.nextRoleIdx++);
      const role = createRoleRecord(idx, kindId, star, player);
      if (role) {
        player.team.roles[idx] = role;
        recalcPlayerPower(player);
        syncOut.team = syncOut.team || { roles: {}, friendshipAttr: player.team.friendshipAttr };
        syncOut.team.roles[idx] = role;
        syncOut.power = player.power;
        return;
      }
    } else {
      // Duplicate role converts to equivalent souls
      const soulMeta = dataApi.findSoulByClassId(meta.classId);
      const eqSouls = (serverConfig.ROLE.CONSTS.EQUIVALENT_SOULS[star] || 10) * count;
      if (soulMeta) {
        addEntity(player, soulMeta.kindId, eqSouls, {}, syncOut);
        return;
      }
    }
  }

  syncOut.bag = syncOut.bag || { items: {}, lastIdx: player.bag.lastIdx };
  if (isStackableEntity(meta)) {
    const existing = findBagItemByKindId(player, kindId);
    if (existing) {
      existing.count = Number(existing.count || 0) + count;
      syncOut.bag.items[existing.idx] = existing;
      syncOut.bag.lastIdx = player.bag.lastIdx;
      return;
    }
  }

  const qtyLoops = isStackableEntity(meta) ? 1 : count;
  const perCount = isStackableEntity(meta) ? count : 1;
  for (let i = 0; i < qtyLoops; i++) {
    const idx = String(player.bag.lastIdx++);
    const item = { idx, kindId, count: perCount, extra: extra ? { ...extra } : {} };
    player.bag.items[idx] = item;
    syncOut.bag.items[idx] = item;
  }
  syncOut.bag.lastIdx = player.bag.lastIdx;
}

function reduceEntity(player, kindId, count = 1, syncOut = {}) {
  kindId = Number(kindId);
  count = Math.floor(Number(count || 1));
  if (count <= 0) return true;

  const EID = serverConfig.CONSTS.ENTITY_ID;
  if (kindId === EID.COIN) {
    if ((player.coin || 0) < count) return false;
    player.coin -= count;
    syncOut.coin = player.coin;
    return true;
  }
  if (kindId === EID.GEM) {
    if ((player.gem || 0) < count) return false;
    player.gem -= count;
    syncOut.gem = player.gem;
    return true;
  }
  if (kindId === EID.AP) {
    if ((player.actionPoint || 0) < count) return false;
    player.actionPoint -= count;
    syncOut.actionPoint = player.actionPoint;
    return true;
  }

  if (getBagItemCount(player, kindId) < count) return false;
  syncOut.bag = syncOut.bag || { items: {}, lastIdx: player.bag.lastIdx };

  let rem = count;
  for (const idx of Object.keys(player.bag.items || {})) {
    if (rem <= 0) break;
    const it = player.bag.items[idx];
    if (!it || Number(it.kindId) !== kindId) continue;
    const take = Math.min(rem, Number(it.count || 0));
    it.count -= take;
    rem -= take;
    if (it.count <= 0) {
      delete player.bag.items[idx];
      syncOut.bag.items[idx] = null;
    } else {
      syncOut.bag.items[idx] = it;
    }
  }
  syncOut.bag.lastIdx = player.bag.lastIdx;
  return true;
}

function reduceBagByIdx(player, bagIndex, count = 1, syncOut = {}) {
  const idx = String(bagIndex);
  const it = player.bag.items[idx];
  if (!it || Number(it.count || 0) < count) return null;
  const takenKindId = it.kindId;
  it.count -= count;
  syncOut.bag = syncOut.bag || { items: {}, lastIdx: player.bag.lastIdx };
  if (it.count <= 0) {
    delete player.bag.items[idx];
    syncOut.bag.items[idx] = null;
  } else {
    syncOut.bag.items[idx] = it;
  }
  syncOut.bag.lastIdx = player.bag.lastIdx;
  return { kindId: takenKindId, count };
}

function addDropList(player, dropList, syncOut = {}) {
  const entityCountMap = {};
  for (const d of dropList || []) {
    const eid = Number(d.entityId || d.kindId);
    const cnt = Number(d.count || 1);
    if (!eid || cnt <= 0) continue;
    addEntity(player, eid, cnt, d.extra || {}, syncOut);
    entityCountMap[eid] = (entityCountMap[eid] || 0) + cnt;
  }
  return entityCountMap;
}

function addRoleExp(role, amount, player) {
  const maxLv = serverConfig.ROLE.FUNS.getMaxLevel(player.level || 1);
  role.experience = (role.experience || 0) + Math.floor(amount);
  while (role.level < maxLv) {
    const row = dataApi.findExperienceByLevel(role.level);
    const need = row ? row.roleExp : 9999999;
    role.nextLevelExp = need;
    if (role.experience >= need && need > 0) {
      role.experience -= need;
      role.level += 1;
      const nextRow = dataApi.findExperienceByLevel(role.level);
      role.nextLevelExp = nextRow ? nextRow.roleExp : 9999999;
    } else {
      break;
    }
  }
  recalcRoleAttr(role, player);
  recalcPlayerPower(player);
  return role;
}

module.exports = {
  getBagItemCount,
  findBagItemByKindId,
  getRoleByClassId,
  syncVipFromExp,
  addPlayerExp,
  addEntity,
  reduceEntity,
  reduceBagByIdx,
  addDropList,
  addRoleExp
};
