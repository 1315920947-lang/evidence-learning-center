const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let state = {
  page: "home",
  courses: [],
  refs: [],
  tools: [],
  request: 0,
  status: {},
  selected: null,
  token: sessionStorage.getItem("evidence_token") || "",
  start: null,
};
const notify = (t) => {
  const x = $("#toast");
  x.textContent = t;
  x.style.display = "block";
  setTimeout(() => (x.style.display = "none"), 3500);
};
async function api(path, opts = {}) {
  let r = await fetch("/api" + path, {
    ...opts,
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(state.token ? { "X-Admin-Token": state.token } : {}),
      ...(opts.headers || {}),
    },
  });
  let j = await r.json();
  if (r.status === 401) {
    state.token = "";
    sessionStorage.removeItem("evidence_token");
  }
  if (!r.ok)
    throw Error(
      typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail),
    );
  return j;
}
function btn(t, fn, cls = "btn") {
  return `<button class="${cls}" onclick="${fn}">${t}</button>`;
}
function courseRow(c, practice = false) {
  return `<div class="listrow"><div><small>${esc(c.day)} · 第${c.version}版 · ${c.minutes}分钟建议学习</small><strong>${esc(c.title)}</strong><span class="tag">${esc(c.topic || "未分类")}</span></div>${btn(practice ? "开始练习" : "阅读课程", `openCourse(${c.id},${practice})`, "btn secondary")}</div>`;
}
function empty(t = "暂无课程") {
  return `<div class="empty"><h3>${esc(t)}</h3><p>未同步的日期不会生成虚假内容。可通过“导入课程”发布完整原文。</p>${btn("导入课程", "showImport()")}</div>`;
}
async function load() {
  try {
    [state.courses, state.refs, state.tools, state.status] = await Promise.all([
      api("/courses"),
      api("/references"),
      api("/tools"),
      api("/status"),
    ]);
    $("#syncStatus").textContent =
      "同步方式：手动导入 · " +
      (state.status.write_locked ? "写入锁定" : "写入已配置");
    $("#clock").textContent = "北京时间 " + state.status.today;
    render();
  } catch (e) {
    $("#main").innerHTML =
      `<div class="notice">加载失败：${esc(e.message)}</div>`;
  }
}
function navigate(page) {
  state.request++;
  state.page = page;
  state.selected = null;
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  render();
  window.scrollTo(0, 0);
}
function render() {
  const m = $("#main");
  if (state.selected) {
    renderCourse();
    return;
  }
  if (state.page === "home") {
    const today = state.courses.find((c) => c.day === state.status.today);
    if (today) {
      m.innerHTML = '<p class="loading">正在读取今日课程…</p>';
      openCourse(today.id);
    } else {
      const recent = state.courses
        .filter((c) => c.day < state.status.today)
        .slice(0, 4);
      m.innerHTML = `<div class="hero"><h1>今日研修</h1><p>北京时间 ${esc(state.status.today)} · 每日研修建议 60–90 分钟</p><div class="actions">${btn("导入课程", "showImport()")} ${btn("浏览课程档案", "navigate('archive')", "btn secondary")}</div></div><p class="notice">今天还没有已发布的课程。</p><div class="sectionhead"><h2>近期课程</h2></div><div class="list">${recent.map(courseRow).join("") || '<p class="muted">暂无历史课程。</p>'}</div>`;
    }
  } else if (state.page === "archive") {
    m.innerHTML = `<div class="eyebrow">COURSE ARCHIVE</div><h1>每日课程档案</h1><p class="sub">所有课程按北京时间日期保存；同一天修订保留历史版本。</p><input class="search" placeholder="搜索标题、全文、专题或输入日期 YYYY-MM-DD" oninput="filterCourses(this.value)"><div id="courseList" class="list">${state.courses.map(courseRow).join("") || empty()}</div>`;
  } else if (state.page === "papers") {
    m.innerHTML = `<div class="eyebrow">RESEARCH LIBRARY</div><h1>循证文献库</h1><p class="sub">链接来自已导入课程；“待核验”不等于已确认免费全文。</p><input class="search" placeholder="搜索标题、PMID或DOI" oninput="filterRefs(this.value)"><div id="paperList" class="list">${state.refs.map(refRow).join("") || empty("尚无文献")}</div>`;
  } else if (state.page === "topics") {
    const systems = new Map();
    for (const c of state.courses) {
      const system = c.system || "未分类医学系统";
      const topic = c.topic || "未分类专题";
      if (!systems.has(system)) systems.set(system, new Map());
      const topics = systems.get(system);
      if (!topics.has(topic)) topics.set(topic, []);
      topics.get(topic).push(c);
    }
    m.innerHTML = `<h1>专题知识库</h1>${[...systems].map(([system, topics]) => `<section><h2>${esc(system)}</h2><div class="grid two">${[...topics].map(([topic, courses]) => `<div class="card"><h3>${esc(topic)}</h3>${courses.map((c) => `<p>${btn(esc(c.day + " · " + c.title), `openCourse(${c.id})`, "btn secondary")}</p>`).join("")}</div>`).join("")}</div></section>`).join("") || empty("专题库等待课程导入")}`;
  } else if (state.page === "cases") {
    m.innerHTML = `<h1>临床案例训练</h1><p class="sub">选择包含练习的课程。提交答案后即可查看解析。</p><div class="list">${
      state.courses
        .filter((c) => c.question_count)
        .map((c) => courseRow(c, true))
        .join("") || empty("尚无可练习的课程")
    }</div>`;
  } else if (state.page === "tools") {
    m.innerHTML = `<h1>健康管理工具库</h1>${
      ["体检审核清单", "报告解读模板", "随访工具", "其他"]
        .map((kind) => {
          const items = state.tools.filter((t) => t.kind === kind);
          return items.length
            ? `<section><h2>${kind}</h2><div class="list">${items.map((t) => `<details class="card"><summary><strong>${esc(t.title)}</strong> <small>${esc(t.day)} · 第${t.version}版</small></summary><article>${t.html}</article>${btn("查看来源课程", `openCourse(${t.course_id})`, "btn secondary")}</details>`).join("")}</div></section>`
            : "";
        })
        .join("") || empty("尚未导入工作工具")
    }`;
  } else if (state.page === "profile") renderProfile();
}
function refRow(r, saved = false) {
  const link = (label, url) =>
    `<a class="btn secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;
  return `<div class="listrow"><div><small>${esc(r.day || state.selected?.day || "课程文献")} · ${esc(r.access)}</small><strong>${esc(r.title)}</strong>
 ${r.source ? `<div>${esc(r.source)}</div>` : ""}
 <div class="paperlink">${r.doi ? `DOI ${esc(r.doi)}` : ""} ${r.pmid ? `· PMID ${esc(r.pmid)}` : ""}</div></div>
 <div class="actions">${link("原文", r.url)}${r.full_text_url ? link("全文", r.full_text_url) : ""}${btn(saved ? "取消收藏" : "收藏", `saveBookmark(${r.id},${!saved},this)`, "btn secondary")}</div></div>`;
}
async function saveBookmark(id, bookmarked, button) {
  try {
    const token = await getToken();
    if (!token) return;
    await api("/bookmarks/" + id, {
      method: "PUT",
      body: JSON.stringify({ bookmarked }),
    });
    notify(bookmarked ? "已收藏" : "已取消收藏");
    if (state.page === "profile" && !state.selected) renderProfile();
    else {
      button.textContent = bookmarked ? "取消收藏" : "收藏";
      button.onclick = () => saveBookmark(id, !bookmarked, button);
    }
  } catch (e) {
    notify(e.message);
  }
}
let searchRequest = 0;
async function filterCourses(query) {
  const request = ++searchRequest;
  const q = query.trim();
  try {
    const results = q
      ? await api(
          "/courses?" +
            new URLSearchParams(
              /^\d{4}-\d{2}-\d{2}$/.test(q) ? { day: q } : { q },
            ),
        )
      : state.courses;
    if (request === searchRequest && $("#courseList"))
      $("#courseList").innerHTML =
        results.map((c) => courseRow(c)).join("") || empty("没有匹配课程");
  } catch (e) {
    if (request === searchRequest) notify(e.message);
  }
}
function filterRefs(q) {
  q = q.toLowerCase();
  $("#paperList").innerHTML =
    state.refs
      .filter((r) =>
        [r.title, r.doi, r.pmid, r.source].some((s) =>
          String(s).toLowerCase().includes(q),
        ),
      )
      .map((r) => refRow(r))
      .join("") || empty("没有匹配文献");
}
async function openCourse(id, practice = false) {
  const request = ++state.request;
  try {
    const c = await api("/courses/" + id);
    c.progress = { seconds: 0, completed: 0 };
    c.note = { body: "" };
    if (state.token) {
      try {
        Object.assign(c, await api("/learning/" + id));
      } catch (e) {
        if (request === state.request) notify(e.message);
      }
    }
    if (request !== state.request) return;
    state.selected = c;
    state.start = Date.now();
    renderCourse();
    if (practice) $("#practice").scrollIntoView();
    else window.scrollTo(0, 0);
  } catch (e) {
    if (request === state.request) notify(e.message);
  }
}
async function getToken() {
  if (state.token) return state.token;
  const dialog = $("#credentials");
  $("#access-token").value = "";
  dialog.showModal();
  await new Promise((resolve) =>
    dialog.addEventListener("close", resolve, { once: true }),
  );
  if (dialog.returnValue !== "confirm") return "";
  state.token = $("#access-token").value;
  sessionStorage.setItem("evidence_token", state.token);
  return state.token;
}
function clearToken() {
  state.token = "";
  sessionStorage.removeItem("evidence_token");
  notify("已清除当前会话口令");
  navigate("profile");
}
function renderCourse() {
  const c = state.selected;
  if (!c) return;
  $("#main").innerHTML =
    `<div class="course"><div class="actions">${btn("← 返回" + (state.page === "home" ? "档案" : "列表"), `navigate('${state.page === "home" ? "archive" : state.page}')`, "btn secondary")}${btn("打印 / 保存PDF", "window.print()", "btn secondary")}${btn("标记完成", `saveProgress(${c.id},true)`, "btn")}</div><div class="eyebrow">${esc(c.day)} · 课程第${c.version}版</div><h1>${esc(c.title)}</h1><p class="sub">${esc(c.topic)} · 建议${c.minutes}分钟 · 来源：${esc(c.source)} · 原文版本保留</p><div class="card" style="margin-bottom:16px"><div class="sub">本课程历史版本</div><div class="actions">${c.versions.map((v) => btn("v" + v.version, `openCourse(${v.id})`, v.id === c.id ? "btn" : "btn secondary")).join("")}</div><div class="sub" id="course-progress">${progressText(c.progress)}</div></div><article id="courseArticle">${c.html}</article><div class="sectionhead"><h2>本期研究全文入口</h2></div>${c.references.length ? `<div class="list">${c.references.map((r) => refRow(r)).join("")}</div>` : empty("本课程尚未录入结构化文献链接")}<div class="sectionhead"><h2 id="practice">临床案例与练习</h2></div>${c.questions.length ? c.questions.map((q) => `<div class="card" style="margin-bottom:12px"><h3>${esc(q.question)}</h3>${q.options.map((o, i) => `<button class="choice" id="choice-${q.id}-${i}" onclick="choose(${q.id},${i})">${String.fromCharCode(65 + i)}. ${esc(o)}</button>`).join("")}<div id="result-${q.id}"></div></div>`).join("") : empty("当前课程没有单独导入结构化练习题")}<div class="sectionhead"><h2>我的课程笔记</h2></div><textarea id="note" placeholder="记录重点、临床疑问或工作实践…">${esc(c.note.body)}</textarea><div class="actions">${btn("保存笔记", `saveNote(${c.id})`)}${btn("保存学习进度", `saveProgress(${c.id},false)`, "btn secondary")}</div></div>`;
}
async function choose(qid, i) {
  document
    .querySelectorAll(`[id^="choice-${qid}-"]`)
    .forEach((x) => x.classList.remove("selected"));
  $(`#choice-${qid}-${i}`).classList.add("selected");
  try {
    if (!(await getToken())) return;
    let r = await api("/answer/" + qid, {
      method: "POST",
      body: JSON.stringify({ choice: i }),
    });
    const result = $(`#result-${qid}`);
    if (!result) return;
    result.innerHTML = `<div class="notice">${r.correct ? "✓ 回答正确" : "参考答案：" + String.fromCharCode(65 + r.answer)}<p>${esc(r.explanation)}</p></div>`;
  } catch (e) {
    notify(e.message);
  }
}
async function saveProgress(cid, completed) {
  try {
    const c = state.selected;
    const hadToken = Boolean(state.token);
    if (!(await getToken()) || state.selected !== c) return;
    if (!hadToken) c.progress = (await api("/learning/" + cid)).progress;
    const seconds = Math.min(
      86400,
      Math.floor((Date.now() - state.start) / 1000) + c.progress.seconds,
    );
    await api("/progress/" + cid, {
      method: "POST",
      body: JSON.stringify({ seconds, completed }),
    });
    if (state.selected === c) {
      c.progress = { seconds, completed: completed || c.progress.completed };
      state.start = Date.now();
      $("#course-progress").textContent = progressText(c.progress);
    }
    notify("学习记录已保存");
  } catch (e) {
    notify(e.message);
  }
}
function progressText(progress) {
  return `实际学习记录：${Math.floor(progress.seconds / 60)}分钟${progress.completed ? " · 已完成" : ""}`;
}
async function saveNote(cid) {
  try {
    const body = $("#note").value;
    if (!(await getToken())) return;
    await api("/notes/" + cid, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    notify("笔记已保存");
  } catch (e) {
    notify(e.message);
  }
}
async function unlockLearning() {
  if (await getToken()) renderProfile();
}
async function renderProfile() {
  const main = $("#main");
  const request = ++state.request;
  if (!state.token) {
    main.innerHTML = `<h1>我的学习中心</h1><p>输入访问口令后，即可查看学习记录、笔记与收藏。</p>${btn("输入口令", "unlockLearning()")} ${btn("导入课程", "showImport()", "btn secondary")}`;
    return;
  }
  main.innerHTML = "<h1>我的学习中心</h1><p>正在读取学习记录…</p>";
  try {
    const d = await api("/dashboard");
    if (request !== state.request) return;
    main.innerHTML = `<h1>我的学习中心</h1><div class="grid"><div class="card"><div class="sub">已完成课程版本</div><div class="stat">${d.completed}</div></div><div class="card"><div class="sub">学习分钟</div><div class="stat">${Math.floor(d.seconds / 60)}</div></div><div class="card"><div class="sub">练习答对 / 提交</div><div class="stat">${d.attempts.correct} / ${d.attempts.n}</div></div></div>
  <h2>课程记录与笔记</h2><div class="list">${d.records.map((r) => `<div class="card">${courseRow(r)}<p>${esc(progressText({ seconds: r.seconds || 0, completed: r.completed }))} · 答对 ${r.correct} / 提交 ${r.attempts}</p>${r.body ? `<p class="saved-note">${esc(r.body)}</p>` : ""}</div>`).join("") || "<p>暂无学习记录。</p>"}</div>
  <h2>收藏文献</h2><div class="list">${d.bookmarks.map((r) => refRow(r, true)).join("") || "<p>暂无收藏。</p>"}</div>
  <h2>课程与数据管理</h2><div class="actions">${btn("导出备份", "exportBackup()")} ${btn("导入课程", "showImport()", "btn secondary")} ${btn("清除会话口令", "clearToken()", "btn secondary")}</div>`;
  } catch (e) {
    if (request === state.request)
      main.innerHTML = `<h1>我的学习中心</h1><p class="notice">${esc(e.message)}</p>${btn("清除会话口令", "clearToken()", "btn secondary")}`;
  }
}
function showImport() {
  state.request++;
  state.selected = null;
  $("#main").innerHTML =
    `<div class="eyebrow">CONTENT IMPORT</div><h1>导入完整课程</h1><p class="sub">支持完整 Markdown、TXT，以及含课程、文献、题目和工具的 JSON 文件。导入前请核对课程日期与来源。</p><div class="notice">本网站不会直接读取ChatGPT定期任务。请粘贴完整正文或选择文件。已有同日课程会保存为新版本；相同内容不会重复导入。</div><div class="card"><label>管理口令（仅当前会话）</label><input id="token" type="password" placeholder="部署时设置的 EVIDENCE_ADMIN_TOKEN" value="${esc(state.token)}" style="width:100%"><div class="formrow"><div><label>课程日期（北京时间）</label><input id="day" type="date" value="${state.status.today || ""}"></div><div><label>建议学习分钟</label><input id="minutes" type="number" min="1" max="300" value="70"></div></div><label>课程标题</label><input id="title" style="width:100%" placeholder="例如：血脂、ApoB与ASCVD风险分层"><label for="system">医学系统或管理领域</label><input id="system" style="width:100%" placeholder="例如：心血管系统"><label for="source">课程来源</label><input id="source" style="width:100%" placeholder="例如：研修课程原稿"><label for="topic">专题</label><input id="topic" style="width:100%" placeholder="例如：心血管风险评估"><label>上传文件</label><input id="upload" type="file" accept=".md,.txt,.json" onchange="loadFile(this)"><label>课程完整正文（Markdown）</label><textarea id="content" style="min-height:260px" placeholder="粘贴完整课程，支持Markdown标题、表格、引用链接…"></textarea><label for="refs">文献条目（JSON 数组）</label><textarea id="refs" style="min-height:90px" placeholder='[{"title":"文献标题","source":"来源","doi":"","pmid":"","url":"原文地址","full_text_url":"全文地址","access":"全文获取状态"}]'></textarea><label for="questions">结构化案例（JSON 数组）</label><textarea id="questions" style="min-height:90px" placeholder='[{"question":"题干","options":["A","B"],"answer":0,"explanation":"解析"}]'></textarea><label for="tools">工作工具（JSON 数组）</label><textarea id="tools" style="min-height:90px" placeholder='[{"kind":"体检审核清单","title":"工具标题","content":"Markdown 正文"}]'></textarea><div class="actions">${btn("核对并发布课程", "publish()")}${btn("返回首页", "navigate('home')", "btn secondary")}</div></div>`;
  window.scrollTo(0, 0);
}
async function loadFile(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    if (file.size > 3_000_000) throw Error("文件超过 3 MB");
    const text = (await file.text()).replace(/^\uFEFF/, "");
    if (file.name.toLowerCase().endsWith(".json")) {
      const data = JSON.parse(text);
      for (const key of [
        "day",
        "title",
        "topic",
        "system",
        "source",
        "minutes",
        "content",
      ]) {
        $("#" + key).value = data[key] ?? (key === "minutes" ? 60 : "");
      }
      for (const [key, id] of [
        ["references", "refs"],
        ["questions", "questions"],
        ["tools", "tools"],
      ]) {
        $("#" + id).value = JSON.stringify(data[key] ?? [], null, 2);
      }
    } else {
      $("#content").value = text;
    }
    notify("文件已载入，请核对后发布");
  } catch (e) {
    notify("文件读取失败：" + e.message);
  }
}
async function publish() {
  try {
    state.token = $("#token").value;
    sessionStorage.setItem("evidence_token", state.token);
    const data = Object.fromEntries(
      ["day", "title", "topic", "system", "source", "content"].map((key) => [
        key,
        $("#" + key).value,
      ]),
    );
    data.source = data.source || "manual";
    data.minutes = Number($("#minutes").value);
    for (const [key, id] of [
      ["references", "refs"],
      ["questions", "questions"],
      ["tools", "tools"],
    ]) {
      data[key] = JSON.parse($("#" + id).value.trim() || "[]");
    }
    if (!data.day || !data.title.trim() || !data.content.trim())
      throw Error("日期、标题和正文不能为空");
    const result = await api("/courses", {
      method: "POST",
      body: JSON.stringify(data),
    });
    state.page = "archive";
    await load();
    await openCourse(result.id);
    notify(
      result.duplicate
        ? "该内容已归档"
        : "课程已发布，第" + result.version + "版",
    );
  } catch (e) {
    notify("发布失败：" + e.message);
  }
}
async function exportBackup() {
  try {
    const r = await fetch("/api/export", {
      headers: { "X-Admin-Token": state.token },
    });
    if (!r.ok) throw Error((await r.json()).detail);
    let blob = await r.blob();
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "evidence-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    notify(e.message);
  }
}
document
  .querySelectorAll("nav button")
  .forEach((b) => b.addEventListener("click", () => navigate(b.dataset.page)));
$("#theme").onclick = () => {
  document.body.classList.toggle("dark");
  localStorage.setItem(
    "evidence_theme",
    document.body.classList.contains("dark") ? "dark" : "light",
  );
};
if (localStorage.getItem("evidence_theme") === "dark")
  document.body.classList.add("dark");
load();
