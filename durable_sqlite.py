"""Keep the original SQLite schema while persisting snapshots in managed MySQL.

Every connection locks the same remote state row until its SQLite transaction has
finished. A committed write is acknowledged only after the new snapshot is durably
committed. Multiple application instances therefore cannot overwrite each other.
Local development and isolated tests continue to use ordinary SQLite files.
"""

import os
import pathlib
import sqlite3
import ssl
from contextlib import contextmanager
from urllib.parse import parse_qs, unquote, urlsplit

import pymysql

STATE_TABLE = "evidence_sqlite_state"


def remote_connect():
    parsed = urlsplit(os.environ["DATABASE_URL"])
    query = parse_qs(parsed.query)
    options = {
        "host": parsed.hostname,
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": unquote(parsed.path.lstrip("/")),
        "charset": "utf8mb4",
        "autocommit": False,
        "connect_timeout": 15,
        "read_timeout": 30,
        "write_timeout": 30,
    }
    sslmode = query.get("sslmode", [""])[0].lower()
    if sslmode in {"require", "verify-ca", "verify-full"} or "ssl" in query:
        options["ssl"] = ssl.create_default_context()
    return pymysql.connect(**options)


def seed_snapshot(source: pathlib.Path):
    """One-time additive import; an existing state row is never overwritten."""
    with sqlite3.connect(f"file:{source.resolve()}?mode=ro", uri=True) as check:
        if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("The uploaded SQLite database failed integrity checking")
        snapshot = check.serialize()
    remote = remote_connect()
    try:
        with remote.cursor() as cursor:
            cursor.execute(
                f"CREATE TABLE IF NOT EXISTS {STATE_TABLE} ("
                "id TINYINT PRIMARY KEY, payload LONGBLOB NOT NULL, "
                "revision BIGINT UNSIGNED NOT NULL DEFAULT 1, "
                "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP "
                "ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB"
            )
            cursor.execute(
                f"INSERT IGNORE INTO {STATE_TABLE} (id,payload) VALUES (1,%s)",
                (snapshot,),
            )
            inserted = cursor.rowcount == 1
        remote.commit()
        return inserted
    finally:
        remote.close()


@contextmanager
def connection(local_path: pathlib.Path, managed: bool):
    remote = None
    local = None
    before = b""
    try:
        if managed:
            remote = remote_connect()
            remote.begin()
            with remote.cursor() as cursor:
                cursor.execute(
                    f"SELECT payload FROM {STATE_TABLE} WHERE id=1 FOR UPDATE"
                )
                result = cursor.fetchone()
            if not result:
                raise RuntimeError("Original course database has not been imported")
            before = bytes(result[0])
            local = sqlite3.connect(":memory:")
            local.deserialize(before)
        else:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local = sqlite3.connect(local_path, timeout=30)
        local.row_factory = sqlite3.Row
        local.execute("PRAGMA foreign_keys=ON")
        with local:
            yield local
        if remote is not None:
            after = local.serialize()
            if after != before:
                with remote.cursor() as cursor:
                    cursor.execute(
                        f"UPDATE {STATE_TABLE} SET payload=%s,revision=revision+1 WHERE id=1",
                        (after,),
                    )
                remote.commit()
            else:
                remote.rollback()
    except BaseException:
        if remote is not None:
            remote.rollback()
        raise
    finally:
        if local is not None:
            local.close()
        if remote is not None:
            remote.close()
