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

const SAMPLE_REVISION = {
  edits: [
    {
      page: "第4页",
      remove: "验证集 mAP@0.5 达到 92.4，优于对比模型。",
      replace: "验证集 240 张。自研模型 mAP@0.5 是 86.1，MobileNet-SSD 是 79.4。",
      why: "92.4 在论文里不存在。86.1 才是最后一次完整实验。",
    },
    {
      page: "第5页",
      remove: "图3-2 食堂高峰时段浪费热力图已完成，11:30 浪费最高。",
      replace: "高峰热力图还没画，这次不讲具体时段。下一步会单独成图。",
      why: "论文写明没有热力图文件。",
    },
    {
      page: "第2页",
      remove: "本系统已在两个食堂档口试运行。",
      replace: "目前只在离线验证集上测试，还没有进食堂。",
      why: "论文没有试运行记录。",
    },
    {
      page: "第6页",
      remove: "创新点「高峰热力图」已交付。",
      replace: "热力图还在计划里，这次不作为已完成的创新点。",
      why: "和实验记录相反。",
    },
  ],
  script: [
    "食堂现在只知道倒掉总量，不知道哪个窗口、哪个时段浪费最高。",
    "我们用档口俯视画面，识别明显没吃完就被倒掉的餐盘。",
    "验证集 240 张。自研检测器 mAP@0.5 是 86.1，MobileNet-SSD 是 79.4。",
    "对比目前只有 MobileNet-SSD。YOLOv8n 还没做，所以不讲已经超过主流检测器。",
    "热力图和食堂试运行都还没做。接下来补对比实验，并把热力图单独画出来。",
  ],
  todo: [
    "YOLOv8n 没做之前，不要讲对比已经充分。",
    "热力图画出来之前，不要讲 11:30 浪费最高。",
    "没进食堂之前，不要讲试运行。",
  ],
};

function docText(id) {
  return state.docs.find((item) => item.id === id)?.text || "";
}

function samplePaper() {
  return `${docText("proposal")}\n${docText("experiment")}`;
}

function showAnswer(revision, summary) {
  $("intake").hidden = true;
  $("workspace-guide").hidden = false;
  $("answer").hidden = false;
  $("workspace").hidden = false;
  $("notice").textContent = summary;
  $("meta").innerHTML = `<div>修改方案</div><div class="foot">先改红字那几页，再按讲稿念。</div>`;
  const edits = revision.edits.length ? revision.edits : [{
    page: "整份答辩",
    remove: "没有发现需要删掉的结果数字。",
    replace: "可以按现有 PPT 讲。念到的 EM、mAP、准确率，以论文里的数字为准。",
    why: "PPT 里的结果数字能在论文里找到，图号和参考文献编号没有当成结果。",
  }];
  $("edits").innerHTML = edits.map((item) => `
    <article class="edit">
      <b>${esc(item.page)}</b>
      <p class="remove">删掉：${esc(item.remove)}</p>
      <p class="replace">改成：${esc(item.replace)}</p>
      <p class="why">${esc(item.why)}</p>
      <button type="button" class="ghost copy-edit">复制改后的句子</button>
    </article>
  `).join("");
  $("edits").querySelectorAll(".copy-edit").forEach((button, index) => {
    button.addEventListener("click", () => navigator.clipboard.writeText(edits[index].replace));
  });
  $("script").innerHTML = revision.script.map((line) => `<li>${esc(line)}</li>`).join("");
  $("todo").innerHTML = revision.todo.map((line) => `<li>${esc(line)}</li>`).join("");
  $("copy-script").onclick = () => navigator.clipboard.writeText(revision.script.join("\n"));
  renderSide();
  renderTabs();
  renderDoc();
}

function showIntake() {
  $("intake").hidden = false;
  $("workspace-guide").hidden = true;
  $("answer").hidden = true;
  $("workspace").hidden = true;
  state.hasClicked = false;
  state.activeClaim = null;
  $("meta").innerHTML = `<div>导入两份文件</div><div class="foot">论文一份，答辩 PPT 一份。导师批注可以没有。</div>`;
}

function guessPage(line) {
  const found = line.match(/第\d+页/);
  return found ? found[0] : "PPT";
}

