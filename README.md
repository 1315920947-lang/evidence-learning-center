# 体检循证与健康管理工作台

用于积累每日 60–90 分钟中文医学循证课程的个人研修网站。FastAPI 提供接口，SQLite 持久化课程和学习记录，响应式界面支持电脑和手机。

| 模块 | 功能 |
| --- | --- |
| 今日研修 | 按北京时间加载当天最新版完整正文，保留 Markdown 标题、表格、链接等内容 |
| 历史课程 | 按日期归档，搜索课程标题、专题和最新版正文，进入课程可切换同日的全部版本 |
| 循证文献库 | 汇总各课程版本录入的研究来源、DOI、PMID、原文地址、全文入口和获取状态 |
| 专题知识库 | 按医学系统或健康管理领域与课程专题两级归类 |
| 临床案例训练 | 单选题互动、服务端判分、提交后查看解析与记录 |
| 工作工具库 | 集中浏览审核清单、解读模板、随访工具等独立条目，回查来源课程 |
| 学习中心 | 保存各版本的学习时长、完成状态、答题统计、笔记和文献收藏 |

初次启动时数据库为空。课程和文献由维护者从真实资料导入。文献获取状态由导入者填写，全文若有合法的阅读入口，可录入该链接。网站未接入 ChatGPT 私人定期任务。

## 本地运行

需要 Python 3.12 或以上。Linux 与 macOS 可运行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
# 生成一次长口令并保存在密码管理器中
.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(32))'
# 在提示后输入该口令，输入时不会回显
read -rs EVIDENCE_ADMIN_TOKEN
export EVIDENCE_ADMIN_TOKEN
export EVIDENCE_DB="$PWD/data/evidence.sqlite3"
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

访问 http://127.0.0.1:8000，按需要输入刚保存的口令。Windows 可使用 `.venv\Scripts\python.exe`、`.venv\Scripts\uvicorn.exe` 和 PowerShell 的 `$env:变量名`。

## 导入完整课程

1. 打开「导入课程」并输入服务端访问口令。
2. 粘贴正文或上传 UTF-8 Markdown、TXT 文件，然后录入日期、来源、归类和相关条目。也可上传一个完整 JSON 文件，在表单预览和修订之后发布。
3. 日期使用北京时间的 `YYYY-MM-DD`。同日变更会追加版本。相同的结构化内容重复提交会返回已有版本。发布前请确认资料可公开、引用可追溯，且正文和案例均已移除可识别的患者信息。

下面是字段示例。示例包含待替换的占位值，仅用于说明导入格式，应用启动时不会载入。

```json
{
  "day": "2026-11-18",
  "title": "替换为真实课程标题",
  "system": "心血管系统",
  "topic": "心血管风险评估",
  "minutes": 75,
  "source": "替换为课程来源",
  "content": "# 替换为完整 Markdown 正文\n\n保留各研修环节和表格。",
  "references": [
    {
      "title": "替换为真实文献标题",
      "source": "替换为期刊、组织或数据库",
      "doi": "",
      "pmid": "",
      "url": "https://example.org/replace-with-source",
      "full_text_url": "",
      "access": "待核验"
    }
  ],
  "questions": [
    {
      "question": "替换为脱敏题干",
      "options": ["替换为选项 A", "替换为选项 B"],
      "answer": 0,
      "explanation": "替换为真实解析"
    }
  ],
  "tools": [
    {
      "kind": "体检审核清单",
      "title": "替换为工具标题",
      "content": "- 替换为工具正文"
    }
  ]
}
```

`answer` 从 0 开始计数。工具类别支持「体检审核清单」「报告解读模板」「随访工具」和「其他」。文献、题目和工具数组可留空。正文文本和链接按原稿入库。浏览器以经过过滤的 Markdown 渲染正文。

程序化导入使用 `POST /api/courses`，提交上述 JSON，并在 `X-Admin-Token` 请求头传入访问口令。也可以通过 multipart 的 `POST /api/upload` 直接发布完整 JSON 文件，文件字段名为 `file`。未来可由经过授权的同步发布方调用导入接口。

## 部署到服务器

1. 在服务器检出代码并建立虚拟环境，安装 `requirements.txt`。为服务建立专用系统用户，用该用户可写的持久目录存放数据库，例如 `/var/lib/evidence-learning-center/courses.sqlite3`。
2. 在服务配置或机密管理器中设置 `EVIDENCE_ADMIN_TOKEN` 和 `EVIDENCE_DB`。生产使用随机长口令，并在重启间保持口令和数据库路径一致。
3. 通过 systemd 或容器管理进程运行 `.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000`。工作目录设为项目根目录，开启进程故障重启。容器部署时可绑定容器内的 `0.0.0.0`，并将数据库路径挂载到持久卷。
4. 在公网入口反代到服务并启用 HTTPS。例如 Caddy 可配置以下站点，将域名替换为自己的域名：

   ```caddyfile
   learning.example.com {
       reverse_proxy 127.0.0.1:8000
   }
   ```

