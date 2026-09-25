/* 探方档案：探方、层位、遗物的唯一数据来源。
 * 负责 localStorage 持久化、旧版潜水标记迁移、发布快照冻结、JSON 导出。 */
window.Archive = (function () {
  const KEY = "zfl30Archive";
  let state = load();

  function load() {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try { return JSON.parse(raw); } catch { /* 损坏数据按空档案重建 */ }
    }
    const seeded = seed();
    localStorage.setItem(KEY, JSON.stringify(seeded));
    return seeded;
  }

  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  function uid(prefix) {
    return (prefix || "id") + "-" + crypto.randomUUID().slice(0, 8);
  }

  /* 首次使用：造一套可演示的探方档案；
   * 若旧版 zfl30Marks 有数据，迁移为 T1 探方遗物并按深度归入已确认层位。 */
  function seed() {
    const fresh = {
      trenches: [
        {
          id: "t1", code: "T1", name: "沉船右舷主探方",
          datum: "海面基准", opened: "DIVE-01", note: "覆盖中部货舱外侧堆积。",
          snapshot: null,
          layers: [
            { id: "l1", code: "①", top: 17.6, bottom: 18.0, sediment: "深灰淤泥，贝壳碎屑，松散" },
            { id: "l2", code: "②", top: 18.0, bottom: 18.6, sediment: "青灰粉砂夹少量陶片，较致密" },
            { id: "l3", code: "③", top: 18.6, bottom: 19.2, sediment: "粗砂与压舱石混杂，含朽木" },
            { id: "l4", code: "④", top: 19.2, bottom: 19.6, sediment: "黄褐色黏砂，遗物稀少" }
          ],
          marks: [
            { id: uid("m"), code: "A-017", type: "ceramic", dive: "DIVE-01", x: 42, y: 46, depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋", layerId: null },
            { id: uid("m"), code: "W-003", type: "wood", dive: "DIVE-02", x: 58, y: 39, depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁", layerId: null }
          ]
        },
        {
          id: "t2", code: "T2", name: "艉部试掘方",
          datum: "海面基准", opened: "DIVE-03", note: "艉楼塌陷区，层位待补全。",
          snapshot: null,
          layers: [
            { id: uid("l"), code: "Ⅰ", top: 16.4, bottom: 16.8, sediment: "表层淤砂，含现代缆绳" },
            { id: uid("l"), code: "Ⅰ", top: 16.8, bottom: 17.1, sediment: "腐泥（层号待核）" }
          ],
          marks: []
        }
      ]
    };

    // 旧版单文件标记（zfl30Marks）迁移：并入 T1，深度落在确认剖面内的自动归层
    const legacy = JSON.parse(localStorage.getItem("zfl30Marks") || "null");
    if (Array.isArray(legacy) && legacy.length) {
      const t1 = fresh.trenches[0];
      const prof = Strata.profile(t1.layers);
      const seen = new Set(t1.marks.map(m => m.code));
      legacy.forEach(old => {
        if (seen.has(old.code)) return;
        seen.add(old.code);
        const host = Strata.containing(prof, old.depth);
        t1.marks.push(Object.assign({}, old, { id: uid("m"), layerId: host ? host.id : null }));
      });
    }
    t1LayerAutoAssign(fresh);
    return fresh;
  }

  function t1LayerAutoAssign(fresh) {
    const t1 = fresh.trenches[0];
    const prof = Strata.profile(t1.layers);
    t1.marks.forEach(m => { if (!m.layerId) {
      const host = Strata.containing(prof, m.depth);
      m.layerId = host ? host.id : null;
    }});
  }

  // —— 探方 ——
  function getTrenches() { return state.trenches; }
  function trench(id) { return state.trenches.find(t => t.id === id) || null; }

  function upsertTrench(data) {
    let t = data.id ? trench(data.id) : null;
    if (!t) {
      t = { id: uid("t"), code: "", name: "", datum: "", opened: "", note: "", snapshot: null, layers: [], marks: [] };
      state.trenches.push(t);
    }
    t.code = (data.code || "").trim();
    t.name = (data.name || "").trim();
    t.datum = (data.datum || "").trim();
    t.opened = (data.opened || "").trim();
    t.note = (data.note || "").trim();
    save();
    return t;
  }

  // —— 层位 ——
  function upsertLayer(trenchId, data) {
    const t = trench(trenchId);
    if (!t) return null;
    let layer = data.id ? t.layers.find(l => l.id === data.id) : null;
    if (!layer) {
      layer = { id: uid("l"), code: "", top: NaN, bottom: NaN, sediment: "" };
      t.layers.push(layer);
    }
    layer.code = data.code.trim();
    layer.top = Number(data.top);
    layer.bottom = Number(data.bottom);
    layer.sediment = data.sediment.trim();

    // 关系/约深变动后以判定结果为准重排；遗物只留在已确认层位。
    // 原归属仍确认的保留；未归属或因此失效的，按遗物深度重新匹配（后续层位重排）。
    const prof = Strata.profile(t.layers);
    const confirmedIds = new Set(prof.map(l => l.id));
    t.marks.forEach(m => {
      if (m.layerId && confirmedIds.has(m.layerId)) return;
      const host = Strata.containing(prof, m.depth);
      m.layerId = host ? host.id : null;
    });
    save();
    return { layer, profile: prof };
  }

  function deleteLayer(trenchId, layerId) {
    const t = trench(trenchId);
    if (!t) return;
    t.layers = t.layers.filter(l => l.id !== layerId);
    t.marks.forEach(m => { if (m.layerId === layerId) m.layerId = null; });
    save();
  }

  // —— 遗物（潜水标记）——
  function upsertMark(trenchId, data) {
    const t = trench(trenchId);
    if (!t) return null;
    let mark = data.id ? t.marks.find(m => m.id === data.id) : null;
    if (!mark) {
      mark = { id: uid("m") };
      t.marks.push(mark);
    }
    Object.assign(mark, data);
    // 遗物只归到已确认层位；所选层位无效时退回按深度匹配
    const prof = Strata.profile(t.layers);
    let host = prof.find(l => l.id === data.layerId);
    if (!host) host = Strata.containing(prof, mark.depth);
    mark.layerId = host ? host.id : null;
    save();
    return mark;
  }

  function deleteMark(trenchId, markId) {
    const t = trench(trenchId);
    if (!t) return;
    t.marks = t.marks.filter(m => m.id !== markId);
    save();
  }

  // —— 发布：冻结确认剖面与遗物归属，不静默改值 ——
  function publish(trenchId) {
    const t = trench(trenchId);
    if (!t) return null;
    const prof = Strata.profile(t.layers);
    t.snapshot = {
      at: new Date().toISOString(),
      layers: prof.map((l, i) => ({
        id: l.id, code: l.code, seq: i + 1,
        top: l.top, bottom: l.bottom, sediment: l.sediment
      })),
      relics: t.marks.map(m => ({ id: m.id, code: m.code, layerId: m.layerId || null }))
    };
    save();
    return t.snapshot;
  }

  function diff(trenchId) {
    const t = trench(trenchId);
    if (!t || !t.snapshot) return null;
    return Strata.publishDiff(t.snapshot, t.layers, t.marks);
  }

  // —— 导出 ——
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "underwater-archive.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return {
    save, getTrenches, trench, upsertTrench,
    upsertLayer, deleteLayer, upsertMark, deleteMark,
    publish, diff, exportJSON
  };
})();
