"""
Test-database isolation for the backend test suite (Phase 4, workstream 9a).

pytest loads this file before any test module, i.e. before ``main`` / ``db.session`` are imported.
It switches the process into test mode and points ``DATABASE_URL`` at a throwaway SQLite file in a
temporary directory, so every test that uses the application's own engine works on that file - never on
``backend/shoppulse.db``. Importing ``main`` no longer creates any schema (Stage 5.1): the test database
is initialized explicitly below, once, before the first test.

``core.db_safety`` re-checks the URL when the engine is created and stops the run if it is not a
dedicated test database. Set ``SHOPPULSE_TEST_DATABASE_URL`` to use a specific test database instead
of the temporary one (it is checked by the same guard).
"""

import os
import shutil
import tempfile

_TMP_DIR = tempfile.mkdtemp(prefix="shoppulse-pytest-")
_TEST_DB_URL = os.environ.get("SHOPPULSE_TEST_DATABASE_URL") or f"sqlite:///{_TMP_DIR}/test.db"

os.environ["SHOPPULSE_TEST_MODE"] = "1"
# Any DATABASE_URL inherited from the shell or .env is replaced: tests never use it
os.environ["DATABASE_URL"] = _TEST_DB_URL

import pytest  # noqa: E402


def pytest_report_header(config):
    return f"test database: {_TEST_DB_URL} (SHOPPULSE_TEST_MODE=1)"


@pytest.fixture(scope="session", autouse=True)
def _assert_isolated_database():
    """The application's engine must point at the test database for the whole run."""
    from core.db_safety import DEFAULT_DB_PATH
    from db.session import engine

    import urllib.parse
    actual_url = urllib.parse.unquote(str(engine.url)).replace("\\", "/")
    expected_url = urllib.parse.unquote(_TEST_DB_URL).replace("\\", "/")
    assert actual_url.lower() == expected_url.lower(), f"application engine is {engine.url}, expected {_TEST_DB_URL}"
    assert str(DEFAULT_DB_PATH) not in str(engine.url)
    # Explicit schema initialization of the isolated test database (never done on import any more)
    from db.init_schema import init_db_schema
    init_db_schema(engine)
    yield


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP_DIR, ignore_errors=True)
