import importlib
import sqlite3

from fastapi.testclient import TestClient


def test_content_times_are_stable_across_learning_and_duplicate_imports(monkeypatch, tmp_path):
    db_path = tmp_path / "isolated.sqlite3"
    build_file = tmp_path / "build-time"
    build_file.write_text("2026-11-18T22:30:00Z\n", encoding="utf-8")
    monkeypatch.setenv("EVIDENCE_DB", str(db_path))
    monkeypatch.setenv("EVIDENCE_ADMIN_TOKEN", "test-only-token")
    module = importlib.reload(importlib.import_module("app"))
    monkeypatch.setattr(module, "BUILD_TIME_FILE", build_file)
    headers = {"X-Admin-Token": "test-only-token"}
    payload = {"day": "2026-11-19", "title": "测试课程", "content": "测试内容"}

    with TestClient(module.app) as client:
        first = client.get("/api/status").json()
        assert first["site_build_at"] == "2026-11-18T22:30:00Z"
        assert first["course_import_at"] is None
        result = client.post("/api/courses", headers=headers, json=payload).json()
        with sqlite3.connect(db_path) as db:
            db.execute("UPDATE courses SET created_at=? WHERE id=?", ("2026-11-19 00:15:00", result["id"]))
        published = client.get("/api/status").json()
        assert published["course_import_at"] == "2026-11-19T00:15:00Z"
        assert client.post("/api/courses", headers=headers, json=payload).json()["duplicate"]
        assert client.post(f"/api/progress/{result['id']}", headers=headers, json={"seconds": 31}).status_code == 200
        assert client.post(f"/api/notes/{result['id']}", headers=headers, json={"body": "笔记"}).status_code == 200
        afterward = client.get("/api/status").json()
        assert afterward["site_build_at"] == published["site_build_at"]
        assert afterward["course_import_at"] == published["course_import_at"]
        assert client.get("/api/status").headers["cache-control"] == "no-store"
        assert client.get("/").headers["cache-control"] == "no-cache"
        assert client.get("/static/app.js").headers["cache-control"] == "no-cache"


def test_missing_or_invalid_build_timestamp_does_not_invent_current_time(monkeypatch, tmp_path):
    monkeypatch.setenv("EVIDENCE_DB", str(tmp_path / "isolated.sqlite3"))
    module = importlib.reload(importlib.import_module("app"))
    build_file = tmp_path / "invalid-time"
    monkeypatch.setattr(module, "BUILD_TIME_FILE", build_file)
    with TestClient(module.app) as client:
        assert client.get("/api/status").json()["site_build_at"] is None
        build_file.write_text("invalid timestamp", encoding="utf-8")
        assert client.get("/api/status").json()["site_build_at"] is None
