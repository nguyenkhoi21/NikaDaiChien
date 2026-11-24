const dataApi = require("./dataLoader");

const CONSTS = {
  A_DAY: 86400000,
  UPDATE_TYPE: { ADD: 1, REDUCE: 2, MODIFY: 3 },
  ENTITY_TYPE: {
    ROLE: "role",
    GEM: "gem",
    COIN: "coin",
    FRAGMENT: "fragment",
    MONEY: "money",
    SOUL: "soul",
    STONE: "stone",
    ARTIFACT: "artifact",
    ARTIFACT_FRAGMENT: "artifactFragment",
    TREASURE: "treasure",
    CONSUMABLES: "consumables",
    SHIP: "ship",
    SHIP_FRAGMENT: "shipFragment",
    BOX: "box",
    TITLE: "title",
    CHAT_SKIN: "chatSkin",
    FRUIT: "fruit",
    FRUIT_FRAGMENT: "fruitFragment",
    FRAME: "frame",
    CAPSULE: "capsule",
    STAR_SIGN: "starSign"
  },
  ENTITY_ID: {
    VIP_EXP: 98,
    AP: 99,
    EXP: 100,
    COIN: 101,
    GEM: 102,
    ARENA_COIN: 103,
    SKIP_COIN: 104,
    EXPEDITION_COIN: 105,
    ARENA_3V3_COIN: 106,
    GUILD_COIN: 107,
    PRACTICE_COIN: 111,
    VIP_COIN: 112,
    PRESTIGE_COIN: 115,
    SIX_COIN: 116,
    SHIP_COIN: 118,
    GEM_TICKET: 120,
    FRUIT_COIN: 122,
    RANDOM_BOX: 351,
    TOP_ARENA_3V3_COIN: 97,
    STAR_SIGN_COIN: 61002
  }
};

const ROLE_CONSTS = {
  STAR_GROWTH: {
    1: 1, 2: 1.5, 3: 2, 4: 2.5, 5: 3,
    6: 3.15, 7: 3.3, 8: 3.45, 9: 3.6, 10: 3.75,
    11: 3.9, 12: 4.05, 13: 4.2, 14: 4.35, 15: 4.5,
    16: 4.8, 17: 5.1, 18: 5.4, 19: 5.7, 20: 6
  },
  AWAKE_GROWTH: {
    0: 0, 1: 0.05, 2: 0.1, 3: 0.15, 4: 0.2, 5: 0.25,
    6: 0.3, 7: 0.35, 8: 0.4, 9: 0.45, 10: 0.5,
    11: 0.55, 12: 0.6, 13: 0.65, 14: 0.7, 15: 0.75,
    16: 0.8, 17: 0.85, 18: 0.9, 19: 0.95, 20: 1
  },
  EQUIVALENT_SOULS: [0, 10, 30, 80, 180, 330],
  MAX_STAR: 5,
  MAX_AWAKE_LEVEL: 20,
  MAX_BREAK: 15,
  EVOLVE_SKILL_NEED_STAR: 10,
  EVOLVE_SKILL_NEED_LEVEL: 50,
  EVOLVE_SKILL_RATE: 0.7,
  EVOLVE_SKILL_INCREASE_RATE: 0.1,
  EVOLVE_SKILL_INCREASE_RATE_COST_GEMS: [0, 300, 600, 900],
  UPGRADE_AWAKE_LEVEL_RATE: 0.7,
  UPGRADE_AWAKE_LEVEL_INCREASE_RATE: 0.1,
  UPGRADE_AWAKE_LEVEL_INCREASE_RATE_COST_GEMS: [0, 300, 600, 900],
  UPGRADE_AWAKE_LEVEL_COST_SOUL: 50,
  UPGRADE_AWAKE_LEVEL_COST_COIN: 2000000,
  TRAIN_UNLOCK_COST: { ID: 95, COUNT: 100 },
  TRAIN_COST: { SOUL: 80, GEM: 600, COIN: 3000000, STONE: { ID: 96, COUNT: 100 } },
  RESET_TRAIN_COST_GEM: 500
};

