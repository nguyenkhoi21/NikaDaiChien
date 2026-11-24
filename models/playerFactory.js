const dataApi = require("../config/dataLoader");
const serverConfig = require("../config/serverConfig");
const settings = require("../config/serverSettings");

function formatServerTimeStr(ts) {
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildEquipmentItem(kindId, level = 1) {
  const meta = dataApi.findEntityById(kindId);
  const eff = (meta && meta.effect) || {};
  const attrs = {};
  if (eff.initHp !== undefined || eff.hpGrowth !== undefined) attrs.hp = Math.floor((eff.initHp || 0) + (eff.hpGrowth || 0) * level);
  if (eff.initAtk !== undefined || eff.atkGrowth !== undefined) attrs.atk = Math.floor((eff.initAtk || 0) + (eff.atkGrowth || 0) * level);
  if (eff.initDef !== undefined || eff.defGrowth !== undefined) attrs.def = Math.floor((eff.initDef || 0) + (eff.defGrowth || 0) * level);
  if (eff.initMdef !== undefined || eff.mdefGrowth !== undefined) attrs.mdef = Math.floor((eff.initMdef || 0) + (eff.mdefGrowth || 0) * level);
  if (eff.initCrit !== undefined || eff.critGrowth !== undefined) attrs.crit = Math.floor((eff.initCrit || 0) + (eff.critGrowth || 0) * level);
  if (eff.initDodge !== undefined || eff.dodgeGrowth !== undefined) attrs.dodge = Math.floor((eff.initDodge || 0) + (eff.dodgeGrowth || 0) * level);
  return { kindId, level, attrs };
}

function recalcRoleAttr(role, player) {
  const meta = dataApi.findEntityById(role.kindId);
  if (!meta) return role;
  const star = role.star || 1;
  const level = role.level || 1;
  const growthMult = serverConfig.ROLE.CONSTS.STAR_GROWTH[star] || 1;
  const awakeMult = 1 + (serverConfig.ROLE.CONSTS.AWAKE_GROWTH[role.awakeLevel || 0] || 0);

  const hpGrowth = Math.floor((meta.hpGrowth || 0) * growthMult);
  const atkGrowth = Math.floor((meta.atkGrowth || 0) * growthMult);
  const defGrowth = Math.floor((meta.defGrowth || 0) * growthMult);
  const mdefGrowth = Math.floor((meta.mdefGrowth || 0) * growthMult);

  const initAttr = {
    hp: Math.floor(((meta.initHp || 500) + hpGrowth * level) * awakeMult),
    atk: Math.floor(((meta.initAtk || 30) + atkGrowth * level) * awakeMult),
    def: Math.floor(((meta.initDef || 30) + defGrowth * level) * awakeMult),
    mdef: Math.floor(((meta.initMdef || 30) + mdefGrowth * level) * awakeMult),
    hit: Math.floor(meta.hit || 100),
    dodge: Math.floor(meta.dodge || 0),
    crit: Math.floor(meta.crit || 0)
  };

  const eqAttr = { hp: 0, atk: 0, def: 0, mdef: 0, hit: 0, dodge: 0, crit: 0 };
  for (const slot of Object.keys(role.equipments || {})) {
    const eq = role.equipments[slot];
    if (!eq) continue;
    if (slot.startsWith("evlItem_")) {
      const rebuilt = buildEquipmentItem(eq.kindId, eq.level || 1);
      eq.attrs = rebuilt.attrs;
      for (const k of Object.keys(rebuilt.attrs)) {
        eqAttr[k] = (eqAttr[k] || 0) + (rebuilt.attrs[k] || 0);
      }
    } else if (eq.kindId) {
      const em = dataApi.findEntityById(eq.kindId);
      const eff = (em && em.effect) || {};
      if (eff.hp) eqAttr.hp += eff.hp;
      if (eff.atk) eqAttr.atk += eff.atk;
      if (eff.def) eqAttr.def += eff.def;
      if (eff.mdef) eqAttr.mdef += eff.mdef;
      if (eff.crit) eqAttr.crit += eff.crit;
      if (eff.dodge) eqAttr.dodge += eff.dodge;
    }
  }

  const friendAttr = (player && player.team && player.team.friendshipAttr) || {};
  const attr = {
    hp: Math.floor(initAttr.hp + eqAttr.hp + (friendAttr.hp || 0)),
    atk: Math.floor(initAttr.atk + eqAttr.atk + (friendAttr.atk || 0)),
    def: Math.floor(initAttr.def + eqAttr.def + (friendAttr.def || 0)),
    mdef: Math.floor(initAttr.mdef + eqAttr.mdef + (friendAttr.mdef || 0)),
    hit: Math.floor(initAttr.hit + eqAttr.hit),
    dodge: Math.floor(initAttr.dodge + eqAttr.dodge),
    crit: Math.floor(initAttr.crit + eqAttr.crit),
    hpGrowth,
    atkGrowth,
    defGrowth,
    mdefGrowth,
    reducePctDmgRate: Number(((role.breakLevel || 0) * 0.01).toFixed(4))
  };

  let skillSum = 0;
  for (const s of role.skills || []) skillSum += s.level || 0;
  role.initAttr = initAttr;
  role.equipmentsAttr = eqAttr;
  role.attr = attr;
  role.power = serverConfig.ROLE.FUNS.getPower(attr, skillSum, star);
  const expRow = dataApi.findExperienceByLevel(level);
  role.nextLevelExp = expRow ? expRow.roleExp : 9999999;
  return role;
}

function createRoleRecord(idx, kindId, starOverride, player) {
  const meta = dataApi.findEntityById(kindId);
  if (!meta) return null;
  const soulMeta = dataApi.findSoulByClassId(meta.classId);
  const star = starOverride || (soulMeta ? soulMeta.star : 1) || 1;
  const initEvl = meta.initEvlItemIds || [30101, 30201, 30301, 30401, 30501, 30601];
  const equipments = {};
  for (let i = 0; i < 6; i++) {
    equipments[`evlItem_${i + 1}`] = buildEquipmentItem(initEvl[i] || (30101 + i * 100), 1);
  }
  const skills = (meta.skillIds || []).map((sid, i) => ({
    kindId: sid,
    level: i === 0 ? 1 : 0
  }));
  const role = {
    idx: String(idx),
    kindId: Number(kindId),
    level: 1,
    experience: 0,
    nextLevelExp: 100,
    star,
    awakeLevel: 0,
    awakeRateIncreaseTimes: 0,
    breakLevel: 0,
    equipments,
    skills,
    awakeSkills: [],
    evolveSkillIds: [],
    evolveSkillRateIncreaseTimes: 0,
    trainLevelMap: {},
    trainUnlockMap: {},
    soulLevelMap: {},
    power: 0,
    attr: {},
    initAttr: {},
    equipmentsAttr: {}
  };
  return recalcRoleAttr(role, player);
}

function buildShopGoodsForType(shopType, playerLevel = 1) {
  const rows = dataApi.shop.findBy("type", shopType);
  const selected = rows.slice(0, 12);
  const map = {};
  for (const r of selected) {
    map[r.kindId] = {
      kindId: r.kindId,
      entityId: r.entityId,
      moneyId: r.requireEntityId,
      price: r.price,
      count: r.minCount || 1,
      group: r.group || 1,
      requireVip: r.requireVip || 0,
      shopType,
      priority: r.kindId,
      discount: 1,
      isSaleOut: false
    };
  }
  return map;
}

function buildAllShops(playerLevel = 1) {
  const goodsMap = {};
  const refreshTimesMap = {};
  for (const t of Object.values(serverConfig.SHOP.CONSTS.TYPE)) {
    goodsMap[t] = buildShopGoodsForType(t, playerLevel);
    refreshTimesMap[t] = 0;
  }
  return {
    goodsMap,
    refreshTimesMap,
    hideRoleClassIds: [],
    hideShipClassIds: [],
    randomBoxList: {}
  };
}

function buildGmShop() {
  const shop = {};
  const levels = [0, 1, 2, 3, 4, 5];
  const sampleItems = [
    { id: 1001, dropDesc: "101x1000000", price: 1, dailyMaxBuyTimes: 99 },
    { id: 1002, dropDesc: "20004x50", price: 1, dailyMaxBuyTimes: 99 },
    { id: 1003, dropDesc: "120x10", price: 1, dailyMaxBuyTimes: 99 },
    { id: 1004, dropDesc: "21001x100", price: 1, dailyMaxBuyTimes: 99 }
  ];
  for (const lv of levels) {
    shop[lv] = sampleItems.map((it, idx) => ({
      id: lv * 100 + idx + 1,
      dropDesc: it.dropDesc,
      price: it.price,
      dailyMaxBuyTimes: it.dailyMaxBuyTimes,
      maxBuyTimes: it.dailyMaxBuyTimes
    }));
  }
  return shop;
}

function buildDefaultGoodsList() {
  return {
    1: { id: 1, name: "60 Gems", price: 6, gem: 60, gift: 60, show: "$1", imgId: 1, isFirstDouble: true },
    2: { id: 2, name: "300 Gems", price: 30, gem: 300, gift: 300, show: "$1", imgId: 2, isFirstDouble: true },
    3: { id: 3, name: "680 Gems", price: 68, gem: 680, gift: 680, show: "$1", imgId: 3, isFirstDouble: true },
    4: { id: 4, name: "1280 Gems", price: 128, gem: 1280, gift: 1280, show: "$1", imgId: 4, isFirstDouble: true },
    5: { id: 5, name: "3280 Gems", price: 328, gem: 3280, gift: 3280, show: "$1", imgId: 5, isFirstDouble: true },
    6: { id: 6, name: "6480 Gems", price: 648, gem: 6480, gift: 6480, show: "$1", imgId: 6, isFirstDouble: true, isRecommend: true },
    7: { id: 7, name: "Monthly Card", price: 30, gem: 300, gift: 0, dailyGem: 120, isMonthCard: true, show: "$1", imgId: 7 },
    8: { id: 8, name: "Super Card", price: 68, gem: 680, gift: 0, dailyGem: 300, isBigMonthCard: true, show: "$1", imgId: 8 }
  };
}

function buildDefaultTasks() {
  const mainFirst = dataApi.taskExt.main && dataApi.taskExt.main[1] && dataApi.taskExt.main[1][1];
  const daily = {};
  for (const gid of Object.keys(dataApi.taskExt.daily || {})) {
    const first = dataApi.taskExt.daily[gid][1];
    if (first) {
      daily[gid] = { taskId: first.kindId, show: "0/1", isComplete: false, progress: 0 };
    }
  }
  const achievement = {};
  for (const gid of Object.keys(dataApi.taskExt.achievement || {})) {
    const first = dataApi.taskExt.achievement[gid][1];
    if (first) {
      achievement[gid] = { taskId: first.kindId, show: "0/1", isComplete: false, progress: 0 };
    }
  }
  return {
    main: {
      1: {
        taskId: mainFirst ? mainFirst.kindId : 1,
        show: "0/1",
        isComplete: false,
        progress: 0
      }
    },
    daily,
    achievement,
    dailyActivePoint: 0,
    weeklyActivePoint: 0,
    receivedPointMap: { daily: {}, weekly: {} }
  };
}

function recalcPlayerPower(player) {
  const powers = Object.values(player.team.roles || {}).map((r) => r.power || 0).sort((a, b) => b - a);
  player.power = powers.slice(0, 5).reduce((sum, x) => sum + x, 0);
  return player.power;
}

function createPlayerRecord({ playerId, userId, userName, name, serverId, oldServerId }) {
  const now = Date.now();
  const expRow = dataApi.findExperienceByLevel(settings.STARTER.LEVEL);
  const roleId = settings.STARTER.INIT_ROLES[0] || 100101;
  const roleMeta = dataApi.findEntityById(roleId);

  const player = {
    id: playerId,
    userId,
    userName,
    name: name || userName,
    serverId: Number(serverId || settings.SERVER_ID),
    oldServerId: Number(oldServerId || settings.OLD_SERVER_ID),
    ctime: now,
    lastLoginTime: now,
    level: settings.STARTER.LEVEL,
    experience: 0,
    nextLevelExp: expRow ? expRow.playerExp : 50,
    coin: settings.STARTER.COIN,
    gem: settings.STARTER.GEM,
    actionPoint: settings.STARTER.ACTION_POINT,
    skillPoint: settings.STARTER.SKILL_POINT,
    power: 0,
    honourPoint: 0,
    topUpPoint: 0,
    guildId: 0,
    guildName: "",
    guildSkill: { hp: 0, atk: 0, def: 0, mdef: 0 },
    honourReceivedMap: {},
    chatSkinIds: [0],
    titleInfoMap: {},
    signInDays: 0,
    signInTime: 0,
    weekCardExpire: 0,
    monthCardExpire: 0,
    bigMonthCardExpire: 0,
    yearCardExpire: 0,
    dailyGiftPackCardExpire: 0,
    buyGoodsTimesMap: {},
    dailyBuyGoodsTimesMap: {},
    nextRecoverTimeMap: { actionPoint: 0, skillPoint: 0 },
    photoInfo: {
      photoImgId: (roleMeta && roleMeta.imgId) || 1001,
      shipImgId: 901,
      frameId: 0,
      titleImgId: 0,
      chatImgId: 0
    },
    vip: {
      level: settings.STARTER.VIP_LEVEL,
      topUpGem: settings.STARTER.VIP_EXP,
      topUpMoney: 0,
      buyActionPointTimes: 0,
      resetSmapTimesTimesMap: {},
      buyCoinTimes: 0,
      buyChallengeTimesTimes: 0,
      buy3v3ChallengeTimesTimes: 0,
      buySkillPointTimes: 0,
      resetExpeditionTimes: 0,
      resetSixExpeditionTimes: 0,
      endlessSkipTimes: 0,
      buyEyeChallengeTimesTimes: 0,
      buyMapType3Times: 0,
      buyMapType4Times: 0,
      buyMapType5Times: 0,
      shipUpgradeLevelTimes: 0
    },
    team: {
      roles: {},
      ships: {},
      skills: {},
      friendshipAttr: { hp: 0, atk: 0, def: 0, mdef: 0 },
      titleAttr: {},
      nextRoleIdx: 2
    },
    bag: {
      items: {},
      lastIdx: 10
    },
    smapStarMap: { "1": {}, "2": {}, "3": {}, "4": {}, "5": {} },
    smapTimesMap: { "1": {}, "2": {}, "3": {}, "4": {}, "5": {} },
    bmapBoxReceivedMap: {},
    friendshipUnlockMap: {},
    point: {
      freeCoinTimes: 0,
      nextCoinFreeTime: 0,
      nextGemFreeTime: 0,
      isPayGemFirst: false,
      coinTimes: 0,
      gemTimes: 0
    },
    shop: buildAllShops(settings.STARTER.LEVEL),
    task: buildDefaultTasks(),
    activity: {
      scorePointInfoMap: {},
      map: {
        online_reward: {
          name: "online_reward",
          type: "online_reward",
          priority: 10,
          start_time: -1,
          end_time: -1,
          isSuccess: false,
          reachMap: { onlineSeconds: 0 },
          rewards: {
            0: { idx: 0, status: 2, needMap: { onlineSeconds: 0 }, dropListDesc: "101x50000,102x200" },
            1: { idx: 1, status: 1, needMap: { onlineSeconds: 60 }, dropListDesc: "101x100000,102x500,120x2" },
            2: { idx: 2, status: 1, needMap: { onlineSeconds: 300 }, dropListDesc: "102x1000,120x5,20003x10" }
          }
        }
      }
    },
    arena: {
      rank: 500,
      topRank: 500,
      remainingChallengeTimes: 5,
      maxChallengeTimes: 5,
      defenseTeamIndexs: ["1"],
      defenseShipIndexs: [],
      lastChallengeTime: 0
    },
    arena3v3: {
      rank: 500,
      remainingChallengeTimes: 5,
      maxChallengeTimes: 5,
      hourCoin: 20,
      receiveCoin: 0,
      playerInfoMap: {},
      defenseTeamIndexsMap: {},
      defenseShipIndexsMap: {}
    },
    topArena3v3: {
      score: 0,
      remainingMatchTimes: 7,
      resetTime: now + 16 * serverConfig.CONSTS.A_DAY,
      playerInfos: [],
      topInfoMap: {},
      firstReachReceivedMap: {}
    },
    expedition: {
      passId: 0,
      prePassId: 0,
      status: 1,
      challengerInfo: {},
      selfInfo: { roles: {} },
      sixChallengerInfo: {},
      sixPlayerInfos: [],
      sixSelfInfo: { roles: {} }
    },
    endless: {
      topPassId: 0,
      otherTopPassIdMap: {},
      pursuitTeamMap: {},
      fruitMapPowerUp: 0,
      fruitMapUseRolesNo: 0,
      starSignMapUseRolesNo: 0
    },
    eye: {
      list: [],
      remainingChallengeTimes: 5
    },
    island: {
      attackerIds: [],
      buyChallengeTimesTimes: 0,
      defenseInfoMap: {},
      defenseShipIndexs: [],
      defenseTeamIndexs: [],
      helpShipIndexs: [],
      helpTeamIndexs: [],
      remainingChallengeTimes: 5,
      remainingDefenseTimes: 5,
      teamIdxUnLockTimeMap: {}
    },
    practice: {
      allDefenseShipIndexs: [],
      allDefenseTeamIndexs: [],
      usedShipIndexs: [],
      usedTeamIndexs: []
    },
    friend: {
      list: [],
      infoMap: {},
      requests: [],
      actionPointReceiveTimes: 0,
      count: 0
    },
    timePeak: {},
    gm: {
      level: settings.STARTER.GM_LEVEL,
      dailyUseGmPoint: 0,
      shop: buildGmShop(),
      gmShopDailyBuyTimesMap: {},
      gmShopBuyTimesMap: {},
      activeRewardStatusMap: {},
      dailyRewardReceivedMap: {},
      buyGoodsTimesMap: {}
    },
    extra: {
      serverTime: now,
      serverTimeStr: formatServerTimeStr(now),
      openDays: 1,
      clientIp: "127.0.0.1",
      goodsList: buildDefaultGoodsList(),
      mails: [
        {
          _id: "welcome_1",
          senderId: 9999999999,
          senderName: "System",
          title: "Welcome to Sunny Pirates Private Server!",
          body: "Enjoy your private server! Use /help in chat or open the Web GM Panel on port 8088/gm to grant any hero, item, gems, or coins.",
          ctime: now,
          status: 1,
          isSys: true,
          dropList: [
            { entityId: 102, count: 50000 },
            { entityId: 101, count: 2000000 },
            { entityId: 120, count: 50 },
            { entityId: 20004, count: 20 }
          ]
        }
      ],
      chat: { worldList: [], guildList: [], allServerList: [] },
      arenaRankTop1: null,
      arena3v3RankTop1: null,
      prestigeBattleRankTop1: null,
      topArena3v3RankTop1: null,
      guildBattle: {},
      newGuildBattle: {},
      activityGuildBattle: {},
      allServerBattle: {},
      worldBoss: {},
      guildBoss: {},
      prestigeBattle: {},
      worshipBattle: {},
      doubleBattle: {}
    }
  };

  // Starter hero(s)
  let rIdx = 1;
  for (const rid of settings.STARTER.INIT_ROLES) {
    const role = createRoleRecord(rIdx, rid, null, player);
    if (role) {
      player.team.roles[String(rIdx)] = role;
      rIdx++;
    }
  }
  player.team.nextRoleIdx = rIdx;

  // Starter bag items (EXP potions, gacha tickets, skip tickets, stones)
  const starterBag = [
    { kindId: 20003, count: 50 },
    { kindId: 20004, count: 20 },
    { kindId: 120, count: 50 },
    { kindId: 104, count: 500 },
    { kindId: 113, count: 50 },
    { kindId: 9010, count: 20 }
  ];
  let bIdx = 1;
  for (const sb of starterBag) {
    player.bag.items[String(bIdx)] = { idx: String(bIdx), kindId: sb.kindId, count: sb.count, extra: {} };
    bIdx++;
  }
  player.bag.lastIdx = bIdx;

  recalcPlayerPower(player);
  return player;
}

function sanitizePlayerForClient(player) {
  const now = Date.now();
  player.extra = player.extra || {};
  player.extra.serverTime = now;
  player.extra.serverTimeStr = formatServerTimeStr(now);

  // Backfill schema fields required by homeScene and child panels
  if (!player.honourReceivedMap) player.honourReceivedMap = {};
  if (!Array.isArray(player.chatSkinIds)) player.chatSkinIds = [0];
  if (!player.titleInfoMap) player.titleInfoMap = {};
  if (player.bigMonthCardExpire === undefined) player.bigMonthCardExpire = 0;
  if (!player.timePeak) player.timePeak = {};

  player.vip = player.vip || {};
  if (player.vip.shipUpgradeLevelTimes === undefined) player.vip.shipUpgradeLevelTimes = 0;

  player.activity = player.activity || { map: {} };
  if (!player.activity.scorePointInfoMap) player.activity.scorePointInfoMap = {};
  if (!player.activity.map) player.activity.map = {};

  player.friend = player.friend || { list: [], infoMap: {}, requests: [] };
  if (player.friend.actionPointReceiveTimes === undefined) player.friend.actionPointReceiveTimes = 0;
  if (player.friend.count === undefined) player.friend.count = (player.friend.list || []).length;

  const oldChat = player.extra.chat || {};
  player.extra.chat = {
    worldList: Array.isArray(oldChat.worldList) ? oldChat.worldList : (Array.isArray(oldChat.world) ? oldChat.world : []),
    guildList: Array.isArray(oldChat.guildList) ? oldChat.guildList : (Array.isArray(oldChat.guild) ? oldChat.guild : []),
    allServerList: Array.isArray(oldChat.allServerList) ? oldChat.allServerList : (Array.isArray(oldChat.allServer) ? oldChat.allServer : [])
  };

  return player;
}

module.exports = {
  formatServerTimeStr,
  buildEquipmentItem,
  recalcRoleAttr,
  createRoleRecord,
  buildAllShops,
  buildShopGoodsForType,
  recalcPlayerPower,
  createPlayerRecord,
  sanitizePlayerForClient
};
