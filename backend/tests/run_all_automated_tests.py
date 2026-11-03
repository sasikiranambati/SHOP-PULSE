#!/usr/bin/env python3
"""
ShopPulse QA Automated Test Suite Runner

Executes the complete test automation suite covering all 20 Phase 1 & 2 workflows:
- Workflows 1-18: test_automated_workflows.py
- Workflow 19: test_phase1_database_foundation.py (Phase 1 Database Foundation)
- Workflow 20: test_phase2_backend_apis.py (Phase 2 Backend APIs & Data Quality)

Usage:
    python backend/tests/run_all_automated_tests.py
"""

import sys
import time
import unittest
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from tests.test_automated_workflows import TestAutomatedWorkflows
from tests.test_phase1_database_foundation import TestPhase1DatabaseFoundation
from tests.test_phase2_backend_apis import TestPhase2BackendApis
from tests.test_phase3_forecasting import TestPhase3Forecasting



class QualityAuditTestResult(unittest.TextTestResult):
    def __init__(self, stream, descriptions, verbosity):
        super().__init__(stream, descriptions, verbosity)
        self.test_records = []

    def startTest(self, test):
        super().startTest(test)
        self._test_start_time = time.time()

    def addSuccess(self, test):
        super().addSuccess(test)
        elapsed = time.time() - self._test_start_time
        self.test_records.append({
            "name": test._testMethodName,
            "class": test.__class__.__name__,
            "status": "PASSED",
            "time": elapsed,
            "details": None,
        })

    def addFailure(self, test, err):
        super().addFailure(test, err)
        elapsed = time.time() - self._test_start_time
        self.test_records.append({
            "name": test._testMethodName,
            "class": test.__class__.__name__,
            "status": "FAILED",
            "time": elapsed,
            "details": self._exc_info_to_string(err, test),
        })

    def addError(self, test, err):
        super().addError(test, err)
        elapsed = time.time() - self._test_start_time
        self.test_records.append({
            "name": test._testMethodName,
            "class": test.__class__.__name__,
            "status": "ERROR",
            "time": elapsed,
            "details": self._exc_info_to_string(err, test),
        })

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.test_records.append({
            "name": test._testMethodName,
            "class": test.__class__.__name__,
            "status": "SKIPPED",
            "time": 0.0,
            "details": reason,
        })


def build_suite() -> unittest.TestSuite:
    suite = unittest.TestSuite()
    loader = unittest.TestLoader()

    # Workflows 1 - 18
    suite.addTests(loader.loadTestsFromTestCase(TestAutomatedWorkflows))
    # Workflow 19: Phase 1 Database Foundation
    suite.addTests(loader.loadTestsFromTestCase(TestPhase1DatabaseFoundation))
    # Workflow 20: Phase 2 Backend APIs & Data Quality
    suite.addTests(loader.loadTestsFromTestCase(TestPhase2BackendApis))
    # Phase 3: Statistical AI Forecasting Engine
    suite.addTests(loader.loadTestsFromTestCase(TestPhase3Forecasting))

    return suite


def main():
    print("=" * 80)
    print(" SHOPPULSE QA AUTOMATION — FULL BACKEND WORKFLOW TEST SUITE")
    print("=" * 80)
    print("Environment: Isolated In-Memory SQLite Database")
    print("Testing Strategy: FastAPI TestClient E2E + Direct DB Assertions")
    print("-" * 80)

    suite = build_suite()
    total_tests = suite.countTestCases()
    print(f"Discovered {total_tests} test cases across 4 test modules.\n")

    start_time = time.time()
    runner = unittest.TextTestRunner(
        resultclass=QualityAuditTestResult,
        verbosity=1,
    )
    result = runner.run(suite)
    duration = time.time() - start_time

    passed_count = len([t for t in result.test_records if t["status"] == "PASSED"])
    failed_count = len(result.failures)
    error_count = len(result.errors)
    skipped_count = len(result.skipped)

    print("\n" + "=" * 80)
    print(" EXECUTION SUMMARY")
    print("=" * 80)
    print(f"Total Tests Run   : {total_tests}")
    print(f"Passed            : {passed_count}")
    print(f"Failed            : {failed_count}")
    print(f"Errors            : {error_count}")
    print(f"Skipped           : {skipped_count}")
    print(f"Total Time Taken  : {duration:.2f} seconds")
    print("-" * 80)

    if failed_count == 0 and error_count == 0:
        print("RESULT: ALL TESTS PASSED SUCCESSFULLY! (100% Pass Rate)")
    else:
        print(f"RESULT: FAILED ({failed_count} failures, {error_count} errors)")
        print("\nFAILURE DETAILS:")
        for idx, fail in enumerate(result.failures + result.errors, 1):
            test_obj, err_text = fail
            print(f"\n[{idx}] {test_obj}:")
            print(err_text)

    print("=" * 80)
    return 0 if (failed_count == 0 and error_count == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
