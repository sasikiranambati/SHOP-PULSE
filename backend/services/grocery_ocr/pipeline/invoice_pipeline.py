"""
Pipeline orchestrator for the ShopPulse Grocery OCR Engine.
Coordinates validation, image processing, OCR recognition, table reconstruction,
semantic extraction, classification, validation, and audit workbook generation.
Supports full dependency injection for all 13 services.
Never writes to the database during extraction.
Preserves complete OCR evidence, word coordinates, and Decimal precision.
"""

from concurrent.futures import ThreadPoolExecutor
import re
import time
import uuid
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence

from services.grocery_ocr.config import GroceryOCRConfig, default_config
from services.grocery_ocr.excel.integrity_validator import ExcelIntegrityValidator
from services.grocery_ocr.excel.storage_manager import WorkbookStorageManager
from services.grocery_ocr.excel.workbook_generator import BaseWorkbookGenerator, IWorkbookGenerator
from services.grocery_ocr.excel.workbook_parser import BaseWorkbookParser, IWorkbookParser
from services.grocery_ocr.exceptions import (
    FileValidationError,
    GroceryOCRError,
    InvalidInvoiceError,
    PipelineOrchestrationError,
    UnsupportedFileError,
)
from services.grocery_ocr.extraction.column_detector import BaseColumnDetector, IColumnDetector
from services.grocery_ocr.extraction.column_wise_extractor import ColumnWiseExtractor
from services.grocery_ocr.extraction.price_extractor import BasePriceExtractor, IPriceExtractor
from services.grocery_ocr.extraction.product_extractor import BaseProductExtractor, IProductExtractor
from services.grocery_ocr.extraction.quantity_extractor import BaseQuantityExtractor, IQuantityExtractor
from services.grocery_ocr.extraction.table_reconstructor import BaseTableReconstructor, ITableReconstructor
from services.grocery_ocr.engines.ocr_engine import IOCREngine, MockOCREngine
from services.grocery_ocr.intelligence.grocery_classifier import BaseGroceryClassifier, IGroceryClassifier
from services.grocery_ocr.intelligence.product_matcher import BaseProductMatcher, IProductMatcher
from services.grocery_ocr.logger import get_logger, stage_timer
from services.grocery_ocr.processors.file_validator import BaseFileValidator, IFileValidator
from services.grocery_ocr.processors.image_processor import BaseImageProcessor, IImageProcessor
from services.grocery_ocr.processors.pdf_processor import BasePDFProcessor, IPDFProcessor
from services.grocery_ocr.processors.text_line_reconstructor import build_ocr_document_from_raw_text
from services.grocery_ocr.quality.ocr_quality_assessor import OCRQualityAssessor
from services.grocery_ocr.ai.service import AIInterpretationService
from services.grocery_ocr.schemas.invoice import ExtractedInvoice, InvoiceProcessingMetadata
from services.grocery_ocr.schemas.invoice_item import ExtractedInvoiceItem
from services.grocery_ocr.schemas.ocr import (
    BoundingBox,
    OCRDocumentResult,
    OCRLine,
    OCRPageResult,
    OCRWord,
)
from services.grocery_ocr.schemas.table import TableResult
from services.grocery_ocr.validation.cross_validator import UnifiedValidationService
from services.grocery_ocr.validation.invoice_validator import BaseInvoiceValidator, IInvoiceValidator

logger = get_logger("pipeline.orchestrator")


_MONEY_TOKEN_RE = re.compile(r"^[₹(]?\d[\d,]*\.\d{2,3}[)|\]]?$")
_INT_PART_FRAGMENT_RE = re.compile(r"^\d[\d,]*\.$")       # '130.'
_FRACTION_FRAGMENT_RE = re.compile(r"^\.\d{2,3}[|\]]?$")  # '.00'


_NUMBER_TOKEN_RE = re.compile(r"^\d+(?:[.,]\d+)?$")


