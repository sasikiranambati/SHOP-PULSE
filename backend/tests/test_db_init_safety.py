"""
Stage 5.1: database initialization safety.

Importing the application (``main``) or any router / service / schema / model / core module must never
create or modify a database. Schema initialization happens only at application startup (FastAPI lifespan,
unmanaged databases only, SHOPPULSE_DB_INIT=off disables it), through the explicit command
``python -m db.init_schema --confirm``, or in test setup on the isolated test database.

Each import check runs in a fresh Python process (this pytest process has already imported everything)
against temporary databases only; backend/shoppulse.db is never used.
"""

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
PACKAGES = ("api", "services", "schemas", "db", "core")

IMPORT_EVERYTHING = f"""
import importlib, pkgutil, sys
import main  # the application module
failed = []
for pkg_name in {PACKAGES!r}:
    pkg = importlib.import_module(pkg_name)
    for mod in pkgutil.walk_packages(pkg.__path__, pkg_name + "."):
        try:
            importlib.import_module(mod.name)
        except Exception as exc:  # optional heavy dependencies are irrelevant here
            failed.append((mod.name, type(exc).__name__))
print("IMPORTED", len(sys.modules))
"""


def _run(code: str, db_url: str, extra_env=None, timeout=240):
    env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "SHOPPULSE_DB_INIT")}
    env.update({"DATABASE_URL": db_url, "SHOPPULSE_TEST_MODE": "1", "PYTHONDONTWRITEBYTECODE": "1"})
    env.update(extra_env or {})
    return subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=timeout)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _siblings(path: Path):
    return [p.name for p in path.parent.iterdir() if p.name.startswith(path.name + "-")]


def _tables(path: Path):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return sorted(r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'"))
    finally:
        con.close()


def test_importing_main_does_not_create_a_database(tmp_path):
    db = tmp_path / "never_created.db"
    r = _run("import main; print('OK')", f"sqlite:///{db}")
    assert r.returncode == 0, r.stderr[-2000:]
    assert not db.exists() and _siblings(db) == []


def test_importing_everything_leaves_an_existing_database_byte_identical(tmp_path):
    db = tmp_path / "existing.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE ledger (id INTEGER PRIMARY KEY, note TEXT)")
    con.execute("INSERT INTO ledger (note) VALUES ('historical record')")
    con.commit()
    con.close()
    before = (_sha(db), db.stat().st_mtime_ns, db.stat().st_size)
    r = _run(IMPORT_EVERYTHING, f"sqlite:///{db}")
    assert r.returncode == 0 and "IMPORTED" in r.stdout, r.stderr[-2000:]
    assert (_sha(db), db.stat().st_mtime_ns, db.stat().st_size) == before
    assert _siblings(db) == []  # no -wal / -shm / -journal: nothing even opened it
    assert _tables(db) == ["ledger"]


def test_importing_routers_and_services_does_not_create_schema(tmp_path):
    db = tmp_path / "routers.db"
    r = _run(IMPORT_EVERYTHING.replace("import main  # the application module", ""), f"sqlite:///{db}")
    assert r.returncode == 0, r.stderr[-2000:]
    assert not db.exists()


STARTUP = """
import json
from fastapi.testclient import TestClient
from main import app
with TestClient(app) as client:  # runs the startup lifespan
    root = client.get("/").status_code
    reg = client.post("/api/v1/auth/register", json={"email": "smoke@example.com", "password": "password123"}).status_code
    login = client.post("/api/v1/auth/login", json={"email": "smoke@example.com", "password": "password123"}).status_code
print("RESULT", json.dumps([root, reg, login]))
"""


def _result(r):
    line = next((ln for ln in r.stdout.splitlines() if ln.startswith("RESULT ")), None)
    assert line, (r.stdout[-1000:], r.stderr[-2000:])
    return json.loads(line[len("RESULT "):])


def test_application_starts_with_an_explicitly_configured_database(tmp_path):
    db = tmp_path / "app.db"
    r = _run(STARTUP, f"sqlite:///{db}")
    assert r.returncode == 0, r.stderr[-2000:]
    assert _result(r) == [200, 201, 200]
    assert {"users", "shops", "products", "sales", "purchases"} <= set(_tables(db))


def test_startup_never_changes_an_alembic_managed_database(tmp_path):
    db = tmp_path / "managed.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
    con.execute("INSERT INTO alembic_version VALUES ('708192a3b4c5')")
    con.commit()
    con.close()
    r = _run("from fastapi.testclient import TestClient\nfrom main import app\nwith TestClient(app):\n    pass\nprint('OK')", f"sqlite:///{db}")
    assert r.returncode == 0, r.stderr[-2000:]
    assert _tables(db) == ["alembic_version"]  # not even missing tables are created: migrations own it


def test_startup_initialization_can_be_disabled(tmp_path):
    db = tmp_path / "off.db"
    r = _run("from fastapi.testclient import TestClient\nfrom main import app\nwith TestClient(app) as c:\n    print('RESULT', c.get('/').status_code)",
             f"sqlite:///{db}", {"SHOPPULSE_DB_INIT": "off"})
    assert r.returncode == 0, r.stderr[-2000:]
    assert _result(r) == 200
    assert not db.exists()  # nothing connected to the database


def test_explicit_command_requires_confirmation(tmp_path):
    db = tmp_path / "cmd.db"
    env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
    env.update({"DATABASE_URL": f"sqlite:///{db}", "SHOPPULSE_TEST_MODE": "1"})
    dry = subprocess.run([sys.executable, "-m", "db.init_schema"], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=240)
    assert dry.returncode == 2 and "Nothing done" in dry.stdout and not db.exists()
    real = subprocess.run([sys.executable, "-m", "db.init_schema", "--confirm"], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=240)
    assert real.returncode == 0, real.stderr[-2000:]
    assert "Tables created" in real.stdout and "users" in _tables(db)


def test_init_is_additive_and_reports_what_it_did(tmp_path):
    from sqlalchemy import create_engine

    from db.init_schema import init_db_schema
    db = tmp_path / "legacy.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE notes_kept (id INTEGER PRIMARY KEY)")
    con.execute("INSERT INTO notes_kept VALUES (7)")
    con.commit()
    con.close()
    engine = create_engine(f"sqlite:///{db}")
    first = init_db_schema(engine)
    second = init_db_schema(engine)
    engine.dispose()
    assert "users" in first.created_tables and first.changed
    assert not second.changed  # idempotent: nothing more to do
    con = sqlite3.connect(db)
    assert con.execute("SELECT id FROM notes_kept").fetchall() == [(7,)]  # unrelated data untouched
    con.close()


def test_test_suite_uses_its_own_database():
    from core.db_safety import DEFAULT_DB_PATH
    from db.session import engine

    assert str(DEFAULT_DB_PATH) not in str(engine.url)
    assert "shoppulse-pytest-" in str(engine.url) or os.environ.get("SHOPPULSE_TEST_DATABASE_URL")
    from sqlalchemy import inspect
    with engine.connect() as conn:
        assert "users" in inspect(conn).get_table_names()  # initialized explicitly by conftest


@pytest.mark.parametrize("value,enabled", [(None, True), ("auto", True), ("off", False), ("0", False), ("false", False)])
def test_startup_switch(value, enabled):
    from db.init_schema import startup_init_enabled
    env = {} if value is None else {"SHOPPULSE_DB_INIT": value}
    assert startup_init_enabled(env) is enabled
