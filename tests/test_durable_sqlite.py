"""Isolated contract tests: no production database, app import, or network access.

The fake remote connection publishes a staged blob only on commit and holds a
shared row lock from SELECT ... FOR UPDATE through commit/rollback/close.
All SQL is executed either by this fake or by a new in-memory SQLite database.
"""

import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import durable_sqlite  # noqa: E402 -- this module has no connection side effects


class FakeStore:
    def __init__(self, payload):
        self.payload = payload
        self.revision = 1
        self.lock = threading.Lock()
        self.registry_lock = threading.Lock()
        self.connections = []
        self.second_select_attempted = threading.Event()
        self.fail_commit = False

    def connect(self):
        with self.registry_lock:
            remote = FakeRemote(self, len(self.connections) + 1)
            self.connections.append(remote)
        return remote


class FakeRemote:
    def __init__(self, store, number):
        self.store = store
        self.number = number
        self.active = False
        self.locked = False
        self.pending = None
        self.closed = False
        self.commits = 0
        self.rollbacks = 0
        self.updates = 0

    def begin(self):
        assert not self.closed and not self.active
        self.active = True

    def cursor(self):
        assert not self.closed
        return FakeCursor(self)

    def commit(self):
        assert self.active and self.locked and not self.closed
        if self.store.fail_commit:
            raise RuntimeError("simulated remote commit failure")
        if self.pending is not None:
            self.store.payload = self.pending
            self.store.revision += 1
        self.commits += 1
        self._finish()

    def rollback(self):
        assert not self.closed
        self.rollbacks += 1
        self._finish()

    def _finish(self):
        self.pending = None
        self.active = False
        if self.locked:
            self.locked = False
            self.store.lock.release()

    def close(self):
        self._finish()
        self.closed = True


class FakeCursor:
    def __init__(self, remote):
        self.remote = remote
        self.result = None
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, args=()):
        remote = self.remote
        normalized = " ".join(sql.split())
        select = (
            f"SELECT payload FROM {durable_sqlite.STATE_TABLE} "
            "WHERE id=1 FOR UPDATE"
        )
        update = (
            f"UPDATE {durable_sqlite.STATE_TABLE} "
            "SET payload=%s,revision=revision+1 WHERE id=1"
        )
        assert remote.active and not remote.closed
        if normalized == select:
            assert not args and not remote.locked
            if remote.number == 2:
                remote.store.second_select_attempted.set()
            assert remote.store.lock.acquire(timeout=10), "fake row lock timed out"
            remote.locked = True
            payload = remote.store.payload
            self.result = None if payload is None else (payload,)
            self.rowcount = int(payload is not None)
        elif normalized == update:
            assert remote.locked and len(args) == 1
            remote.pending = bytes(args[0])
            remote.updates += 1
            self.rowcount = 1
        else:
            raise AssertionError(f"Unexpected SQL in fake remote: {normalized}")

    def fetchone(self):
        return self.result


@pytest.fixture(autouse=True)
def prohibit_real_remote_connections(monkeypatch):
    # Remove credentials from the test environment without reading their values.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("EVIDENCE_DB", raising=False)

    def forbidden(*args, **kwargs):
        raise AssertionError("Real database/network access is forbidden in these tests")

    monkeypatch.setattr(durable_sqlite.pymysql, "connect", forbidden)


@pytest.fixture
def store(monkeypatch):
    with sqlite3.connect(":memory:") as local:
        local.executescript(
            "CREATE TABLE counter(id INTEGER PRIMARY KEY, value INTEGER NOT NULL);"
            "INSERT INTO counter VALUES(1,0);"
            "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL);"
            "INSERT INTO notes VALUES(1,'原始课程快照');"
        )
        blob = local.serialize()
    local.close()
    fake = FakeStore(blob)
    monkeypatch.setattr(durable_sqlite, "remote_connect", fake.connect)
    return fake


def assert_all_closed_and_unlocked(store):
    assert all(remote.closed for remote in store.connections)
    assert not store.lock.locked()


def test_reads_snapshot_without_creating_local_database(store, tmp_path):
    path = tmp_path / "not-created" / "data.sqlite3"
    original = store.payload
    with durable_sqlite.connection(path, managed=True) as local:
        assert local.row_factory is sqlite3.Row
        assert local.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        row = local.execute("SELECT * FROM notes WHERE id=1").fetchone()
        assert row["body"] == "原始课程快照"
        assert local.execute("SELECT value FROM counter").fetchone()[0] == 0
    assert not path.parent.exists()
    assert store.payload == original
    assert store.revision == 1
    assert store.connections[0].updates == 0
    assert store.connections[0].commits == 0
    assert store.connections[0].rollbacks == 1
    assert_all_closed_and_unlocked(store)


