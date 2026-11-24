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

function ensureRoleEquipments(eqMap) {
  const eq = eqMap || {};
  const defaults = {
    stoneItem_1: null, stoneItem_2: null, stoneItem_3: null, stoneItem_4: null, stoneItem_5: null, stoneItem_6: null,
    artifactItem_1: null, artifactItem_2: null, artifactItem_3: null, artifactItem_4: null, artifactItem_5: null,
    capsuleItem_1: null, capsuleItem_2: null, capsuleItem_3: null, capsuleItem_4: null, capsuleItem_5: null,
    starSignItem_1: null, starSignItem_2: null, starSignItem_3: null, starSignItem_4: null,
    starSignSkillId: 0
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (eq[k] === undefined) eq[k] = v;
  }
  return eq;
}

function makeDefaultTrainLevelMap() {
  return { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0, "10": 0 };
}

function makeDefaultSoulLevelMap() {
  return { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0 };
}

function recalcShipItem(item) {
  if (!item) return item;
  const lv = Number(item.level || 0);
  const star = Number(item.star || 1);
  const skillLv = Number(item.skillLevel || 1);
  const meta = dataApi.findEntityById(item.kindId);
  const eff = (meta && meta.effect) || {};
  const hp = Math.floor((eff.initHp || 0) + (eff.hpGrowth || 0) * lv * star);
  const atk = Math.floor((eff.initAtk || 0) + (eff.atkGrowth || 0) * lv * star);
  const def = Math.floor((eff.initDef || 0) + (eff.defGrowth || 0) * lv * star + lv * 9 * star);
  const mdef = Math.floor((eff.initMdef || 0) + (eff.mdefGrowth || 0) * lv * star + lv * 9 * star);
  item.attr = { hp, atk, def, mdef };
  item.nextLevelExp = 75 + lv * 25;
  item.power = Math.floor(30 + 0.1 * hp + atk + def + mdef + (skillLv - 1) * 60 + (star - 1) * 240);
  return item;
}

