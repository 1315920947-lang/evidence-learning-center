import datetime
import hashlib
import hmac
import json
import os
import pathlib
import re
import sqlite3
import urllib.parse
from contextlib import contextmanager
from zoneinfo import ZoneInfo
import mistune, bleach
from fastapi import FastAPI, Request, HTTPException, UploadFile, File, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError, model_validator
from durable_sqlite import connection

ROOT = pathlib.Path(__file__).resolve().parent
DB = pathlib.Path(os.getenv("EVIDENCE_DB", str(ROOT / "data.sqlite3")))
BUILD_TIME_FILE = ROOT / ".site-build-time"
MANAGED_DB = bool(os.getenv("DATABASE_URL")) and not bool(os.getenv("EVIDENCE_DB"))
TOKEN = os.getenv("EVIDENCE_ADMIN_TOKEN", "")
app = FastAPI(title="体检循证与健康管理工作台", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")
md = mistune.create_markdown(
    escape=True, plugins=["table", "strikethrough", "url", "task_lists"]
)
ALLOWED_TAGS = set(bleach.sanitizer.ALLOWED_TAGS) | {
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "pre",
    "code",
    "hr",
    "br",
    "input",
    "del",
    "section",
}
ALLOWED_ATTRS = {
    "a": ["href", "title", "target", "rel"],
    "th": ["align"],
    "td": ["align"],
    "input": ["type", "checked", "disabled"],
    "code": ["class"],
}


@contextmanager
def conn():
    with connection(DB, managed=MANAGED_DB) as c:
        yield c


def init_db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with conn() as c:
        c.executescript(
            """CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY,day TEXT NOT NULL,title TEXT NOT NULL,topic TEXT DEFAULT '',minutes INTEGER DEFAULT 60,version INTEGER NOT NULL,source TEXT NOT NULL DEFAULT 'manual',content TEXT NOT NULL,checksum TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(day,version));
  CREATE INDEX IF NOT EXISTS courses_day ON courses(day);
  CREATE TABLE IF NOT EXISTS papers(id INTEGER PRIMARY KEY,course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,title TEXT NOT NULL,url TEXT NOT NULL,doi TEXT DEFAULT '',pmid TEXT DEFAULT '',access TEXT DEFAULT '待核验',UNIQUE(course_id,url));
  CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY,course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,question TEXT NOT NULL,options TEXT NOT NULL,answer INTEGER NOT NULL,explanation TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS progress(course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,seconds INTEGER DEFAULT 0,completed INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,choice INTEGER NOT NULL,correct INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS bookmarks(ref_id INTEGER PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS notes(course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,body TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS tools(id INTEGER PRIMARY KEY,course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS course_categories(course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,system TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chronic_versions(
    course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
    slug TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL,
    revision INTEGER NOT NULL, metadata TEXT NOT NULL, UNIQUE(slug, revision)
  );
  CREATE VIEW IF NOT EXISTS daily_course_versions AS
    SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.day ORDER BY c.version) AS daily_version
    FROM courses c WHERE NOT EXISTS (SELECT 1 FROM chronic_versions v WHERE v.course_id=c.id);"""
        )
        columns = {row["name"] for row in c.execute("PRAGMA table_info(papers)")}
        for column in ("source", "full_text_url"):
            if column not in columns:
                c.execute(
                    f"ALTER TABLE papers ADD COLUMN {column} TEXT NOT NULL DEFAULT ''"
                )


init_db()


def auth(req: Request):
    if not TOKEN:
        raise HTTPException(
            503, "尚未设置 EVIDENCE_ADMIN_TOKEN；为保护资料，写入功能已锁定"
        )
    supplied = req.headers.get("x-admin-token", "")
    if not hmac.compare_digest(supplied.encode(), TOKEN.encode()):
        raise HTTPException(401, "管理口令错误")


def html(text):
    out = bleach.clean(
        str(md(text)),
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=["http", "https", "mailto"],
        strip=True,
    )
    return re.sub(
        r'<a\s+href="(https?://[^"]+)"',
        r'<a target="_blank" rel="noopener noreferrer" href="\1"',
        out,
    )


def rows(query, args=()):
    with conn() as c:
        return [dict(r) for r in c.execute(query, args).fetchall()]


def one(query, args=()):
    with conn() as c:
        r = c.execute(query, args).fetchone()
        return dict(r) if r else None


def validate_day(day):
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            raise ValueError
        return datetime.date.fromisoformat(day).isoformat()
    except ValueError:
        raise HTTPException(422, "日期须为YYYY-MM-DD")


def normalize_url(url):
    try:
        p = urllib.parse.urlsplit(url)
        if (
            p.scheme not in ("http", "https")
            or not p.hostname
            or p.username
            or any(ch.isspace() or ord(ch) < 32 for ch in url)
        ):
            raise ValueError
    except ValueError:
        raise HTTPException(422, "文献链接必须为有效的 HTTP(S) 地址")
    return url


class Ref(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    url: str
    doi: str = ""
    pmid: str = ""
    access: str = "待核验"
    source: str = ""
    full_text_url: str = ""


class Tool(BaseModel):
    kind: str = Field(pattern="^(体检审核清单|报告解读模板|随访工具|其他)$")
    title: str = Field(min_length=1, max_length=250)
    content: str = Field(min_length=1)


class Question(BaseModel):
    question: str
    options: list[str] = Field(min_length=2, max_length=26)
    answer: int
    explanation: str


class ChronicSections(BaseModel):
    precheck: str = Field(min_length=1)
    design: str = Field(min_length=1)
    interpretation: str = Field(min_length=1)
    followup: str = Field(min_length=1)


class ChronicPackage(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
    name: str = Field(min_length=1, max_length=100)
    sort_order: int = Field(ge=1)
    sections: ChronicSections
    guidelines: str = Field(min_length=1)
    revision_notes: str = Field(min_length=1)
    affected_decisions: str = Field(min_length=1)


class Course(BaseModel):
    day: str
    title: str = Field(min_length=1, max_length=250)
    topic: str = ""
    system: str = ""
    minutes: int = Field(default=60, ge=1, le=300)
    content: str = Field(min_length=1)
    references: list[Ref] = []
    questions: list[Question] = []
    tools: list[Tool] = []
    source: str = "manual"
    chronic: ChronicPackage | None = None

    @model_validator(mode="after")
    def check_chronic_package(self):
        if self.chronic:
            if not 60 <= self.minutes <= 90:
                raise ValueError("慢病工作包的建议学习时长须为 60–90 分钟")
            if len(self.questions) < 3 or not self.references or not self.tools:
                raise ValueError("慢病工作包须含至少三题、指南来源和工作工具")
        return self


@app.get("/", response_class=HTMLResponse)
def index():
    return (ROOT / "static" / "index.html").read_text(encoding="utf-8")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/status")
def status():
    # SQLite creates course timestamps in UTC. Do not use the snapshot's
    # revision timestamp: learner notes, answers, and progress also update it.
    latest = one("SELECT MAX(created_at) AS latest FROM courses") or {}
    course_time = latest.get("latest")
    try:
        built_time = BUILD_TIME_FILE.read_text(encoding="utf-8").strip()
        datetime.datetime.fromisoformat(built_time.replace("Z", "+00:00"))
    except (OSError, ValueError):
        built_time = None
    return {
        "write_locked": not bool(TOKEN),
        "today": datetime.datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat(),
        "sync": "manual-import",
        "site_build_at": built_time,
        "course_import_at": course_time.replace(" ", "T") + "Z" if course_time else None,
    }


@app.get("/api/courses")
def courses(q: str = "", topic: str = "", day: str = ""):
    sql = """SELECT c.id,c.day,c.title,c.topic,c.minutes,c.daily_version AS version,c.source,c.created_at,COALESCE(g.system,'') system,(SELECT COUNT(*) FROM questions WHERE course_id=c.id) question_count FROM daily_course_versions c LEFT JOIN course_categories g ON g.course_id=c.id WHERE c.daily_version=(SELECT MAX(daily_version) FROM daily_course_versions WHERE day=c.day)"""
    args = []
    if q:
        sql += " AND (c.title LIKE ? OR c.topic LIKE ? OR c.content LIKE ?)"
        args.extend(["%" + q + "%"] * 3)
    if topic:
        sql += " AND c.topic LIKE ?"
        args.append("%" + topic + "%")
    if day:
        sql += " AND c.day=?"
        args.append(validate_day(day))
    return rows(sql + " ORDER BY c.day DESC", args)


@app.get("/api/chronic")
def chronic_packages():
    return rows("""
        SELECT v.course_id AS id, v.slug, v.name, v.revision AS version,
               c.title, c.day, c.minutes
        FROM chronic_versions v JOIN courses c ON c.id=v.course_id
        WHERE v.revision=(SELECT MAX(revision) FROM chronic_versions WHERE slug=v.slug)
        ORDER BY v.sort_order, v.slug
    """)


@app.get("/api/courses/{cid}")
def course(cid: int):
    r = one("SELECT * FROM courses WHERE id=?", (cid,))
    if not r:
        raise HTTPException(404, "课程不存在")
    r["html"] = html(r["content"])
    r["references"] = rows("SELECT * FROM papers WHERE course_id=?", (cid,))
    r["questions"] = rows(
        "SELECT id,question,options FROM questions WHERE course_id=?", (cid,)
    )
    chronic = one("SELECT * FROM chronic_versions WHERE course_id=?", (cid,))
    if chronic:
        meta = json.loads(chronic["metadata"])
        r["version"] = chronic["revision"]
        r["chronic"] = {
            **meta,
            "sections": {key: html(value) for key, value in meta["sections"].items()},
            "guidelines": html(meta["guidelines"]),
        }
        r["versions"] = rows(
            """
            SELECT c.id, v.revision AS version, c.day, c.created_at
            FROM chronic_versions v JOIN courses c ON c.id=v.course_id
            WHERE v.slug=? ORDER BY v.revision DESC
        """,
            (chronic["slug"],),
        )
        r["tools"] = course_tools(cid)
    else:
        r["versions"] = rows(
            """
            SELECT id, daily_version AS version, created_at FROM daily_course_versions
            WHERE day=? ORDER BY daily_version DESC
        """,
            (r["day"],),
        )
        r["version"] = next(v["version"] for v in r["versions"] if v["id"] == cid)
    for q in r["questions"]:
        q["options"] = json.loads(q["options"])
    return r


@app.get("/api/learning/{cid}", dependencies=[Depends(auth)])
def learning(cid: int):
    require_course(cid)
    progress = one("SELECT seconds,completed FROM progress WHERE course_id=?", (cid,))
    note = one("SELECT body FROM notes WHERE course_id=?", (cid,))
    return {
        "progress": progress or {"seconds": 0, "completed": 0},
        "note": note or {"body": ""},
    }


def require_course(cid):
    if not one("SELECT id FROM courses WHERE id=?", (cid,)):
        raise HTTPException(404, "课程不存在")


@app.post("/api/courses", dependencies=[Depends(auth)])
def import_course(data: Course):
    day = validate_day(data.day)
    if not data.title.strip() or not data.content.strip():
        raise HTTPException(422, "课程标题和正文不能为空")
    if len(data.content.encode("utf-8")) > 3_000_000:
        raise HTTPException(413, "内容超过3MB")
    urls = set()
    for ref in data.references:
        normalize_url(ref.url)
        if ref.url in urls:
            raise HTTPException(422, "同一课程存在重复的文献原文链接")
        urls.add(ref.url)
        if ref.full_text_url:
            normalize_url(ref.full_text_url)
    for q in data.questions:
        if not 0 <= q.answer < len(q.options):
            raise HTTPException(422, "题目答案索引无效")
    payload = data.model_dump(exclude_none=True)
    payload["day"] = day
    checksum = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        dup = c.execute(
            "SELECT id FROM courses WHERE day=? AND checksum=?", (day, checksum)
        ).fetchone()
        if dup:
            return {"id": dup["id"], "duplicate": True}
        ver = c.execute(
            "SELECT COALESCE(MAX(version),0)+1 FROM courses WHERE day=?", (day,)
        ).fetchone()[0]
        cur = c.execute(
            "INSERT INTO courses(day,title,topic,minutes,version,source,content,checksum) VALUES(?,?,?,?,?,?,?,?)",
            (
                day,
                data.title,
                data.topic,
                data.minutes,
                ver,
                data.source,
                data.content,
                checksum,
            ),
        )
        cid = cur.lastrowid
        for r in data.references:
            c.execute(
                "INSERT INTO papers(course_id,title,url,doi,pmid,access,source,full_text_url) VALUES(?,?,?,?,?,?,?,?)",
                (
                    cid,
                    r.title,
                    r.url,
                    r.doi,
                    r.pmid,
                    r.access,
                    r.source,
                    r.full_text_url,
                ),
            )
        for q in data.questions:
            c.execute(
                "INSERT INTO questions(course_id,question,options,answer,explanation) VALUES(?,?,?,?,?)",
                (
                    cid,
                    q.question,
                    json.dumps(q.options, ensure_ascii=False),
                    q.answer,
                    q.explanation,
                ),
            )
        if data.system:
            c.execute("INSERT INTO course_categories VALUES(?,?)", (cid, data.system))
        for tool in data.tools:
            c.execute(
                "INSERT INTO tools(course_id,kind,title,content) VALUES(?,?,?,?)",
                (cid, tool.kind, tool.title, tool.content),
            )
        if data.chronic:
            chronic = data.chronic
            revision = c.execute(
                "SELECT COALESCE(MAX(revision),0)+1 FROM chronic_versions WHERE slug=?",
                (chronic.slug,),
            ).fetchone()[0]
            c.execute(
                "INSERT INTO chronic_versions VALUES (?,?,?,?,?,?)",
                (
                    cid,
                    chronic.slug,
                    chronic.name,
                    chronic.sort_order,
                    revision,
                    chronic.model_dump_json(),
                ),
            )
        else:
            revision = c.execute(
                "SELECT daily_version FROM daily_course_versions WHERE id=?", (cid,)
            ).fetchone()[0]
    return {"id": cid, "version": revision, "duplicate": False}


@app.post("/api/upload", dependencies=[Depends(auth)])
async def upload(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith((".md", ".txt", ".html", ".json")):
        raise HTTPException(422, "支持.md/.txt/.html/.json")
    raw = await file.read(3_000_001)
    if len(raw) > 3_000_000:
        raise HTTPException(413, "文件超过3MB")
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "请使用 UTF-8 文件")
    if (file.filename or "").lower().endswith(".json"):
        try:
            return import_course(Course.model_validate_json(content))
        except ValidationError:
            raise HTTPException(422, "JSON 文件不符合课程导入格式")
    return {
        "content": content,
        "filename": file.filename,
        "note": "文件已读取，请核对日期标题后发布；HTML原文将作为文本保存以防不安全脚本执行。",
    }


@app.get("/api/references")
def references(q: str = ""):
    sql = """SELECT r.*,c.day,c.title course_title FROM papers r JOIN courses c ON r.course_id=c.id WHERE 1=1"""
    args = []
    if q:
        sql += (
            " AND (r.title LIKE ? OR r.doi LIKE ? OR r.pmid LIKE ? OR r.source LIKE ?)"
        )
        args = ["%" + q + "%"] * 4
    return rows(sql + " ORDER BY c.day DESC", args)


@app.get("/api/tools")
def tools():
    return course_tools()


def course_tools(cid=None):
    sql = """
        SELECT t.*, c.day, COALESCE(v.revision, d.daily_version) AS version
        FROM tools t JOIN courses c ON c.id=t.course_id
        LEFT JOIN chronic_versions v ON v.course_id=c.id
        LEFT JOIN daily_course_versions d ON d.id=c.id
    """
    params = ()
    if cid is not None:
        sql += " WHERE t.course_id=?"
        params = (cid,)
    items = rows(sql + " ORDER BY c.day DESC, c.version DESC, t.id", params)
    for item in items:
        item["html"] = html(item["content"])
    return items


class ProgressUpdate(BaseModel):
    seconds: int = Field(default=0, ge=0, le=86400)
    completed: bool = False


class AnswerUpdate(BaseModel):
    choice: int = Field(ge=0)


class NoteUpdate(BaseModel):
    body: str = Field(max_length=30000)


class BookmarkUpdate(BaseModel):
    bookmarked: bool


@app.post("/api/progress/{cid}", dependencies=[Depends(auth)])
def progress(cid: int, data: ProgressUpdate):
    seconds, completed = data.seconds, int(data.completed)
    with conn() as c:
        if not c.execute("SELECT id FROM courses WHERE id=?", (cid,)).fetchone():
            raise HTTPException(404, "课程不存在")
        c.execute(
            "INSERT INTO progress(course_id,seconds,completed) VALUES(?,?,?) ON CONFLICT(course_id) DO UPDATE SET seconds=MAX(progress.seconds,excluded.seconds),completed=MAX(progress.completed,excluded.completed),updated_at=CURRENT_TIMESTAMP",
            (cid, seconds, completed),
        )
    return {"ok": True}


@app.post("/api/answer/{qid}", dependencies=[Depends(auth)])
def answer(qid: int, data: AnswerUpdate):
    q = one("SELECT * FROM questions WHERE id=?", (qid,))
    if not q:
        raise HTTPException(404, "题目不存在")
    choice = data.choice
    if choice >= len(json.loads(q["options"])):
        raise HTTPException(422, "选项索引无效")
    correct = int(choice == q["answer"])
    with conn() as c:
        c.execute(
            "INSERT INTO attempts(question_id,choice,correct) VALUES(?,?,?)",
            (qid, choice, correct),
        )
    return {
        "correct": bool(correct),
        "answer": q["answer"],
        "explanation": q["explanation"],
    }


@app.post("/api/notes/{cid}", dependencies=[Depends(auth)])
def notes(cid: int, data: NoteUpdate):
    require_course(cid)
    body = data.body
    with conn() as c:
        c.execute(
            "INSERT INTO notes(course_id,body) VALUES(?,?) ON CONFLICT(course_id) DO UPDATE SET body=excluded.body",
            (cid, body),
        )
    return {"ok": True}


@app.put("/api/bookmarks/{rid}", dependencies=[Depends(auth)])
def bookmark(rid: int, data: BookmarkUpdate):
    with conn() as c:
        if not c.execute("SELECT 1 FROM papers WHERE id=?", (rid,)).fetchone():
            raise HTTPException(404, "文献不存在")
        if data.bookmarked:
            c.execute("INSERT OR IGNORE INTO bookmarks(ref_id) VALUES(?)", (rid,))
        else:
            c.execute("DELETE FROM bookmarks WHERE ref_id=?", (rid,))
    return {"bookmarked": data.bookmarked}


@app.get("/api/dashboard", dependencies=[Depends(auth)])
def dashboard():
    course_count = one("SELECT COUNT(DISTINCT day) n FROM courses") or {"n": 0}
    completed = one("SELECT COUNT(*) n FROM progress WHERE completed=1") or {"n": 0}
    seconds = one("SELECT COALESCE(SUM(seconds),0) n FROM progress") or {"n": 0}
    return {
        "courses": course_count["n"],
        "completed": completed["n"],
        "seconds": seconds["n"],
        "attempts": one(
            "SELECT COUNT(*) n,COALESCE(SUM(correct),0) correct FROM attempts"
        ),
        "bookmarks": rows(
            "SELECT r.*,c.day FROM bookmarks b JOIN papers r ON r.id=b.ref_id JOIN courses c ON c.id=r.course_id"
        ),
        "records": rows(
            """SELECT c.id,c.title,c.day,COALESCE(v.revision,d.daily_version) version,c.topic,c.minutes,p.seconds,p.completed,n.body,
    (SELECT COUNT(*) FROM attempts a JOIN questions q ON a.question_id=q.id WHERE q.course_id=c.id) attempts,
    (SELECT COUNT(*) FROM attempts a JOIN questions q ON a.question_id=q.id WHERE q.course_id=c.id AND a.correct=1) correct
    FROM courses c LEFT JOIN chronic_versions v ON v.course_id=c.id LEFT JOIN daily_course_versions d ON d.id=c.id LEFT JOIN progress p ON p.course_id=c.id LEFT JOIN notes n ON n.course_id=c.id
    WHERE p.course_id IS NOT NULL OR n.body<>'' OR attempts>0 ORDER BY c.day DESC,c.version DESC"""
        ),
    }


@app.get("/api/export", dependencies=[Depends(auth)])
def export_data():
    with conn() as c:
        c.execute("BEGIN")
        data = {
            k: [dict(row) for row in c.execute("SELECT * FROM " + k)]
            for k in (
                "courses",
                "papers",
                "questions",
                "progress",
                "attempts",
                "bookmarks",
                "notes",
                "tools",
                "course_categories",
                "chronic_versions",
            )
        }
    return JSONResponse(
        data,
        headers={"Content-Disposition": 'attachment; filename="evidence-backup.json"'},
    )


@app.middleware("http")
async def prevent_api_cache(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    elif request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response
