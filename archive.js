/* 探方档案：探方、层位、遗物与发布快照的登记和持久化。 */
const Archive = (() => {
  const MARKS_KEY = "zfl30Marks";
  const ARCHIVE_KEY = "zfl30Archive";

  const load = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  };

  let marks = load(MARKS_KEY, null);
  let archive = load(ARCHIVE_KEY, null);

  if (!archive) {
    archive = {
      squares: [
        { id: "SQ-T1", name: "T1", note: "船体西北侧，水深约18m" },
        { id: "SQ-T2", name: "T2", note: "船艏东侧，水深约19m" }
      ],
      layers: [
        { id: "LY-T1-1", square: "SQ-T1", layerNo: "L1", topDepth: 0, bottomDepth: 0.35, aboveId: "", sediment: "灰色粉砂质淤泥，疏松，含少量贝壳" },
        { id: "LY-T1-2", square: "SQ-T1", layerNo: "L2", topDepth: 0.35, bottomDepth: 0.8, aboveId: "LY-T1-1", sediment: "黄褐色细砂，夹贝壳碎屑" },
        { id: "LY-T1-3", square: "SQ-T1", layerNo: "L3", topDepth: 0.8, bottomDepth: 1.25, aboveId: "LY-T1-2", sediment: "文化层，含陶片、木炭与骨渣" }
      ],
      published: {}
    };
    persistArchive();
  }
  if (!marks) {
    marks = [
      { id: crypto.randomUUID(), code: "A-017", type: "ceramic", dive: "DIVE-01", x: 42, y: 46, depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋", layerId: "LY-T1-3" },
      { id: crypto.randomUUID(), code: "W-003", type: "wood", dive: "DIVE-02", x: 58, y: 39, depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁", layerId: "" }
    ];
    persistMarks();
  }

  function persistMarks() { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)); }
  function persistArchive() { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive)); }

  // 探方
  const listSquares = () => archive.squares.slice();
  function addSquare({ name, note }) {
    const square = { id: crypto.randomUUID(), name: String(name || "").trim(), note: String(note || "").trim() };
    archive.squares.push(square);
    persistArchive();
    return square;
  }

  // 层位
  const listLayers = () => archive.layers.slice();
  function saveLayer(data) {
    if (data.id) {
      const target = archive.layers.find(l => l.id === data.id);
      if (target) {
        Object.assign(target, data);
        persistArchive();
        return target;
      }
    }
    const layer = { ...data, id: crypto.randomUUID() };
    archive.layers.push(layer);
    persistArchive();
    return layer;
  }
  function deleteLayer(id) {
    archive.layers = archive.layers.filter(l => l.id !== id);
    persistArchive();
  }

  // 遗物（沿用原有存储键，保证旧数据可用）
  const listMarks = () => marks.slice();
  function saveMark(data) {
    if (data.id) {
      const target = marks.find(m => m.id === data.id);
      if (target) {
        Object.assign(target, data);
        persistMarks();
        return target;
      }
    }
    const mark = { ...data, id: crypto.randomUUID() };
    marks.push(mark);
    persistMarks();
    return mark;
  }
  function deleteMark(id) {
    marks = marks.filter(m => m.id !== id);
    persistMarks();
  }

  // 发布快照：发布后保持原值，不因编录改动而静默变化
  const getPublished = squareId => archive.published[squareId] || null;
  function publish(squareId) {
    const profile = Stratigraphy.buildProfile(archive.layers, squareId);
    const artifacts = marks
      .filter(m => profile.some(l => l.id === m.layerId))
      .map(m => ({ id: m.id, code: m.code, layerId: m.layerId }));
    archive.published[squareId] = {
      at: new Date().toISOString(),
      layers: profile.map(l => ({ id: l.id, layerNo: l.layerNo, seq: l.seq, topDepth: l.top, bottomDepth: l.bottom, aboveId: l.aboveId || "", sediment: l.sediment })),
      artifacts
    };
    persistArchive();
    return archive.published[squareId];
  }

  function exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      squares: archive.squares,
      layers: archive.layers,
      marks,
      published: archive.published
    };
  }

  return { listSquares, addSquare, listLayers, saveLayer, deleteLayer, listMarks, saveMark, deleteMark, getPublished, publish, exportAll };
})();
