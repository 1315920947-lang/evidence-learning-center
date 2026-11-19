const readingLevels = ["初级", "中级", "高级"];
const readingLibrary = { items: null, level: "", query: "", id: null, relatedTopic: "", topicContext: "" };

function readingSourceLink(label, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return "";
  return `<a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

async function renderReadingLibrary() {
  const container = $("#main");
  const request = state.request;
  if (!readingLibrary.items) {
    container.innerHTML = '<h1>体检病例精读库</h1><p role="status">正在加载病例…</p>';
    try {
      const response = await fetch("/static/case-library.json?v=4");
      if (!response.ok) throw Error("无法读取病例资料");
      readingLibrary.items = await response.json();
    } catch {
      if (state.page === "readings" && state.request === request)
        container.innerHTML = `<h1>体检病例精读库</h1><p role="alert">病例资料暂时无法加载。</p>${btn("重试", "renderReadingLibrary()")}`;
      return;
    }
  }
  if (state.page !== "readings" || state.selected || state.request !== request) return;
  const item = readingLibrary.items.find((entry) => entry.id === readingLibrary.id);
  if (item) {
    renderReadingDetail(item);
    return;
  }
  container.innerHTML = `<h1>体检病例精读库</h1>
    <p class="sub">按初级、中级、高级阅读公开病例，理解体检发现、指南依据和长期健康管理。</p>
    ${!readingLibrary.relatedTopic ? `<div class="listrow"><div><strong>循证自学推荐</strong><p>体检血糖、血压同时升高：如何理解风险与长期管理？</p></div>
      <button id="reading-featured" type="button" class="btn secondary">阅读自学案例</button>
    </div>` : ""}
    <div class="category-filters" role="group" aria-label="病例级别">
      ${["", ...readingLevels].map((level) => `<button type="button" class="btn secondary" data-reading-level="${level}" aria-pressed="${level === readingLibrary.level}">${level || "全部级别"}</button>`).join("")}
    </div>
    ${readingLibrary.relatedTopic ? `<div class="actions"><span>仅显示所选专题的公开病例</span>
      <button id="all-published-readings" class="btn secondary" type="button">查看全部病例</button></div>` :
      readingLibrary.topicContext ? `<div class="actions"><span>显示全部公开病例</span>
      <button id="related-published-readings" class="btn secondary" type="button">返回相关病例</button></div>` : ""}
    <label for="reading-query">搜索病例</label>
    <input id="reading-query" class="search" type="search" placeholder="例如：肌酸激酶、尿潜血、肺结节">
    <div id="reading-list"></div>`;
  $("#reading-featured")?.addEventListener("click", () => {
    readingLibrary.id = "glucose-bp-lipids";
    renderReadingLibrary();
    window.scrollTo(0, 0);
  });
  $("#all-published-readings")?.addEventListener("click", () => {
    readingLibrary.relatedTopic = "";
    readingLibrary.level = "";
    readingLibrary.query = "";
    renderReadingLibrary();
  });
  $("#related-published-readings")?.addEventListener("click", () => {
    readingLibrary.relatedTopic = readingLibrary.topicContext;
    readingLibrary.level = "";
    readingLibrary.query = "";
    renderReadingLibrary();
  });
  const query = $("#reading-query");
  query.value = readingLibrary.query;
  query.addEventListener("input", () => {
    readingLibrary.query = query.value;
    showReadingResults();
  });
  container.querySelectorAll("[data-reading-level]").forEach((button) => {
    button.addEventListener("click", () => {
      readingLibrary.level = button.dataset.readingLevel;
      container.querySelectorAll("[data-reading-level]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      showReadingResults();
    });
  });
  showReadingResults();
}

function showReadingResults() {
  const normalize = (text) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const query = normalize(readingLibrary.query);
  const acronym = /^[a-z0-9]+$/.test(query)
    ? new RegExp(`(^|[^a-z0-9])${query}(?![a-z0-9])`)
    : null;
  const matchesQuery = (item) => {
    const text = [item.title, item.value, ...item.tags, item.source.title].join(" ");
    return acronym
      ? acronym.test(text.normalize("NFKC").toLowerCase())
      : normalize(text).includes(query);
  };
  const levels = readingLibrary.level ? [readingLibrary.level] : readingLevels;
  const list = $("#reading-list");
  list.innerHTML = levels.map((level) => {
    const matches = readingLibrary.items.filter((item) =>
      item.level === level &&
      (!readingLibrary.relatedTopic || item.related.includes(readingLibrary.relatedTopic)) &&
      matchesQuery(item),
    );
    if (!matches.length) return "";
    return `<section><h2>${level}</h2><div class="list">${matches.map((item) =>
      `<article class="listrow"><div><strong>${esc(item.title)}</strong>
        <p>${esc(item.value)}</p><small>${esc(item.tags.join(" · "))}</small></div>
        <button type="button" class="btn secondary" data-reading-id="${esc(item.id)}">阅读病例</button>
      </article>`).join("")}</div></section>`;
  }).join("") || '<p class="notice" role="status">没有找到匹配病例。</p>';
  list.querySelectorAll("[data-reading-id]").forEach((button) => {
    button.addEventListener("click", () => {
      readingLibrary.id = button.dataset.readingId;
      renderReadingLibrary();
      window.scrollTo(0, 0);
    });
  });
}

function renderReadingDetail(item) {
  const s = item.source;
  const phases = [
    ["病例梗概与时间线", item.timeline],
    ["原作者的分析过程", item.reasoning],
    ["循证健康管理：从病例学到什么", item.application],
  ];
  const related = state.chronic.filter((course) => item.related.includes(course.slug));
  const daily = item.dailyDay && state.courses.find((course) => course.day === item.dailyDay);
  const relatedLinks = related.map((course) => btn(esc(course.name), `openCourse(${course.id})`, "btn secondary"));
  if (daily) relatedLinks.push(btn("肺癌筛查相关研修", `openCourse(${daily.id})`, "btn secondary"));
  const renderList = (title, values, tag = "ol") =>
    `<section><h2>${title}</h2><${tag}>${values.map((text) => `<li>${esc(text)}</li>`).join("")}</${tag}></section>`;
  $("#main").innerHTML = `<article class="reading-detail">
    <button class="btn secondary" type="button" id="back-to-readings">← 返回病例列表</button>
    <h1 tabindex="-1">${esc(item.title)}</h1>
    <p class="sub">${esc(item.level)} · ${esc(item.levelReason)}</p>
    <div class="actions reading-jumps">
      <a class="btn secondary" href="#reading-record">先看病例资料</a>
      <a class="btn secondary" href="#reading-analysis">看原作者分析</a>
      ${readingSourceLink("打开公开病例全文与原图", s.url)}
    </div>
    <section id="reading-record" aria-labelledby="reading-record-title">
      <h2 id="reading-record-title">病例资料</h2>
      <p>${esc(item.profile)}</p>
      <div class="reading-table-scroll" tabindex="0" role="region" aria-label="关键检查与原报告所见">
        <table><caption>关键检查与原报告所见</caption>
        <thead><tr><th scope="col">时间</th><th scope="col">项目</th><th scope="col">原文记录</th></tr></thead>
        <tbody>${item.observations.map(([when, test, result]) =>
          `<tr><td>${esc(when)}</td><th scope="row">${esc(test)}</th><td>${esc(result)}</td></tr>`
        ).join("")}</tbody></table>
      </div>
      <p class="sub">为已发表病例的中文整理。来源中的原始图表和完整病历叙述可通过上方原文入口查阅。</p>
    </section>
    <p><strong>为什么值得读</strong>　${esc(item.value)}</p>
    ${renderList(...phases[0])}
    <div id="reading-analysis">${renderList(...phases[1])}</div>
    <section><h2>最终诊断、处置及随访</h2><p>${esc(item.outcome)}</p></section>
    ${renderList(...phases[2], "ul")}
    ${item.studyQuestions?.length ? `<section><h2>自学思考</h2>${item.studyQuestions.map(([question, answer]) =>
      `<details class="reading-question"><summary>${esc(question)}</summary><p>${esc(answer)}</p></details>`).join("")}</section>` : ""}
    <p><strong>指南来源</strong>　${item.guidelines.map(([label, url]) => readingSourceLink(label, url)).join(" · ")}</p>
    ${relatedLinks.length ? `<section><h2>关联体检专题与研修</h2><div class="actions">${relatedLinks.join("")}</div></section>` : ""}
    <section><h2>原文入口</h2>
      <p>${esc(s.authors)} · ${esc(s.journal)} · ${esc(s.date)}</p>
      <p class="sub">${esc(s.access)} · DOI ${esc(s.doi)} · PMID ${esc(s.pmid)}。精读位置：${esc(s.sections)}。</p>
      ${readingSourceLink(s.title, s.url)}
    </section></article>`;
  $("#back-to-readings").addEventListener("click", () => {
    readingLibrary.id = null;
    renderReadingLibrary();
    $("#reading-query").focus();
  });
  $(".reading-detail h1").focus({ preventScroll: true });
}

function returnToReading() {
  state.request++;
  state.selected = null;
  renderReadingLibrary();
  window.scrollTo(0, 0);
}