const ROLE_FUNS = {
  getMaxLevel(playerLevel) {
    return playerLevel <= 10 ? playerLevel + 5 : playerLevel < 20 ? 20 : playerLevel;
  },
  getUpgradeCost(star) {
    return {
      coin: [0, 35000, 120000, 300000, 800000, 3000000, 3000000, 3000000, 3000000, 3000000, 5000000, 5000000, 5000000, 5000000, 5000000, 8000000, 8000000, 8000000, 8000000, 8000000][star] || 0,
      soul: [0, 20, 50, 100, 150, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 100, 100, 100, 100, 100][star] || 0,
      gem: [0, 0, 0, 0, 0, 1000, 1000, 1000, 1000, 1000, 1500, 1500, 1500, 1500, 1500, 2000, 2000, 2000, 2000, 2000][star] || 0,
      sixCoin: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1000, 1000, 1000, 1000, 1000][star] || 0,
      isSelf: !![0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1][star]
    };
  },
  getComposeRoleCost(star) {
    return {
      coin: [0, 1000, 35000, 120000][star] || 1000,
      soul: [0, 10, 30, 80][star] || 10
    };
  },
  getPower(attr, skillLevelSum, star) {
    let p = 0.1 * (attr.hp || 0) + (attr.atk || 0) + (attr.def || 0) + (attr.mdef || 0);
    p += 2 * (attr.hit || 0) + 2 * (attr.dodge || 0) + 2 * (attr.crit || 0);
    p += 30 * (skillLevelSum || 0);
    p += 5000 * (star || 1);
    return Math.floor(p);
  }
};

const EQUIPMENTS = {
  CONSTS: {
    EVOLVE_COST_COINS: [0, 0, 100, 500, 1000, 2000, 5000, 6000, 8000, 10000, 12000, 14000, 150000, 200000, 300000, 500000, 600000, 1000000, 1500000, 2000000, 3000000],
    EVL_ITEM_TYPES: ["evlItem_1", "evlItem_2", "evlItem_3", "evlItem_4", "evlItem_5", "evlItem_6"],
    STONE_ITEM_TYPES: ["stoneItem_1", "stoneItem_2", "stoneItem_3", "stoneItem_4", "stoneItem_5", "stoneItem_6"],
    ARTIFACT_ITEM_TYPES: ["artifactItem_1", "artifactItem_2", "artifactItem_3"],
    CAPSULE_ITEM_TYPES: ["capsuleItem_1", "capsuleItem_2", "capsuleItem_3"],
    STAR_SIGN_ITEM_TYPES: ["starSignItem_1", "starSignItem_2", "starSignItem_3", "starSignItem_4"]
  },
  FUNS: {
    getUpgradeCost(level) {
      const row = dataApi.findCostByLevel(level);
      return row ? row.eqpUpgradeCoin : 1000;
    },
    getEvolveCost(color) {
      return EQUIPMENTS.CONSTS.EVOLVE_COST_COINS[color] || 0;
    }
  }
};

const SKILL = {
  CONSTS: {
    UN_LOCK_COLOR: { 1: 0, 2: 1, 4: 2, 7: 3 }
  },
  FUNS: {
    getUpgradeCost(level) {
      const row = dataApi.findCostByLevel(level);
      return row ? row.skillUpgradeCoin : 1000;
    },
    getAwakeUpgradeCost(level) {
      const row = dataApi.findCostByLevel(100 + level);
      return row ? row.skillUpgradeCoin : 10000;
    },
    getShipUpgradeCost(level) {
      const row = dataApi.findCostByLevel(level);
      return row ? 5 * row.skillUpgradeCoin : 5000;
    }
  }
};

const PLAYER = {
  CONSTS: {
    MAX_LEVEL: 100,
    RE_NAME_COST_GEM: 100,
    BUY_ACTION_POINT: 120,
    BUY_SKILL_POINT: 10,
    BUY_SKILL_COST_GEMS: [0, 10, 20, 20, 20, 40, 40, 40, 40, 40, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 200]
  },
  FUNS: {
    getActionPointMax(playerLevel) {
      return 60 + playerLevel;
    },
    getBuyActionPointCost(times) {
      const a = [0, 50, 50, 50, 100, 100, 100, 200, 200, 200, 400];
      return a[times] || a[a.length - 1];
    },
    getBuyCoinCost(times) {
      const a = [0, 10, 20, 20, 20, 40, 40, 40, 40, 40, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 200];
      return a[times] || a[a.length - 1];
    },
    getBuyCoin(vipLevel, playerLevel) {
      const unit = Math.floor((30000 + 100 * playerLevel) * Math.pow(vipLevel + 1, 0.35) / 2.23);
      const r = Math.random();
      let ratio = 1;
      if (r <= 0.001) ratio = 10;
      else if (r <= 0.011) ratio = 5;
      else if (r <= 0.061) ratio = 3;
      else if (r <= 0.211) ratio = 2;
      return { coin: unit * ratio, ratio };
    },
    getBuySkillPointCost(times) {
      const a = PLAYER.CONSTS.BUY_SKILL_COST_GEMS;
      return a[times] || a[a.length - 1];
    },
    getUpgradeIncreaseActionPoint(level) {
      if (level <= 7) return 20;
      if (level <= 11) return 30;
      if (level <= 20) return 40;
      if (level <= 30) return 60;
      if (level <= 40) return 80;
      if (level <= 50) return 100;
      return 120;
    }
  }
};

