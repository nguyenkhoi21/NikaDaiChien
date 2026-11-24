const dataApi = require("../config/dataLoader");
const serverConfig = require("../config/serverConfig");
const { buildEquipmentItem, recalcRoleAttr, recalcPlayerPower } = require("../models/playerFactory");
const playerService = require("../services/playerService");

function handleTeamRoute(route, msg, player) {
  if (!route.startsWith("logic.teamHandler.")) return null;
  const action = route.split(".")[2];
  const role = msg.teamIndex !== undefined ? player.team.roles[String(msg.teamIndex)] : null;
  const sync = { code: 200, _temp: { route } };

  const syncRole = (r) => {
    recalcRoleAttr(r, player);
    recalcPlayerPower(player);
    sync.team = { roles: { [r.idx]: r }, friendshipAttr: player.team.friendshipAttr };
    sync.power = player.power;
  };

  if (action === "useExpItem" && role) {
    const it = player.bag.items[String(msg.bagIndex)];
    const cnt = Math.max(1, Number(msg.itemCount || 1));
    if (!it || it.count < cnt) return { code: 500, msg: "Not enough EXP items" };
    const meta = dataApi.findEntityById(it.kindId);
    const expPer = (meta && meta.roleExp) || 100;
    playerService.reduceBagByIdx(player, msg.bagIndex, cnt, sync);
    playerService.addRoleExp(role, expPer * cnt, player);
    syncRole(role);
    return sync;
  }

  if (action === "useExpItemMax" && role) {
    const maxLv = serverConfig.ROLE.FUNS.getMaxLevel(player.level);
    let expTotal = 0;
    const expIds = [20004, 20003, 20002, 20001];
    for (const eid of expIds) {
      if (role.level >= maxLv) break;
      const meta = dataApi.findEntityById(eid);
      const per = (meta && meta.roleExp) || 100;
      const have = playerService.getBagItemCount(player, eid);
      if (have > 0) {
        const useCnt = Math.min(have, 20);
        playerService.reduceEntity(player, eid, useCnt, sync);
        expTotal += per * useCnt;
      }
    }
    if (expTotal > 0) playerService.addRoleExp(role, expTotal, player);
    syncRole(role);
    return sync;
  }

  if (action === "upgradeEquipment" && role) {
    const eq = role.equipments[msg.equipmentType];
    if (!eq) return { code: 500, msg: "Equipment not found" };
    if (eq.level >= role.level) return { code: 500, msg: "Reached role level cap" };
    const cost = serverConfig.EQUIPMENTS.FUNS.getUpgradeCost(eq.level + 1);
    if (!playerService.reduceEntity(player, 101, cost, sync)) {
      return { code: 500, msg: "Not enough coins" };
    }
    eq.level += 1;
    role.equipments[msg.equipmentType] = buildEquipmentItem(eq.kindId, eq.level);
    syncRole(role);
    return sync;
  }

  if (action === "upgradeEquipmentMax" && role) {
    const eq = role.equipments[msg.equipmentType];
    if (!eq) return { code: 500, msg: "Equipment not found" };
    while (eq.level < role.level) {
      const cost = serverConfig.EQUIPMENTS.FUNS.getUpgradeCost(eq.level + 1);
      if (!playerService.reduceEntity(player, 101, cost, sync)) break;
      eq.level += 1;
    }
    role.equipments[msg.equipmentType] = buildEquipmentItem(eq.kindId, eq.level);
    syncRole(role);
    return sync;
  }

  if (action === "upgradeAllEquipmentMax" && role) {
    for (const slot of serverConfig.EQUIPMENTS.CONSTS.EVL_ITEM_TYPES) {
      const eq = role.equipments[slot];
      if (!eq) continue;
      while (eq.level < role.level) {
        const cost = serverConfig.EQUIPMENTS.FUNS.getUpgradeCost(eq.level + 1);
        if (!playerService.reduceEntity(player, 101, cost, sync)) break;
        eq.level += 1;
      }
      role.equipments[slot] = buildEquipmentItem(eq.kindId, eq.level);
    }
    syncRole(role);
    return sync;
  }

  if (action === "evolveEquipment" && role) {
    const eq = role.equipments[msg.equipmentType];
    if (!eq) return { code: 500, msg: "Equipment not found" };
    const curMeta = dataApi.findEntityById(eq.kindId);
    const nextId = curMeta && curMeta.evolutionItemId;
    if (!nextId) return { code: 500, msg: "Max evolution" };
    const nextMeta = dataApi.findEntityById(nextId);
    const coinCost = serverConfig.EQUIPMENTS.FUNS.getEvolveCost(nextMeta.color || 2);
    if (!playerService.reduceEntity(player, 101, coinCost, sync)) {
      return { code: 500, msg: "Not enough coins" };
    }
    if (Array.isArray(nextMeta.requiredIds)) {
      for (let i = 0; i < nextMeta.requiredIds.length; i++) {
        const rid = nextMeta.requiredIds[i];
        const rcnt = (nextMeta.requiredCounts && nextMeta.requiredCounts[i]) || 1;
        playerService.reduceEntity(player, rid, rcnt, sync);
      }
    }
    role.equipments[msg.equipmentType] = buildEquipmentItem(nextId, eq.level);
    syncRole(role);
    return sync;
  }

  if (action === "evolveAllEquipment" && role) {
    for (const slot of serverConfig.EQUIPMENTS.CONSTS.EVL_ITEM_TYPES) {
      const eq = role.equipments[slot];
      if (!eq) continue;
      const curMeta = dataApi.findEntityById(eq.kindId);
      const nextId = curMeta && curMeta.evolutionItemId;
      if (!nextId) continue;
      const nextMeta = dataApi.findEntityById(nextId);
      const roleMeta = dataApi.findEntityById(role.kindId);
      if (roleMeta && nextMeta && roleMeta.color >= nextMeta.color) {
        role.equipments[slot] = buildEquipmentItem(nextId, eq.level);
      }
    }
    syncRole(role);
    return sync;
  }

  if (action === "evolveRole" && role) {
    const meta = dataApi.findEntityById(role.kindId);
    if (!meta || !meta.evolutionRoleId) return { code: 500, msg: "Cannot evolve role" };
    const nextRole = dataApi.findEntityById(meta.evolutionRoleId);
    if (!nextRole) return { code: 500, msg: "Next role missing" };
    role.kindId = nextRole.kindId;
    const unlockSlot = serverConfig.SKILL.CONSTS.UN_LOCK_COLOR[nextRole.color];
    if (unlockSlot !== undefined && role.skills[unlockSlot] && role.skills[unlockSlot].level === 0) {
      role.skills[unlockSlot].level = 1;
    }
    syncRole(role);
    return sync;
  }

  if (action === "upgradeRoleStar" && role) {
    if (role.star >= 20) return { code: 500, msg: "Max star" };
    const cost = serverConfig.ROLE.FUNS.getUpgradeCost(role.star);
    const meta = dataApi.findEntityById(role.kindId);
    const soulMeta = meta && dataApi.findSoulByClassId(meta.classId);
    if (cost.coin) playerService.reduceEntity(player, 101, cost.coin, sync);
    if (cost.gem) playerService.reduceEntity(player, 102, cost.gem, sync);
    if (cost.soul && soulMeta) playerService.reduceEntity(player, soulMeta.kindId, cost.soul, sync);
    role.star += 1;
    syncRole(role);
    return sync;
  }

  if (action === "upgradeRoleSkill" && role) {
    const sk = (role.skills || []).find((s) => Number(s.kindId) === Number(msg.skillKindId));
    if (!sk) return { code: 500, msg: "Skill not found" };
    const steps = msg.isMax ? Math.max(1, role.level - sk.level) : 1;
    let upgraded = 0;
    for (let i = 0; i < steps; i++) {
      if (sk.level >= role.level || player.skillPoint <= 0) break;
      const cost = serverConfig.SKILL.FUNS.getUpgradeCost(sk.level + 1);
      if (!playerService.reduceEntity(player, 101, cost, sync)) break;
      player.skillPoint -= 1;
      sk.level += 1;
      upgraded++;
    }
    sync.skillPoint = player.skillPoint;
    syncRole(role);
    return sync;
  }

  if (action === "upgradeRoleAwakeLevel" && role) {
    role.awakeLevel = Math.min(20, (role.awakeLevel || 0) + 1);
    role.awakeRateIncreaseTimes = 0;
    syncRole(role);
    return sync;
  }

  if (action === "increaseAwakeLevelUpgradeSuccessRate" && role) {
    role.awakeRateIncreaseTimes = (role.awakeRateIncreaseTimes || 0) + 1;
    syncRole(role);
    return sync;
  }

  if (action === "upgradeRoleAwakeSkill" && role) {
    role.awakeSkills = role.awakeSkills || [];
    let sk = role.awakeSkills.find((s) => Number(s.kindId) === Number(msg.skillKindId));
    if (!sk) {
      sk = { kindId: Number(msg.skillKindId), level: 0 };
      role.awakeSkills.push(sk);
    }
    sk.level = Math.min(100, sk.level + (msg.isMax ? 5 : 1));
    syncRole(role);
    return sync;
  }

  if (action === "roleBreak" && role) {
    for (const bidx of msg.bagIndexs || []) {
      playerService.reduceBagByIdx(player, bidx, 1, sync);
    }
    role.breakLevel = Math.min(15, (role.breakLevel || 0) + 1);
    syncRole(role);
    return sync;
  }

  if (action === "trainRole" && role) {
    const t = String(msg.type);
    role.trainLevelMap[t] = Math.min(3, (role.trainLevelMap[t] || 0) + 1);
    syncRole(role);
    return sync;
  }

  if (action === "unlockRoleTrain" && role) {
    role.trainUnlockMap[String(msg.type)] = true;
    syncRole(role);
    return sync;
  }

  if (action === "resetRoleTrain" && role) {
    role.trainLevelMap[String(msg.type)] = 0;
    syncRole(role);
    return sync;
  }

  if (action === "soulRole" && role) {
    const t = String(msg.type);
    role.soulLevelMap[t] = Math.min(10, (role.soulLevelMap[t] || 0) + 1);
    syncRole(role);
    return sync;
  }

  if (action === "evolveRoleSkill" && role) {
    role.evolveSkillIds = role.evolveSkillIds || [];
    if (!role.evolveSkillIds.includes(Number(msg.skillKindId))) {
      role.evolveSkillIds.push(Number(msg.skillKindId));
    }
    syncRole(role);
    return sync;
  }

  if (action === "increaseEvolveSkillSuccessRate" && role) {
    role.evolveSkillRateIncreaseTimes = (role.evolveSkillRateIncreaseTimes || 0) + 1;
    syncRole(role);
    return sync;
  }

  // Equip / Unequip Stone, Artifact, Capsule, StarSign
  if ((action === "equipStone" || action === "equipArtifact" || action === "equipCapsule" || action === "equipStarSign") && role) {
    const it = player.bag.items[String(msg.bagIndex)];
    if (!it) return { code: 500, msg: "Item not found" };
    const meta = dataApi.findEntityById(it.kindId);
    const prefix = action.replace("equip", "").toLowerCase();
    const slotKey = (meta && meta.equipmentType) || `${prefix}Item_1`;
    const prev = role.equipments[slotKey];
    role.equipments[slotKey] = { kindId: it.kindId, level: (it.extra && it.extra.level) || 1, star: (it.extra && it.extra.star) || 1, extra: it.extra || {} };
    playerService.reduceBagByIdx(player, msg.bagIndex, 1, sync);
    if (prev && prev.kindId) playerService.addEntity(player, prev.kindId, 1, prev.extra || {}, sync);
    syncRole(role);
    return sync;
  }

  if ((action === "unEquipStone" || action === "unEquipArtifact" || action === "unEquipCapsule" || action === "unEquipStarSign") && role) {
    const prev = role.equipments[msg.equipmentType];
    if (prev && prev.kindId) {
      playerService.addEntity(player, prev.kindId, 1, prev.extra || {}, sync);
      delete role.equipments[msg.equipmentType];
    }
    syncRole(role);
    return sync;
  }

  if (action === "unlockFriendship") {
    const fid = String(msg.friendShipId);
    const cid = String(msg.classId);
    player.friendshipUnlockMap[fid] = player.friendshipUnlockMap[fid] || {};
    player.friendshipUnlockMap[fid][cid] = true;
    const fRow = dataApi.friendship.findById(Number(fid));
    if (fRow) {
      const fType = fRow.type;
      const val = fRow.base || 100;
      if (fType === 1) player.team.friendshipAttr.hp = (player.team.friendshipAttr.hp || 0) + val;
      if (fType === 2) player.team.friendshipAttr.atk = (player.team.friendshipAttr.atk || 0) + val;
      if (fType === 3) player.team.friendshipAttr.def = (player.team.friendshipAttr.def || 0) + val;
      if (fType === 4) player.team.friendshipAttr.mdef = (player.team.friendshipAttr.mdef || 0) + val;
    }
    for (const r of Object.values(player.team.roles)) recalcRoleAttr(r, player);
    recalcPlayerPower(player);
    sync.friendshipUnlockMap = player.friendshipUnlockMap;
    sync.team = { roles: player.team.roles, friendshipAttr: player.team.friendshipAttr };
    sync.power = player.power;
    return sync;
  }

  return sync;
}

module.exports = { handleTeamRoute };
