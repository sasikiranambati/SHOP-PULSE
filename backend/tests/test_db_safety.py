"""
Test-database isolation (Phase 4, workstream 9a).

Unit: the guard accepts only dedicated SQLite test databases in test mode and is a no-op otherwise.
Integration: the application refuses to start in test mode without a test database, and with one it
creates its schema there - the protected development database is never opened.
"""

import hashlib
import os
import subprocess
import sys
from pathlib import Path

import pytest

from core.db_safety import (
    BACKEND_DIR,
    DEFAULT_DB_PATH,
    UnsafeTestDatabaseError,
    assert_safe_test_database,
    is_test_mode,
)

# ------------------------------------------------------------------------------------- unit


@pytest.mark.parametrize("url", [
    "sqlite:///:memory:",
    "sqlite://",
    "sqlite:////tmp/shoppulse-pytest-x/test.db",
])
def test_dedicated_test_databases_are_accepted(url):
    assert_safe_test_database(url, explicit=True, cwd=Path("/tmp"))


def test_missing_database_url_is_refused():
    """The application would fall back to the default database: ambiguous, so refused."""
    with pytest.raises(UnsafeTestDatabaseError, match="DATABASE_URL is not set"):
        assert_safe_test_database(f"sqlite:///{DEFAULT_DB_PATH}", explicit=False)
    with pytest.raises(UnsafeTestDatabaseError):
        assert_safe_test_database(None, explicit=True)


@pytest.mark.parametrize("url,cwd", [
    (f"sqlite:///{DEFAULT_DB_PATH}", Path("/tmp")),                  # absolute
    ("sqlite:///shoppulse.db", BACKEND_DIR),                         # relative, run from backend/
    ("sqlite:///./shoppulse.db", BACKEND_DIR),
    ("sqlite:///backend/shoppulse.db", BACKEND_DIR.parent),          # relative, run from the repo root
    (f"sqlite:///{BACKEND_DIR}/../backend/shoppulse.db", Path("/tmp")),  # path tricks resolve first
    (f"sqlite:///file:{DEFAULT_DB_PATH}?mode=rw&uri=true", Path("/tmp")),
    ("sqlite:////tmp/copy/shoppulse.db", Path("/tmp")),              # any file named like the dev db
    (f"sqlite:///{BACKEND_DIR}/test.db", Path("/tmp")),              # beside the dev db
])
def test_development_database_and_backend_directory_are_refused(url, cwd):
    with pytest.raises(UnsafeTestDatabaseError):
        assert_safe_test_database(url, explicit=True, cwd=cwd)


@pytest.mark.parametrize("url", ["postgresql://u:p@localhost/shop", "mysql://u:p@db/shop", "not a url"])
def test_non_sqlite_or_unparsable_urls_are_refused(url):
    with pytest.raises(UnsafeTestDatabaseError):
        assert_safe_test_database(url, explicit=True)


def test_test_mode_detection():
    assert is_test_mode({"SHOPPULSE_TEST_MODE": "1"}, {}) is True
    assert is_test_mode({"SHOPPULSE_TEST_MODE": "TRUE"}, {}) is True
    assert is_test_mode({}, {"pytest": object()}) is True  # a run that bypassed conftest still counts
    assert is_test_mode({"SHOPPULSE_TEST_MODE": "0"}, {}) is False
    assert is_test_mode({}, {}) is False


def test_this_run_uses_the_isolated_database():
    from db.session import engine

    assert os.environ["SHOPPULSE_TEST_MODE"] == "1"
    assert engine.url.get_backend_name() == "sqlite"
    assert engine.url.database is not None
    assert Path(engine.url.database).resolve() != DEFAULT_DB_PATH
    assert BACKEND_DIR not in Path(engine.url.database).resolve().parents


# ------------------------------------------------------------------------------------- integration


def _fingerprint(path: Path):
    if not path.exists():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns


def _import_app(env_overrides, cwd=BACKEND_DIR):
    env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "SHOPPULSE_TEST_MODE")}
    if "DATABASE_URL" not in env_overrides:
        env["DATABASE_URL"] = ""
    env.update(env_overrides)
    return subprocess.run([sys.executable, "-c", "import main; from db.session import engine; print(engine.url)"],
                          cwd=cwd, env=env, capture_output=True, text=True, timeout=120)