const DROP = {
  FUNS: {
    getDropListByDesc(desc) {
      if (!desc) return [];
      const list = [];
      for (const part of String(desc).split(",")) {
        if (!part.trim()) continue;
        const [left, cntStr] = part.split("x");
        const segs = left.split("_");
        const entityId = Number(segs[0]);
        const count = Number(cntStr);
        if (!isNaN(entityId) && !isNaN(count)) {
          if (segs.length > 2) {
            list.push({ entityId, extra: { [segs[1]]: Number(segs[2]) }, count });
          } else {
            list.push({ entityId, count });
          }
        }
      }
      return list;
    }
  }
};

const SHOP = {
  CONSTS: {
    TYPE: {
      NORMAL: 1, ARENA: 2, EXPEDITION: 3, VIP: 4, ARENA_3V3: 5,
      GUILD: 6, PRACTICE: 7, ARTIFACT: 8, SIX_PATH: 9, SHIP: 10,
      FRUIT: 11, ISLAND: 12, TOP_ARENA_3V3: 13, STAR_SIGN: 14
    },
    REFRESH_COST_MONEY_MAP: {
      1: [0, 50, 100, 100, 200],
      2: [0, 50, 100, 100, 200],
      3: [0, 50, 100, 100, 200],
      4: [0, 50, 100, 100, 200],
      5: [0, 50, 100, 100, 200],
      6: [0, 50, 100, 100, 200],
      7: [0, 50, 100, 100, 200],
      8: [0, 50, 100, 100, 200],
      9: [0, 200],
      10: [0, 200],
      11: [0, 50, 50, 100],
      12: [0, 100, 100, 150, 200],
      13: [0, 50, 100, 100, 200],
      14: [0, 50, 100, 100, 200]
    },
    REFRESH_MONEY_ID_MAP: {
      1: 102, 2: 103, 3: 105, 4: 102, 5: 106, 6: 107, 7: 111,
      8: 102, 9: 102, 10: 118, 11: 122, 12: 20, 13: 102, 14: 102
    }
  }
};

const TASK = {
  CONSTS: {
    ACTIVE_REWARD_MAP: {
      daily: {
        50: [{ entityId: 21001, count: 5 }, { entityId: 101, count: 100000 }, { entityId: 20002, count: 5 }, { entityId: 49902, count: 5 }],
        100: [{ entityId: 21001, count: 10 }, { entityId: 101, count: 200000 }, { entityId: 108, count: 500 }, { entityId: 49904, count: 5 }],
        150: [{ entityId: 21001, count: 15 }, { entityId: 60007, count: 50 }, { entityId: 49907, count: 5 }, { entityId: 49912, count: 5 }],
        200: [{ entityId: 172, count: 1 }, { entityId: 21001, count: 20 }, { entityId: 100, count: 100 }, { entityId: 49907, count: 10 }, { entityId: 49912, count: 10 }]
      },
      weekly: {
        500: [{ entityId: 49907, count: 20 }, { entityId: 111, count: 500 }, { entityId: 102, count: 500 }, { entityId: 101, count: 500000 }],
        850: [{ entityId: 49912, count: 20 }, { entityId: 112, count: 500 }, { entityId: 102, count: 1000 }, { entityId: 101, count: 1000000 }],
        1250: [{ entityId: 49915, count: 20 }, { entityId: 116, count: 500 }, { entityId: 102, count: 1500 }, { entityId: 101, count: 1500000 }]
      }
    }
  }
};

const POINT = {
  CONSTS: {
    GEM_COST: 280,
    GEM_TEN_COST: 2520,
    GEM_FREE_TIME: 172800000,
    GEM_TICKET_ID: 120,
    COIN_COST: 10000,
    COIN_TEN_COST: 90000,
    COIN_FREE_TIME: 300000,
    COIN_DAILY_FREE_TIMES: 5
  }
};

module.exports = {
  CONSTS,
  ROLE: { CONSTS: ROLE_CONSTS, FUNS: ROLE_FUNS },
  EQUIPMENTS,
  SKILL,
  PLAYER,
  DROP,
  SHOP,
  TASK,
  POINT
};
