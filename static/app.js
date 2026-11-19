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
  chronic: [],
  topicCategory: "",
  topicSearch: "",
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
let timestampRequest = 0;
function updateTimestampDisplay(status) {
  const times = [status.site_build_at, status.course_import_at]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()));
  const last = times.length ? new Date(Math.max(...times.map((date) => date.getTime()))) : null;
  const time = last ? new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(last) : "暂无记录";
  const label = `内容持续更新中 · 最近更新 ${time}（北京时间）`;
  const explanation = "以站点版本构建时间和课程导入时间中较晚者为准；学习记录变动不会改变此时间。";
  const element = $("#update-status");
  if (element) {
    element.textContent = label;
    element.title = explanation;
  }
}
async function refreshTimestamp() {
  const request = ++timestampRequest;
  try {
    const next = await api("/status");
    if (request !== timestampRequest) return;
    const previous = state.status;
    state.status = next;
    $("#clock").textContent = "北京时间 " + next.today;
    updateTimestampDisplay(next);
    if ((previous.site_build_at && previous.site_build_at !== next.site_build_at) ||
        (previous.course_import_at && previous.course_import_at !== next.course_import_at)) {
      notify("检测到内容更新，请刷新页面查看最新版本。");
    }
  } catch (_) {
    // Keep the last verified timestamp rather than replacing it with the current time.
  }
}
async function load() {
  const statusRequest = ++timestampRequest;
  try {
    const [courses, refs, tools, status, chronic] = await Promise.all([
      api("/courses"),
      api("/references"),
      api("/tools"),
      api("/status"),
      api("/chronic"),
    ]);
    Object.assign(state, { courses, refs, tools, chronic });
    if (statusRequest === timestampRequest) state.status = status;
    $("#syncStatus").textContent =
      "同步方式：手动导入 · " +
      (state.status.write_locked ? "写入锁定" : "写入已配置");
    $("#clock").textContent = "北京时间 " + state.status.today;
    render();
    updateTimestampDisplay(state.status);
  } catch (e) {
    $("#main").innerHTML =
      `<div class="notice">加载失败：${esc(e.message)}</div>`;
  }
}
function navigate(page, relatedTopic = "") {
  state.request++;
  state.page = page;
  if (page === "readings") {
    readingLibrary.id = null;
    readingLibrary.relatedTopic = relatedTopic;
    readingLibrary.topicContext = relatedTopic;
    readingLibrary.level = "";
    readingLibrary.query = "";
  }
  if (page === "home") {
    state.topicCategory = "";
    state.topicSearch = "";
  }
  state.selected = null;
  document
    .querySelectorAll("#nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  render();
  window.scrollTo(0, 0);
}
const topicQuestions = {
  hypertension: ["体检血压偏高，怎么确认？", "血压 · 家庭血压 · 动态血压"],
  diabetes: ["空腹血糖或糖化升高，怎么复查？", "血糖 · HbA1c · 糖尿病前期"],
  lipids: ["LDL-C 偏高或没标红，怎么判断风险？", "血脂 · 胆固醇 · ApoB · Lp(a)"],
  obesity: ["腰围超标，体重管理从哪开始？", "超重 · 肥胖 · 腹型肥胖"],
  ckd: ["肌酐、eGFR 或尿蛋白异常，怎么判断？", "肾功能 · 尿白蛋白 · 尿蛋白阳性 · 肌酐异常 · 肌酐升高 · 慢性肾病"],
  masld: ["超声提示脂肪肝，要评估哪些风险？", "脂肪肝 · MASLD · 肝纤维化"],
  urate: ["尿酸高了，何时复查或转诊？", "高尿酸 · 痛风 · 肾结石"],
  osteoporosis: ["骨密度低，要关注哪些骨折风险？", "骨密度 · DXA · 跌倒"],
  menopause: ["围绝经期体检，哪些项目有必要？", "绝经 · 潮热 · 女性健康"],
  "thyroid-function": ["甲功三项、五项、七项怎么选？", "甲状腺 · TSH · FT4 · FT3 · 甲功异常"],
  "h-pylori": ["¹³C 呼气试验阳性，下一步怎么做？", "C13 · Hp · 幽门螺杆菌 · 根除复测"],
  "cervical-spine": ["颈椎曲度变直、骨赘或手麻，怎么处理？", "颈椎 · 颈肩痛 · 手麻 · 颈椎病"],
  "lumbar-spine": ["腰椎间盘膨出或腰腿痛，要做什么检查？", "腰椎 · 腰痛 · 坐骨神经痛 · 腰椎间盘突出"],
  dizziness: ["头晕、眩晕，什么时候需要急诊？", "头晕 · 眩晕 · 耳石症 · 站立不稳"],
  headache: ["头疼或反复头痛，哪些信号需要就医？", "头痛 · 头疼 · 偏头痛 · 雷击样头痛"],
  "stool-blood": ["大便隐血阳性，下一步需要做肠镜吗？", "大便隐血 · 大便潜血 · 便潜血 · 粪便隐血 · 便隐血 · FIT"],
  "urine-blood": ["小便隐血或尿潜血阳性，怎么复查？", "小便隐血 · 小便潜血 · 尿隐血 · 尿潜血 · 镜下血尿"],

};

const topicCategories = {
  chronic: {
    name: "慢病与代谢",
    description: "适合查已确诊慢病、反复异常或长期风险的管理方法，例如血压偏高、血糖异常和尿酸升高。",
    steps: [
      "先区分首次发现、反复异常和已确诊治疗中，带上近期用药及历年结果。",
      "打开对应专题，先读「检后解读」，再看「复查随访」。核对个体目标、复查指标和负责岗位。",
      "准备下一次随访时，下载工作表记录约定、复查结果和临床反馈。",
    ],
    topics: ["hypertension", "diabetes", "lipids", "obesity", "urate", "masld", "ckd"],
  },
  lab: {
    name: "检验异常",
    description: "适合拿着一项化验结果来查，例如甲功、尿潜血、尿蛋白、尿白蛋白或肌酐。",
    steps: [
      "先核对实际检测项目、数值、单位、参考区间、方法和采样条件。",
      "同时看同组指标与历年结果。打开「检后解读」，核对本次发现属于哪种异常组合。",
      "再用随访工具记录需要复测的项目、采样要求，以及什么情况要请医生复核。",
    ],
    topics: ["thyroid-function", "urine-blood", "ckd"],
  },
  imaging: {
    name: "影像异常",
    description: "适合看超声、CT、X 线或 MRI 报告里出现的偶然发现、结构变化或病变描述。",
    steps: [
      "带上完整报告、检查方式、部位、分级或尺寸、原报告建议和历次影像。",
      "对照专题的「检后解读」，判断报告描述与症状、体征及历年变化是否一致。",
      "依据原报告和临床评估，在随访表记录是否需对比旧片、复查或转专科。",
    ],
    topics: ["cervical-spine", "lumbar-spine", "masld"],
  },
  symptoms: {
    name: "症状与心电",
    description: "适合从头晕、头痛、颈肩痛、腰腿痛或心悸等主诉出发，梳理问诊与分流。当前上线的工作包覆盖头晕、头痛和脊柱相关症状。",
    steps: [
      "先记录起病时间、持续多久、诱因、最重程度和伴随症状；如有心电报告，带上原图。",
      "主动看专题的警示症状与转介说明。出现急性警示时，先按院内急诊流程处理。",
      "稳定或反复的情况，可用症状记录与工作包里的案例练习复诊交接。",
    ],
    topics: ["dizziness", "headache", "cervical-spine", "lumbar-spine"],
  },
  screening: {
    name: "筛查与阳性随访",
    description: "适合筛查报告已经提示阳性、需要确认或记录后续处置时使用。目前可查粪便隐血和 ¹³C 呼气试验。",
    steps: [
      "先核对筛查项目、检测方法、日期、样本或用药情况及既往检查结果。",
      "打开对应专题的「检后解读」和「复查随访」，确认下一步是诊断评估还是治疗后复测。",
      "在随访表上记录预约、负责岗位、结果回收和下一步安排，核对是否完成闭环。",
    ],
    topics: ["stool-blood", "h-pylori"],
  },
  womens: {
    name: "女性与骨健康",
    description: "适合围绝经期、绝经后健康评估和骨折风险管理。骨健康工作包也供符合其适用条件的其他人群查阅。",
    steps: [
      "先理清月经与症状变化、既往骨折和跌倒、用药及历年报告。",
      "根据当前问题选择围绝经期管理或骨质疏松专题，用「项目设计」查看哪些检查适合当前风险。",
      "用工具记录症状、功能和复查反馈。需专科判断的问题，按工作包说明安排转介。",
    ],
    topics: ["menopause", "osteoporosis"],
  },
};

function setTopicCategory(key) {
  state.topicCategory = key;
  state.topicSearch = "";
  renderHome();
  $(".category-filters [aria-pressed=true]").focus({ preventScroll: true });
  $("#topic-title").scrollIntoView({ block: "start" });
}

function returnToTopicList() {
  state.request++;
  state.selected = null;
  renderHome();
  $("#topic-title").focus({ preventScroll: true });
  $("#topic-title").scrollIntoView({ block: "start" });
}

function categoryGuide(category) {
  if (!category) return "";
  const kidney = state.chronic.find((course) => course.slug === "ckd");
  const links = category === topicCategories.lab && kidney
    ? `<div class="actions">${["尿蛋白", "尿白蛋白", "肌酐异常"].map((label) =>
        btn(label, `openCourse(${kidney.id}, false, 'interpretation')`, "btn secondary")
      ).join("")}</div>`
    : "";
  return `<section class="category-guide" aria-labelledby="category-guide-title">
    <h3 id="category-guide-title">${esc(category.name)} · 使用指南</h3>
    <p>${esc(category.description)}</p>
    <ol>${category.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>
    ${links}
  </section>`;
}

function renderHome() {
  const today = state.courses.find((course) => course.day === state.status.today);
  const recent = state.courses.find((course) => course.day < state.status.today);
  const daily = today || recent;
  const category = topicCategories[state.topicCategory];
  $("#main").innerHTML = `<section class="home-hero" aria-labelledby="home-title">
    <h1 id="home-title">体检循证与健康管理工作台</h1>
    <p>从体检发现出发，对照指南和真实病例，理解健康风险与长期管理。</p>
    <div class="actions">${btn("今日研修", "navigate('today')", "btn secondary")}
      ${btn("历史课程", "navigate('archive')", "btn secondary")}
      ${btn("体检病例精读库", "navigate('readings')", "btn secondary")}
      ${btn("循证指南与应用", "navigate('evidence')", "btn secondary")}</div>
  </section>
  <section aria-labelledby="topic-title">
    <div class="home-topic-heading"><h2 id="topic-title" tabindex="-1">体检常见问题</h2>
      <div><label for="topic-search">查找工作包</label>
        <input class="search" id="topic-search" type="search" placeholder="例如：尿酸、甲功、C13"></div>
    </div>
    <div class="category-filters" role="group" aria-label="专题分类">
      ${[["", "全部专题"], ...Object.entries(topicCategories).map(([key, item]) => [key, item.name])].map(([key, label]) =>
        `<button class="btn secondary" type="button" aria-pressed="${key === state.topicCategory}" onclick="setTopicCategory('${key}')">${esc(label)}</button>`
      ).join("")}
    </div>
    ${categoryGuide(category)}
    <div class="home-topics" id="home-topics"></div>
    <p class="muted" id="topic-empty" role="status" hidden></p>
  </section>
  <section aria-labelledby="daily-title"><h2 id="daily-title">${today ? "今日研修" : "最近发布的研修"}</h2>
    ${daily ? courseRow(daily) : '<p class="muted">暂无已发布课程。</p>'}
  </section>`;
  updateTimestampDisplay(state.status);
  const search = $("#topic-search");
  search.value = state.topicSearch;
  search.addEventListener("input", () => {
    state.topicSearch = search.value;
    filterHomeTopics(search.value);
  });
  filterHomeTopics(state.topicSearch);
}

function filterHomeTopics(value) {
  const normalize = (text) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const query = normalize(value);
  const featured = ["thyroid-function", "h-pylori", "urate"];
  const ordered = [
    ...featured.map((slug) => state.chronic.find((course) => course.slug === slug)).filter(Boolean),
    ...state.chronic.filter((course) => !featured.includes(course.slug)),
  ];
  const category = topicCategories[state.topicCategory];
  const courses = ordered.filter((course) =>
    (!category || category.topics.includes(course.slug)) &&
    normalize([course.name, course.title, ...(topicQuestions[course.slug] || [])].join(" ")).includes(query),
  );
  $("#home-topics").innerHTML = courses.map((course) => {
    const [question, terms] = topicQuestions[course.slug] || [course.name, ""];
    return `<button class="home-topic" type="button" onclick="openCourse(${course.id})">
      <strong>${esc(question)}</strong><span>${esc(terms || course.name)}</span><span class="topic-arrow" aria-hidden="true">↗</span>
    </button>`;
  }).join("");
  $("#topic-empty").hidden = Boolean(courses.length);
  $("#topic-empty").textContent = state.chronic.length
    ? "没有找到匹配的问题。"
    : "尚未导入工作包。可从「体检专题」导入。";
}
function render() {
  const m = $("#main");
  if (state.selected) {
    renderCourse();
    return;
  }
  if (state.page === "home") {
    renderHome();
  } else if (state.page === "evidence") {
    renderEvidenceCatalog();
  } else if (state.page === "readings") {
    renderReadingLibrary();
  } else if (state.page === "today") {
    const today = state.courses.find((c) => c.day === state.status.today);
    if (today) {
      m.innerHTML = '<p class="loading">正在读取今日课程…</p>';
      openCourse(today.id);
    } else {
      const recent = state.courses
        .filter((c) => c.day < state.status.today)
        .slice(0, 4);
      m.innerHTML = `<div class="hero"><h1>今日研修</h1><p>北京时间 ${esc(state.status.today)} · 每日研修建议 60–90 分钟</p><div class="actions">${btn("导入课程", "showImport()")} ${btn("浏览课程档案", "navigate('archive')", "btn secondary")}</div></div><p class="notice">今天还没有已发布的课程。</p><div class="sectionhead"><h2>近期课程</h2></div><div class="list">${recent.map((course) => courseRow(course)).join("") || '<p class="muted">暂无历史课程。</p>'}</div>`;
    }
  } else if (state.page === "archive") {
    m.innerHTML = `<div class="eyebrow">COURSE ARCHIVE</div><h1>每日课程档案</h1><p class="sub">所有课程按北京时间日期保存；同一天修订保留历史版本。</p><input class="search" placeholder="搜索标题、全文、专题或输入日期 YYYY-MM-DD" oninput="filterCourses(this.value)"><div id="courseList" class="list">${state.courses.map((course) => courseRow(course)).join("") || empty()}</div>`;
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
  } else if (state.page === "chronic") {
    m.innerHTML = `<h1>体检专题</h1>
      <p class="sub">按病种研修检前沟通、项目设计、检后解读与复查随访。</p>
      <div class="list">${state.chronic.map((course) => `<div class="listrow">
        <div><strong>${esc(course.name)}</strong><p>${esc(course.title)}</p>
        <small>${esc(course.day)} · 第${course.version}版 · ${course.minutes}分钟</small></div>
        ${btn("打开学习工作包", `openCourse(${course.id})`)}
      </div>`).join("") || '<p class="notice">尚未发布病种工作包。</p>'}</div>
      <div class="actions">${btn("导入工作包", "showImport(true)", "btn secondary")}</div>`;
  } else if (state.page === "tools") {
    m.innerHTML = `<h1>健康管理工具库</h1>${
      ["体检审核清单", "报告解读模板", "随访工具", "其他"]
        .map((kind) => {
          const items = state.tools.filter((t) => t.kind === kind);
          return items.length
            ? `<section><h2>${kind === "报告解读模板" ? "检查与结果解读参考" : kind}</h2><div class="list">${items.map((t) => `<details class="card"><summary><strong>${esc(t.title)}</strong> <small>${esc(t.day)} · 第${t.version}版</small></summary><article data-tool-id="${t.id}">${t.html}</article>${btn("查看来源课程", `openCourse(${t.course_id})`, "btn secondary")}</details>`).join("")}</div></section>`
            : "";
        })
        .join("") || empty("尚未导入工作工具")
    }`;
    enableToolChecklists(m);
  } else if (state.page === "profile") renderProfile();
}
function enableToolChecklists(main) {
  for (const tool of main.querySelectorAll("[data-tool-id]")) {
    const key = "evidence_tool_" + tool.dataset.toolId;
    const boxes = [...tool.querySelectorAll("input[type=checkbox]")];
    if (!boxes.length) continue;
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(saved)) boxes.forEach((box, i) => { box.checked = saved[i] === true; });
    } catch {
      // The checklist is still usable when local browser storage is unavailable.
    }
    boxes.forEach((box) => {
      box.disabled = false;
      const caption = box.parentElement.textContent.trim();
      if (caption) box.setAttribute("aria-label", caption);
    });
    const count = document.createElement("p");
    count.className = "sub";
    count.setAttribute("role", "status");
    tool.prepend(count);
    function updateCount() {
      count.textContent = `已核对 ${boxes.filter((box) => box.checked).length} / ${boxes.length} 项`;
    }
    updateCount();
    tool.addEventListener("change", () => {
      updateCount();
      try {
        localStorage.setItem(key, JSON.stringify(boxes.map((box) => box.checked)));
      } catch {
        notify("此浏览器无法保存勾选记录");
      }
    });
  }
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
async function openCourse(id, practice = false, section = null) {
  const request = ++state.request;
  try {
    const c = await api("/courses/" + id);
    c.progress = { seconds: 0, completed: 0 };
    c.note = null;
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
    if (section) jumpToSection(section);
    else if (practice) $("#practice").scrollIntoView();
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
    `<div class="course"><div class="actions">${btn(state.page === "home" ? (state.topicCategory ? "← 返回分类" : "← 返回首页") : (state.page === "readings" ? "← 返回病例" : "← 返回列表"), state.page === "home" ? "returnToTopicList()" : state.page === "readings" ? "returnToReading()" : `navigate('${state.page === "today" ? "archive" : state.page}')`, "btn secondary")}${btn("打印 / 保存PDF", "window.print()", "btn secondary")}${btn("标记完成", `saveProgress(${c.id},true)`, "btn")}</div><div class="eyebrow">${esc(c.day)} · 课程第${c.version}版</div><h1>${esc(c.title)}</h1><p class="sub">${esc(c.topic)} · 建议${c.minutes}分钟 · 来源：${esc(c.source)} · 原文版本保留</p><div class="card" style="margin-bottom:16px"><div class="sub">本课程历史版本</div><div class="actions">${c.versions.map((v) => btn("v" + v.version, `openCourse(${v.id})`, v.id === c.id ? "btn" : "btn secondary")).join("")}</div><div class="sub" id="course-progress">${progressText(c.progress)}</div></div>${c.chronic ? evidenceTopicPanel() : ""}<article id="courseArticle">${c.html}</article>${chronicWorkspace(c)}<div class="sectionhead"><h2>本期研究全文入口</h2></div>${c.references.length ? `<div class="list">${c.references.map((r) => refRow(r)).join("")}</div>` : empty("本课程尚未录入结构化文献链接")}<div class="sectionhead"><h2 id="practice">临床案例与练习</h2></div>${c.questions.length ? c.questions.map((q) => `<div class="card" style="margin-bottom:12px"><h3>${esc(q.question)}</h3>${q.options.map((o, i) => `<button class="choice" id="choice-${q.id}-${i}" onclick="choose(${q.id},${i})">${String.fromCharCode(65 + i)}. ${esc(o)}</button>`).join("")}<div id="result-${q.id}"></div></div>`).join("") : empty("当前课程没有单独导入结构化练习题")}${chronicTools(c)}<div class="sectionhead"><h2>我的课程笔记</h2></div><div id="course-note">${courseNote(c)}</div><div class="actions">${btn("保存学习进度", `saveProgress(${c.id},false)`, "btn secondary")}</div></div>`;
  if (c.chronic) {
    enableToolChecklists($("#main"));
    wireEvidenceTopic(c);
  }
}
const chronicSections = [
  ["precheck", "检前沟通"],
  ["design", "项目设计"],
  ["interpretation", "检后解读"],
  ["followup", "复查随访"],
];

function chronicWorkspace(course) {
  const info = course.chronic;
  if (!info) return "";
  const shortcuts = [
    ...chronicSections,
    ["guidelines", "指南对照"],
    ["practice", "互动案例"],
    ["worktools", "工作工具"],
  ];
  return `<nav class="chronic-links" aria-label="慢病工作包章节">
    ${shortcuts.map(([key, label]) => btn(label, `jumpToSection('${key}')`, "btn secondary")).join("")}
    </nav><p class="sub">版本修订 · ${esc(info.revision_notes)}</p>
    <p class="sub">受影响的体检决策 · ${esc(info.affected_decisions)}</p>
    ${chronicSections.map(([key, label]) => `<article id="${key}"><h2>${label}</h2>${info.sections[key]}</article>`).join("")}
    <article id="guidelines"><h2>指南对照与精读任务</h2>${info.guidelines}</article>`;
}
function chronicTools(course) {
  if (!course.chronic) return "";
  return `<section id="worktools"><h2>工作工具</h2><div class="list">${course.tools.map((tool) =>
    `<details class="card"><summary><strong>${esc(tool.title)}</strong></summary>
    <article data-tool-id="${tool.id}">${tool.html}</article>
    <div class="actions">${btn("复制模板", `copyWorkTool(${tool.id})`, "btn secondary")}
    ${btn("下载 Markdown", `downloadWorkTool(${tool.id})`, "btn secondary")}</div></details>`).join("")}</div></section>`;
}
function jumpToSection(id) {
  document.getElementById(id)?.scrollIntoView();
}
async function copyWorkTool(id) {
  const tool = state.selected?.tools?.find((item) => item.id === id);
  if (!tool) return;
  try {
    await navigator.clipboard.writeText(tool.content);
    notify("已复制模板");
  } catch {
    notify("当前浏览器禁止复制，请使用下载按钮");
  }
}
function downloadWorkTool(id) {
  const tool = state.selected?.tools?.find((item) => item.id === id);
  if (!tool) return;
  const url = URL.createObjectURL(new Blob([tool.content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = tool.title.replace(/[\\/:*?"<>|]/g, "_") + ".md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function courseNote(course) {
  if (!course.note) return btn("解锁并读取笔记", `unlockCourseNote(${course.id})`);
  return `<textarea id="note" aria-label="我的课程笔记" placeholder="记录重点或临床疑问" maxlength="30000">${esc(course.note.body)}</textarea>
    <div class="actions">${btn("保存笔记", `saveNote(${course.id})`)}</div>`;
}
async function unlockCourseNote(id) {
  const course = state.selected;
  try {
    if (!await getToken() || state.selected !== course) return;
    const learning = await api("/learning/" + id);
    if (state.selected !== course) return;
    Object.assign(course, learning);
    $("#course-note").innerHTML = courseNote(course);
    $("#course-progress").textContent = progressText(course.progress);
    $("#note").focus();
  } catch (e) {
    notify(e.message);
  }
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
function showImport(chronic = false) {
  state.request++;
  state.selected = null;
  $("#main").innerHTML =
    `<div class="eyebrow">CONTENT IMPORT</div><h1>${chronic ? "导入慢病工作包" : "导入完整课程"}</h1><p class="sub">支持完整 Markdown、TXT，以及含课程、文献、题目和工具的 JSON 文件。导入前请核对课程日期与来源。</p><div class="notice">本网站不会直接读取ChatGPT定期任务。请粘贴完整正文或选择文件。已有同日课程会保存为新版本；相同内容不会重复导入。</div><div class="card"><label>管理口令（仅当前会话）</label><input id="token" type="password" placeholder="部署时设置的 EVIDENCE_ADMIN_TOKEN" value="${esc(state.token)}" style="width:100%"><div class="formrow"><div><label>课程日期（北京时间）</label><input id="day" type="date" value="${state.status.today || ""}"></div><div><label>建议学习分钟</label><input id="minutes" type="number" min="1" max="300" value="70"></div></div><label>课程标题</label><input id="title" style="width:100%" placeholder="例如：血脂、ApoB与ASCVD风险分层"><label for="system">医学系统或管理领域</label><input id="system" style="width:100%" placeholder="例如：心血管系统"><label for="source">课程来源</label><input id="source" style="width:100%" placeholder="例如：研修课程原稿"><label for="topic">专题</label><input id="topic" style="width:100%" placeholder="例如：心血管风险评估"><label>上传文件</label><input id="upload" type="file" accept=".md,.txt,.json" onchange="loadFile(this)"><label>课程完整正文（Markdown）</label><textarea id="content" style="min-height:260px" placeholder="粘贴完整课程，支持Markdown标题、表格、引用链接…"></textarea><label for="refs">文献条目（JSON 数组）</label><textarea id="refs" style="min-height:90px" placeholder='[{"title":"文献标题","source":"来源","doi":"","pmid":"","url":"原文地址","full_text_url":"全文地址","access":"全文获取状态"}]'></textarea><label for="questions">结构化案例（JSON 数组）</label><textarea id="questions" style="min-height:90px" placeholder='[{"question":"题干","options":["A","B"],"answer":0,"explanation":"解析"}]'></textarea><label for="chronic-meta">慢病工作包（JSON 对象，日常课程留空）</label><textarea id="chronic-meta" aria-label="慢病工作包字段"></textarea><label for="tools">工作工具（JSON 数组）</label><textarea id="tools" style="min-height:90px" placeholder='[{"kind":"体检审核清单","title":"工具标题","content":"Markdown 正文"}]'></textarea><div class="actions">${btn("核对并发布课程", "publish()")}${btn("返回首页", "navigate('home')", "btn secondary")}</div></div>`;
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
      $("#chronic-meta").value = data.chronic ? JSON.stringify(data.chronic, null, 2) : "";
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
    const chronicMeta = $("#chronic-meta").value.trim();
    if (chronicMeta) data.chronic = JSON.parse(chronicMeta);
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
    navigate(data.chronic ? "chronic" : "archive");
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
  .querySelectorAll("#nav button")
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
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshTimestamp();
});
setInterval(() => { if (!document.hidden) refreshTimestamp(); }, 120000);
load();
