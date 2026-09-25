/* 页面：地图、遗物表单、层位编录台的交互与渲染。 */
const map = document.querySelector("#map");
const form = document.querySelector("#form");
const list = document.querySelector("#list");
const filter = document.querySelector("#filter");
const view = document.querySelector("#view");
const listTitle = document.querySelector("#listTitle");
const squareSelect = document.querySelector("#squareSelect");
const squareNote = document.querySelector("#squareNote");
const squareForm = document.querySelector("#squareForm");
const layerForm = document.querySelector("#layerForm");
const layerList = document.querySelector("#layerList");
const profileList = document.querySelector("#profileList");
const publishBox = document.querySelector("#publishBox");
const typeNames = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };
let pending = null;
let currentSquare = null;

// 船肋装饰（保留原图）
for (let i = 0; i < 7; i++) {
  const rib = document.createElement("div");
  rib.className = "rib";
  rib.style.left = 28 + i * 7 + "%";
  map.appendChild(rib);
}

const allMarks = () => Archive.listMarks();
const filteredMarks = () => filter.value ? allMarks().filter(m => m.type === filter.value) : allMarks();
const findLayer = id => Archive.listLayers().find(l => l.id === id);
const findSquare = id => Archive.listSquares().find(s => s.id === id);
const profileOf = squareId => Stratigraphy.buildProfile(Archive.listLayers(), squareId);
const fmt2 = v => Stratigraphy.fmt(v);

// 遗物归层标签：只认已确认层位，失效或删除要显式提示
function layerPill(mark) {
  if (!mark.layerId) return '<span class="pill">未归层</span>';
  const layer = findLayer(mark.layerId);
  if (!layer) return '<span class="pill warn">层位已删除</span>';
  const sq = findSquare(layer.square);
  const confirmed = profileOf(layer.square).some(l => l.id === layer.id);
  return confirmed
    ? '<span class="pill ok">' + sq.name + "·" + layer.layerNo + "</span>"
    : '<span class="pill warn">' + sq.name + "·" + layer.layerNo + " 已失效</span>";
}

function renderMarkers() {
  map.querySelectorAll(".marker").forEach(el => el.remove());
  filteredMarks().forEach(mark => {
    const el = document.createElement("button");
    el.className = "marker " + mark.type + (mark.id === form.id.value ? " selected" : "");
    el.style.left = mark.x + "%";
    el.style.top = mark.y + "%";
    el.textContent = mark.code.slice(0, 2);
    el.title = mark.code;
    el.onclick = event => { event.stopPropagation(); edit(mark.id); };
    map.appendChild(el);
  });
}

function renderList(data) {
  listTitle.textContent = "标记列表";
  list.className = "list";
  list.innerHTML = data.map(m =>
    '<div class="item ' + (m.id === form.id.value ? "active" : "") + '" data-id="' + m.id + '"><b>' + m.code + "</b> " +
    '<span class="pill">' + typeNames[m.type] + "</span> " + layerPill(m) +
    '<div class="muted">' + m.dive + " · " + m.depth + " · " + m.orientation + "</div><div>" + m.condition + "</div></div>"
  ).join("");
  list.querySelectorAll("[data-id]").forEach(el => el.onclick = () => edit(el.dataset.id));
}

function renderTimeline(data) {
  listTitle.textContent = "潜次时间线";
  list.className = "timeline";
  const groups = data.reduce((acc, item) => ((acc[item.dive] ||= []).push(item), acc), {});
  list.innerHTML = Object.entries(groups).map(([dive, items]) =>
    '<div class="item"><b>' + dive + '</b><div class="muted">新增' + items.length + "个标记</div>" +
    items.map(i => "<div>" + i.code + " · " + typeNames[i.type] + " " + layerPill(i) + "</div>").join("") + "</div>"
  ).join("");
}

// 遗物只能归到已确认层位
function renderMarkLayerOptions(want) {
  const sel = form.layerId;
  let html = '<option value="">未归层</option>';
  Archive.listSquares().forEach(sq => {
    const profile = profileOf(sq.id);
    if (!profile.length) return;
    html += '<optgroup label="探方 ' + sq.name + '">' +
      profile.map(l => '<option value="' + l.id + '">' + l.layerNo + "（" + fmt2(l.top) + "–" + fmt2(l.bottom) + "m）</option>").join("") +
      "</optgroup>";
  });
  sel.innerHTML = html;
  sel.value = want || "";
}

