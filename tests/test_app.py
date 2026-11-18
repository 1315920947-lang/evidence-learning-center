import importlib
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

HEADERS = {"X-Admin-Token": "test-secret"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("EVIDENCE_DB", str(tmp_path / "test.sqlite3"))
    monkeypatch.setenv("EVIDENCE_ADMIN_TOKEN", HEADERS["X-Admin-Token"])
    module = importlib.reload(importlib.import_module("app"))
    with TestClient(module.app) as test_client:
        yield test_client


@pytest.fixture
def payload(client):
    # Test fixture metadata only. It is never seeded or published.
    return {
        "day": client.get("/api/status").json()["today"],
        "title": "测试课程",
        "system": "测试系统",
        "topic": "测试专题",
        "minutes": 75,
        "source": "测试文件",
        "content": "# 测试正文\n\n|项目|结果|\n|---|---|\n|A|全文关键词|",
        "references": [
            {
                "title": "测试文献条目",
                "source": "测试来源",
                "url": "https://example.org/paper",
                "full_text_url": "https://example.org/full",
                "doi": "test-doi",
                "pmid": "test-pmid",
            }
        ],
        "questions": [
            {
                "question": "测试题干",
                "options": ["A", "B"],
                "answer": 1,
                "explanation": "测试解析",
            }
        ],
        "tools": [{"kind": "体检审核清单", "title": "测试工具", "content": "- 清单项"}],
    }


def test_complete_import_and_archive(client, payload):
    assert client.get("/").status_code == 200
    assert client.get("/api/courses").json() == []
    assert client.post("/api/courses", json=payload).status_code == 401
    imported = client.post(
        "/api/upload",
        headers=HEADERS,
        files={
            "file": ("course.json", json.dumps(payload, ensure_ascii=False).encode())
        },
    )
    assert imported.status_code == 200, imported.text
    first = imported.json()["id"]
    assert client.post("/api/courses", json=payload, headers=HEADERS).json() == {
        "duplicate": True,
        "id": first,
    }
    course = client.get(f"/api/courses/{first}").json()
    assert course["content"] == payload["content"]
    assert "<table>" in course["html"]
    assert course["source"] == payload["source"]
    assert "answer" not in course["questions"][0]
    assert "explanation" not in course["questions"][0]
    assert "note" not in course
    refs = client.get("/api/references", params={"q": "test-pmid"}).json()
    assert {key: refs[0][key] for key in payload["references"][0]} == payload[
        "references"
    ][0]
    tools = client.get("/api/tools").json()
    assert tools[0]["kind"] == "体检审核清单"
    assert "<li>清单项</li>" in tools[0]["html"]
    assert (
        client.get("/api/courses", params={"q": "全文关键词"}).json()[0]["system"]
        == "测试系统"
    )
    newer = {**payload, "content": "新版正文", "references": []}
    result = client.post("/api/courses", json=newer, headers=HEADERS).json()
    assert result["version"] == 2
    assert [
        c["id"]
        for c in client.get("/api/courses", params={"day": payload["day"]}).json()
    ] == [result["id"]]
    assert [
        v["id"] for v in client.get(f"/api/courses/{first}").json()["versions"]
    ] == [result["id"], first]
    assert client.get("/api/references").json()[0]["course_id"] == first


def test_learning_data_and_export(client, payload):
    cid = client.post("/api/courses", json=payload, headers=HEADERS).json()["id"]
    course = client.get(f"/api/courses/{cid}").json()
    qid = course["questions"][0]["id"]
    rid = course["references"][0]["id"]
    assert client.get(f"/api/learning/{cid}").status_code == 401
    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/export").status_code == 401
    assert (
        client.post(
            f"/api/answer/{qid}", json={"choice": 2}, headers=HEADERS
        ).status_code
        == 422
    )
    answer = client.post(f"/api/answer/{qid}", json={"choice": 1}, headers=HEADERS)
    assert answer.json() == {"correct": True, "answer": 1, "explanation": "测试解析"}
    for seconds, completed in ((120, True), (60, False)):
        assert (
            client.post(
                f"/api/progress/{cid}",
                json={"seconds": seconds, "completed": completed},
                headers=HEADERS,
            ).status_code
            == 200
        )
    assert (
        client.post(
            f"/api/notes/{cid}", json={"body": "测试笔记"}, headers=HEADERS
        ).status_code
        == 200
    )
    for _ in range(2):
        assert client.put(
            f"/api/bookmarks/{rid}", json={"bookmarked": True}, headers=HEADERS
        ).json()["bookmarked"]
    d = client.get("/api/dashboard", headers=HEADERS).json()
    assert d["attempts"] == {"n": 1, "correct": 1}
    assert (d["completed"], d["seconds"]) == (1, 120)
    assert d["records"][0]["body"] == "测试笔记"
    assert [b["id"] for b in d["bookmarks"]] == [rid]
    assert (
        client.get(f"/api/learning/{cid}", headers=HEADERS).json()["note"]["body"]
        == "测试笔记"
    )
    assert (
        client.get("/api/export", headers=HEADERS).json()["tools"][0]["course_id"]
        == cid
    )
    assert (
        client.put(
            f"/api/bookmarks/{rid}", json={"bookmarked": False}, headers=HEADERS
        ).status_code
        == 200
    )
    assert client.get("/api/dashboard", headers=HEADERS).json()["bookmarks"] == []


def test_validation_and_safe_rendering(client, payload):
    bad = {
        **payload,
        "references": [
            {**payload["references"][0], "full_text_url": "javascript:alert(1)"}
        ],
    }
    assert client.post("/api/courses", json=bad, headers=HEADERS).status_code == 422
    assert client.get("/api/courses").json() == []
    raw = "<script>alert(1)</script>\n\n[链接](javascript:alert%281%29)"
    cid = client.post(
        "/api/courses", json={**payload, "content": raw}, headers=HEADERS
    ).json()["id"]
    data = client.get(f"/api/courses/{cid}").json()
    assert data["content"] == raw
    assert "<script>" not in data["html"]
    assert 'href="javascript:' not in data["html"]


def test_concurrent_duplicate_import(client, payload):
    def publish(_):
        return client.post("/api/courses", json=payload, headers=HEADERS).json()

    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(publish, range(4)))
    assert len({result["id"] for result in results}) == 1
    assert sum(not result["duplicate"] for result in results) == 1
