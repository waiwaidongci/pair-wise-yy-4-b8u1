/* 层位判定：层号、顶底深度与上下关系校验，确认剖面生成，已发布剖面差异计算。
 * 纯业务逻辑，不接触 DOM，可被页面与探方档案复用。 */
window.Strata = (function () {
  const TOL = 0.02; // 深度接触容差（米），顶底相接视为连续接触

  /**
   * 判定一个探方内全部层位的问题。
   * @returns {Object<string, string[]>} 层位 id -> 问题描述列表；无问题即“已确认”，可进入剖面。
   * 不进入剖面的三种情形：深度区间重叠、层号重复、上下关系缺失；另附深度倒置/数据缺失检查。
   */
  function reasonMap(layers) {
    const reasons = Object.create(null);
    const add = (id, text) => { (reasons[id] ||= []).push(text); };

    // 一、顶底深度必须可解析且顶深小于底深
    const sane = [];
    layers.forEach(l => {
      if (!Number.isFinite(l.top) || !Number.isFinite(l.bottom) || l.top >= l.bottom) {
        add(l.id, "顶深须小于底深");
      } else {
        sane.push(l);
      }
    });

    // 二、层号重复（空层号不在此列，由表单必填约束）
    const codeGroups = Object.create(null);
    layers.forEach(l => {
      const code = (l.code || "").trim();
      if (code) (codeGroups[code] ||= []).push(l);
    });
    const dupIds = new Set();
    Object.values(codeGroups).forEach(group => {
      if (group.length > 1) group.forEach(l => {
        dupIds.add(l.id);
        add(l.id, "层号 “" + group[0].code.trim() + "” 重复");
      });
    });

    // 三、深度区间重叠（只在层号唯一、深度正常的层位之间判定，边界相接不算重叠）
    const candidates = sane.filter(l => !dupIds.has(l.id));
    const overlapIds = new Set();
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i], b = candidates[j];
        if (a.top < b.bottom - TOL && b.top < a.bottom - TOL) {
          overlapIds.add(a.id);
          overlapIds.add(b.id);
          add(a.id, "与 " + b.code + " 的深度区间重叠");
          add(b.id, "与 " + a.code + " 的深度区间重叠");
        }
      }
    }

    // 四、上下关系：无重叠层位按顶深排序，相邻层位必须接触，间隔即上下关系缺失
    const chain = candidates
      .filter(l => !overlapIds.has(l.id))
      .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
    for (let i = 0; i < chain.length - 1; i++) {
      const up = chain[i], down = chain[i + 1];
      if (up.bottom < down.top - TOL) {
        const gap = (down.top - up.bottom).toFixed(2);
        add(up.id, "与下伏 " + down.code + " 之间缺失 " + gap + "m，接触关系不成立");
        add(down.id, "与上覆 " + up.code + " 之间缺失 " + gap + "m，接触关系不成立");
      }
    }

    return reasons;
  }

  /** 已确认层位 = 无任何问题；自浅而深排序，即确认剖面。 */
  function profile(layers) {
    const reasons = reasonMap(layers);
    return layers
      .filter(l => !reasons[l.id])
      .sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  }

  function reasonsOf(layers, id) {
    return reasonMap(layers)[id] || [];
  }

  /** 按遗物深度匹配已确认层位；恰好压在界线上时归入下伏层。 */
  function containing(confirmedLayers, depth) {
    const d = Number.parseFloat(depth);
    if (!Number.isFinite(d)) return null;
    let hit = null;
    confirmedLayers.forEach(l => {
      if (d >= l.top - TOL && d <= l.bottom + TOL) {
        if (!hit || l.top > hit.top) hit = l;
      }
    });
    return hit;
  }

  /**
   * 已发布剖面（快照）与当前工作数据的差异。
   * 发布值冻结，改深度/层号/沉积描述或调整关系只会记进差异，不静默覆盖快照。
   * @param {{at:string, layers:Array, relics:Array}} snapshot publishTrench 产出的快照
   * @param {Array} layers 该探方当前全部层位
   * @param {Array} marks 该探方当前全部遗物
   */
  function publishDiff(snapshot, layers, marks) {
    const reasons = reasonMap(layers);
    const prof = profile(layers);
    const now = new Map(prof.map((l, i) => [l.id, Object.assign({}, l, { seq: i + 1 })]));
    const old = new Map((snapshot.layers || []).map(l => [l.id, l]));

    const added = [], removed = [], changed = [], reordered = [];
    for (const [id, l] of now) {
      if (!old.has(id)) added.push(l);
    }
    for (const [id, o] of old) {
      const cur = layers.find(l => l.id === id);
      if (!cur) { removed.push({ snapshot: o, deleted: true, reasons: ["层位已删除"] }); continue; }
      if (!now.has(id)) removed.push({ snapshot: o, deleted: false, reasons: reasons[id] || [] });
      // 字段改值对快照中的每个层位检测；即使该层已退出剖面也要列出，不静默改值
      const fields = [];
      if (cur.code !== o.code) fields.push({ field: "层号", from: o.code, to: cur.code });
      if (Math.abs(cur.top - o.top) > TOL) fields.push({ field: "顶深", from: o.top.toFixed(2), to: cur.top.toFixed(2) });
      if (Math.abs(cur.bottom - o.bottom) > TOL) fields.push({ field: "底深", from: o.bottom.toFixed(2), to: cur.bottom.toFixed(2) });
      if ((cur.sediment || "") !== (o.sediment || "")) fields.push({ field: "沉积描述", from: o.sediment || "—", to: cur.sediment || "—" });
      if (fields.length) changed.push({ layer: cur, fields });
      const live = now.get(id);
      if (live && live.seq !== o.seq) reordered.push({ layer: live, from: o.seq, to: live.seq });
    }

    // 受影响遗物：归属变化、归属层位退出剖面、所属层位改值或位次变化、遗物本身新增/删除
    const oldRelics = new Map((snapshot.relics || []).map(r => [r.id, r]));
    const cur = new Map(marks.map(m => [m.id, m]));
    const touchedLayerIds = new Set([
      ...added.map(l => l.id),
      ...changed.map(c => c.layer.id),
      ...reordered.map(r => r.layer.id)
    ]);
    const relicChanges = [];
    for (const [id, m] of cur) {
      const o = oldRelics.get(id);
      const ol = o ? (o.layerId || null) : null;
      const nl = m.layerId || null;
      const text = [];
      if (!o) text.push("新增遗物");
      if (!o || ol !== nl) {
        text.push("归属层位：" + (old.get(ol) ? old.get(ol).code : "未归属")
          + " → " + (now.get(nl) ? now.get(nl).code : "未归属（层位未确认/已失效）"));
      }
      const host = now.get(nl);
      if (host) {
        const ch = changed.find(c => c.layer.id === nl);
        if (ch) text.push("所属层位 " + host.code + " 改值：" + ch.fields.map(f => f.field + " " + f.from + "→" + f.to).join("、"));
        const ro = reordered.find(r => r.layer.id === nl);
        if (ro) text.push("所属层位位次：第 " + ro.from + " 层 → 第 " + ro.to + " 层");
      }
      if (text.length) relicChanges.push({ mark: m, text: text.join("；") });
    }
    for (const [id, o] of oldRelics) {
      if (!cur.has(id)) {
        const host = old.get(o.layerId);
        relicChanges.push({ mark: o, text: "遗物已删除（原归属 " + (host ? host.code : "未归属") + "）" });
      }
    }

    const hasChanges = !!(added.length || removed.length || changed.length
      || reordered.length || relicChanges.length);
    return { added, removed, changed, reordered, relicChanges, hasChanges };
  }

  return { TOL, reasonMap, profile, reasonsOf, containing, publishDiff };
})();