// 直接上层候选：本探方内除自身外的全部层位
function renderAboveOptions() {
  const exclude = layerForm.id.value;
  const want = layerForm.aboveId.value;
  const layers = Archive.listLayers()
    .filter(l => l.square === currentSquare && l.id !== exclude)
    .sort((a, b) => (parseFloat(a.topDepth) || 0) - (parseFloat(b.topDepth) || 0));
  layerForm.aboveId.innerHTML = '<option value="">（地表 / 最上层）</option>' +
    layers.map(l => '<option value="' + l.id + '">' + l.layerNo + "（" + fmt2(l.topDepth) + "–" + fmt2(l.bottomDepth) + "m）</option>").join("");
  layerForm.aboveId.value = want;
}

function renderLayerPanel() {
  const squares = Archive.listSquares();
  if (!currentSquare || !squares.some(s => s.id === currentSquare)) currentSquare = squares.length ? squares[0].id : null;
  squareSelect.innerHTML = squares.map(s => '<option value="' + s.id + '">' + s.name + "</option>").join("");
  squareSelect.value = currentSquare || "";
  const sq = findSquare(currentSquare);
  squareNote.textContent = sq && sq.note ? sq.note : "";
  if (!currentSquare) {
    layerList.innerHTML = "";
    profileList.innerHTML = "";
    publishBox.innerHTML = "";
    return;
  }
  renderAboveOptions();

  // 层位判定结果
  const evaluated = Stratigraphy.evaluateLayers(Archive.listLayers(), currentSquare)
    .sort((a, b) => (a.top === null ? Infinity : a.top) - (b.top === null ? Infinity : b.top));
  layerList.innerHTML = evaluated.map(l => {
    const status = l.ok ? '<span class="status ok">进入剖面</span>' : '<span class="status bad">不进入剖面</span>';
    const above = l.aboveId ? findLayer(l.aboveId) : null;
    const reasons = l.reasons.length ? '<div class="muted">原因：' + l.reasons.join("；") + "</div>" : "";
    return '<div class="item' + (l.ok ? "" : " rejected") + (l.id === layerForm.id.value ? " active" : "") + '" data-id="' + l.id + '">' +
      "<b>" + l.layerNo + "</b> " + status +
      '<div class="muted">' + fmt2(l.topDepth) + "–" + fmt2(l.bottomDepth) + "m · 上层：" + (above ? above.layerNo : "地表") + "</div>" +
      "<div>" + (l.sediment || "") + "</div>" + reasons + "</div>";
  }).join("") || '<div class="muted">尚未登记层位</div>';
  layerList.querySelectorAll("[data-id]").forEach(el => el.onclick = () => editLayer(el.dataset.id));

  // 地层剖面（确认层位按顶深重排）
  const profile = profileOf(currentSquare);
  const marks = allMarks();
  profileList.innerHTML = profile.map(l => {
    const arts = marks.filter(m => m.layerId === l.id);
    return '<div class="profile-item"><b>#' + l.seq + " " + l.layerNo + "</b> " +
      '<span class="muted">' + fmt2(l.top) + "–" + fmt2(l.bottom) + "m</span>" +
      "<div>" + l.sediment + "</div>" +
      '<div class="muted">遗物：' + (arts.length ? arts.map(a => a.code).join("、") : "无") + "</div></div>";
  }).join("") || '<div class="muted">当前探方暂无确认层位，剖面为空</div>';
  renderPublishBox(profile);
}

// 发布管理：已发布剖面不静默改值，列出受影响层位和遗物后重新发布
function renderPublishBox(profile) {
  const published = Archive.getPublished(currentSquare);
  if (!published) {
    publishBox.innerHTML = profile.length
      ? '<button id="publishBtn" type="button">发布剖面</button><div class="muted">发布后剖面值锁定，后续改动需确认并重新发布</div>'
      : '<div class="muted">剖面为空，暂不能发布</div>';
    const btn = document.querySelector("#publishBtn");
    if (btn) btn.onclick = () => { Archive.publish(currentSquare); render(); };
    return;
  }
  const when = new Date(published.at).toLocaleString();
  const impact = Stratigraphy.computeImpact(profile, allMarks(), published);
  if (!impact.affectedLayers.length && !impact.affectedMarks.length) {
    publishBox.innerHTML = '<div class="banner ok">已于 ' + when + " 发布，当前编录与发布一致</div>";
    return;
  }
  publishBox.innerHTML =
    '<div class="impact"><b>已发布剖面（' + when + "）与当前编录不一致</b>" +
    '<div class="muted">发布值保持原样，不会被自动修改。受影响层位 ' + impact.affectedLayers.length +
    " 个、遗物 " + impact.affectedMarks.length + " 件，确认后重新发布。</div>" +
    (impact.affectedLayers.length
      ? "<ul>" + impact.affectedLayers.map(a => "<li>" + a.layerNo + "：" + a.changes.join("；") + "</li>").join("") + "</ul>"
      : "") +
    (impact.affectedMarks.length
      ? "<ul>" + impact.affectedMarks.map(a => "<li>遗物 " + a.code + "（" + a.reason + "）</li>").join("") + "</ul>"
      : "") +
    '<button id="republishBtn" type="button">重新发布剖面</button></div>';
  document.querySelector("#republishBtn").onclick = () => { Archive.publish(currentSquare); render(); };
}