function paperHasNumber(paper, num) {
  const escaped = num.replace(".", "\\.");
  return new RegExp(`(?<!\\d)${escaped}(?!\\d)`).test(paper);
}

function isDelta(line, index) {
  return /差|降|升|高|低|优|约|近/.test(line.slice(Math.max(0, index - 4), index));
}

function isStructural(line, index) {
  return /[图表式第章节.]/.test(line.slice(Math.max(0, index - 1), index));
}

function claimNumbers(line) {
  const found = [];
  const metric = line.match(/mAP(?:@0\.5)?|EM|F1|准确率|精确率|召回率/i);
  if (metric) {
    for (const match of line.matchAll(/\d+\.\d+/g)) {
      const before = line.slice(Math.max(0, match.index - 1), match.index);
      if (before === "@" || isDelta(line, match.index) || isStructural(line, match.index)) continue;
      if (/^\d{4}\.\d{4,5}$/.test(match[0])) continue;
      found.push({ label: metric[0], num: match[0] });
    }
    return found;
  }
  for (const match of line.matchAll(/(\d+\.\d+)\s*%/g)) {
    if (isDelta(line, match.index) || isStructural(line, match.index)) continue;
    found.push({ label: "百分比", num: match[1] });
  }
  return found;
}

function paperMetricValues(paper, label) {
  const body = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...paper.matchAll(new RegExp(`${body}[^\\d]{0,24}(\\d+\\.\\d+)`, "gi"))].map((item) => item[1]);
}

