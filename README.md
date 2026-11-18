# 全球体检与健康管理循证研修中心

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