function createShipItem(kindId, idx) {
  const item = {
    idx: String(idx),
    kindId: Number(kindId),
    count: 1,
    star: 1,
    level: 0,
    experience: 0,
    nextLevelExp: 75,
    skillLevel: 1,
    attr: { hp: 0, atk: 0, def: 0, mdef: 0 },
    power: 30
  };
  return recalcShipItem(item);
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
    if (!eq || typeof eq !== "object") continue;
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
  const guildAttr = (player && player.guildSkill && player.guildSkill.attr) || {};
  const attr = {
    hp: Math.floor(initAttr.hp + eqAttr.hp + (friendAttr.hp || 0) + (guildAttr.hp || 0)),
    atk: Math.floor(initAttr.atk + eqAttr.atk + (friendAttr.atk || 0) + (guildAttr.atk || 0)),
    def: Math.floor(initAttr.def + eqAttr.def + (friendAttr.def || 0) + (guildAttr.def || 0)),
    mdef: Math.floor(initAttr.mdef + eqAttr.mdef + (friendAttr.mdef || 0) + (guildAttr.mdef || 0)),
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
  const skillList = Array.isArray(role.skills) ? role.skills : Object.values(role.skills || {});
  for (const s of skillList) skillSum += (s && s.level) || 0;
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
  const equipments = ensureRoleEquipments({});
  for (let i = 0; i < 6; i++) {
    equipments[`evlItem_${i + 1}`] = buildEquipmentItem(initEvl[i] || (30101 + i * 100), 1);
  }
  const skills = {};
  if (Array.isArray(meta.skillIds) && meta.skillIds.length > 0) {
    const firstSid = meta.skillIds[0];
    skills[String(firstSid)] = { kindId: firstSid, level: 1 };
  }
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
    awakeSkills: {},
    evolveSkillIds: [],
    evolveSkillRateIncreaseTimes: 0,
    trainLevelMap: makeDefaultTrainLevelMap(),
    trainUnlockMap: {},
    soulLevelMap: makeDefaultSoulLevelMap(),
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
      groupId: String(r.group || 101),
      buyTimes: 0,
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
    payGetEntityIds: [],
    willForSaleEntityIds: [],
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
  const defs = [
    { id: 1, name: "60 Gems", price: 6, gem: 60, gift: 60, imgId: 1, isFirstDouble: true },
    { id: 2, name: "300 Gems", price: 30, gem: 300, gift: 300, imgId: 2, isFirstDouble: true },
    { id: 3, name: "680 Gems", price: 68, gem: 680, gift: 680, imgId: 3, isFirstDouble: true },
    { id: 4, name: "1280 Gems", price: 128, gem: 1280, gift: 1280, imgId: 4, isFirstDouble: true },
    { id: 5, name: "3280 Gems", price: 328, gem: 3280, gift: 3280, imgId: 5, isFirstDouble: true },
    { id: 6, name: "6480 Gems", price: 648, gem: 6480, gift: 6480, imgId: 6, isFirstDouble: true, isRecommend: true },
    { id: 7, name: "Monthly Card", price: 30, gem: 300, gift: 0, dailyGem: 120, isMonthCard: true, imgId: 7 },
    { id: 8, name: "Super Card", price: 68, gem: 680, gift: 0, dailyGem: 300, isBigMonthCard: true, imgId: 8 }
  ];
  const out = {};
  for (const d of defs) {
    out[d.id] = { ...d, show: "$1$", pid: d.id, needPoint: d.price };
  }
  return out;
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
    mapType1SmapId: 0,
    mapType2SmapId: 0,
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

function buildDefaultActivities(now = Date.now()) {
  return {
    map: {
      online_reward: {
        name: "online_reward",
        desc: "Online Rewards",
        start_time: -1,
        end_time: -1,
        reachMap: { onlineSeconds: 0 },
        rewards: [
          { needMap: { onlineSeconds: 60 }, dropListDesc: "120x2,171x1", status: 2 },
          { needMap: { onlineSeconds: 300 }, dropListDesc: "113x2,171x1", status: 1 },
          { needMap: { onlineSeconds: 600 }, dropListDesc: "120x3,171x1", status: 1 },
          { needMap: { onlineSeconds: 1800 }, dropListDesc: "113x3,171x2", status: 1 }
        ]
      },
      login8day: {
        name: "login8day",
        desc: "Login 8 Days Rewards",
        create_day: 30,
        reachMap: { loginDays: 1 },
        rewards: [
          { desc: "Bikini Nami", needMap: { loginDays: 1 }, dropListDesc: "51510x80,102x1000", status: 2 },
          { desc: "Gear 5 Luffy", needMap: { loginDays: 2 }, dropListDesc: "50920x80,102x2000", status: 1 },
          { desc: "Kimono Sabo", needMap: { loginDays: 3 }, dropListDesc: "51570x80,102x3000", status: 1 },
          { desc: "Lady Robin", needMap: { loginDays: 4 }, dropListDesc: "51550x80,102x4000", status: 1 }
        ]
      },
      upgradeLevel: {
        name: "upgradeLevel",
        desc: "Leveling Master",
        spineResId: "1_2",
        priority: 101,
        isKeepShow: true,
        reachMap: { playerLevel: 1 },
        rewards: [
          { desc: "Team level reached 5", needMap: { playerLevel: 5 }, dropListDesc: "50840x10", status: 1 },
          { desc: "Team level reached 10", needMap: { playerLevel: 10 }, dropListDesc: "50840x10", status: 1 },
          { desc: "Team level reached 20", needMap: { playerLevel: 20 }, dropListDesc: "50840x20", status: 1 }
        ]
      }
    },
    firstTimeMap: {},
    scorePointInfoMap: {},
    dial: {
      luckDesc: "364x10_W20,171x10_W5,369x5_W10,312x1_W20,60001x1_W15,114x1_W5,374x5_W10,102x100_W15",
      vipDesc: "363x10_W20,171x20_W5,368x5_W10,313x1_W20,60001x2_W15,117x1_W5,373x5_W10,102x200_W15",
      svipDesc: "362x5_W20,171x50_W5,367x2_W10,314x1_W20,60002x1_W15,119x1_W5,372x2_W10,102x500_W15",
      shenDesc: "50920x2_W20,171x100_W5,366x1_W10,315x1_W20,60002x2_W15,172x1_W5,371x1_W10,102x1000_W15",
      start_time: -1,
      end_time: -1,
      shenEndTime: now + 365 * serverConfig.CONSTS.A_DAY
    },
    dream: {
      curPos: 0,
      logs: [],
      activityItem: {
        name: "dreamActivity_1",
        desc: "Dream Country",
        type: "dream",
        rewardMap: {
          "1": "341x10", "2": "20003x10", "3": "364x10", "4": "event",
          "5": "102x300", "6": "20003x10", "7": "342x3", "8": "128x10",
          "9": "341x10", "10": "313x1", "11": "102x300", "12": "323x1",
          "13": "event", "14": "113x2", "15": "368x5", "16": "343x1",
          "17": "369x5", "18": "363x10", "19": "102x300", "20": "314x1",
          "21": "20003x10", "22": "120x10", "23": "event", "24": "364x10"
        }
      }
    }
  };
}

function buildDefaultTimePeak() {
  return {
    bmapId: 0,
    battleLevel: 0,
    endTime: 0,
    statusMap: {},
    boxStatusMap: {},
    blessingIds: [],
    blessingIdGetTimeMap: {},
    selectBlessingIdsMap: {},
    challengeWinTimeList: [],
    challengerInfoMap: {},
    selfInfo: { hpMap: {}, mpMap: {} },
    campInfo: {},
    borrowRoles: [],
    logs: [],
    extInfo: {}
  };
}

function recalcPlayerPower(player) {
  const powers = Object.values((player.team && player.team.roles) || {}).map((r) => r.power || 0).sort((a, b) => b - a);
  let total = powers.slice(0, 5).reduce((sum, x) => sum + x, 0);
  let bestShipPower = 0;
  for (const it of Object.values((player.bag && player.bag.items) || {})) {
    if (it && Number(it.kindId) >= 900 && Number(it.kindId) < 1000 && it.skillLevel !== undefined) {
      bestShipPower = Math.max(bestShipPower, Number(it.power || 0));
    }
  }
  total += bestShipPower;
  player.power = total;
  player.topPower = Math.max(player.topPower || 0, player.power);
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
    accountId: String(userId),
    userName,
    name: name || userName,
    channel: "Android",
    serverId: Number(serverId || settings.SERVER_ID),
    oldServerId: Number(oldServerId || settings.OLD_SERVER_ID),
    ctime: now,
    atime: now,
    resetTime: now,
    lastLoginTime: now,
    level: settings.STARTER.LEVEL,
    experience: 0,
    nextLevelExp: expRow ? expRow.playerExp : 50,
    coin: settings.STARTER.COIN,
    gem: settings.STARTER.GEM,
    sysGem: 0,
    costGem: 0,
    dailyTopUpMoney: 0,
    actionPoint: settings.STARTER.ACTION_POINT,
    skillPoint: settings.STARTER.SKILL_POINT,
    power: 0,
    topPower: 0,
    starCount: 0,
    honourPoint: 0,
    topUpPoint: 0,
    guildId: 0,
    guildName: "",
    joinGuildTimes: 0,
    guildSkill: {
      levelMap: { HP: 0, ATK: 0, DEF: 0, MDEF: 0 },
      attr: { hp: 0, atk: 0, def: 0, mdef: 0 }
    },
    honourReceivedMap: {},
    chatSkinIds: [0],
    frameIds: [],
    titleInfoMap: {},
    dropLuckMap: {},
    settingInfo: {},
    resetPayDoubleId: 1,
    useMoneyCarTimesMap: {},
    useTaskCodes: [],
    videoSupportCount: 5,
    cardDaysMap: {},
    worshipStatueMap: {},
    worshipStatueExtMap: {},
    worshipStatue3v3Map: {},
    worshipStatueDoubleMap: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
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
    timesMaxMap: { skillPoint: 15, actionPoint: 60 + settings.STARTER.LEVEL },
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
      giftGem: settings.STARTER.VIP_EXP,
      topUpMoney: 0,
      topUpTrueMoney: 0,
      buyActionPointTimes: 0,
      resetSmapTimesTimesMap: {},
      buyCoinTimes: 0,
      buyChallengeTimesTimes: 0,
      buy3v3ChallengeTimesTimes: 0,
      buySkillPointTimes: 0,
      resetExpeditionTimes: 0,
      tailChallengeTimesTimes: 0,
      resetSixExpeditionTimes: 0,
      endlessSkipTimes: 0,
      buyEyeChallengeTimesTimes: 0,
      buyMapType3Times: 0,
      buyMapType4Times: 0,
      buyMapType5Times: 0,
      shipUpgradeLevelTimes: 0,
      worshipStatueTimes: 0,
      worshipStatueExtTimes: 0,
      worshipStatue3v3Times: 0,
      worshipStatueDoubleTimesMap: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }
    },
    team: {
      roles: {},
      ships: {},
      skills: {},
      friendshipAttr: { hp: 0, atk: 0, def: 0, mdef: 0 },
      titleAttr: { incHpRate: 0, incAtkRate: 0 },
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
      coinTenTimes: 0,
      gemTenTimes: 0,
      dailyCoinTimes: 0,
      dailyUseGemTimes: 0,
      isPayCoinFirst: false,
      isPayGemFirst: false,
      coinTimes: 0,
      gemTimes: 0
    },
    shop: buildAllShops(settings.STARTER.LEVEL),
    task: buildDefaultTasks(),
    activity: buildDefaultActivities(now),
    arena: {
      rank: 500,
      topRank: 10001,
      winTimes: 0,
      challengeTimes: 0,
      nextChallengeTime: 0,
      remainingChallengeTimes: 5,
      maxChallengeTimes: 5,
      defenseTeamIndexs: ["1"],
      defenseShipIndexs: [],
      lastChallengeTime: 0
    },
    arena3v3: {
      rank: 500,
      winTimes: 0,
      challengeTimes: 0,
      nextChallengeTime: 0,
      lastReceiveTime: now,
      remainingChallengeTimes: 5,
      maxChallengeTimes: 5,
      hourCoin: 20,
      receiveCoin: 0,
      playerInfoMap: {},
      defenseTeamIndexsMap: { "1": [], "2": [], "3": [] },
      defenseShipIndexsMap: { "1": [], "2": [], "3": [] }
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
      sixPassId: 0,
      sixStatus: 1,
      preSixPassId: 0,
      sixChallengerInfo: {},
      sixPlayerInfos: [],
      sixSelfInfo: { roles: {} }
    },
    endless: {
      passId: 0,
      topPassId: 0,
      otherTopPassIdMap: {},
      pursuitTeamMap: {},
      pursuitTimesMap: {},
      pursuitResetTeamTimesMap: {},
      fruitMapChallengeTimes: 0,
      fruitMapBuyTimes: 0,
      fruitMapPowerUp: 0,
      fruitMapUseRolesNo: 0,
      starSignMapChallengeTimes: 0,
      starSignMapUseRolesNo: 0
    },
    eye: {
      list: [],
      challengeTimes: 0,
      teamIndexs: [],
      shipIndexs: [],
      startTime: 0,
      type: null,
      remainingChallengeTimes: 5
    },
    island: {
      challengeTimes: 0,
      attackerIds: [],
      attackerIdTimesMap: {},
      helpInfoMap: {},
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
      defenseTimes: 0,
      challengeTimes: 0,
      defenseInfoMap: {},
      allDefenseShipIndexs: [],
      allDefenseTeamIndexs: [],
      usedShipIndexs: [],
      usedTeamIndexs: [],
      remainingChallengeTimes: 6,
      remainingDefenseTimes: 6
    },
    friend: {
      list: [],
      infoMap: {},
      requests: [],
      actionPointReceiveTimes: 0,
      count: 0
    },
    timePeak: buildDefaultTimePeak(),
    gm: {
      level: settings.STARTER.GM_LEVEL,
      dailyUseGmPoint: 0,
      dailyGetGmPoint: 0,
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
      banner: null,
      crossSid: 0,
      zhixingStr: null,
      goodsList: buildDefaultGoodsList(),
      mails: [
        {
          _id: "welcome_1",
          senderId: 9999999999,
          senderName: "System",
          title: "Welcome to Sunny Pirates Private Server!",
          body: "Enjoy your private server! Use /help in chat or open the Web GM Panel on /gm to grant any hero, item, gems, or coins.",
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
  if (player.extra.banner === undefined) player.extra.banner = null;
  if (player.extra.crossSid === undefined) player.extra.crossSid = 0;
  if (player.extra.zhixingStr === undefined) player.extra.zhixingStr = null;

  // Migrate top-level fields expected by official client
  if (player.accountId === undefined) player.accountId = String(player.userId || 0);
  if (player.atime === undefined) player.atime = now;
  if (player.resetTime === undefined) player.resetTime = now;
  if (!player.channel) player.channel = "Android";
  if (player.costGem === undefined) player.costGem = 0;
  if (player.sysGem === undefined) player.sysGem = 0;
  if (player.dailyTopUpMoney === undefined) player.dailyTopUpMoney = 0;
  if (player.starCount === undefined) player.starCount = 0;
  if (player.topPower === undefined) player.topPower = player.power || 0;
  if (!player.honourReceivedMap) player.honourReceivedMap = {};
  if (!Array.isArray(player.chatSkinIds)) player.chatSkinIds = [0];
  if (!Array.isArray(player.frameIds)) player.frameIds = [];
  if (!player.titleInfoMap) player.titleInfoMap = {};
  if (!player.dropLuckMap) player.dropLuckMap = {};
  if (!player.settingInfo) player.settingInfo = {};
  if (player.resetPayDoubleId === undefined) player.resetPayDoubleId = 1;
  if (!player.useMoneyCarTimesMap) player.useMoneyCarTimesMap = {};
  if (!Array.isArray(player.useTaskCodes)) player.useTaskCodes = [];
  if (player.videoSupportCount === undefined) player.videoSupportCount = 5;
  if (!player.cardDaysMap) player.cardDaysMap = {};
  if (!player.worshipStatueMap) player.worshipStatueMap = {};
  if (!player.worshipStatueExtMap) player.worshipStatueExtMap = {};
  if (!player.worshipStatue3v3Map) player.worshipStatue3v3Map = {};
  if (!player.worshipStatueDoubleMap) player.worshipStatueDoubleMap = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  if (player.bigMonthCardExpire === undefined) player.bigMonthCardExpire = 0;
  if (player.joinGuildTimes === undefined) player.joinGuildTimes = 0;
  if (!player.timesMaxMap) {
    player.timesMaxMap = { skillPoint: 15, actionPoint: 60 + (player.level || 1) };
  }

  // Migrate guildSkill flat -> { levelMap, attr }
  if (!player.guildSkill || !player.guildSkill.levelMap) {
    const oldGs = player.guildSkill || {};
    player.guildSkill = {
      levelMap: {
        HP: Number(oldGs.hp || oldGs.HP || 0),
        ATK: Number(oldGs.atk || oldGs.ATK || 0),
        DEF: Number(oldGs.def || oldGs.DEF || 0),
        MDEF: Number(oldGs.mdef || oldGs.MDEF || 0)
      },
      attr: {
        hp: Number(oldGs.hp || 0) * 100,
        atk: Number(oldGs.atk || 0) * 100,
        def: Number(oldGs.def || 0) * 100,
        mdef: Number(oldGs.mdef || 0) * 100
      }
    };
  }

  // Migrate roles: skills Array -> Object map, awakeSkills Array -> Object map, ensure slots & maps
  player.team = player.team || { roles: {}, ships: {}, skills: {}, friendshipAttr: { hp: 0, atk: 0, def: 0, mdef: 0 }, titleAttr: {}, nextRoleIdx: 2 };
  for (const r of Object.values(player.team.roles || {})) {
    if (!r) continue;
    if (Array.isArray(r.skills)) {
      const obj = {};
      for (const s of r.skills) {
        if (s && s.kindId && Number(s.level || 0) > 0) {
          obj[String(s.kindId)] = { kindId: Number(s.kindId), level: Number(s.level) };
        }
      }
      if (Object.keys(obj).length === 0 && r.skills[0] && r.skills[0].kindId) {
        const s0 = r.skills[0];
        obj[String(s0.kindId)] = { kindId: Number(s0.kindId), level: 1 };
      }
      r.skills = obj;
    } else if (!r.skills) {
      r.skills = {};
    }
    if (Array.isArray(r.awakeSkills) || !r.awakeSkills) r.awakeSkills = {};
    r.equipments = ensureRoleEquipments(r.equipments);
    if (!r.trainLevelMap || Object.keys(r.trainLevelMap).length < 10) {
      r.trainLevelMap = { ...makeDefaultTrainLevelMap(), ...(r.trainLevelMap || {}) };
    }
    if (!r.soulLevelMap || Object.keys(r.soulLevelMap).length < 9) {
      r.soulLevelMap = { ...makeDefaultSoulLevelMap(), ...(r.soulLevelMap || {}) };
    }
  }

  // Migrate timePeak
  const defTp = buildDefaultTimePeak();
  player.timePeak = { ...defTp, ...(player.timePeak || {}) };

  // Backfill vip & point & arena & endless & task & shop
  player.vip = player.vip || {};
  if (player.vip.shipUpgradeLevelTimes === undefined) player.vip.shipUpgradeLevelTimes = 0;
  if (player.vip.topUpTrueMoney === undefined) player.vip.topUpTrueMoney = 0;
  if (player.vip.giftGem === undefined) player.vip.giftGem = player.vip.topUpGem || 0;
  if (player.vip.tailChallengeTimesTimes === undefined) player.vip.tailChallengeTimesTimes = 0;
  if (player.vip.worshipStatueTimes === undefined) player.vip.worshipStatueTimes = 0;
  if (player.vip.worshipStatueExtTimes === undefined) player.vip.worshipStatueExtTimes = 0;
  if (player.vip.worshipStatue3v3Times === undefined) player.vip.worshipStatue3v3Times = 0;
  if (!player.vip.worshipStatueDoubleTimesMap) player.vip.worshipStatueDoubleTimesMap = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };

  player.point = player.point || {};
  if (player.point.coinTenTimes === undefined) player.point.coinTenTimes = 0;
  if (player.point.gemTenTimes === undefined) player.point.gemTenTimes = 0;
  if (player.point.dailyCoinTimes === undefined) player.point.dailyCoinTimes = 0;
  if (player.point.dailyUseGemTimes === undefined) player.point.dailyUseGemTimes = 0;
  if (player.point.isPayCoinFirst === undefined) player.point.isPayCoinFirst = false;
  if (player.point.isPayGemFirst === undefined) player.point.isPayGemFirst = false;

  player.arena = player.arena || {};
  if (player.arena.winTimes === undefined) player.arena.winTimes = 0;
  if (player.arena.challengeTimes === undefined) player.arena.challengeTimes = 0;
  if (player.arena.nextChallengeTime === undefined) player.arena.nextChallengeTime = 0;

  player.arena3v3 = player.arena3v3 || {};
  if (player.arena3v3.winTimes === undefined) player.arena3v3.winTimes = 0;
  if (player.arena3v3.challengeTimes === undefined) player.arena3v3.challengeTimes = 0;
  if (player.arena3v3.nextChallengeTime === undefined) player.arena3v3.nextChallengeTime = 0;
  if (player.arena3v3.lastReceiveTime === undefined) player.arena3v3.lastReceiveTime = now;
  if (!player.arena3v3.defenseTeamIndexsMap) player.arena3v3.defenseTeamIndexsMap = { "1": [], "2": [], "3": [] };
  if (!player.arena3v3.defenseShipIndexsMap) player.arena3v3.defenseShipIndexsMap = { "1": [], "2": [], "3": [] };

  player.endless = player.endless || {};
  if (player.endless.passId === undefined) player.endless.passId = 0;
  if (!player.endless.pursuitTimesMap) player.endless.pursuitTimesMap = {};
  if (!player.endless.pursuitResetTeamTimesMap) player.endless.pursuitResetTeamTimesMap = {};
  if (player.endless.fruitMapChallengeTimes === undefined) player.endless.fruitMapChallengeTimes = 0;
  if (player.endless.fruitMapBuyTimes === undefined) player.endless.fruitMapBuyTimes = 0;
  if (player.endless.starSignMapChallengeTimes === undefined) player.endless.starSignMapChallengeTimes = 0;

  player.task = player.task || buildDefaultTasks();
  if (player.task.mapType1SmapId === undefined) player.task.mapType1SmapId = 0;
  if (player.task.mapType2SmapId === undefined) player.task.mapType2SmapId = 0;

  player.shop = player.shop || buildAllShops(player.level || 1);
  if (!Array.isArray(player.shop.payGetEntityIds)) player.shop.payGetEntityIds = [];
  if (!Array.isArray(player.shop.willForSaleEntityIds)) player.shop.willForSaleEntityIds = [];

  // Migrate activity & convert any Object-shaped rewards -> Array
  const defAct = buildDefaultActivities(now);
  player.activity = player.activity || {};
  if (!player.activity.scorePointInfoMap) player.activity.scorePointInfoMap = {};
  if (!player.activity.firstTimeMap) player.activity.firstTimeMap = {};
  if (!player.activity.dial) player.activity.dial = defAct.dial;
  if (!player.activity.dream) player.activity.dream = defAct.dream;
  if (!player.activity.map) player.activity.map = {};
  for (const act of Object.values(player.activity.map)) {
    if (act && act.rewards && !Array.isArray(act.rewards) && typeof act.rewards === "object") {
      act.rewards = Object.keys(act.rewards)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => act.rewards[k]);
    }
  }
  for (const [k, v] of Object.entries(defAct.map)) {
    if (!player.activity.map[k]) player.activity.map[k] = v;
  }

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
  ensureRoleEquipments,
  createShipItem,
  recalcShipItem,
  recalcRoleAttr,
  createRoleRecord,
  buildAllShops,
  buildShopGoodsForType,
  recalcPlayerPower,
  createPlayerRecord,
  sanitizePlayerForClient
};