def money_token_stats(page: Any) -> Dict[str, int]:
    """Count well-formed money values and decimal fragments in an OCR page reading."""
    words = [w.text.strip() for w in getattr(page, "words", []) or [] if getattr(w, "text", "").strip()]
    return {
        "money_values": sum(1 for t in words if _MONEY_TOKEN_RE.match(t)),
        # every plain number (quantities, codes, amounts): single digits are what a layout loses first
        "numeric_values": sum(1 for t in words if _NUMBER_TOKEN_RE.match(t)),
        "split_integer_parts": sum(1 for t in words if _INT_PART_FRAGMENT_RE.match(t)),
        "split_fractions": sum(1 for t in words if _FRACTION_FRAGMENT_RE.match(t)),
    }


def decimal_values_look_split(stats: Dict[str, int]) -> bool:
    """Evidence that the layout analysis cut numbers at the decimal point."""
    # Three or more numbers broken at the decimal point is demonstrable loss; whether the second
    # reading is actually better is decided separately (it must hold clearly more money values).
    return stats["split_integer_parts"] + stats["split_fractions"] >= 3



def extraction_metadata(rec: Any) -> Dict[str, Any]:
    """Line-level extraction facts that the API needs (all JSON-safe)."""
    return {
        "financial_components": {k: str(v) for k, v in (getattr(rec, "components", {}) or {}).items()},
        "review_reasons": list(getattr(rec, "review_reasons", []) or []),
        "extraction_suggestions": list(getattr(rec, "suggestions", []) or []),
        "quantity_details": {k: (str(v) if isinstance(v, Decimal) else v)
                             for k, v in (getattr(rec, "quantity_details", {}) or {}).items()},
        "derived_fields": list(getattr(rec, "derived_fields", []) or []),
        "is_free_item": bool(getattr(rec, "is_free_item", False)),
    }


_CARRIED_FIELDS = ("taxable_amount", "discount_pct", "raw_cells", "barcode")


def carry_forward_unexported_fields(pre_items: Sequence[Any], post_items: Sequence[Any]) -> int:
    """Copy fields that the Excel round trip cannot hold from the pre-Excel items to the parsed
    items. Rows are matched by position and only when the product text matches, so a value can
    never move to a different product. Returns the number of rows updated."""
    if len(pre_items) != len(post_items):
        return 0
    updated = 0
    for pre, post in zip(pre_items, post_items):
        if (pre.raw_product_name or "").strip() != (post.raw_product_name or "").strip():
            continue
        for key, value in (pre.metadata or {}).items():
            post.metadata.setdefault(key, value)
        for field_name in _CARRIED_FIELDS:
            if getattr(post, field_name, None) in (None, {}, "") and getattr(pre, field_name, None) not in (None, {}, ""):
                setattr(post, field_name, getattr(pre, field_name))
        updated += 1
    return updated


