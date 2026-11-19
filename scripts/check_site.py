"""Read-only deployment checks; never prints credentials or writes learning data."""

import os
import pathlib
import sqlite3
import sys

import httpx

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
headers = {"X-Admin-Token": os.environ["EVIDENCE_ADMIN_TOKEN"]}
with httpx.Client(base_url=base, timeout=60, follow_redirects=True) as client:
    for path, expected in (
        ("/", "text/html"),
        ("/static/app.js", "javascript"),
        ("/static/style.css", "text/css"),
        ("/health", "application/json"),
        ("/manus-routes.json", "application/json"),
    ):
        response = client.get(path)
        assert response.status_code == 200, (path, response.status_code)
        assert expected in response.headers.get("content-type", ""), path
        print("PASS", path, flush=True)
    assert client.get("/manus-routes.json").json() == {
        "routes": [{"path": "/", "title": "全球体检与健康管理循证研修中心"}]
    }
    assert client.get("/api/status").json()["write_locked"] is False
    latest = client.get("/api/courses").json()
    assert len(latest) == 2
    assert len(client.get("/api/references").json()) == 16
    assert len(client.get("/api/tools").json()) == 5
    course = client.get("/api/courses/2").json()
    assert len(course["versions"]) == 2
    for cid in (1, 2, 3):
        response = client.get(f"/api/courses/{cid}")
        assert response.status_code == 200
        assert response.json()["content"]
        assert all("answer" not in item for item in response.json()["questions"])
    assert client.get("/api/dashboard").status_code == 401
    response = client.get("/api/dashboard", headers=headers)
    assert response.status_code == 200
    assert response.json()["courses"] == 2
    response = client.get("/api/export", headers=headers)
    assert response.status_code == 200
    exported = response.json()
    source = pathlib.Path(__file__).resolve().parents[1] / "data/evidence.sqlite3"
    if source.exists():
        db = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        try:
            db.row_factory = sqlite3.Row
            for name, saved in exported.items():
                original = [dict(row) for row in db.execute("SELECT * FROM " + name)]
                assert saved == original, f"Source mismatch: {name}"
        finally:
            db.close()
        print("PASS full original SQLite row-for-row comparison", flush=True)
    print("PASS core endpoints, course versions, token protection and read-only export", flush=True)
