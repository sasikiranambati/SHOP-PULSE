"""
Test-database safety guard (Phase 4, workstream 9a).

Automated tests and browser checks must never read from or write to the developer's default database
(``backend/shoppulse.db``). When the process runs in *test mode* the database URL must be set
explicitly and point to a throwaway SQLite database; anything else stops the process before a
database engine is created (fail closed).

Test mode is on when:
  * ``SHOPPULSE_TEST_MODE`` is ``1`` / ``true`` / ``yes`` (set by the pytest ``conftest.py`` and by the
    browser-test launcher ``scripts/e2e/run.cjs``), or
  * ``pytest`` has been imported in this process (a test run that bypassed ``conftest.py``).

Outside test mode the guard does nothing, so normal development and production are unchanged.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import Mapping, Optional, Tuple

from sqlalchemy.engine import make_url

TEST_MODE_ENV = "SHOPPULSE_TEST_MODE"
BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = (BACKEND_DIR / "shoppulse.db").resolve()

_TRUE = {"1", "true", "yes", "on"}
_TEST_MODULES = ("pytest", "fastapi.testclient", "starlette.testclient")


class UnsafeTestDatabaseError(RuntimeError):
    """Raised when a test run would use a database that is not a dedicated test database."""


def is_test_mode(environ: Optional[Mapping[str, str]] = None, modules: Optional[Mapping[str, object]] = None) -> bool:
    environ = os.environ if environ is None else environ
    modules = sys.modules if modules is None else modules
    return (
        environ.get(TEST_MODE_ENV, "").strip().lower() in _TRUE
        or any(mod in modules for mod in _TEST_MODULES)
    )


def _sqlite_target(url: str, cwd: Path) -> Optional[Path]:
    """Resolved file of a SQLite URL; None for an in-memory database."""
    database = make_url(url).database
    if database in (None, "", ":memory:") or database.startswith("file::memory:"):
        return None
    if database.startswith("file:"):  # URI form: file:/path/db?mode=...
        database = database[5:].split("?", 1)[0]
    path = Path(database)
    if not path.is_absolute():
        path = cwd / path  # SQLite resolves a relative path against the working directory
    return path.resolve()


def assert_safe_test_database(url: Optional[str], *, explicit: bool, cwd: Optional[Path] = None) -> None:
    """Raise UnsafeTestDatabaseError unless ``url`` is a dedicated SQLite test database.

    ``explicit`` is False when the application fell back to its default database because no
    ``DATABASE_URL`` was configured; in test mode that is always refused.
    """
    if not explicit or not url:
        raise UnsafeTestDatabaseError(
            f"{TEST_MODE_ENV}: DATABASE_URL is not set, so the default database {DEFAULT_DB_PATH} would be "
            "used. Tests must set DATABASE_URL to a dedicated test database (see docs/phase4/TEST_ISOLATION.md)."
        )
    try:
        backend = make_url(url).get_backend_name()
    except Exception as exc:  # unparsable: ambiguous, so refuse
        raise UnsafeTestDatabaseError(f"Test database URL could not be parsed: {exc}") from exc
    if backend != "sqlite":
        raise UnsafeTestDatabaseError(
            f"Test runs only accept a SQLite test database, got '{backend}'. A server database cannot be "
            "verified as a throwaway database, so it is refused."
        )
    target = _sqlite_target(url, cwd or Path.cwd())
    if target is None:
        return  # in-memory
    if target == DEFAULT_DB_PATH or target.name.startswith(DEFAULT_DB_PATH.name):
        raise UnsafeTestDatabaseError(f"Test run refused: {target} is the protected development database.")
    if BACKEND_DIR in target.parents:
        raise UnsafeTestDatabaseError(
            f"Test run refused: {target} is inside the backend directory, next to the development database. "
            "Use a temporary directory for test databases."
        )


def guard_database_url(url: Optional[str], *, explicit: bool) -> None:
    """Check the application's database URL before the engine is created (no-op outside test mode)."""
    if is_test_mode():
        assert_safe_test_database(url, explicit=explicit)


def prepare_isolated_diagnostic_db(db_path: Optional[Path] = None) -> Tuple[str, Path]:
    """Configure SHOPPULSE_TEST_MODE and DATABASE_URL to an isolated temporary SQLite file.

    Refuses to run if ``core.config``, ``db.session``, or ``main`` has already been imported so
    a diagnostic script can never silently switch or bind late after the production DB was loaded.
    """
    already_loaded = [m for m in ("core.config", "db.session", "main") if m in sys.modules]
    if already_loaded:
        raise RuntimeError(
            f"Cannot configure isolated diagnostic database after importing {', '.join(already_loaded)}. "
            "Call prepare_isolated_diagnostic_db() before importing application modules."
        )

    if db_path is None:
        tmp_dir = Path(tempfile.mkdtemp(prefix="shoppulse-diag-"))
        target_path = (tmp_dir / "diag.db").resolve()
    else:
        target_path = Path(db_path).resolve()

    url = f"sqlite:///{target_path.as_posix()}"
    assert_safe_test_database(url, explicit=True)
    os.environ[TEST_MODE_ENV] = "1"
    os.environ["DATABASE_URL"] = url
    print(f"[db_safety] Isolated diagnostic target: {url}")
    return url, target_path
