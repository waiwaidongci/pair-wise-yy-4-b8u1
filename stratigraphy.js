/* 层位判定：校验层位、生成剖面、计算发布影响。纯逻辑，不操作页面。 */
const Stratigraphy = (() => {
  const toNum = value => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  };

  const fmt = value => {
    const n = toNum(value);
    return n === null ? "?" : n.toFixed(2);
  };

  // 判定一个探方内的全部层位，返回带 ok / reasons / top / bottom 的副本
  function evaluateLayers(layers, squareId) {
    const result = layers
      .filter(l => l.square === squareId)
      .map(l => ({ ...l, top: toNum(l.topDepth), bottom: toNum(l.bottomDepth), ok: true, reasons: [] }));
    const reject = (l, reason) => {
      l.ok = false;
      if (!l.reasons.includes(reason)) l.reasons.push(reason);
    };

    // 顶底深度必须有效且顶浅于底
    result.forEach(l => {
      if (l.top === null || l.bottom === null || l.top >= l.bottom) reject(l, "顶底深度无效");
    });

    // 层号在同一探方内不得重复
    const byNo = new Map();
    result.forEach(l => {
      const key = String(l.layerNo || "").trim();
      if (!key) {
        reject(l, "层号缺失");
        return;
      }
      if (!byNo.has(key)) byNo.set(key, []);
      byNo.get(key).push(l);
    });
    byNo.forEach(group => {
      if (group.length > 1) group.forEach(l => reject(l, "层号重复"));
    });

    // 深度区间不得互相重叠（上下相接允许）
    const valid = result.filter(l => l.top !== null && l.bottom !== null && l.top < l.bottom);
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i];
        const b = valid[j];
        if (a.top < b.bottom && b.top < a.bottom) {
          reject(a, "深度区间重叠");
          reject(b, "深度区间重叠");
        }
      }
    }

    // 上下关系：最上层直接出露地表，其余各层必须挂接紧邻的已确认上层；
    // 关系缺失或断裂的层位不进入剖面，其下方各层也随之失去依托
    const candidates = valid.filter(l => l.ok).sort((a, b) => a.top - b.top);
    let lastConfirmed = null;
    candidates.forEach(l => {
      const above = l.aboveId || "";
      if (!lastConfirmed) {
        if (above) reject(l, "上下关系缺失");
        else lastConfirmed = l;
      } else if (above !== lastConfirmed.id) {
        reject(l, "上下关系缺失");
      } else {
        lastConfirmed = l;
      }
    });

    return result;
  }

  // 剖面：仅确认层位，按顶深排序并重新编号（深度或关系改动后后续层位自动重排）
  function buildProfile(layers, squareId) {
    return evaluateLayers(layers, squareId)
      .filter(l => l.ok)
      .sort((a, b) => a.top - b.top)
      .map((l, i) => ({ ...l, seq: i + 1 }));
  }

  // 发布影响：当前剖面与发布快照的差异，以及受波及的遗物
  function computeImpact(profile, marks, published) {
    const affectedLayers = [];
    const affectedMarks = [];
    if (!published) return { affectedLayers, affectedMarks };
    const curById = new Map(profile.map(l => [l.id, l]));
    const pubById = new Map(published.layers.map(l => [l.id, l]));
    const noOf = (map, id) => {
      const l = map.get(id);
      return l ? l.layerNo : "（已删除）";
    };

    profile.forEach(cur => {
      const pub = pubById.get(cur.id);
      if (!pub) {
        affectedLayers.push({ id: cur.id, layerNo: cur.layerNo, changes: ["新增层位"] });
        return;
      }
      const changes = [];
      if (pub.layerNo !== cur.layerNo) changes.push("层号 " + pub.layerNo + "→" + cur.layerNo);
      if (fmt(pub.topDepth) !== fmt(cur.top) || fmt(pub.bottomDepth) !== fmt(cur.bottom)) {
        changes.push("深度 " + fmt(pub.topDepth) + "–" + fmt(pub.bottomDepth) + "m→" + fmt(cur.top) + "–" + fmt(cur.bottom) + "m");
      }
      if ((pub.aboveId || "") !== (cur.aboveId || "")) {
        const from = pub.aboveId ? noOf(pubById, pub.aboveId) : "地表";
        const to = cur.aboveId ? noOf(curById, cur.aboveId) : "地表";
        changes.push("上层 " + from + "→" + to);
      }
      if (pub.seq !== cur.seq) changes.push("序次 #" + pub.seq + "→#" + cur.seq);
      if ((pub.sediment || "") !== (cur.sediment || "")) changes.push("沉积描述变更");
      if (changes.length) affectedLayers.push({ id: cur.id, layerNo: cur.layerNo, changes });
    });
    published.layers.forEach(pub => {
      if (!curById.has(pub.id)) affectedLayers.push({ id: pub.id, layerNo: pub.layerNo, changes: ["退出剖面"] });
    });

    const affectedLayerIds = new Set(affectedLayers.map(a => a.id));
    const confirmedIds = new Set(profile.map(l => l.id));
    marks.forEach(m => {
      const pubArt = published.artifacts.find(a => a.id === m.id);
      let reason = "";
      if (m.layerId && affectedLayerIds.has(m.layerId)) reason = "所属层位受影响";
      else if (m.layerId && !confirmedIds.has(m.layerId)) reason = "所属层位已失效";
      else if (pubArt && (pubArt.layerId || "") !== (m.layerId || "")) reason = "归层发生变更";
      else if (!m.layerId && pubArt) reason = "已解除归层";
      if (reason) affectedMarks.push({ id: m.id, code: m.code, reason });
    });
    published.artifacts.forEach(a => {
      if (!marks.some(m => m.id === a.id)) affectedMarks.push({ id: a.id, code: a.code, reason: "已从记录中删除" });
    });

    return { affectedLayers, affectedMarks };
  }

  return { evaluateLayers, buildProfile, computeImpact, fmt };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Stratigraphy;
