let evidencePromise;
function loadEvidenceResources() {
  if (!evidencePromise) {
    evidencePromise = fetch("/static/evidence-resources.json?v=1")
      .then((response) => {
        if (!response.ok) throw Error("暂时无法读取循证资料");
        return response.json();
      })
      .catch((error) => {
        evidencePromise = null;
        throw error;
      });
  }
  return evidencePromise;
}

function envelopeLink(label, url) {
  if (!url) return "";
  const target = new URL(url);
  return target.protocol === "https:"
    ? `<a href="${esc(target.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
    : "";
}

function evidenceSource(row, expanded = false, scopeNote = "") {
  const details = [
    ["适用范围", row["适用范围"]],
    ["先读哪里", row["优先阅读"]],
    ["如何理解与应用", row["体检应用"]],
    ["入口状态", row["入口说明"]],
    ["入口核对", row["入口机器检查"]],
  ];
  const backupLinks = (row["备用入口"] || []).map((item) => {
    const link = envelopeLink(item["名称"], item["地址"]);
    return link ? `<li>${link}<span>：${esc(item["说明"])}</span></li>` : "";
  }).join("");
  return `<details class="evidence-source"${expanded ? " open" : ""}>
    <summary><strong>${esc(row["资料名称"])}</strong>
      <small>${esc(row["来源地区"]+" · "+row["文件类型"]+" · "+row["发布机构或原刊"])}</small>
    </summary>${scopeNote ? `<p class="evidence-scope">${esc(scopeNote)}</p>` : ""}
    <dl>${details.map(([title,value]) => `<dt>${title}</dt><dd>${esc(value)}</dd>`).join("")}</dl>
    <div class="actions">${envelopeLink("机构或原刊入口", row["来源"])}
      ${envelopeLink("补充入口", row["全文入口"])}
    </div>${backupLinks ? `<div class="backup-links"><strong>备用入口</strong><ul>${backupLinks}</ul></div>` : ""}</details>`;
}

async function renderEvidenceCatalog() {
  const main = $("#main");
  const request = state.request;
  main.innerHTML = '<h1>循证指南与应用</h1><p role="status">正在加载资料…</p>';
  try {
    const { sources } = await loadEvidenceResources();
    if (state.page !== "evidence" || state.request !== request) return;
    const rows = Object.values(sources);
    const groups = [...new Set(rows.map((row) => row["分类"]))];
    main.innerHTML = `<h1>循证指南与应用</h1>
      <p>先读适用人群、重点章节和体检应用，再打开正文。索引、官方解读与全文入口分别标注。</p>
      <div class="actions"><a class="btn secondary" href="/static/evidence-handbook.html" target="_blank" rel="noopener noreferrer">打开中文应用手册</a></div>
      <div class="evidence-shortcuts" aria-label="专题资料快捷查询">
        <span>专题资料直达：</span>
        <button type="button" class="btn secondary" data-evidence-quick="前列腺">前列腺癌筛查</button>
        <button type="button" class="btn secondary" data-evidence-quick="口腔">口腔健康</button>
        <small>这两类目前为资料目录，暂无独立工作包。</small>
      </div>
      <div class="evidence-filters">
        <label for="evidence-query">搜索资料<input id="evidence-query" class="search" type="search" placeholder="例如：甲状腺、肺结节、尿潜血"></label>
        <label for="evidence-region">资料来源<select id="evidence-region"><option value="">全部</option><option>中国</option><option>国际</option></select></label>
        <label for="evidence-group">分类<select id="evidence-group"><option value="">全部</option>${groups.map((group) => `<option>${esc(group)}</option>`).join("")}</select></label>
      </div><p id="evidence-count" role="status"></p><div id="evidence-list"></div>`;
    const update = () => {
      const normalize = (text) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
      const query = normalize($("#evidence-query").value);
      const region = $("#evidence-region").value, group = $("#evidence-group").value;
      const aliases = [["肺癌","肺结节 ldct"],["甲状腺功能","甲功"],["粪便隐血","大便隐血 便潜血 便隐血 fit"],["尿潜血","小便隐血 小便潜血"],["幽门螺杆菌","c13"]];
      const result = rows.filter((row) => {
        const terms = aliases.filter(([key]) => row["主题"].includes(key)).map(([,value]) => value).join(" ");
        return (!region || row["来源地区"] === region) && (!group || row["分类"] === group)
          && normalize([row["资料名称"], row["主题"], row["发布机构或原刊"], row["文件类型"], row["优先阅读"], row["体检应用"], terms].join(" ")).includes(query);
      });
      $("#evidence-count").textContent = `显示 ${result.length} 条资料`;
      $("#evidence-list").innerHTML = result.map((row) => evidenceSource(row)).join("") || "<p>没有找到匹配资料。</p>";
    };
    main.querySelectorAll(".evidence-filters input, .evidence-filters select").forEach((control) => control.addEventListener("input", update));
    main.querySelectorAll("[data-evidence-quick]").forEach((button) => button.addEventListener("click", () => {
      $("#evidence-query").value = button.dataset.evidenceQuick;
      $("#evidence-region").value = "";
      $("#evidence-group").value = "";
      update();
    }));
    update();
  } catch (error) {
    if (state.request === request)
      main.innerHTML = `<h1>循证指南与应用</h1><p role="alert">${esc(error.message)}</p>${btn("重试","renderEvidenceCatalog()")}`;
  }
}

function evidenceTopicPanel() {
  return `<section class="topic-evidence" aria-label="专题循证资料">
    <div class="category-filters" role="group" aria-label="专题学习入口">
      ${[["domestic","国内权威指南依据"],["external","国际权威指南依据"],["cases","体检病例精读库"]].map(([key,label]) =>
        `<button class="btn secondary" type="button" data-evidence-part="${key}" aria-pressed="false" aria-expanded="false" aria-controls="topic-evidence-body">${label}</button>`
      ).join("")}
    </div><div id="topic-evidence-body" hidden></div>
  </section>`;
}

function wireEvidenceTopic(course) {
  const panel = $("#topic-evidence-body");
  if (!panel) return;
  const controls = [...document.querySelectorAll("[data-evidence-part]")];
  let clickId = 0;
  controls.forEach((button) => button.addEventListener("click", async () => {
    const request = ++clickId;
    const show = button.getAttribute("aria-expanded") === "false";
    controls.forEach((other) => {
      other.setAttribute("aria-expanded", String(other === button && show));
      other.setAttribute("aria-pressed", String(other === button && show));
    });
    panel.hidden = !show;
    if (!show) return;
    panel.innerHTML = '<p role="status">正在加载…</p>';
    try {
      const { sources, topics } = await loadEvidenceResources();
      if (request !== clickId || !panel.isConnected) return;
      const pack = topics[course.chronic.slug];
      if (!pack) {
        panel.textContent = "这个专题尚无独立的循证学习资料。";
        return;
      }
      const part = button.dataset.evidencePart;
      if (part === "domestic") {
        const slug = course.chronic.slug;
        const scopes = {
          urate: { "09": "本专题对应高尿酸血症与痛风食养分册。", "80": "本专题对应高尿酸血症营养和运动指导分册。" },
          ckd: { "09": "本专题对应慢性肾脏病食养分册，不替代肾病诊疗指南。" },
          obesity: { "09": "本专题对应成人肥胖食养分册，不替代肥胖诊疗指南。", "80": "生活方式相关背景，四份分册分别针对血压、血糖、血脂和尿酸，并非肥胖诊疗指南。" },
          hypertension: { "80": "本专题对应高血压营养和运动指导分册。" },
          diabetes: { "80": "本专题对应高血糖症营养和运动指导分册。" },
          lipids: { "80": "本专题对应高脂血症营养和运动指导分册。" },
          "stool-blood": { "60": "本专题对应文件中的结直肠癌筛查及阳性后随访部分。" },
          "h-pylori": { "62": "胃癌和食管癌筛查背景资料，不是幽门螺杆菌感染治疗指南。" },
        };
        const related = slug === "h-pylori" ? pack.domestic.filter((id) => id === "62") : [];
        const clinical = pack.domestic.filter((id) => id !== "01" && !related.includes(id));
        panel.innerHTML = `<h2>国内权威指南依据</h2><p>${esc(pack.application)}</p>
            ${clinical.length ? clinical.map((id) => evidenceSource(sources[id], false, scopes[slug]?.[id] || "")).join("") : "<p>当前目录尚无该专题独立的国内专科指南条目。</p>"}
            ${related.length ? `<h3>相关筛查背景</h3>${related.map((id) => evidenceSource(sources[id], false, scopes[slug]?.[id] || "")).join("")}` : ""}
            <h3>通用体检参考</h3><p>以下为一般成人体检总纲，不替代本专题的专科指南。</p>${evidenceSource(sources["01"])}`;
      } else if (part === "external") {
        panel.innerHTML = `<h2>国际权威指南依据</h2>
          <dl><dt>英文要点（编辑意译）</dt><dd lang="en">${esc(pack.english)}</dd>
          <dt>中文译解</dt><dd>${esc(pack.translation)}</dd>
          <dt>结合中国体检场景理解</dt><dd>${esc(pack.application)}</dd>
          <dt>原文位置</dt><dd>${esc(pack.location)}</dd></dl>
          ${evidenceSource(sources[pack.external])}`;
      } else {
        panel.innerHTML = `<h2>体检病例精读库</h2>
          <p>先看情境，再对照分析。模拟情境用于理解证据和健康管理。</p>
          ${pack.examples.map((example) => `<details class="evidence-source"><summary><strong>${esc(example.title)}</strong><small>教学模拟</small></summary>
            <table class="case-learning-facts"><caption>病例资料</caption><tbody>
              <tr><th scope="row">已知发现</th><td>${esc(example.facts)}</td></tr>
            </tbody></table><dl>
            <dt>怎么理解</dt><dd>${esc(example.analysis)}</dd>
            <dt>健康管理学习重点</dt><dd>${esc(example.management)}</dd></dl>
            <p>依据：${pack.domestic.map((id) => envelopeLink(sources[id]["资料名称"], sources[id]["来源"])).join(" · ")}
              · ${envelopeLink(sources[pack.external]["资料名称"], sources[pack.external]["来源"])}</p>
          </details>`).join("")}
          <div class="actions"><button id="open-related-readings" type="button" class="btn secondary">查看相关公开病例</button>
            ${btn("查看全部公开病例", "navigate('readings')", "btn secondary")}</div>`;
        $("#open-related-readings").addEventListener("click", () => {
          navigate("readings", course.chronic.slug);
        });
      }
    } catch (error) {
      if (panel.isConnected && request === clickId) panel.textContent = error.message + "，请关闭后重新打开。";
    }
  }));
}
