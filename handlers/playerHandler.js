const dataApi = require("../config/dataLoader");
const serverConfig = require("../config/serverConfig");
const { db, markDirty, saveDb } = require("../db/database");
const { createRoleRecord, recalcPlayerPower } = require("../models/playerFactory");
const playerService = require("../services/playerService");

function handleChatCommand(text, player, sync, pushToAll) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === "/help") {
    return "Commands: /gem <amt>, /coin <amt>, /vip <0-16>, /level <1-100>, /addrole <kindId> [star], /additem <kindId> [count], /unlockall";
  }
  if (cmd === "/gem") {
    const amt = Number(parts[1] || 100000);
    playerService.addEntity(player, 102, amt, {}, sync);
    return `Added ${amt} Gems.`;
  }
  if (cmd === "/coin") {
    const amt = Number(parts[1] || 1000000);
    playerService.addEntity(player, 101, amt, {}, sync);
    return `Added ${amt} Coins.`;
  }
  if (cmd === "/vip") {
    const lv = Math.max(0, Math.min(16, Number(parts[1] || 16)));
    player.vip.level = lv;
    sync.vip = { level: lv, topUpGem: player.vip.topUpGem };
    return `Set VIP level to ${lv}.`;
  }
  if (cmd === "/level") {
    const lv = Math.max(1, Math.min(100, Number(parts[1] || 50)));
    player.level = lv;
    sync.level = lv;
    return `Set team level to ${lv}.`;
  }
  if (cmd === "/addrole") {
    const kindId = Number(parts[1] || 100201);
    const star = Number(parts[2] || 5);
    const idx = String(player.team.nextRoleIdx++);
    const role = createRoleRecord(idx, kindId, star, player);
    if (!role) return `Role ${kindId} not found.`;
    player.team.roles[idx] = role;
    recalcPlayerPower(player);
    sync.team = { roles: { [idx]: role }, friendshipAttr: player.team.friendshipAttr };
    sync.power = player.power;
    return `Added role ${kindId} (star=${star}).`;
  }
  if (cmd === "/additem") {
    const kindId = Number(parts[1] || 120);
    const count = Number(parts[2] || 50);
    playerService.addEntity(player, kindId, count, {}, sync);
    return `Added item ${kindId} x${count}.`;
  }
  if (cmd === "/unlockall") {
    for (const sm of Object.values(dataApi.smap.all())) {
      if (!sm.bmap) continue;
      const t = sm.bmap.type;
      if (t === 1 || t === 2) {
        player.smapStarMap[t] = player.smapStarMap[t] || {};
        player.smapStarMap[t][sm.bmapId] = player.smapStarMap[t][sm.bmapId] || {};
        player.smapStarMap[t][sm.bmapId][sm.kindId] = 3;
      }
    }
    sync.smapStarMap = player.smapStarMap;
    return "Unlocked all Normal & Elite chapters (3 stars).";
  }
  return null;
}

