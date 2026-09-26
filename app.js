const STATUS = {
  supported: "有证据",
  conflict: "说法冲突",
  missing: "材料里没有",
  withheld: "先别讲",
  done: "已落实",
  open: "还没做",
};

const state = {
  docs: [],
  docId: "proposal",
  analysis: null,
  activeClaim: null,
  mentorIndex: null,
  hasClicked: false,
};

const $ = (id) => document.getElementById(id);

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

async function loadDemo() {
  try {
    const res = await fetch("/api/demo", { headers: { Accept: "application/json" } });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.includes("json")) throw new Error("not api");
    return await res.json();
  } catch {
    const res = await fetch("demo.json");
    if (!res.ok) throw new Error("没有找到演示数据");
    return await res.json();
  }
}

async function load() {
  const data = await loadDemo();
  state.docs = data.docs;
  state.analysis = data.analysis;
  state.activeClaim = null;
  state.mentorIndex = null;
  const summary = data.analysis?.result.summary;
  const lead = $("notice").querySelector(".guide-kicker");
  if (lead && summary) {
    lead.textContent = `样例课题「${data.topic}」。${summary}`;
  }
  renderMeta(data);
  renderSide();
  renderTabs();
  renderDoc();
}

function renderMeta(data) {
  const analysis = data.analysis;
  if (data.snapshot) {
    $("meta").innerHTML = `
      <div>千问已核对这份样例</div>
      <div class="foot">直接点红色问题，不用再上传。</div>
    `;
    return;
  }
  const spent = data.budget;
  const bits = [
    `已调用 ${spent.calls} 次`,
    `估算 ${Number(spent.estimated_yuan).toFixed(4)} 元`,
  ];
  if (analysis) bits.unshift(analysis.model);
  $("meta").innerHTML = `
    <div>${bits.map(esc).join(" · ")}</div>
    <button id="run" ${spent.blocked ? "disabled" : ""}>${analysis ? "重新核对" : "开始核对"}</button>
    <div class="foot">${spent.blocked ? esc(spent.blocked) : "重新核对称会再请求一次千问。"}</div>
  `;
  $("run").addEventListener("click", onRun);
}

async function onRun() {
  const again = Boolean(state.analysis);
  const ok = window.confirm(again
    ? "再请求一次千问，并覆盖当前核对结果？"
    : "现在请求千问，核对这四份样例？");
  if (!ok) return;
  const button = $("run");
  button.disabled = true;
  button.textContent = "核对中";
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    $("notice").textContent = err.detail || "核对失败";
    button.disabled = false;
    button.textContent = state.analysis ? "重新核对" : "开始核对";
    return;
  }
  await load();
}

function renderTabs() {
  $("tabs").innerHTML = state.docs.map((doc) => `
    <button type="button" data-doc="${doc.id}" class="${doc.id === state.docId ? "active" : ""}">${esc(doc.title)}</button>
  `).join("");
  $("tabs").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.docId = button.dataset.doc;
      renderTabs();
      renderDoc();
    });
  });
}

function orderedClaims() {
  const rank = { conflict: 0, missing: 1, supported: 2 };
  const mentorText = new Set((state.analysis?.result.mentor_items || []).map((item) => item.text));
  return [...(state.analysis?.result.claims || [])]
    .filter((item) => !mentorText.has(item.text))
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
}

