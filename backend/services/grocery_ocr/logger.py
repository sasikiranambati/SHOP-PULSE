"""
Structured logging for the ShopPulse Grocery OCR Engine.
Provides traceable logs with pipeline stage contexts and execution timings.
"""

import logging
import time
from contextlib import contextmanager
from typing import Any, Dict, Generator, Optional

LOGGER_NAME = "grocery_ocr"
logger = logging.getLogger(LOGGER_NAME)


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """Returns the grocery OCR logger or a child logger."""
    if name:
        return logging.getLogger(f"{LOGGER_NAME}.{name}")
    return logger


@contextmanager
def stage_timer(stage_name: str, metadata: Optional[Dict[str, Any]] = None) -> Generator[Dict[str, Any], None, None]:
    """
    Context manager to log and record the execution time of a pipeline stage.
    """
    log = get_logger("pipeline")
    start_time = time.perf_counter()
    info: Dict[str, Any] = {"stage": stage_name, "start_time": start_time}
    log.info("[STAGE START] %s | metadata: %s", stage_name, metadata or {})
    try:
        yield info
    except Exception as exc:
        duration_ms = (time.perf_counter() - start_time) * 1000
        info["duration_ms"] = duration_ms
        info["error"] = str(exc)
        log.error("[STAGE FAILED] %s after %.2f ms | error: %s", stage_name, duration_ms, exc)
        raise
    else:
        duration_ms = (time.perf_counter() - start_time) * 1000
        info["duration_ms"] = duration_ms
        log.info("[STAGE COMPLETE] %s in %.2f ms", stage_name, duration_ms)
