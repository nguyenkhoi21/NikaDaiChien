const fs = require("fs");
const path = require("path");

const TABLES_DIR = path.join(__dirname, "..", "data", "tables");

class Table {
  constructor(rows) {
    this.data = {};
    if (!Array.isArray(rows) || rows.length === 0) return;
    const cols = rows[0];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const obj = {};
      for (let c = 0; c < cols.length; c++) {
        obj[cols[c]] = row[c];
      }
      this.data[obj.kindId] = obj;
    }
  }

  findBy(key, val) {
    const out = [];
    for (const k in this.data) {
      if (this.data[k][key] == val) out.push(this.data[k]);
    }
    return out;
  }

  findOneBy(key, val) {
    for (const k in this.data) {
      if (this.data[k][key] == val) return this.data[k];
    }
    return null;
  }

  findByOpts(opts) {
    const match = (a, b) => {
      for (const k in a) {
        if (typeof a[k] === "object" && a[k] !== null && b[k] != null) {
          if (!match(a[k], b[k])) return false;
        } else if (b[k] != a[k]) {
          return false;
        }
      }
      return true;
    };
    const out = [];
    for (const k in this.data) {
      if (match(opts, this.data[k])) out.push(this.data[k]);
    }
    return out;
  }

  findById(id) {
    if (id === null || id === undefined) return null;
    return this.data[id] || null;
  }

  all() {
    return this.data;
  }
}

const dataApi = {
  dropExt: {},
  robotExt: {},
  taskExt: { main: {}, daily: {}, achievement: {} }
};

function initDataApi() {
  if (!fs.existsSync(TABLES_DIR)) {
    throw new Error(`Tables directory missing: ${TABLES_DIR}`);
  }
  const files = fs.readdirSync(TABLES_DIR).filter((f) => f.endsWith("Data.json"));
  for (const file of files) {
    const name = file.slice(0, -9); // strip "Data.json"
    const raw = JSON.parse(fs.readFileSync(path.join(TABLES_DIR, file), "utf-8"));
    dataApi[name] = new Table(raw);
  }

  // Merge entityExt into entity
  if (dataApi.entityExt && dataApi.entity) {
    const extAll = dataApi.entityExt.all();
    const entAll = dataApi.entity.all();
    for (const k in extAll) entAll[extAll[k].kindId] = extAll[k];
  }

  // Merge mobExt into mob
  if (dataApi.mobExt && dataApi.mob) {
    const extAll = dataApi.mobExt.all();
    const mobAll = dataApi.mob.all();
    for (const k in extAll) mobAll[extAll[k].kindId] = extAll[k];
  }

  // Merge entity base properties into typed tables (role, soul, stone, etc.)
  if (dataApi.entity) {
    const entAll = dataApi.entity.all();
    for (const k in entAll) {
      const u = entAll[k];
      u.extra = u.extra || {};
      if (u.type && dataApi[u.type] && typeof dataApi[u.type].findById === "function") {
        const sub = dataApi[u.type].findById(u.kindId);
        if (sub) {
          for (const p in u) sub[p] = u[p];
        }
      }
    }
  }

  // Link smap <-> bmap
  if (dataApi.smap && dataApi.bmap) {
    const smaps = dataApi.smap.all();
    for (const k in smaps) {
      const sm = smaps[k];
      sm.bmap = dataApi.bmap.findById(sm.bmapId);
      if (Array.isArray(sm.showEntityIds)) {
        sm.showEntityIds = sm.showEntityIds.filter((x) => x !== 0);
      }
      if (typeof sm.position === "string" && sm.position.includes(",")) {
        const [x, y] = sm.position.split(",");
        sm.position = { x: Number(x), y: Number(y) };
      }
    }
    const bmaps = dataApi.bmap.all();
    for (const k in bmaps) {
      const bm = bmaps[k];
      bm.smaps = dataApi.smap.findBy("bmapId", bm.kindId).sort((a, b) => a.rankId - b.rankId);
    }
  }

  // Build dropExt
  if (dataApi.drop) {
    const dropAll = dataApi.drop.all();
    const dropExt = {};
    for (const k in dropAll) {
      const d = dropAll[k];
      dropExt[d.classId] = dropExt[d.classId] || {};
      dropExt[d.classId][d.groupId] = dropExt[d.classId][d.groupId] || [];
      dropExt[d.classId][d.groupId].push(d);
    }
    dataApi.dropExt = dropExt;
  }

  // Build robotExt
  if (dataApi.robot) {
    const robAll = dataApi.robot.all();
    const robExt = {};
    for (const k in robAll) {
      const r = robAll[k];
      const rk = Array.isArray(r.rankRange) ? r.rankRange[0] : r.miniRange;
      robExt[rk] = robExt[rk] || {};
      robExt[rk][r.positionType] = r;
    }
    dataApi.robotExt = robExt;
  }

  // Build taskExt
  if (dataApi.task) {
    const taskAll = dataApi.task.all();
    const taskExt = { main: {}, daily: {}, achievement: {} };
    for (const k in taskAll) {
      const t = taskAll[k];
      if (t.type === 1) {
        taskExt.main[t.groupId] = taskExt.main[t.groupId] || {};
        taskExt.main[t.groupId][t.rankId] = t;
      } else if (t.type === 2) {
        taskExt.daily[t.groupId] = taskExt.daily[t.groupId] || {};
        taskExt.daily[t.groupId][t.rankId] = t;
      } else if (t.type === 3) {
        taskExt.achievement[t.groupId] = taskExt.achievement[t.groupId] || {};
        taskExt.achievement[t.groupId][t.rankId] = t;
      }
    }
    dataApi.taskExt = taskExt;
  }

  console.log(`[DataLoader] Loaded ${files.length} tables (roles=${Object.keys(dataApi.role.all()).length}, entities=${Object.keys(dataApi.entity.all()).length}, smaps=${Object.keys(dataApi.smap.all()).length})`);
}

dataApi.findEntityById = function (id) {
  const a = dataApi.entity.findById(id);
  if (a && a.type && dataApi[a.type] && typeof dataApi[a.type].findById === "function") {
    return dataApi[a.type].findById(a.kindId) || a;
  }
  return a;
};

dataApi.findDropByClassId = function (classId) {
  return dataApi.dropExt[classId];
};

dataApi.findExperienceByLevel = function (level) {
  return dataApi.experience.findOneBy("level", level);
};

dataApi.findCostByLevel = function (level) {
  return dataApi.cost.findOneBy("level", level);
};

dataApi.findSoulByClassId = function (classId) {
  return dataApi.soul.findOneBy("classId", classId);
};

initDataApi();

module.exports = dataApi;