function render() {
  renderMarkers();
  const data = filteredMarks();
  if (view.value === "timeline") renderTimeline(data);
  else renderList(data);
  renderMarkLayerOptions(form.layerId.value);
  renderLayerPanel();
}

function edit(id) {
  const mark = allMarks().find(m => m.id === id);
  if (!mark) return;
  for (const [key, value] of Object.entries(mark)) {
    if (key === "layerId" || key === "x" || key === "y") continue;
    if (form[key]) form[key].value = value;
  }
  pending = { x: mark.x, y: mark.y };
  render();
  form.layerId.value = mark.layerId || "";
}

function editLayer(id) {
  const layer = findLayer(id);
  if (!layer) return;
  layerForm.id.value = layer.id;
  layerForm.layerNo.value = layer.layerNo;
  layerForm.topDepth.value = layer.topDepth;
  layerForm.bottomDepth.value = layer.bottomDepth;
  layerForm.sediment.value = layer.sediment;
  renderLayerPanel();
  layerForm.aboveId.value = layer.aboveId || "";
}

// 页签切换
function switchPane(which) {
  document.querySelector("#paneMarks").hidden = which !== "marks";
  document.querySelector("#paneLayers").hidden = which !== "layers";
  document.querySelector("#tabMarks").classList.toggle("active", which === "marks");
  document.querySelector("#tabLayers").classList.toggle("active", which === "layers");
}
document.querySelector("#tabMarks").onclick = () => switchPane("marks");
document.querySelector("#tabLayers").onclick = () => switchPane("layers");

// 地图点击新增标记（保留原交互）
map.addEventListener("click", event => {
  const rect = map.getBoundingClientRect();
  pending = {
    x: Number(((event.clientX - rect.left) / rect.width * 100).toFixed(2)),
    y: Number(((event.clientY - rect.top) / rect.height * 100).toFixed(2))
  };
  form.reset();
  form.id.value = "";
  form.code.value = "M-" + String(allMarks().length + 1).padStart(3, "0");
  form.dive.value = "DIVE-01";
  render();
});

form.onsubmit = event => {
  event.preventDefault();
  if (!pending) pending = { x: 50, y: 50 };
  const data = Object.fromEntries(new FormData(form).entries());
  const saved = Archive.saveMark({ ...data, ...pending });
  form.id.value = saved.id;
  render();
};

document.querySelector("#deleteBtn").onclick = () => {
  if (!form.id.value) return;
  Archive.deleteMark(form.id.value);
  form.reset();
  form.id.value = "";
  pending = null;
  render();
};

// 探方档案
squareForm.onsubmit = event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(squareForm).entries());
  if (!data.name.trim()) return;
  const sq = Archive.addSquare(data);
  currentSquare = sq.id;
  squareForm.reset();
  render();
};
squareSelect.onchange = () => {
  currentSquare = squareSelect.value;
  layerForm.reset();
  layerForm.id.value = "";
  render();
};

// 层位登记：保存后剖面自动重排，已发布的探方会列出影响
layerForm.onsubmit = event => {
  event.preventDefault();
  if (!currentSquare) return;
  const data = Object.fromEntries(new FormData(layerForm).entries());
  Archive.saveLayer({
    id: data.id || "",
    square: currentSquare,
    layerNo: data.layerNo.trim(),
    topDepth: parseFloat(data.topDepth),
    bottomDepth: parseFloat(data.bottomDepth),
    aboveId: data.aboveId || "",
    sediment: data.sediment.trim()
  });
  layerForm.reset();
  layerForm.id.value = "";
  render();
};

document.querySelector("#layerDelete").onclick = () => {
  if (!layerForm.id.value) return;
  Archive.deleteLayer(layerForm.id.value);
  layerForm.reset();
  layerForm.id.value = "";
  render();
};

document.querySelector("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(Archive.exportAll(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "dive-archive.json";
  a.click();
  URL.revokeObjectURL(a.href);
};

filter.onchange = render;
view.onchange = render;
render();
