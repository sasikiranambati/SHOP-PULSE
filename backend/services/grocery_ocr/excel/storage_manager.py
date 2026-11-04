"""
Secure storage and file retrieval service for generated Excel invoice workbooks.
Guarantees collision-free filenames, prevents path traversal, and manages temporary files safely.
"""

import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import ExcelGenerationError
from services.grocery_ocr.logger import get_logger

logger = get_logger("excel.storage_manager")


class WorkbookStorageManager:
    """
    Manages local filesystem persistence for generated XLSX invoice workbooks.
    Adheres to ShopPulse security guidelines: prevents path traversal and cleans up temp files.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None, base_dir: Optional[str] = None):
        self.config = config or default_config
        # Store in project uploads/invoices or system temp
        if base_dir:
            self.base_dir = Path(base_dir).resolve()
        else:
            # Check uploads/invoices relative to current working dir or project root
            if Path("uploads/invoices").parent.exists():
                self.base_dir = Path("uploads/invoices").resolve()
            elif Path("backend/uploads/invoices").parent.exists():
                self.base_dir = Path("backend/uploads/invoices").resolve()
            else:
                self.base_dir = (Path(tempfile.gettempdir()) / "shoppulse_invoices").resolve()

        self.base_dir.mkdir(parents=True, exist_ok=True)
        logger.debug("WorkbookStorageManager initialized with storage directory: %s", self.base_dir)

    def _sanitize_filename(self, name: str) -> str:
        """Strips path traversal elements and unsafe characters from filenames."""
        clean = re.sub(r"[^\w.\-]", "_", os.path.basename(name))
        return clean or "invoice"

    def generate_filename(self, invoice_id: str, original_filename: Optional[str] = None) -> str:
        """
        Generates a unique, deterministic, collision-free filename.
        Example: invoice_audit_inv_abc123_8f9a2e.xlsx
        """
        safe_inv_id = re.sub(r"[^\w\-]", "_", invoice_id)
        unique_token = uuid.uuid4().hex[:8]
        return f"invoice_audit_{safe_inv_id}_{unique_token}.xlsx"

    def save_workbook(
        self,
        workbook_bytes: bytes,
        invoice_id: str,
        original_filename: Optional[str] = None
    ) -> str:
        """
        Saves raw XLSX bytes securely to disk and returns the absolute file path.

        Args:
            workbook_bytes: Genuine XLSX file bytes.
            invoice_id: Identifier for invoice.
            original_filename: Original user uploaded document name for tagging.

        Returns:
            Absolute filesystem path to saved file.

        Raises:
            ExcelGenerationError: If saving fails or path is invalid.
        """
        if not workbook_bytes:
            raise ExcelGenerationError("Cannot save empty workbook bytes", details={"invoice_id": invoice_id})

        try:
            filename = self.generate_filename(invoice_id, original_filename)
            resolved_base = self.base_dir.resolve()
            target_path = (resolved_base / filename).resolve()

            # Path traversal safety check
            try:
                target_path.relative_to(resolved_base)
            except ValueError:
                raise ExcelGenerationError(f"Security violation: path traversal detected for {filename}")

            with open(target_path, "wb") as f:
                f.write(workbook_bytes)

            logger.info("Saved genuine XLSX workbook to %s (%d bytes)", target_path, len(workbook_bytes))
            return str(target_path)
        except Exception as exc:
            logger.error("Failed to save workbook for %s: %s", invoice_id, exc)
            raise ExcelGenerationError(f"Failed to persist workbook to disk: {exc}", details={"invoice_id": invoice_id})

    def get_workbook_bytes(self, file_path: str) -> bytes:
        """
        Safely reads workbook bytes from an approved path.
        """
        path = Path(file_path).resolve()
        if not path.exists():
            raise ExcelGenerationError(f"Workbook file does not exist: {file_path}")
        if not path.is_file():
            raise ExcelGenerationError(f"Target path is not a file: {file_path}")

        try:
            with open(path, "rb") as f:
                return f.read()
        except Exception as exc:
            logger.error("Failed to read workbook %s: %s", file_path, exc)
            raise ExcelGenerationError(f"Cannot read workbook: {exc}", details={"path": file_path})

    def delete_workbook(self, file_path: str) -> bool:
        """Safely removes a temporary workbook file."""
        try:
            path = Path(file_path).resolve()
            if path.exists() and path.is_file() and str(path).startswith(str(self.base_dir)):
                path.unlink()
                logger.debug("Deleted workbook: %s", file_path)
                return True
            return False
        except Exception as exc:
            logger.warning("Failed to delete workbook %s: %s", file_path, exc)
            return False

    def cleanup_old_files(self, max_age_seconds: int = 86400) -> int:
        """Removes temporary workbooks older than specified age (default 24h)."""
        now = time.time()
        removed_count = 0
        try:
            for item in self.base_dir.glob("invoice_audit_*.xlsx"):
                if item.is_file():
                    age = now - item.stat().st_mtime
                    if age > max_age_seconds:
                        try:
                            item.unlink()
                            removed_count += 1
                        except Exception:
                            pass
        except Exception as exc:
            logger.warning("Cleanup error in %s: %s", self.base_dir, exc)
        return removed_count