def test_app_refuses_to_start_in_test_mode_without_a_test_database():
    before = _fingerprint(DEFAULT_DB_PATH)
    proc = _import_app({"SHOPPULSE_TEST_MODE": "1"})
    assert proc.returncode != 0
    assert "UnsafeTestDatabaseError" in proc.stderr and "DATABASE_URL is not set" in proc.stderr
    assert _fingerprint(DEFAULT_DB_PATH) == before


def test_app_refuses_the_development_database_in_test_mode():
    before = _fingerprint(DEFAULT_DB_PATH)
    proc = _import_app({"SHOPPULSE_TEST_MODE": "1", "DATABASE_URL": "sqlite:///./shoppulse.db"})
    assert proc.returncode != 0 and "protected development database" in proc.stderr
    assert _fingerprint(DEFAULT_DB_PATH) == before


def test_app_starts_on_a_test_database_and_creates_its_schema_there(tmp_path):
    before = _fingerprint(DEFAULT_DB_PATH)
    db = tmp_path / "isolated.db"

    # 1. Importing main does not create the database file
    proc = _import_app({"SHOPPULSE_TEST_MODE": "1", "DATABASE_URL": f"sqlite:///{db}"})
    assert proc.returncode == 0, proc.stderr
    assert not db.exists(), "importing main should not create the database file"

    # 2. Controlled initialization explicitly initializes schema on the test database
    env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "SHOPPULSE_TEST_MODE")}
    env.update({"SHOPPULSE_TEST_MODE": "1", "DATABASE_URL": f"sqlite:///{db}"})
    init_proc = subprocess.run(
        [sys.executable, "-c", "import main; main.init_db_schema(); from db.session import engine; print(engine.url)"],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=120
    )
    assert init_proc.returncode == 0, init_proc.stderr

    import urllib.parse
    stdout_unquoted = urllib.parse.unquote(init_proc.stdout)
    assert str(db) in stdout_unquoted.replace("/", "\\") or str(db).replace("\\", "/") in stdout_unquoted
    import sqlite3

    with sqlite3.connect(db) as con:
        tables = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
    assert {"products", "purchases", "sales"} <= tables
    assert _fingerprint(DEFAULT_DB_PATH) == before


def test_testclient_import_without_database_url_is_refused():
    """Ad-hoc scripts importing TestClient before main without DATABASE_URL must fail closed."""
    before = _fingerprint(DEFAULT_DB_PATH)
    env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "SHOPPULSE_TEST_MODE")}
    env["DATABASE_URL"] = ""
    proc = subprocess.run(
        [sys.executable, "-c", "from fastapi.testclient import TestClient; import main"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode != 0
    assert "UnsafeTestDatabaseError" in proc.stderr
    assert _fingerprint(DEFAULT_DB_PATH) == before


def test_isolated_diagnostic_helper_enforces_import_order_and_isolates_db(tmp_path):
    """prepare_isolated_diagnostic_db refuses late calls and safely isolates early diagnostic runs."""
    before = _fingerprint(DEFAULT_DB_PATH)
    env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "SHOPPULSE_TEST_MODE")}
    env["DATABASE_URL"] = ""

    # Late call after importing core.config is refused (never silently switches DBs)
    late_proc = subprocess.run(
        [
            sys.executable,
            "-c",
            "import os; os.environ['SHOPPULSE_TEST_MODE']='0'; import core.config; from core.db_safety import prepare_isolated_diagnostic_db; prepare_isolated_diagnostic_db()",
        ],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert late_proc.returncode != 0
    assert "before importing application modules" in late_proc.stderr

    # Early call binds cleanly to isolated temp DB and never touches shoppulse.db
    diag_db = tmp_path / "diag_isolated.db"
    ok_proc = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                f"import urllib.parse; from pathlib import Path; from core.db_safety import prepare_isolated_diagnostic_db; "
                f"url, path = prepare_isolated_diagnostic_db(Path(r'{diag_db}')); "
                f"import main; from db.session import engine; "
                f"actual = urllib.parse.unquote(str(engine.url)).replace('\\\\','/'); "
                f"assert str(path).replace('\\\\','/') in actual, f'{{actual}} != {{path}}'"
            ),
        ],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert ok_proc.returncode == 0, ok_proc.stderr
    assert "[db_safety] Isolated diagnostic target:" in ok_proc.stdout
    assert _fingerprint(DEFAULT_DB_PATH) == before
