"""
Robust numeric and currency parsing service for grocery invoices.
Handles Indian number formatting, currency symbols, comma separators, and conservative OCR error recovery.
Uses Python Decimal exclusively; never floats. Preserves verbatim raw strings.
"""

import re
from decimal import Decimal, InvalidOperation
from typing import List, Optional, Tuple
from pydantic import BaseModel, Field

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.logger import get_logger

logger = get_logger("extraction.numeric_parser")


class ParsedNumericResult(BaseModel):
    """Result of parsing a numeric token from an OCR cell."""
    value: Optional[Decimal] = Field(None, description="Parsed Decimal magnitude, or None if empty/unreadable")
    raw_text: Optional[str] = Field(None, description="Original verbatim text as extracted from cell")
    is_valid: bool = Field(default=True, description="True if text parsed cleanly without fatal syntax errors")
    confidence: float = Field(default=100.0, ge=0.0, le=100.0, description="Confidence in numeric parsing")
    is_negative: bool = Field(default=False, description="True if value represents a negative deduction")
    is_percentage: bool = Field(default=False, description="True if value carries a percent symbol")
    issues: List[str] = Field(default_factory=list, description="Audit issues or OCR repairs applied")


class NumericParser:
    """
    Financial and quantity numeric parsing engine.
    Safely converts strings into Decimal representations without floating-point inaccuracies.
    """

    def __init__(self, config: Optional[GroceryOCRConfig] = None):
        self.config = config or default_config

    def parse_currency(
        self,
        text: Optional[str],
        quantize_exp: Optional[Decimal] = None
    ) -> ParsedNumericResult:
        """
        Parses monetary price or total string into Decimal (e.g. '₹1,378.62', '2760.00', '700/-').
        """
        exp = quantize_exp or self.config.currency_quantize_exp
        return self._parse_number(text, exp, is_quantity=False)

    def parse_quantity(
        self,
        text: Optional[str],
        quantize_exp: Optional[Decimal] = None
    ) -> ParsedNumericResult:
        """
        Parses quantity string into Decimal (e.g. '1', '10', '0.500', '1.25').
        """
        exp = quantize_exp or self.config.quantity_quantize_exp
        return self._parse_number(text, exp, is_quantity=True)

    def _parse_number(
        self,
        text: Optional[str],
        quantize_exp: Decimal,
        is_quantity: bool = False
    ) -> ParsedNumericResult:
        if not text:
            return ParsedNumericResult(value=None, raw_text=None, is_valid=True, confidence=0.0)

        raw = text.strip()
        # Missing or placeholder symbols
        if raw in ("-", "--", "---", ".", "..", "|", "/", "\\", "NA", "N/A", "nil", "NIL", "null", "NULL", "None"):
            return ParsedNumericResult(value=None, raw_text=raw, is_valid=True, confidence=100.0)

        cleaned = raw
        issues: List[str] = []
        confidence = 100.0

        # Check for accounting parenthesis negative: (700.00)
        is_negative = False
        if cleaned.startswith("(") and cleaned.endswith(")"):
            is_negative = True
            cleaned = cleaned[1:-1].strip()
        elif cleaned.startswith("-"):
            is_negative = True
            cleaned = cleaned[1:].strip()

        # Check for percentage
        is_percentage = False
        if "%" in cleaned:
            is_percentage = True
            cleaned = cleaned.replace("%", "").strip()

        # Strip standard currency symbols and Indian formatting artifacts
        cleaned = re.sub(r"(?i)₹|\brs\b\.?|\binr\b|\$|€|£|/-", "", cleaned).strip()

        # Check for Indian comma formatting (e.g. '1,378.62' or '1,00,000.00')
        cleaned = cleaned.replace(",", "").strip()

        # Strip leading and trailing noise delimiters: e.g. '100 =', '10 |', '| 200'
        cleaned = re.sub(r"^[\s\|\:\/\=\~\;\-]+", "", cleaned).strip()
        cleaned = re.sub(r"[\s\|\:\/\=\~\;\-]+$", "", cleaned).strip()

        # Conservative OCR ambiguity repair:

        # 2. Letter 'O' or 'o' between digits or at start/end of digits: '276O.00' -> '2760.00'
        if re.search(r"\d[Oo]|[Oo]\d", cleaned):
            repaired = re.sub(r"(?<=\d)[Oo](?=\d|\.|$)", "0", cleaned)
            repaired = re.sub(r"(^|\s)[Oo](?=\d)", r"\g<1>0", repaired)
            if repaired != cleaned:
                issues.append(f"Repaired OCR letter O to digit 0 in '{cleaned}'")
                cleaned = repaired
                confidence = min(confidence, 85.0)

        # 3. Letter 'I' or 'l' at start of digits or between digits: 'I378.62' -> '1378.62'
        if re.search(r"(?:^|\s)[Il](?=\d)|(?<=\d)[Il](?=\d)", cleaned):
            repaired = re.sub(r"(^|\s)[Il](?=\d)", r"\g<1>1", cleaned)
            repaired = re.sub(r"(?<=\d)[Il](?=\d)", "1", repaired)
            if repaired != cleaned:
                issues.append(f"Repaired OCR letter I/l to digit 1 in '{cleaned}'")
                cleaned = repaired
                confidence = min(confidence, 85.0)

        # Remove stray trailing dots: '700..' -> '700'
        cleaned = re.sub(r"\.+$", "", cleaned)

        # Multiple decimal dots check (e.g. '12.50.00' or '1..5')
        if cleaned.count(".") > 1:
            # If multiple dots, e.g. 1.234.56, check if first dot is thousands separator
            parts = cleaned.split(".")
            if len(parts) == 3 and len(parts[1]) == 3 and len(parts[2]) == 2:
                # European/Indo style 1.234.56 -> 1234.56
                cleaned = f"{parts[0]}{parts[1]}.{parts[2]}"
                issues.append("Normalized multiple decimal dots")
                confidence = min(confidence, 80.0)
            else:
                issues.append(f"Unparseable multiple decimal points in '{raw}'")
                return ParsedNumericResult(
                    value=None,
                    raw_text=raw,
                    is_valid=False,
                    confidence=20.0,
                    issues=issues,
                )

        try:
            val = Decimal(cleaned)
            if is_negative:
                val = -val

            if quantize_exp:
                val = val.quantize(quantize_exp)

            return ParsedNumericResult(
                value=val,
                raw_text=raw,
                is_valid=True,
                confidence=confidence,
                is_negative=is_negative,
                is_percentage=is_percentage,
                issues=issues,
            )
        except (InvalidOperation, ValueError):
            logger.debug("Failed to parse numeric string '%s' (cleaned: '%s')", raw, cleaned)
            return ParsedNumericResult(
                value=None,
                raw_text=raw,
                is_valid=False,
                confidence=0.0,
                issues=[f"Cannot parse '{raw}' as numeric value"],
            )