def test_writes_persist_across_fresh_connections(store, tmp_path):
    path = tmp_path / "unused.sqlite3"
    original = store.payload
    with durable_sqlite.connection(path, managed=True) as local:
        local.execute("BEGIN IMMEDIATE")  # Matches course import transaction usage.
        local.execute("UPDATE counter SET value=7 WHERE id=1")
        local.execute("INSERT INTO notes VALUES(2,?)", ("跨连接保存",))
    assert store.payload != original
    assert store.connections[0].commits == 1
    assert store.revision == 2

    with durable_sqlite.connection(path, managed=True) as local:
        assert local.execute("SELECT value FROM counter").fetchone()[0] == 7
        assert local.execute("SELECT body FROM notes WHERE id=2").fetchone()[0] == "跨连接保存"
        local.execute("UPDATE counter SET value=value+1 WHERE id=1")
    with durable_sqlite.connection(path, managed=True) as local:
        assert local.execute("SELECT value FROM counter").fetchone()[0] == 8
        assert local.execute("SELECT COUNT(*) FROM notes").fetchone()[0] == 2
    assert store.revision == 3
    assert [remote.commits for remote in store.connections] == [1, 1, 0]
    assert not path.exists()
    assert_all_closed_and_unlocked(store)


@pytest.mark.parametrize("error_type", [RuntimeError, KeyboardInterrupt])
def test_exception_rolls_back_without_publishing_snapshot(store, tmp_path, error_type):
    original = store.payload
    path = tmp_path / "unused.sqlite3"
    with pytest.raises(error_type, match="abort isolated transaction"):
        with durable_sqlite.connection(path, managed=True) as local:
            local.execute("UPDATE counter SET value=99 WHERE id=1")
            local.execute("DELETE FROM notes")
            raise error_type("abort isolated transaction")
    assert store.payload == original
    assert store.revision == 1
    assert store.connections[0].rollbacks == 1
    assert store.connections[0].commits == 0
    assert store.connections[0].updates == 0
    with durable_sqlite.connection(path, managed=True) as local:
        assert local.execute("SELECT value FROM counter").fetchone()[0] == 0
        assert local.execute("SELECT COUNT(*) FROM notes").fetchone()[0] == 1
    assert_all_closed_and_unlocked(store)


def test_remote_commit_failure_is_not_acknowledged_and_preserves_blob(store, tmp_path):
    original = store.payload
    path = tmp_path / "unused.sqlite3"
    store.fail_commit = True
    with pytest.raises(RuntimeError, match="simulated remote commit failure"):
        with durable_sqlite.connection(path, managed=True) as local:
            local.execute("UPDATE counter SET value=99 WHERE id=1")
    assert store.payload == original
    assert store.revision == 1
    assert store.connections[0].updates == 1
    assert store.connections[0].commits == 0
    assert store.connections[0].rollbacks == 1
    assert_all_closed_and_unlocked(store)
    store.fail_commit = False
    with durable_sqlite.connection(path, managed=True) as local:
        assert local.execute("SELECT value FROM counter").fetchone()[0] == 0
    assert_all_closed_and_unlocked(store)


def test_missing_seed_fails_and_releases_remote_transaction(store, tmp_path):
    store.payload = None
    with pytest.raises(RuntimeError, match="Original course database has not been imported"):
        with durable_sqlite.connection(tmp_path / "unused.sqlite3", managed=True):
            pytest.fail("An absent seed must not produce a writable empty database")
    assert store.connections[0].rollbacks == 1
    assert store.connections[0].commits == 0
    assert_all_closed_and_unlocked(store)


def test_concurrent_writes_reload_latest_snapshot_and_do_not_lose_updates(store, tmp_path):
    path = tmp_path / "unused.sqlite3"
    first_changed = threading.Event()
    allow_first_commit = threading.Event()
    second_entered = threading.Event()

    def first_writer():
        with durable_sqlite.connection(path, managed=True) as local:
            assert local.execute("SELECT value FROM counter").fetchone()[0] == 0
            local.execute("UPDATE counter SET value=value+1 WHERE id=1")
            first_changed.set()
            assert allow_first_commit.wait(timeout=10), "first writer was not released"

    def second_writer():
        with durable_sqlite.connection(path, managed=True) as local:
            second_entered.set()
            # The first commit must be visible, not the original value of zero.
            assert local.execute("SELECT value FROM counter").fetchone()[0] == 1
            local.execute("UPDATE counter SET value=value+1 WHERE id=1")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(first_writer)
        try:
            assert first_changed.wait(timeout=5), "first writer did not enter"
            second = pool.submit(second_writer)
            assert store.second_select_attempted.wait(timeout=5), "second writer did not contend"
            assert not second_entered.is_set(), "row lock allowed an overlapping snapshot"
            assert not second.done()
        finally:
            allow_first_commit.set()
        first.result(timeout=10)
        second.result(timeout=10)

    with durable_sqlite.connection(path, managed=True) as local:
        assert local.execute("SELECT value FROM counter").fetchone()[0] == 2
    assert store.revision == 3
    assert [remote.commits for remote in store.connections] == [1, 1, 0]
    assert not path.exists()
    assert_all_closed_and_unlocked(store)