function handlePlayerRoute(route, msg, player, pushToAll) {
  if (!route.startsWith("logic.playerHandler.")) return null;
  const action = route.split(".")[2];
  const sync = { code: 200, _temp: { route } };

  if (action === "rename") {
    const newName = String(msg.name || "").trim();
    if (!newName) return { code: 500, msg: "Invalid name" };
    if (player.name !== player.userName) {
      if (!playerService.reduceEntity(player, 102, serverConfig.PLAYER.CONSTS.RE_NAME_COST_GEM, sync)) {
        return { code: 500, msg: "Not enough gems" };
      }
    }
    player.name = newName;
    sync.name = newName;
    return sync;
  }

  if (action === "setPhotoImg") {
    player.photoInfo.photoImgId = Number(msg.imgId || msg.photoImgId || player.photoInfo.photoImgId);
    sync.photoInfo = player.photoInfo;
    return sync;
  }
  if (action === "setShipImg") {
    player.photoInfo.shipImgId = Number(msg.imgId || msg.shipImgId || player.photoInfo.shipImgId);
    sync.photoInfo = player.photoInfo;
    return sync;
  }
  if (action === "setTitleImg") {
    player.photoInfo.titleImgId = Number(msg.imgId || msg.titleImgId || 0);
    sync.photoInfo = player.photoInfo;
    return sync;
  }
  if (action === "setChatSkin") {
    player.photoInfo.chatImgId = Number(msg.imgId || msg.chatImgId || 0);
    sync.photoInfo = player.photoInfo;
    return sync;
  }

  if (action === "buyActionPoint") {
    const times = (player.vip.buyActionPointTimes || 0) + 1;
    const cost = serverConfig.PLAYER.FUNS.getBuyActionPointCost(times);
    if (!playerService.reduceEntity(player, 102, cost, sync)) return { code: 500, msg: "Not enough gems" };
    player.vip.buyActionPointTimes = times;
    playerService.addEntity(player, 99, serverConfig.PLAYER.CONSTS.BUY_ACTION_POINT, {}, sync);
    sync.vip = { buyActionPointTimes: times };
    return sync;
  }

  if (action === "buyCoin") {
    const times = (player.vip.buyCoinTimes || 0) + 1;
    const cost = serverConfig.PLAYER.FUNS.getBuyCoinCost(times);
    if (!playerService.reduceEntity(player, 102, cost, sync)) return { code: 500, msg: "Not enough gems" };
    const { coin, ratio } = serverConfig.PLAYER.FUNS.getBuyCoin(player.vip.level, player.level);
    player.vip.buyCoinTimes = times;
    playerService.addEntity(player, 101, coin, {}, sync);
    sync.vip = { buyCoinTimes: times };
    sync._temp.coin = coin;
    sync._temp.ratio = ratio;
    return sync;
  }

  if (action === "buySkillPoint") {
    const times = (player.vip.buySkillPointTimes || 0) + 1;
    const cost = serverConfig.PLAYER.FUNS.getBuySkillPointCost(times);
    if (!playerService.reduceEntity(player, 102, cost, sync)) return { code: 500, msg: "Not enough gems" };
    player.vip.buySkillPointTimes = times;
    player.skillPoint = (player.skillPoint || 0) + serverConfig.PLAYER.CONSTS.BUY_SKILL_POINT;
    sync.vip = { buySkillPointTimes: times };
    sync.skillPoint = player.skillPoint;
    return sync;
  }

  if (action === "useItem") {
    const it = player.bag.items[String(msg.bagIndex)];
    const cnt = Math.max(1, Number(msg.count || 1));
    if (!it || it.count < cnt) return { code: 500, msg: "Item not found" };
    const meta = dataApi.findEntityById(it.kindId);
    playerService.reduceBagByIdx(player, msg.bagIndex, cnt, sync);

    const dropList = [];
    if (meta && meta.dropListDesc) {
      for (const d of serverConfig.DROP.FUNS.getDropListByDesc(meta.dropListDesc)) {
        dropList.push({ entityId: d.entityId, count: d.count * cnt, extra: d.extra });
      }
    } else if (meta && meta.actionPoint) {
      dropList.push({ entityId: 99, count: meta.actionPoint * cnt });
    } else if (meta && meta.extra && meta.extra.skillPoint) {
      player.skillPoint += meta.extra.skillPoint * cnt;
      sync.skillPoint = player.skillPoint;
    } else {
      dropList.push({ entityId: 101, count: 10000 * cnt });
    }
    sync._temp.entityCountMap = playerService.addDropList(player, dropList, sync);
    return sync;
  }

  if (action === "selectBoxReward" || action === "selectBoxReward2") {
    const it = player.bag.items[String(msg.bagIndex)];
    const cnt = Math.max(1, Number(msg.count || 1));
    if (!it) return { code: 500, msg: "Box not found" };
    const meta = dataApi.findEntityById(it.kindId);
    playerService.reduceBagByIdx(player, msg.bagIndex, cnt, sync);
    const list = (meta && meta.dropListDesc) ? serverConfig.DROP.FUNS.getDropListByDesc(meta.dropListDesc) : [{ entityId: 102, count: 100 }];
    const pick = list[Number(msg.selectIdx || 0)] || list[0];
    sync._temp.entityCountMap = playerService.addDropList(player, [{ entityId: pick.entityId, count: (pick.count || 1) * cnt, extra: pick.extra }], sync);
    return sync;
  }

  if (action === "signIn") {
    player.signInDays = (player.signInDays || 0) + 1;
    player.signInTime = Date.now();
    const row = dataApi.signIn.findOneBy("signInDays", player.signInDays) || dataApi.signIn.findById(1);
    const drops = row ? serverConfig.DROP.FUNS.getDropListByDesc(row.dropListDesc) : [{ entityId: 102, count: 500 }];
    if (row && player.vip.level >= (row.doubleVip || 99)) {
      for (const d of drops) d.count *= 2;
    }
    sync.signInDays = player.signInDays;
    sync.signInTime = player.signInTime;
    sync._temp.entityCountMap = playerService.addDropList(player, drops, sync);
    return sync;
  }

  if (action === "receiveTaskAward") {
    const taskId = Number(msg.taskId);
    const tRow = dataApi.task.findById(taskId);
    const drops = tRow ? serverConfig.DROP.FUNS.getDropListByDesc(tRow.dropListDesc) : [{ entityId: 102, count: 100 }];
    sync._temp.entityCountMap = playerService.addDropList(player, drops, sync);
    if (tRow) {
      if (tRow.activePoint) {
        player.task.dailyActivePoint = (player.task.dailyActivePoint || 0) + tRow.activePoint;
        player.task.weeklyActivePoint = (player.task.weeklyActivePoint || 0) + tRow.activePoint;
      }
      if (tRow.type === 1 && dataApi.taskExt.main[tRow.groupId]) {
        const nextTask = dataApi.taskExt.main[tRow.groupId][tRow.rankId + 1];
        player.task.main[1] = nextTask
          ? { taskId: nextTask.kindId, show: "0/1", isComplete: false, progress: 0 }
          : { taskId: 0, show: "", isComplete: false, progress: 0 };
      } else if (tRow.type === 2 && player.task.daily[tRow.groupId]) {
        player.task.daily[tRow.groupId].isComplete = false;
        player.task.daily[tRow.groupId].received = true;
      }
    }
    sync.task = player.task;
    return sync;
  }

  if (action === "receiveTaskActiveAward") {
    const t = msg.type || "daily";
    const pt = Number(msg.point || 50);
    player.task.receivedPointMap[t] = player.task.receivedPointMap[t] || {};
    player.task.receivedPointMap[t][pt] = true;
    const rewards = (serverConfig.TASK.CONSTS.ACTIVE_REWARD_MAP[t] && serverConfig.TASK.CONSTS.ACTIVE_REWARD_MAP[t][pt]) || [{ entityId: 102, count: 200 }];
    sync._temp.entityCountMap = playerService.addDropList(player, rewards, sync);
    sync.task = { receivedPointMap: player.task.receivedPointMap };
    return sync;
  }

  if (action === "incOnlineTime") {
    const act = player.activity.map.online_reward;
    if (act && act.reachMap) {
      act.reachMap.onlineSeconds = (act.reachMap.onlineSeconds || 0) + Number(msg.seconds || 10);
      for (const k of Object.keys(act.rewards || {})) {
        const r = act.rewards[k];
        if (r.status === 1 && act.reachMap.onlineSeconds >= (r.needMap.onlineSeconds || 0)) {
          r.status = 2;
        }
      }
      sync.activity = { map: { online_reward: act } };
    }
    return sync;
  }

  if (action === "receiveActivityAward" || action === "receiveActivityAward2") {
    const act = player.activity.map[msg.activityName];
    const rIdx = msg.rewardIdx;
    if (act && act.rewards && act.rewards[rIdx]) {
      const rw = act.rewards[rIdx];
      rw.status = 3;
      const drops = rw.dropListDesc ? serverConfig.DROP.FUNS.getDropListByDesc(rw.dropListDesc) : [{ entityId: 102, count: 200 }];
      sync._temp.entityCountMap = playerService.addDropList(player, drops, sync);
      sync.activity = { map: { [msg.activityName]: act } };
    } else {
      sync._temp.entityCountMap = {};
    }
    return sync;
  }

  if (action === "sendChat") {
    const words = String(msg.words || msg.content || "").trim();
    const type = Number(msg.type || 1);
    if (words.startsWith("/")) {
      const gmReply = handleChatCommand(words, player, sync, pushToAll);
      if (gmReply) {
        const gmChat = {
          type,
          playerId: 0,
          playerName: "[GM]",
          playerLevel: 100,
          serverId: player.serverId,
          vipLevel: 16,
          honourLevel: 0,
          playerPhotoInfo: player.photoInfo,
          words: gmReply,
          ctime: Date.now()
        };
        pushToAll("onChat", gmChat);
        return sync;
      }
    }
    const chatObj = {
      type,
      playerId: player.id,
      playerName: player.name,
      playerLevel: player.level,
      serverId: player.serverId,
      vipLevel: player.vip.level,
      honourLevel: 0,
      playerPhotoInfo: player.photoInfo,
      words,
      ctime: Date.now()
    };
    const listKey = type === 2 ? "guildList" : type === 3 ? "allServerList" : "worldList";
    if (player.extra && player.extra.chat && Array.isArray(player.extra.chat[listKey])) {
      player.extra.chat[listKey].push(chatObj);
      if (player.extra.chat[listKey].length > 50) player.extra.chat[listKey].shift();
    }
    pushToAll("onChat", chatObj);
    return sync;
  }

  if (action === "useGiftCode") {
    const code = String(msg.code || "").trim().toUpperCase();
    const reward = code === "VIP16"
      ? [{ entityId: 102, count: 100000 }, { entityId: 101, count: 5000000 }]
      : [{ entityId: 102, count: 10000 }, { entityId: 120, count: 20 }, { entityId: 20004, count: 10 }];
    sync._temp.entityCountMap = playerService.addDropList(player, reward, sync);
    return sync;
  }

  if (action === "topUpGoodsList") {
    return { code: 200, _temp: { route, goodsList: player.extra.goodsList } };
  }

  if (action === "buyGemGoods") {
    const g = player.extra.goodsList[msg.id];
    if (g) {
      const totalGem = (g.gem || 0) + (g.gift || 0);
      playerService.addEntity(player, 102, totalGem, {}, sync);
      playerService.addEntity(player, 98, g.gem || 0, {}, sync);
      player.buyGoodsTimesMap[g.id] = (player.buyGoodsTimesMap[g.id] || 0) + 1;
      sync.buyGoodsTimesMap = player.buyGoodsTimesMap;
    }
    return sync;
  }

  return sync;
}

module.exports = { handlePlayerRoute };