function renderSide() {
  const result = state.analysis?.result;
  if (!result) {
    $("claims").innerHTML = `<div class="empty"><p>核对完成后，冲突和缺口会列在这里。</p></div>`;
    $("mentor").innerHTML = "";
    $("outline").innerHTML = "";
    return;
  }
  const claims = orderedClaims();
  const firstConflict = claims.find((item) => item.status === "conflict");
  $("claims").innerHTML = claims.map((claim) => `
    <button type="button" class="claim ${claim.id === state.activeClaim ? "active" : ""} ${!state.hasClicked && firstConflict && claim.id === firstConflict.id ? "start-here" : ""}" data-claim="${esc(claim.id)}">
      ${!state.hasClicked && firstConflict && claim.id === firstConflict.id ? `<b class="start-label">从这里开始</b>` : ""}
      <small class="st-${claim.status}">${STATUS[claim.status] || claim.status}</small>
      <span>${esc(claim.text)}</span>
      ${claim.gap ? `<p class="gap">${esc(claim.gap)}</p>` : ""}
      ${unverifiedNote(claim.evidence)}
    </button>
  `).join("");
  $("claims").querySelectorAll(".claim").forEach((node) => {
    node.addEventListener("click", () => selectClaim(node.dataset.claim));
  });
  $("mentor").innerHTML = result.mentor_items.map((item, index) => `
    <button type="button" class="mentor-item" data-mentor="${index}">
      <small class="st-${item.status}">${STATUS[item.status] || item.status}</small>
      <span>${esc(item.text)}</span>
      ${item.verified ? "" : `<p class="quote-miss">依据原文没有定位成功</p>`}
      ${item.verified && item.aligned === false ? `<p class="quote-miss">这句原文对不上这条要求</p>` : ""}
    </button>
  `).join("");
  $("mentor").querySelectorAll(".mentor-item").forEach((node) => {
    node.addEventListener("click", () => selectMentor(Number(node.dataset.mentor)));
  });
  $("outline").innerHTML = result.outline.map((item) => `
    <li class="${item.status}" data-ref="${esc(item.ref)}">
      <small class="st-${item.status}">${item.minute} ${STATUS[item.status] || item.status}</small>
      <div class="sentence">${esc(item.sentence)}</div>
    </li>
  `).join("");
  $("outline").querySelectorAll("li").forEach((node) => {
    node.addEventListener("click", () => {
      if (node.dataset.ref) selectClaim(node.dataset.ref);
    });
  });
}

function unverifiedNote(evidence) {
  const missed = (evidence || []).filter((item) => item.quote && !item.verified);
  if (!missed.length) return "";
  return `<p class="quote-miss">${missed.length} 处引用没能在原文定位，不计入已证实。</p>`;
}

function selectClaim(id) {
  state.hasClicked = true;
  state.mentorIndex = null;
  state.activeClaim = id;
  const claim = (state.analysis?.result.claims || []).find((item) => item.id === id);
  const hit = (claim?.evidence || []).find((item) => item.verified);
  if (hit) state.docId = hit.doc_id;
  renderTabs();
  renderSide();
  renderDoc();
}

function selectMentor(index) {
  const item = state.analysis.result.mentor_items[index];
  state.activeClaim = null;
  state.mentorIndex = index;
  if (item?.verified) state.docId = item.doc_id;
  renderTabs();
  renderSide();
  renderDoc();
}

function ranges() {
  const result = state.analysis?.result;
  if (!result) return [];
  const claim = result.claims.find((item) => item.id === state.activeClaim);
  const fromClaim = (claim?.evidence || [])
    .filter((item) => item.verified && item.doc_id === state.docId)
    .map((item) => ({ start: item.start, end: item.end, kind: claim.status }));
  const mentor = state.mentorIndex != null ? result.mentor_items[state.mentorIndex] : null;
  const fromMentor = mentor && mentor.verified && mentor.aligned !== false && mentor.doc_id === state.docId && state.activeClaim == null
    ? [{ start: mentor.start, end: mentor.end, kind: mentor.status }]
    : [];
  return fromClaim.length ? fromClaim : fromMentor;
}

function renderDoc() {
  const doc = state.docs.find((item) => item.id === state.docId) || state.docs[0];
  if (!doc) return;
  const marks = ranges().filter((item) => item.start >= 0 && item.end > item.start)
    .sort((a, b) => a.start - b.start);
  let html = "";
  let cursor = 0;
  marks.forEach((mark) => {
    if (mark.start < cursor) return;
    html += esc(doc.text.slice(cursor, mark.start));
    html += `<mark class="mark-${mark.kind}">${esc(doc.text.slice(mark.start, mark.end))}</mark>`;
    cursor = mark.end;
  });
  html += esc(doc.text.slice(cursor));
  $("doc").innerHTML = html;
  const hit = $("doc").querySelector("mark");
  if (hit) hit.scrollIntoView({ block: "center" });
}

load();