function shorten(text) {
  const clean = text.replace(/^第\d+页：/, "").replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 80)}…` : clean;
}

function localRevise(paper, slides) {
  const edits = [];
  const seen = new Set();
  const lines = slides.split(/\n|。|；/).map((item) => item.trim()).filter((item) => item.length >= 8);
  lines.forEach((line) => {
    claimNumbers(line).forEach((claim) => {
      if (paperHasNumber(paper, claim.num) || seen.has(claim.num)) return;
      seen.add(claim.num);
      const known = [...new Set(paperMetricValues(paper, claim.label))].filter((num) => num !== claim.num).slice(0, 2);
      edits.push({
        page: guessPage(line),
        remove: shorten(line),
        replace: known.length
          ? `不要讲 ${claim.label} ${claim.num}。论文里同一指标写的是 ${known.join("、")}。`
          : `不要把 ${claim.label} ${claim.num} 当成论文里的结果。正文没有这个数字。`,
        why: "这是结果数字，而且论文里对不上。",
      });
    });
    const topic = ["热力图", "试运行", "部署", "YOLOv8n", "对比实验"].find((word) => line.includes(word));
    const boast = ["已完成", "已交付", "试运行", "已部署"].some((word) => line.includes(word));
    if (!topic || !boast || seen.has(topic)) return;
    const denied = paper.split(/。|\n/).some((sentence) => sentence.includes(topic) && /没有|尚未|未绘制|没有进入|还没/.test(sentence));
    if (!denied) return;
    seen.add(topic);
    edits.push({
      page: guessPage(line),
      remove: shorten(line),
      replace: `${topic}还没有做完。答辩只讲论文里已经完成的部分，这一项改口说下一步。`,
      why: `论文里写了还没有${topic}。`,
    });
  });
  const kept = lines.filter((line) => {
    if (/答辩人|指导教师|目录/.test(line)) return false;
    return claimNumbers(line).some((claim) => paperHasNumber(paper, claim.num) && !seen.has(claim.num));
  }).map(shorten).slice(0, 4);
  const script = kept.length ? kept : ["论文和 PPT 的结果数字对得上，可以按现在的 PPT 讲。"];
  const todo = edits.length
    ? edits.slice(0, 4).map((item) => `${item.page}：${item.replace}`)
    : ["没有发现需要改口的实验结果。数字以论文为准，按现有 PPT 排练即可。"];
  return { edits: edits.slice(0, 6), script, todo };
}

async function readZipText(file, pattern, mapXml) {
  if (typeof JSZip === "undefined") throw new Error("读取 PPT 的组件没加载成功，请改用 TXT 或 PDF。");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files).filter((name) => pattern.test(name)).sort();
  const parts = [];
  for (const name of names) {
    const xml = await zip.files[name].async("string");
    parts.push(mapXml(xml, name));
  }
  return parts.filter(Boolean).join("\n");
}

function xmlText(xml) {
  return [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((item) => item[1]).join("");
}

async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) return file.text();
  if (name.endsWith(".pptx")) {
    return readZipText(file, /ppt\/slides\/slide\d+\.xml$/, (xml, slide) => {
      const page = slide.match(/slide(\d+)/)?.[1] || "";
      const text = xmlText(xml);
      return text ? `第${page}页：${text}` : "";
    });
  }
  if (name.endsWith(".docx")) {
    return readZipText(file, /word\/document\.xml$/, (xml) => xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  if (name.endsWith(".pdf")) return readPdf(file);
  throw new Error("请上传 PDF、PPTX、DOCX 或 TXT。");
}

async function readPdf(file) {
  const pdfjs = await import("./vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(""));
  }
  return pages.join("\n");
}

function showWorkspace(data, revision, summary, ownFiles) {
  state.analysis = ownFiles ? null : data.analysis;
  state.docs = data.docs;
  showAnswer(revision, summary);
  $("workspace").hidden = Boolean(ownFiles) || !state.analysis;
}

async function load() {
  const data = await loadDemo();
  state.demo = data;
  state.docs = data.docs;
  state.analysis = data.analysis;
  showIntake();
  $("paper-file").addEventListener("change", (event) => {
    state.paperFile = event.target.files[0] || null;
    $("paper-name").textContent = state.paperFile ? state.paperFile.name : "PDF、Word 或 TXT";
  });
  $("slide-file").addEventListener("change", (event) => {
    state.slideFile = event.target.files[0] || null;
    $("slide-name").textContent = state.slideFile ? state.slideFile.name : "PPTX、PDF 或 TXT";
  });
  $("mentor-file").addEventListener("change", (event) => {
    state.mentorFile = event.target.files[0] || null;
    $("mentor-name").textContent = state.mentorFile ? state.mentorFile.name : "没有就留空";
  });
  $("use-sample").addEventListener("click", () => {
    state.docs = state.demo.docs;
    showWorkspace(
      state.demo,
      SAMPLE_REVISION,
      "这是演示稿的修改方案。林夏的 PPT 不能照原样讲，下面是建议改成的句子。",
    );
  });
  $("check").addEventListener("click", onCheck);
  $("back").addEventListener("click", showIntake);
}

async function onCheck() {
  const note = $("check-note");
  if (!state.paperFile || !state.slideFile) {
    note.textContent = "请先选论文和答辩 PPT。导师批注可以不传。也可以先点「用演示论文和 PPT」。";
    return;
  }
  note.textContent = "正在读取文件…";
  $("check").disabled = true;
  try {
    const paper = await readFile(state.paperFile);
    const slides = await readFile(state.slideFile);
    const mentor = state.mentorFile ? await readFile(state.mentorFile) : "";
    const combined = `${paper}\n${mentor}`;
    state.docs = [
      { id: "proposal", title: "论文", filename: state.paperFile.name, text: paper },
      { id: "experiment", title: "论文续", filename: state.paperFile.name, text: "" },
      { id: "mentor", title: "导师批注", filename: state.mentorFile?.name || "无", text: mentor || "未提供导师批注。" },
      { id: "slides", title: "答辩PPT", filename: state.slideFile.name, text: slides },
    ];
    state.analysis = state.demo.analysis;
    const revision = localRevise(combined, slides);
      note.textContent = "";
    showWorkspace(
      { ...state.demo, docs: state.docs, analysis: state.analysis },
      revision,
      `已从《${state.paperFile.name}》和《${state.slideFile.name}》抽出文字并生成修改建议。`,
    );
  } catch (error) {
    note.textContent = error.message || "文件没有读出来。";
  }
  $("check").disabled = false;
}

function renderMeta() {
  $("meta").innerHTML = `
    <div>核对结果</div>
    <div class="foot">红色是这份稿子里不能直接讲的话。</div>
  `;
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
