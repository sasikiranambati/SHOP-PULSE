"""
Custom exception hierarchy for the ShopPulse Grocery OCR Engine.
Errors are structured, traceable, and designed to avoid exposing sensitive internal details to clients.
"""

from typing import Any, Dict, Optional


class GroceryOCRError(Exception):
    """Base exception for all Grocery OCR engine operations."""

    def __init__(
        self,
        message: str,
        code: str = "GROCERY_OCR_ERROR",
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}

    def to_dict(self) -> Dict[str, Any]:
        """Returns a sanitized dictionary representation suitable for logging or safe responses."""
        return {
            "error_code": self.code,
            "message": self.message,
            "details": self.details,
        }


class UnsupportedFileError(GroceryOCRError):
    """Raised when an uploaded invoice has an unsupported format or MIME type."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="UNSUPPORTED_FILE_FORMAT", details=details)


class InvalidInvoiceError(GroceryOCRError):
    """Raised when an invoice document is empty, corrupted, or unreadable."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="INVALID_INVOICE_DOCUMENT", details=details)


class FileValidationError(GroceryOCRError):
    """Raised when an invoice file fails size, extension, or signature validation."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="FILE_VALIDATION_ERROR", details=details)


class PDFProcessingError(GroceryOCRError):
    """Raised when PDF extraction or page rasterization fails."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="PDF_PROCESSING_ERROR", details=details)


class ImageProcessingError(GroceryOCRError):
    """Raised when image decoding, deskewing, or normalization fails."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="IMAGE_PROCESSING_ERROR", details=details)


class OCRProcessingError(GroceryOCRError):
    """Raised when the OCR engine fails to execute, crashes, or times out."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="OCR_PROCESSING_ERROR", details=details)


class TableReconstructionError(GroceryOCRError):
    """Raised when word bounding boxes cannot be reconstructed into a table grid."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="TABLE_RECONSTRUCTION_ERROR", details=details)


class ColumnDetectionError(GroceryOCRError):
    """Raised when column headers or spatial column boundaries cannot be detected."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="COLUMN_DETECTION_ERROR", details=details)


class ExtractionError(GroceryOCRError):
    """Raised when extraction of product names, quantities, or prices fails."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="EXTRACTION_ERROR", details=details)


class ClassificationError(GroceryOCRError):
    """Raised when grocery taxonomy classification fails."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="CLASSIFICATION_ERROR", details=details)


class ProductMatchingError(GroceryOCRError):
    """Raised when inventory product matching encounters an error."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="PRODUCT_MATCHING_ERROR", details=details)


class ExcelGenerationError(GroceryOCRError):
    """Raised when generating an audit Excel workbook fails."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="EXCEL_GENERATION_ERROR", details=details)


class ExcelParsingError(GroceryOCRError):
    """Raised when parsing or verifying an Excel workbook fails."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="EXCEL_PARSING_ERROR", details=details)


class InvoiceValidationError(GroceryOCRError):
    """Raised when line-item arithmetic or invoice-level validation fails."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="INVOICE_VALIDATION_ERROR", details=details)


class PipelineOrchestrationError(GroceryOCRError):
    """Raised when the pipeline orchestrator encounters a critical stage failure."""

    def __init__(self, message: str, stage: str, details: Optional[Dict[str, Any]] = None):
        full_details = details or {}
        full_details["failed_stage"] = stage
        super().__init__(message, code="PIPELINE_ORCHESTRATION_ERROR", details=full_details)
        self.stage = stage


class AIAssistanceError(GroceryOCRError):
    """Base exception for AI-assisted extraction and validation failures."""

    def __init__(self, message: str, code: str = "AI_ASSISTANCE_ERROR", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code=code, details=details)


class AITimeoutError(AIAssistanceError):
    """Raised when an AI provider call exceeds configured timeout."""

    def __init__(self, message: str = "AI request timed out", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="AI_TIMEOUT_ERROR", details=details)


class AIRateLimitError(AIAssistanceError):
    """Raised when an AI provider responds with HTTP 429 Too Many Requests."""

    def __init__(self, message: str = "AI rate limit exceeded", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="AI_RATE_LIMIT_ERROR", details=details)


class AIProviderUnavailableError(AIAssistanceError):
    """Raised when the AI provider is unreachable or returns 5xx error."""

    def __init__(self, message: str = "AI provider unavailable", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="AI_PROVIDER_UNAVAILABLE", details=details)


class AIResponseValidationError(AIAssistanceError):
    """Raised when an AI response fails schema or type validation."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="AI_RESPONSE_VALIDATION_ERROR", details=details)


class AIHallucinationSecurityViolation(AIAssistanceError):
    """Raised when AI attempts to hallucinate unverified financial fields or brands."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, code="AI_HALLUCINATION_SECURITY_VIOLATION", details=details)