class InvoicePipeline:
    """
    Central pipeline orchestrator for grocery invoice extraction.
    Assembles independent modular services via constructor dependency injection.
    """

    def __init__(
        self,
        file_validator: Optional[IFileValidator] = None,
        pdf_processor: Optional[IPDFProcessor] = None,
        image_processor: Optional[IImageProcessor] = None,
        ocr_engine: Optional[IOCREngine] = None,
        table_reconstructor: Optional[ITableReconstructor] = None,
        column_detector: Optional[IColumnDetector] = None,
        product_extractor: Optional[IProductExtractor] = None,
        quantity_extractor: Optional[IQuantityExtractor] = None,
        price_extractor: Optional[IPriceExtractor] = None,
        grocery_classifier: Optional[IGroceryClassifier] = None,
        product_matcher: Optional[IProductMatcher] = None,
        workbook_generator: Optional[IWorkbookGenerator] = None,
        workbook_parser: Optional[IWorkbookParser] = None,
        storage_manager: Optional[WorkbookStorageManager] = None,
        integrity_validator: Optional[ExcelIntegrityValidator] = None,
        invoice_validator: Optional[IInvoiceValidator] = None,
        ai_service: Optional[AIInterpretationService] = None,
        cross_validator: Optional[UnifiedValidationService] = None,
        column_wise_extractor: Optional[ColumnWiseExtractor] = None,
        config: Optional[GroceryOCRConfig] = None,
    ):
        self.config = config or default_config

        # Injected service dependencies with standard defaults
        self.file_validator = file_validator or BaseFileValidator(self.config)
        self.pdf_processor = pdf_processor or BasePDFProcessor(self.config)
        self.image_processor = image_processor or BaseImageProcessor(self.config)
        self.ocr_engine = ocr_engine or MockOCREngine()
        self.table_reconstructor = table_reconstructor or BaseTableReconstructor(self.config)
        self.column_detector = column_detector or BaseColumnDetector(self.config)
        self.product_extractor = product_extractor or BaseProductExtractor(self.config)
        self.quantity_extractor = quantity_extractor or BaseQuantityExtractor(self.config)
        self.price_extractor = price_extractor or BasePriceExtractor(self.config)
        self.grocery_classifier = grocery_classifier or BaseGroceryClassifier(self.config)
        self.product_matcher = product_matcher or BaseProductMatcher()
        self.workbook_generator = workbook_generator or BaseWorkbookGenerator(self.config)
        self.workbook_parser = workbook_parser or BaseWorkbookParser(self.config)
        self.storage_manager = storage_manager or WorkbookStorageManager(self.config)
        self.integrity_validator = integrity_validator or ExcelIntegrityValidator(self.config)
        self.invoice_validator = invoice_validator or BaseInvoiceValidator(self.config)
        self.ai_service = ai_service or AIInterpretationService(self.config)
        self.quality_assessor = OCRQualityAssessor()
        self.cross_validator = cross_validator or UnifiedValidationService(self.config)
        self.column_wise_extractor = column_wise_extractor or ColumnWiseExtractor(
            config=self.config,
            product_extractor=self.product_extractor,
            quantity_extractor=self.quantity_extractor,
            price_extractor=self.price_extractor,
            numeric_parser=getattr(self.price_extractor, "numeric_parser", None),
        )

    def _compare_fallback_segmentation(
        self,
        image_bytes: bytes,
        page_idx: int,
        default_page: OCRPageResult,
        metadata: InvoiceProcessingMetadata,
        alt_page: Optional[OCRPageResult] = None,
    ) -> OCRPageResult:
        """Choose between the automatic page layout (PSM 3) and a single-block reading (PSM 6).

        Measured on the repository's image invoices (tests/ocr_fixture_benchmark.py): the automatic
        layout can split ruled-table numbers at the decimal point ('130.' / '00'), lose a whole ruled
        table on a photographed page (TC03: 0 amounts read), or drop an entire column band on a clean
        page (TC30: Qty and Unit missing although recognised at 96% in isolation); the single-block
        reading never read fewer printed cells. Both readings are therefore taken (in parallel by the
        caller when possible) and the single-block one is kept only when it is clearly better:
          1. clearly more well-formed money values (+3 or +10%), or
          2. no fewer money values, at least 5% (+3) more words, and confidence within 5 points, or
          3. no fewer money values, at least 2 more plain numbers (e.g. single-digit quantities the
             automatic layout dropped, OR01), and confidence within 5 points.
        Otherwise the default reading is kept. The decision is recorded for audit."""
        default_psm = str(getattr(self.config, "default_ocr_psm", "3"))
        fallback_psm = str(getattr(self.config, "fallback_ocr_psm", "") or "")
        default_stats = money_token_stats(default_page)
        record: Dict[str, Any] = {"page": page_idx, "default_psm": default_psm, "default": default_stats,
                                  "chosen_psm": default_psm}
        metadata.custom_properties.setdefault("ocr_psm_selection", []).append(record)
        metadata.custom_properties.setdefault("ocr_psm_used", default_psm)
        if not fallback_psm or fallback_psm == default_psm:
            record["fallback_tried"] = False
            return default_page
        if alt_page is None:
            try:
                alt_page = self.ocr_engine.recognize(image_bytes, page_number=page_idx, options={"psm": fallback_psm})
            except Exception as exc:  # the default reading is still valid
                record.update(fallback_tried=True, fallback_error=str(exc))
                return default_page
        alt_stats = money_token_stats(alt_page)
        record.update(fallback_tried=True, fallback_psm=fallback_psm, fallback=alt_stats)
        d_vals, a_vals = default_stats["money_values"], alt_stats["money_values"]
        d_words, a_words = len(default_page.words or []), len(alt_page.words or [])
        d_conf, a_conf = float(default_page.confidence or 0.0), float(alt_page.confidence or 0.0)
        record.update(default_words=d_words, fallback_words=a_words,
                      default_confidence=d_conf, fallback_confidence=a_conf)
        reason = None
        if a_vals >= d_vals + max(3, 0.1 * d_vals):
            reason = ("split decimal values" if decimal_values_look_split(default_stats)
                      else "read clearly more amounts")
        elif a_vals >= d_vals and a_words >= d_words * 1.05 + 3 and a_conf >= d_conf - 5.0:
            reason = "read more of the table text"
        elif (a_vals >= d_vals and alt_stats.get("numeric_values", 0) >= default_stats.get("numeric_values", 0) + 2
              and a_conf >= d_conf - 5.0):
            reason = "read more numbers (e.g. quantities)"
        if reason is None:
            return default_page
        record["chosen_psm"] = fallback_psm
        record["reason"] = reason
        metadata.custom_properties["ocr_psm_used"] = fallback_psm
        metadata.warnings.append(
            f"Page {page_idx}: the table was read with a single-block layout because it {reason} "
            f"({d_vals} -> {a_vals} amounts, {d_words} -> {a_words} words)")
        return alt_page

    def _read_page_both_layouts(self, image_bytes: bytes, page_idx: int):
        """Default and single-block readings of one page, run in parallel (separate OCR processes)."""
        fallback_psm = str(getattr(self.config, "fallback_ocr_psm", "") or "")
        default_psm = str(getattr(self.config, "default_ocr_psm", "3"))
        if not fallback_psm or fallback_psm == default_psm:
            return self.ocr_engine.recognize(image_bytes, page_number=page_idx), None
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_default = pool.submit(self.ocr_engine.recognize, image_bytes, page_idx)
            f_alt = pool.submit(self.ocr_engine.recognize, image_bytes, page_idx, {"psm": fallback_psm})
            default_page = f_default.result()  # a default-reading failure propagates as before
            try:
                alt_page = f_alt.result()
            except Exception:  # the default reading is still valid
                alt_page = None
        return default_page, alt_page

    def process(
        self,
        content: bytes,
        filename: str,
        candidate_products: Optional[Sequence[Any]] = None,
    ) -> ExtractedInvoice:
        """
        Executes end-to-end invoice extraction pipeline.

        Pipeline stages:
            1. File Validation
            2. Document Decoupling (PDF vs Image)
            3. Image Preprocessing
            4. OCR Recognition & Coordinate Extraction
            5. Table Reconstruction
            6. Column Detection
            7. Product, Quantity, & Price Extraction
            8. Grocery Classification & Product Matching
            9. Arithmetic & Integrity Validation
            10. XLSX Audit Workbook Generation

        Args:
            content: Raw invoice file bytes.
            filename: Original document filename.
            candidate_products: Optional list of shop inventory products for matching.

        Returns:
            ExtractedInvoice model with complete items, Decimal totals, and OCR evidence.
        """
        invoice_id = f"inv_{uuid.uuid4().hex[:12]}"
        logger.info("Starting invoice pipeline for '%s' (id=%s, bytes=%d)", filename, invoice_id, len(content) if content else 0)

        metadata = InvoiceProcessingMetadata(
            filename=filename,
            file_size_bytes=len(content) if content else 0,
            engine_name=self.ocr_engine.engine_name,
        )

        try:
            # Stage 1: File Validation
            with stage_timer("file_validation", {"filename": filename}) as t:
                val_result = self.file_validator.validate(content, filename)
                metadata.mime_type = val_result.mime_type
                metadata.document_type = val_result.document_type
                metadata.pipeline_stages_completed.append("file_validation")
            metadata.stage_timings_ms["file_validation"] = t.get("duration_ms", 0.0)

            # Stage 2: Page Preparation (PDF Rasterization or Image Passthrough)
            page_images: List[bytes] = []
            digital_doc: Optional[OCRDocumentResult] = None
            with stage_timer("page_preparation", {"doc_type": val_result.document_type}) as t:
                if val_result.document_type == "pdf":
                    pdf_res = self.pdf_processor.process(content)
                    metadata.page_count = pdf_res.page_count
                    if pdf_res.is_digital and pdf_res.digital_document:
                        digital_doc = pdf_res.digital_document
                    else:
                        page_images = pdf_res.pages_rasterized
                elif val_result.document_type == "text":
                    try:
                        raw_str = content.decode("utf-8")
                    except UnicodeDecodeError:
                        raw_str = content.decode("latin-1", errors="ignore")
                    digital_doc = build_ocr_document_from_raw_text(raw_str, filename=filename)
                    metadata.page_count = 1
                else:
                    page_images = [content]
                    metadata.page_count = 1
                metadata.pipeline_stages_completed.append("page_preparation")
            metadata.stage_timings_ms["page_preparation"] = t.get("duration_ms", 0.0)

            # Stage 3: Image Preprocessing & OCR Recognition per page
            ocr_pages: List[OCRPageResult] = []
            with stage_timer("ocr_recognition", {"pages": len(page_images), "is_digital": digital_doc is not None}) as t:
                if digital_doc and digital_doc.pages:
                    ocr_pages = digital_doc.pages
                    ocr_doc = digital_doc
                else:
                    for page_idx, img_bytes in enumerate(page_images, start=1):
                        # Preprocess image with adaptive OpenCV pipeline
                        prep_res = self.image_processor.preprocess(img_bytes)
                        # Recognize characters and extract word coordinates
                        ocr_page, alt_page = self._read_page_both_layouts(prep_res.processed_bytes, page_idx)
                        ocr_page = self._compare_fallback_segmentation(
                            prep_res.processed_bytes, page_idx, ocr_page, metadata, alt_page=alt_page)
                        ocr_pages.append(ocr_page)

                    full_text = "\n\n".join(p.raw_text for p in ocr_pages)
                    avg_conf = (
                        sum(p.confidence for p in ocr_pages) / len(ocr_pages)
                        if ocr_pages else 0.0
                    )
                    ocr_doc = OCRDocumentResult(
                        filename=filename,
                        pages=ocr_pages,
                        total_pages=len(ocr_pages),
                        full_text=full_text,
                        average_confidence=avg_conf,
                        engine_name=self.ocr_engine.engine_name,
                        processing_time_ms=t.get("duration_ms", 0.0),
                    )
                metadata.ocr_evidence = ocr_doc
                quality_rep = self.quality_assessor.assess_document(ocr_doc)
                metadata.custom_properties["quality_report"] = quality_rep.to_dict()
                if not quality_rep.is_readable:
                    metadata.warnings.append(f"Document quality assessment: {quality_rep.quality_grade}. OCR legibility is low.")
                metadata.pipeline_stages_completed.append("ocr_recognition")
            metadata.stage_timings_ms["ocr_recognition"] = t.get("duration_ms", 0.0)

            # Stage 4 & 5: Table Reconstruction & Column Detection
            detected_tables: List[TableResult] = []
            raw_items: List[ExtractedInvoiceItem] = []

            with stage_timer("table_and_column_detection") as t:
                for page in ocr_pages:
                    table = self.table_reconstructor.reconstruct_table(page)
                    columns = table.columns or self.column_detector.detect_columns(table)
                    table = table.model_copy(update={"column_positions": columns, "columns": columns})
                    detected_tables.append(table)

                    if not table.has_table:
                        metadata.warnings.append(f"Page {page.page_number}: No product table detected.")
                        continue

                    has_product_col = any(c.role == "product" for c in columns)
                    has_price_or_qty = any(c.role in ("qty", "rate", "purchase_price") for c in columns)
                    if not (has_product_col or has_price_or_qty):
                        metadata.warnings.append(f"Page {page.page_number}: No valid product columns detected in table.")
                        continue

                    # Extract line items from reconstructed product rows
                    candidate_rows = table.reconstructed_rows if table.reconstructed_rows else table.rows
                    for r_idx, row in enumerate(candidate_rows):
                        if (
                            row.is_header
                            or (table.header_row_index is not None and row.row_index <= table.header_row_index)
                            or row.is_summary
                            or row.is_continuation
                            or not row.cells
                        ):
                            continue

                        schema = (
                            self.column_detector.detect_schema(table)
                            if hasattr(self.column_detector, "detect_schema")
                            else None
                        )
                        rec = self.column_wise_extractor.extract_row(row, schema or columns)
                        if rec is None:
                            continue
                        if rec.is_bundle_header:
                            # Informational bundle heading ("... (With Free Product)", qty "2+1"):
                            # kept as a note for the reviewer, never turned into a stock line
                            metadata.custom_properties.setdefault("bundle_headers", []).append({
                                "page": page.page_number,
                                "row_index": r_idx,
                                "text": rec.raw_product_name,
                                "quantity_text": rec.quantity_details.get("raw_quantity"),
                                "printed_amount": str(rec.taxable_amount or rec.printed_amount or "") or None,
                            })
                            continue

                        raw_name = rec.raw_product_name
                        norm_name = rec.normalized_product_name
                        pack_size = rec.pack_size
                        qty = rec.quantity
                        raw_qty = rec.raw_quantity
                        unit = rec.unit
                        raw_unit = rec.raw_unit
                        p_price = rec.purchase_price
                        s_price = rec.selling_price
                        mrp_val = rec.mrp
                        disc_val = rec.discount
                        disc_pct_val = rec.discount_pct
                        tax_amt = rec.tax_amount
                        gst_rt = rec.gst_rate
                        taxable_val = rec.taxable_amount
                        prn_amt = rec.printed_amount
                        hsn_code = rec.hsn_code
                        fin_conf = rec.financial_role_confidence

                        if rec.warnings:
                            metadata.warnings.extend(rec.warnings)

                        # Classification with taxonomy and HSN
                        class_res = self.grocery_classifier.classify(norm_name or raw_name, hsn=hsn_code)
                        if not pack_size and class_res.package_size:
                            pack_size = class_res.package_size

                        # Product matching
                        item_id = f"item_{uuid.uuid4().hex[:8]}"
                        raw_cells = {
                            cols[c.col_index].role: c.cleaned_text
                            for c in row.cells
                            if c.col_index < len(columns)
                        } if (cols := columns) else {}

                        # Match inventory if pool provided
                        match_res = None
                        if candidate_products:
                            match_res = self.product_matcher.match_product(
                                product_name=norm_name or raw_name,
                                barcode=None,
                                candidate_pool=candidate_products,
                                brand=class_res.brand,
                                package_size=pack_size,
                            )

                        review_status = "CONFIRMED"
                        if class_res.status == "NON_GROCERY":
                            review_status = "NON_GROCERY"
                        elif class_res.status in ("GROCERY_REVIEW_REQUIRED", "UNKNOWN_REVIEW_REQUIRED", "GROCERY_REVIEW", "UNKNOWN_REVIEW"):
                            review_status = "REVIEW_REQUIRED"

                        item = ExtractedInvoiceItem(
                            item_id=item_id,
                            raw_product_name=raw_name,
                            normalized_product_name=norm_name or class_res.normalized_product_name,
                            brand=class_res.brand,
                            category=class_res.category,
                            hsn_code=hsn_code,
                            quantity=qty,
                            raw_quantity=raw_qty,
                            unit=unit,
                            raw_unit=raw_unit,
                            package_size=pack_size,
                            purchase_price=p_price,
                            selling_price=s_price,
                            mrp=mrp_val,
                            discount=disc_val,
                            discount_pct=disc_pct_val,
                            tax_amount=tax_amt,
                            gst_rate=gst_rt,
                            taxable_amount=taxable_val,
                            printed_amount=prn_amt,
                            ocr_confidence=page.confidence,
                            name_confidence=getattr(class_res, "name_confidence", 100.0),
                            brand_confidence=getattr(class_res, "brand_confidence", 0.0),
                            package_size_confidence=getattr(class_res, "package_size_confidence", 0.0),
                            category_confidence=getattr(class_res, "category_confidence", 90.0),
                            match_confidence=match_res.match_confidence if match_res else 0.0,
                            financial_role_confidence=fin_conf,
                            extraction_confidence=85.0 if columns else 50.0,
                            classification_status=class_res.status,
                            is_grocery=class_res.is_grocery,
                            classification_explanation=getattr(class_res, "explanation", None),
                            review_status=review_status,
                            matched_product_id=match_res.matched_product_id if match_res else None,
                            matched_product_name=match_res.matched_product_name if match_res else None,
                            match_method=match_res.match_method if match_res else None,
                            match_explanation=match_res.match_explanation if match_res else None,
                            source_page=page.page_number,
                            source_row_index=r_idx,
                            raw_row_text=row.raw_text,
                            raw_cells=raw_cells,
                        )

                        item.metadata.update(extraction_metadata(rec))
                        if rec.barcode:
                            item.barcode = rec.barcode

                        if match_res and match_res.matched_product_id:
                            item.metadata["matched_product_id"] = match_res.matched_product_id
                            item.metadata["matched_product_name"] = match_res.matched_product_name
                            item.metadata["match_score"] = match_res.similarity_score

                        # Stage 5.5: AI-Assisted Interpretation (Phase 8)
                        # Only invokes AI when item is ambiguous or classification confidence is insufficient
                        if self.ai_service and self.ai_service.should_invoke_for_item(item):
                            ai_sugg = self.ai_service.interpret_product(item, invoice_id=invoice_id)
                            if ai_sugg:
                                item = self.ai_service.apply_to_item(item, ai_sugg)

                        raw_items.append(item)

                metadata.tables_detected = detected_tables
                metadata.pipeline_stages_completed.append("table_and_column_detection")
            metadata.stage_timings_ms["table_and_column_detection"] = t.get("duration_ms", 0.0)

            # Extract header metadata (supplier, invoice no, date)
            from services.invoice import extract_metadata
            all_lines = [l.text for p in ocr_pages for l in p.lines] if ocr_pages else []
            hdr_txt = detected_tables[0].header_text if detected_tables else None
            inv_meta = extract_metadata(all_lines, hdr_txt)

            # Assemble unvalidated invoice
            invoice = ExtractedInvoice(
                invoice_id=invoice_id,
                original_filename=filename,
                supplier_name=inv_meta.get("supplier_name"),
                invoice_number=inv_meta.get("invoice_number"),
                invoice_date=inv_meta.get("invoice_date"),
                status="PROCESSING",
                items=raw_items,
                total_items_count=len(raw_items),
                metadata=metadata,
            )

            # Stage 6: Validation (Pre-Excel verification using UnifiedValidationService)
            with stage_timer("invoice_validation") as t:
                validated_invoice = self.cross_validator.cross_validate_invoice(invoice)
                validated_invoice.metadata.pipeline_stages_completed.append("invoice_validation")
            validated_invoice.metadata.stage_timings_ms["invoice_validation"] = t.get("duration_ms", 0.0)
            if self.ai_service:
                validated_invoice.metadata.custom_properties["ai_telemetry"] = self.ai_service.telemetry.model_dump()
                validated_invoice.metadata.custom_properties["ai_audit_log"] = [
                    e.model_dump() for e in self.ai_service.audit_log
                ]

            # Stage 7: XLSX Workbook Generation & Secure Disk Persistence
            saved_xlsx_path: Optional[str] = None
            with stage_timer("workbook_generation") as t:
                try:
                    wb_bytes = self.workbook_generator.generate(validated_invoice)
                    validated_invoice.metadata.custom_properties["xlsx_generated_bytes"] = len(wb_bytes)
                    saved_xlsx_path = self.storage_manager.save_workbook(wb_bytes, invoice_id, filename)
                    validated_invoice.metadata.custom_properties["xlsx_file_path"] = saved_xlsx_path
                    validated_invoice.metadata.pipeline_stages_completed.append("workbook_generation")
                except Exception as exc:
                    logger.warning("Workbook generation non-fatal failure: %s", exc)
                    validated_invoice.metadata.warnings.append(f"Workbook generation skipped: {exc}")
            validated_invoice.metadata.stage_timings_ms["workbook_generation"] = t.get("duration_ms", 0.0)

            # Stage 8: Excel Reopening & Actual Cell Parsing (Excel-First downstream requirement)
            final_invoice = validated_invoice
            if saved_xlsx_path:
                with stage_timer("workbook_reopening_and_parsing") as t:
                    try:
                        parsed_from_excel = self.workbook_parser.parse(saved_xlsx_path)

                        # Stage 9: Post-Parsing Integrity Validation
                        integrity_report = self.integrity_validator.validate_integrity(
                            pre_invoice=validated_invoice,
                            post_invoice=parsed_from_excel
                        )
                        parsed_from_excel.metadata.custom_properties["excel_integrity_report"] = integrity_report.model_dump()
                        parsed_from_excel.metadata.custom_properties["xlsx_file_path"] = saved_xlsx_path
                        parsed_from_excel.metadata.custom_properties["xlsx_generated_bytes"] = validated_invoice.metadata.custom_properties.get("xlsx_generated_bytes", 0)

                        # Fields the audit workbook does not hold (financial components, review
                        # reasons, taxable value, ...) are carried over row by row
                        carry_forward_unexported_fields(validated_invoice.items, parsed_from_excel.items)

                        # Run final cross-validation on parsed items
                        final_invoice = self.cross_validator.cross_validate_invoice(parsed_from_excel)
                        final_invoice.metadata.ocr_evidence = validated_invoice.metadata.ocr_evidence
                        final_invoice.metadata.mime_type = validated_invoice.metadata.mime_type
                        final_invoice.metadata.document_type = validated_invoice.metadata.document_type
                        final_invoice.metadata.page_count = validated_invoice.metadata.page_count
                        final_invoice.metadata.engine_name = validated_invoice.metadata.engine_name
                        final_invoice.metadata.file_size_bytes = validated_invoice.metadata.file_size_bytes
                        final_invoice.metadata.pipeline_stages_completed = list(validated_invoice.metadata.pipeline_stages_completed)
                        final_invoice.metadata.pipeline_stages_completed.extend(["workbook_parsing", "integrity_validation"])
                        final_invoice.metadata.stage_timings_ms.update(validated_invoice.metadata.stage_timings_ms)
                        final_invoice.metadata.tables_detected = validated_invoice.metadata.tables_detected
                        # OCR-mode decisions, bundle notes, quality report ... are not workbook data
                        for key, value in validated_invoice.metadata.custom_properties.items():
                            final_invoice.metadata.custom_properties.setdefault(key, value)
                        final_invoice.invoice_id = invoice_id
                        final_invoice.original_filename = filename

                        if self.ai_service:
                            final_invoice.metadata.custom_properties["ai_telemetry"] = self.ai_service.telemetry.model_dump()
                            final_invoice.metadata.custom_properties["ai_audit_log"] = [
                                e.model_dump() for e in self.ai_service.audit_log
                            ]

                        if validated_invoice.supplier_name and not final_invoice.supplier_name:
                            final_invoice.supplier_name = validated_invoice.supplier_name
                        if validated_invoice.invoice_number and not final_invoice.invoice_number:
                            final_invoice.invoice_number = validated_invoice.invoice_number
                        if validated_invoice.invoice_date and not final_invoice.invoice_date:
                            final_invoice.invoice_date = validated_invoice.invoice_date

                        if not integrity_report.is_intact:
                            final_invoice.metadata.warnings.append(
                                f"Excel integrity warning: {integrity_report.mismatches_count} mismatch(es) detected"
                            )
                    except Exception as exc:
                        logger.error("Excel-first parsing failed, falling back to pre-Excel dataset: %s", exc)
                        validated_invoice.metadata.warnings.append(f"Excel reopening failed: {exc}")
                        final_invoice = validated_invoice
                    final_invoice.metadata.stage_timings_ms["workbook_reopening_and_parsing"] = t.get("duration_ms", 0.0)

            logger.info(
                "Invoice pipeline finished for '%s': status=%s, items=%d",
                filename, final_invoice.status, len(final_invoice.items)
            )
            return final_invoice

        except (UnsupportedFileError, InvalidInvoiceError, FileValidationError) as err:
            logger.warning("Pipeline validation error for '%s': %s", filename, err)
            metadata.warnings.append(str(err))
            return ExtractedInvoice(
                invoice_id=invoice_id,
                original_filename=filename,
                status="FAILED",
                reason=err.message,
                items=[],
                metadata=metadata,
            )
        except Exception as exc:
            logger.exception("Pipeline critical failure for '%s'", filename)
            metadata.warnings.append(str(exc))
            raise PipelineOrchestrationError(
                f"Invoice pipeline failed: {exc}",
                stage="orchestrator",
                details={"filename": filename, "error": str(exc)}
            )
