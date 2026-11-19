const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const data = JSON.parse(fs.readFileSync('static/evidence-resources.json', 'utf8'));
const handbook = fs.readFileSync('static/evidence-handbook.html', 'utf8');
const script = fs.readFileSync('static/evidence-resources.js', 'utf8');
const ids = ['01', '09', '43', '60', '62', '70', '80', '82'];
const escape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

assert.equal(Object.keys(data.sources).length, 84);
assert.equal(Object.keys(data.topics).length, 17);
assert.equal(ids.reduce((n, id) => n + data.sources[id]['备用入口'].length, 0), 12);
for (const id of ids) {
  const row = data.sources[id];
  assert.ok(row['来源']);
  assert.ok(row['备用入口'].length);
  for (const link of row['备用入口']) {
    assert.equal(new URL(link['地址']).protocol, 'https:');
    assert.ok(link['名称'] && link['说明']);
    assert.ok(handbook.includes(escape(link['地址'])), `手册缺少 ${id}：${link['名称']}`);
  }
}
assert.equal((handbook.match(/<div class="backup-links">/g) || []).length, 8);

function createPanel() {
  const panel = { innerHTML: '', hidden: true, isConnected: true };
  const controls = ['domestic', 'external', 'cases'].map((part) => ({
    dataset: { evidencePart: part }, attrs: { 'aria-expanded': 'false' },
    addEventListener(_event, callback) { this.callback = callback; },
    getAttribute(key) { return this.attrs[key]; },
    setAttribute(key, value) { this.attrs[key] = value; },
  }));
  const context = vm.createContext({
    URL, Promise, document: { querySelectorAll() { return controls; } },
    $: () => panel, esc: escape, state: {}, btn: () => '',
    fetch: async () => ({ ok: true, json: async () => data }),
  });
  vm.runInContext(script, context);
  return { panel, controls, context };
}

async function checkTopic(slug, part, expected, scope) {
  const { panel, controls, context } = createPanel();
  context.wireEvidenceTopic({ chronic: { slug } });
  await controls.find((control) => control.dataset.evidencePart === part).callback();
  for (const name of expected) assert.ok(panel.innerHTML.includes(escape(name)), `${slug}: 缺少 ${name}`);
  if (scope) assert.ok(panel.innerHTML.includes(scope), `${slug}: 缺少用途范围`);
  if (part === 'domestic') assert.ok(panel.innerHTML.includes('通用体检参考'));
}

(async () => {
  for (const id of ids) {
    const { context } = createPanel();
    const result = context.evidenceSource(data.sources[id]);
    for (const link of data.sources[id]['备用入口']) assert.ok(result.includes(escape(link['名称'])));
    assert.ok(result.includes('备用入口'));
  }
  for (const slug of Object.keys(data.topics)) {
    await checkTopic(slug, 'domestic', ['山西省卫健委：指引正文与五份附件'], '不替代本专题的专科指南');
  }
  for (const slug of ['urate', 'obesity', 'ckd']) {
    await checkTopic(slug, 'domestic', ['浙江省疾控中心：四项食养指南']);
  }
  for (const slug of ['hypertension', 'obesity', 'diabetes', 'lipids', 'urate']) {
    await checkTopic(slug, 'domestic', ['广西疾控中心：四份指导原则附件']);
  }
  await checkTopic('stool-blood', 'domestic', ['平顶山市卫健委：两项方案正文'], '结直肠癌筛查');
  await checkTopic('h-pylori', 'domestic', ['新疆卫健委：食管癌方案 PDF', '新疆卫健委：胃癌方案 PDF'], '不是幽门螺杆菌感染治疗指南');
  await checkTopic('urine-blood', 'external', ['AUA：2025 修订官方公告', 'PubMed：2025 修订文献记录与摘要（XML）']);
  assert.ok(script.includes('data-evidence-quick="前列腺"'));
  assert.ok(script.includes('data-evidence-quick="口腔"'));
  console.log('8 条指南、12 个备用入口、中文手册及专题关联检查通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
