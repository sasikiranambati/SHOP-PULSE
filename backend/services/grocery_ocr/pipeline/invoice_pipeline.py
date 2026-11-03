"""
Pipeline orchestrator for the ShopPulse Grocery OCR Engine.
Coordinates validation, image processing, OCR recognition, table reconstruction,
semantic extraction, classification, validation, and audit workbook generation.
Supports full dependency injection for all 13 services.
Never writes to the database during extraction.
Preserves complete OCR evidence, word coordinates, and Decimal precision.
"""

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
        self.cross_validator = cross_validator or UnifiedValidationService(self.config)

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
                    text_lines = raw_str.splitlines()
                    ocr_words: List[OCRWord] = []
                    ocr_lines: List[OCRLine] = []
                    w_idx = 0
                    import re as _re
                    for line_idx, line in enumerate(text_lines):
                        stripped = line.strip()
                        if not stripped:
                            continue
                        line_y0 = float(50 + line_idx * 35)
                        line_y1 = line_y0 + 25.0
                        line_words: List[OCRWord] = []
                        for match in _re.finditer(r"\S+", line):
                            tok = match.group()
                            x0 = float(50 + match.start() * 12)
                            x1 = float(50 + match.end() * 12)
                            word_obj = OCRWord(
                                text=tok,
                                bbox=BoundingBox(x0=x0, y0=line_y0, x1=x1, y1=line_y1),
                                confidence=100.0,
                                word_index=w_idx,
                                reading_order=w_idx,
                                page_number=1,
                            )
                            ocr_words.append(word_obj)
                            line_words.append(word_obj)
                            w_idx += 1
                        if line_words:
                            ocr_lines.append(OCRLine(
                                line_number=line_idx,
                                text=stripped,
                                words=line_words,
                                bbox=BoundingBox(x0=min(w.bbox.x0 for w in line_words), y0=line_y0, x1=max(w.bbox.x1 for w in line_words), y1=line_y1),
                                confidence=100.0
                            ))
                    digital_page = OCRPageResult(
                        page_number=1,
                        width=1400,
                        height=max(800, 100 + len(text_lines) * 35),
                        raw_text=raw_str,
                        words=ocr_words,
                        lines=ocr_lines,
                        confidence=100.0,
                        processing_status="SUCCESS",
                        metadata={"format": "plain_text"}
                    )
                    digital_doc = OCRDocumentResult(
                        filename=filename,
                        pages=[digital_page],
                        total_pages=1,
                        full_text=raw_str,
                        average_confidence=100.0,
                        engine_name="plain_text_direct",
                    )
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
                        ocr_page = self.ocr_engine.recognize(prep_res.processed_bytes, page_number=page_idx)
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

                        raw_name, norm_name = self.product_extractor.extract_product_name(row, columns)
                        pack_size = self.product_extractor.extract_pack_size(raw_name)

                        # Detailed Quantity Extraction
                        if hasattr(self.quantity_extractor, "extract_quantity_detailed"):
                            qty_res = self.quantity_extractor.extract_quantity_detailed(row, columns)
                            qty = qty_res.quantity
                            raw_qty = qty_res.raw_quantity
                            unit = qty_res.unit
                            raw_unit = qty_res.raw_unit
                        else:
                            qty, unit = self.quantity_extractor.extract_quantity(row, columns)
                            raw_qty = str(qty) if qty is not None else None
                            raw_unit = unit

                        # Detailed Financial Field Extraction
                        if hasattr(self.price_extractor, "extract_financials_detailed"):
                            fin_res = self.price_extractor.extract_financials_detailed(row, columns)
                            p_price = fin_res.purchase_price
                            s_price = fin_res.selling_price
                            mrp_val = fin_res.mrp
                            disc_val = fin_res.discount
                            disc_pct_val = fin_res.discount_pct
                            tax_amt = fin_res.tax_amount
                            gst_rt = fin_res.gst_rate
                            taxable_val = fin_res.taxable_amount
                            prn_amt = fin_res.printed_amount
                            fin_conf = fin_res.financial_role_confidence
                        else:
                            prices = self.price_extractor.extract_prices(row, columns)
                            p_price = prices.get("purchase_price")
                            s_price = prices.get("selling_price")
                            mrp_val = prices.get("mrp")
                            disc_val = prices.get("discount")
                            disc_pct_val = prices.get("discount_pct")
                            tax_amt = prices.get("tax_amount")
                            gst_rt = prices.get("gst_rate")
                            taxable_val = prices.get("taxable_amount")
                            prn_amt = prices.get("printed_amount")
                            fin_conf = {}

                        # Require valid product name
                        if not raw_name or len(raw_name.strip()) < 2:
                            continue
                        # Ignore footer / bank / legal metadata text
                        lower_name = raw_name.lower()
                        if any(lower_name.startswith(kw) for kw in [
                            "bank details", "terms and conditions", "total in words",
                            "account number", "for ", "subject to", "our goods", "round off"
                        ]):
                            continue
                        # A product row must have at least one numeric signal (qty, price, or amount)
                        if qty is None and p_price is None and prn_amt is None:
                            continue

                        # Reconcile faint OCR decimal point in quantities:
                        # In dot-matrix / wholesale invoices, quantities like 1.0, 10.0, 3.0, 5.0 often lose the faint dot in OCR (becoming 10, 100, 30, 50).
                        # If (qty / 10) * p_price matches prn_amt within tolerance (factoring in discount/tax), repair qty!
                        if qty is not None and p_price is not None and prn_amt is not None and qty >= Decimal("10"):
                            shifted_qty = (qty / Decimal("10")).quantize(Decimal("0.001"))
                            gross_shifted = (shifted_qty * p_price).quantize(Decimal("0.01"))
                            net_shifted = gross_shifted - (disc_val or Decimal("0.00")) + (tax_amt or Decimal("0.00"))
                            gross_orig = (qty * p_price).quantize(Decimal("0.01"))
                            net_orig = gross_orig - (disc_val or Decimal("0.00")) + (tax_amt or Decimal("0.00"))
                            if abs(net_shifted - prn_amt) <= Decimal("1.50") and abs(net_orig - prn_amt) > Decimal("5.00"):
                                qty = shifted_qty
                                raw_qty = str(shifted_qty)

                        # Extract HSN if column present
                        hsn_code: Optional[str] = None
                        hsn_col_idx = next((c.column_index for c in columns if c.role == "hsn"), None)
                        if hsn_col_idx is not None and hsn_col_idx < len(row.cells):
                            hsn_code = row.cells[hsn_col_idx].raw_text.strip() or None

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
                        final_invoice.invoice_id = invoice_id
                        final_invoice.original_filename = filename

                        if self.ai_service:
                            final_invoice.metadata.custom_properties["ai_telemetry"] = self.ai_service.telemetry.model_dump()
                            final_invoice.metadata.custom_properties["ai_audit_log"] = [
                                e.model_dump() for e in self.ai_service.audit_log
                            ]

                        if validated_invoice.supplier_name and not final_invoice.supplier_name:
                            final_invoice.supplier_name = validated_invoice.supplier_name
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