5. 通过 HTTPS 打开站点并检查 `/api/status`。课程页面和课程内容接口默认公开可读，口令保护导入、答题记录、收藏、笔记和备份。当前是单一学习档案。如果需要让课程仅在团队内可见，应在反向代理层保护整个站点。
6. 定期用 SQLite 的在线备份方式复制数据库，保留加密备份。例如使用 `sqlite3 /var/lib/evidence-learning-center/courses.sqlite3 ".backup /secure-backups/evidence.sqlite3"`。恢复时先停止应用，再用备份数据库替换数据库文件并恢复文件所有权。网页也可导出 JSON 供查阅和迁移，完整恢复使用 SQLite 备份。

该应用需要运行 Python 服务和持久化数据库。GitHub 仓库用于保存源码。数据库、课程导入目录、备份和口令均应存放在仓库之外。

## 测试

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
node --check static/app.js
```

测试使用隔离的临时 SQLite 数据库，涵盖完整导入、同日版本归档、并发去重、文献与工具数据、答题解析、学习进度、笔记、收藏、备份访问和不安全链接过滤。

## 慢病管理工作包

导航中的「体检专题」按病种排序，显示每个病种的最新版。进入工作包可以跳到四个环节、指南对照、案例或工具，并回查旧版。文献、答题、笔记和进度沿用既有数据接口。工作工具可复制或下载 Markdown。清单勾选保存在当前浏览器。

在上述课程 JSON 中增加一个 `chronic` 对象，然后从「体检专题」进入「导入工作包」。首次发布及之后的更新均使用相同流程。`day` 为本次工作包发布日期。更新时沿用同一个 `slug`，提交修订过的正文和新的修订说明。慢病版本按病种累积，日常研修仍按日期归档。

| 字段 | 填写内容 |
| --- | --- |
| `chronic.slug` | 病种固定标识，使用小写字母、数字或连字符 |
| `chronic.name` | 病种展示名称 |
| `chronic.sort_order` | 病种清单中的顺序，从 1 起 |
| `chronic.sections.precheck` | 检前沟通 Markdown |
| `chronic.sections.design` | 项目设计 Markdown |
| `chronic.sections.interpretation` | 检后解读 Markdown |
| `chronic.sections.followup` | 复查随访 Markdown |
| `chronic.guidelines` | 指南对照和精读 Markdown，注明发布机构、版本、日期、核验时间和适用范围 |
| `chronic.revision_notes` | 首次发布或本次修订内容 |
| `chronic.affected_decisions` | 本次发布涉及的体检决策 |

学习时长设为 60–90 分钟，附至少三道互动题、指南来源和工作工具。指南链接放在 `references` 数组，以接入文献库。互动题的 `explanation` 字段写入判断过程、错误选项说明和指南出处。工作工具的 `content` 使用 Markdown，审核清单可用 `- [ ] 核查项目` 表示。

### 更新现有部署

将更新包中的应用文件覆盖到现有项目，继续使用原有 `EVIDENCE_DB` 路径和口令，重启服务。应用启动会添加慢病版本表和日课版本视图。现有课程、文献、学习记录和数据库位置无需迁移。正式环境更新前可用 README 所述 SQLite 备份方式保留恢复点。

**本 Manus 托管站的特殊情况：**生产数据是 `DATABASE_URL` 指向的托管数据库中的 SQLite 快照，本地 `data/evidence.sqlite3` 不代表生产现状，也不能直接用旧文件覆盖生产。更新前须合并并保留 `durable_sqlite.py` 适配和 `/health`，备份生产快照；导入脚本的 `--db` 参数只操作本地 SQLite。具体安全同步、版本与时间口径见 `DEPLOYMENT.md`。

## 体检病例精读库

首页和主导航可进入精读库。病例按初级、中级、高级展示，并可按标题、常用异常词或原文题名搜索。每篇显示病例事实、原作者分析、随访及编辑整理的体检应用点评。复杂度按决策过程分级。相关主题链接到已发布的体检工作包或研修。

病例正文由 `static/case-library.json` 管理。新增或修订病例时，先审查来源、可公开使用范围、去标识化和事实依据。病例资料是原创中文编辑梳理，并链接原文，不存放患者报告、原图或论文全文。上线病例不改动 SQLite。

## 循证指南与应用

首页和主导航提供资料目录，可筛选国内与国际来源和专题，查阅来源状态、原文入口及中文应用手册。17 个工作包各有三个入口，国内依据、国际英文意译与中文译解，以及两则教学模拟和相关公开病例。指南资料与教学模拟放在 static/evidence-resources.json，病例精读仍来自独立的 static/case-library.json。更新循证资料不会重写用户学习记录。

指南条目的 `来源` 和 `全文入口` 保留原值；`备用入口` 数组可增加多个 `名称`、`地址`、`说明`，明确区分全文、附件目录、公告和摘要。`static/evidence-handbook.html` 是目录的静态副本，维护时须同步链接。前列腺癌筛查及口腔健康目前有资料目录但没有独立工作包，不应归入不相关疾病专题；口腔行动方案为 2019—2025 年历史资料，不能据此认定现行效力。
