"""
File validation interface and base implementation.
Enforces file size constraints, magic byte signature checks, and extension verification.
"""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.exceptions import FileValidationError, InvalidInvoiceError, UnsupportedFileError
from services.grocery_ocr.logger import get_logger

logger = get_logger("processors.file_validator")

# Standard magic byte signatures for invoice documents
MAGIC_SIGNATURES = {
    b"%PDF": ("pdf", "application/pdf"),
    b"\x89PNG\r\n\x1a\n": ("image", "image/png"),
    b"\xff\xd8\xff": ("image", "image/jpeg"),
    b"BM": ("image", "image/bmp"),
    b"II*\x00": ("image", "image/tiff"),
    b"MM\x00*": ("image", "image/tiff"),
}


class FileValidationResult(BaseModel):
    """Result of file validation containing verified document type and metadata."""
    is_valid: bool = Field(..., description="True if document passed all validation checks")
    document_type: str = Field(..., description="Normalized document type: 'pdf', 'image', or 'text'")
    mime_type: str = Field(..., description="Verified MIME type")
    file_size_bytes: int = Field(..., ge=0, description="Exact size of the document in bytes")
    detected_extension: str = Field(..., description="File extension with leading dot")
    error_message: Optional[str] = Field(None, description="Detailed explanation if validation failed")


class IFileValidator(ABC):
    """Abstract interface for invoice file validation."""

    @abstractmethod
    def validate(self, content: bytes, filename: str) -> FileValidationResult:
        """
        Validates invoice document bytes and filename against size, format, and signature rules.

        Args:
            content: Raw file bytes.
            filename: Original file name.

        Returns:
            FileValidationResult with metadata.

        Raises:
            InvalidInvoiceError: When the file is empty or corrupt.
            UnsupportedFileError: When the format is unsupported.
            FileValidationError: When the file fails size or security limits.
        """
        pass


class BaseFileValidator(IFileValidator):
    """Production implementation of file validation."""

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config

    def validate(self, content: bytes, filename: str) -> FileValidationResult:
        logger.debug("Validating file '%s' (bytes=%d)", filename, len(content) if content else 0)

        # 1. Empty content check
        if not content or len(content.strip()) == 0:
            logger.warning("Validation rejected: empty file '%s'", filename)
            raise InvalidInvoiceError("Uploaded file is empty. Please upload a valid invoice document.")

        # 2. Maximum size check
        size = len(content)
        if size > self.config.max_file_size_bytes:
            msg = f"File size ({size} bytes) exceeds limit ({self.config.max_file_size_bytes} bytes)."
            logger.warning("Validation rejected: %s", msg)
            raise FileValidationError(msg, details={"file_size": size, "max_size": self.config.max_file_size_bytes})

        # 3. Extension check
        ext = Path(filename or "").suffix.lower().strip()
        if not ext:
            ext = ".pdf" if content.startswith(b"%PDF") else ".png"

        if ext not in self.config.supported_extensions:
            msg = f"Unsupported file extension '{ext}'. Permitted: {sorted(self.config.supported_extensions)}"
            logger.warning("Validation rejected: %s", msg)
            raise UnsupportedFileError(msg, details={"extension": ext})

        # 4. Signature & MIME type detection
        doc_type, mime_type = self._detect_signature(content, ext)

        # 5. Integrity check to catch corrupted documents early
        self._verify_file_integrity(content, doc_type, filename)

        return FileValidationResult(
            is_valid=True,
            document_type=doc_type,
            mime_type=mime_type,
            file_size_bytes=size,
            detected_extension=ext,
            error_message=None,
        )

    def _verify_file_integrity(self, content: bytes, doc_type: str, filename: str) -> None:
        """Verifies that the document can be loaded and is not truncated or corrupted."""
        import io
        if doc_type == "image":
            try:
                from PIL import Image
                with Image.open(io.BytesIO(content)) as img:
                    img.verify()
                # Also verify image decode passes
                with Image.open(io.BytesIO(content)) as img:
                    img.load()
            except Exception as exc:
                msg = f"Corrupted or unreadable image file: {exc}"
                logger.warning("Validation rejected: %s", msg)
                raise InvalidInvoiceError(msg, details={"filename": filename, "error": str(exc)})

        elif doc_type == "pdf":
            if not content.startswith(b"%PDF"):
                raise InvalidInvoiceError("Corrupted or invalid PDF header.", details={"filename": filename})
            if len(content) < 30:
                raise InvalidInvoiceError("PDF document is truncated or empty.", details={"filename": filename})

    def _detect_signature(self, content: bytes, ext: str) -> tuple[str, str]:
        # Check standard magic byte signatures
        for sig, (dtype, mime) in MAGIC_SIGNATURES.items():
            if content.startswith(sig):
                return dtype, mime

        # WebP check (RIFF....WEBP)
        if content.startswith(b"RIFF") and b"WEBP" in content[:16]:
            return "image", "image/webp"

        # Text files (.txt, .csv)
        if ext in (".txt", ".csv"):
            return "text", "text/plain"

        # Fallback to extension if valid image format
        if ext in (".jpg", ".jpeg"):
            return "image", "image/jpeg"
        if ext == ".png":
            return "image", "image/png"
        if ext == ".pdf":
            return "pdf", "application/pdf"

        msg = f"Document content does not match any known image, PDF, or text signature."
        logger.warning("Validation rejected: %s", msg)
        raise UnsupportedFileError(msg, details={"extension": ext})
