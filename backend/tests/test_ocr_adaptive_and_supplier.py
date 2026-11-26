"""
OCR rectification stage 2: evidence-gated contrast treatment and invoice header (supplier) fixes.

  A  Header fields come from the automatic-layout reading when the table was read in single-block layout
     (TC13: the single-block reading drops the large supplier title line).
  B  Supplier cleanup: document titles, malformed GSTIN labels, invoice codes and details lines.
  C  An invoice code with a dash ("INV-00427") is a value, not a label plus value.
  D  The image processor can force a contrast treatment.
  E  The pipeline reads the other contrast treatment only on weak extraction evidence, and keeps it only
     when it is strictly better.

Generic header lines only; fixture-level checks use the repository's verified printed values.
"""

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.invoice import extract_metadata, extract_metadata_from_readings

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures" / "ground_truth"


def meta(*lines):
    return extract_metadata(list(lines), None)


# ------------------------------------------------------------------------------ B supplier cleanup

@pytest.mark.parametrize("lines, supplier", [
    (["SRI BALAJI WHOLESALE TRADERS          TAX INVOICE", "Invoice No: SBW-4101"], "SRI BALAJI WHOLESALE TRADERS"),
    (["SRI BALAJI WHOLESALE TRADERS ~~ TAXINVOICE"], "SRI BALAJI WHOLESALE TRADERS"),
    (["Mahalaxmi Traders     ORIGINAL FOR RECIPIENT"], "Mahalaxmi Traders"),
    (["Kumar Agencies   BILL OF SUPPLY"], "Kumar Agencies"),
    # a GSTIN details line does not outrank the standalone name line above it
    (["Premier Consumer Brands", "TAX INVOICE | Inv No: PCB-5520 | Date: 28/10/2026",
      "GSTIN: 27AABCS1429B1Z | Wholesale Grocery Distributors"], "Premier Consumer Brands"),
    # ...but a name printed on the same line as its GSTIN is still found
    (["Balaji Traders GSTIN: 37ABCDE1234F1Z5"], "Balaji Traders"),
    (["Annapurna Distributors       Invoice No: AD/26/0045"], "Annapurna Distributors"),
    # overlapping text: the unreadable label and the code after it are not part of the name
    (["SRI LAKSHMI WHOLESALE TRADER §veice No: INV-00427", "Date: 08/10/2026"], "SRI LAKSHMI WHOLESALE TRADER"),
    (["|| Shree Ganeshay Namah ||", "Lakshmi Provision Stores", "GSTIN 37ABCDE1234F1Z5"], "Lakshmi Provision Stores"),
    (["Sri Ram & Co.", "Ph: 9848012345"], "Sri Ram & Co"),
    (["Kumar's Wholesale Mart Pvt. Ltd."], "Kumar's Wholesale Mart Pvt Ltd"),
    (["Fresh Farm Foods", "Wholesale Grocery Distributors"], "Fresh Farm Foods"),
])
def test_b_supplier_candidates(lines, supplier):
    assert meta(*lines)["supplier_name"] == supplier


def test_b_no_supplier_is_invented():
    assert meta("TAX INVOICE", "Invoice No: 123", "Date: 01/01/2026")["supplier_name"] is None
    assert meta("BILL TO", "Gupta Kirana Store")["supplier_name"] is None  # the buyer is never the supplier


def test_b_gstin_label_never_eats_a_business_word():
    # the GSTIN value must contain a digit: "GSTIN Wholesale" keeps the word
    assert meta("Om Sai GSTIN Wholesale Traders")["supplier_name"] == "Om Sai GSTIN Wholesale Traders"


# ------------------------------------------------------------------------------ C invoice code with a dash

def test_c_invoice_code_with_dash_is_kept_whole():
    assert meta("Invoice No: INV-00427")["invoice_number"] == "INV-00427"
    assert meta("Bill - 5521")["invoice_number"] == "5521"
    assert meta("Inv No: PCB-5520")["invoice_number"] == "PCB-5520"
    # a code whose label was not read is not cut into "00427"
    assert meta("SRI LAKSHMI WHOLESALE TRADER §veice INV-00427")["invoice_number"] is None


# ------------------------------------------------------------------------------ A header from the layout reading

def test_a_header_fields_prefer_the_automatic_layout_reading():
    table_reading = ["Wholesale & Retail Groceries  igvelcalo: : SBGS/2026/0912",
                     "#110 Market Road   [ TAX INVOICE ]   Invoice Date: 15-09-2026",
                     "Item Qty Rate Amount", "Grand Total: 1,234.00"]
    layout_reading = ["SRI BALAJI GENERAL STORES", "Wholesale & Retail Groceries   Invoice No. : SBGS/2026/0912",
                      "Invoice Date: 15-09-2026"]
    m = extract_metadata_from_readings(table_reading, None, layout_reading)
    assert m["supplier_name"] == "SRI BALAJI GENERAL STORES"
    assert m["invoice_number"] == "SBGS/2026/0912"
    assert m["invoice_total"] == 1234.0  # the printed total comes from the table reading


def test_a_each_field_falls_back_to_the_table_reading():
    table_reading = ["Fresh Farm Foods", "Invoice No: FF-77", "Date: 02/02/2026"]
    layout_reading = ["Fresh Farm Foods", "Date: 02/02/2026"]  # the layout reading lost the invoice number
    m = extract_metadata_from_readings(table_reading, None, layout_reading)
    assert m["invoice_number"] == "FF-77" and m["supplier_name"] == "Fresh Farm Foods"
    # no second reading: identical to extract_metadata
    assert extract_metadata_from_readings(table_reading, None, None) == extract_metadata(table_reading, None)


def test_a_weaker_layout_supplier_does_not_replace_a_stronger_one():
    table_reading = ["Annapurna Distributors", "Invoice No: AD-1"]   # business word: confidence 85
    layout_reading = ["Some Header Text", "Invoice No: AD-1"]       # no business word: confidence 55
    assert extract_metadata_from_readings(table_reading, None, layout_reading)["supplier_name"] == "Annapurna Distributors"


# ------------------------------------------------------------------------------ D forced contrast treatment

def test_d_processor_contrast_treatment_can_be_forced():
    import cv2
    import numpy as np
    from services.grocery_ocr.processors.image_processor import BaseImageProcessor

    clean = np.full((600, 900, 3), 255, np.uint8)
    cv2.putText(clean, "Basmati Rice 25 kg 2 bag 2350.00", (30, 300), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
    png = cv2.imencode(".png", clean)[1].tobytes()
    auto = BaseImageProcessor().preprocess(png)
    assert auto.metadata["contrast_treatment"] == "stretch" and not auto.metadata["contrast_forced"]
    forced = BaseImageProcessor().preprocess(png, contrast="clahe")
    assert "clahe_contrast_enhancement" in forced.preprocessing_steps_applied and forced.metadata["contrast_forced"]
    faded = (FIX / "invoices" / "TC20_faded_thermal_receipt.png").read_bytes()
    assert BaseImageProcessor().preprocess(faded).metadata["contrast_treatment"] == "clahe"
    assert "clahe_contrast_enhancement" not in BaseImageProcessor().preprocess(faded, contrast="stretch").preprocessing_steps_applied
    with pytest.raises(Exception):
        BaseImageProcessor().preprocess(png, contrast="bogus")


# ------------------------------------------------------------------------------ E evidence-gated second treatment

class _FakeProcessor:
    def __init__(self, first="stretch"):
        self.first, self.calls = first, []

    def preprocess(self, image_bytes, contrast=None):
        self.calls.append(contrast)
        treatment = contrast or self.first
        return SimpleNamespace(processed_bytes=treatment.encode(), metadata={"contrast_treatment": treatment})


def _pipeline(evidence_by_treatment, first="stretch"):
    from services.grocery_ocr.pipeline.invoice_pipeline import InvoicePipeline

    pipe = InvoicePipeline.__new__(InvoicePipeline)  # only the methods under test are used
    pipe.image_processor = _FakeProcessor(first)
    pages = {}

    def read(image_bytes, page_idx):
        t = image_bytes.decode()
        pages[t] = (SimpleNamespace(name=f"{t}-layout"), SimpleNamespace(name=f"{t}-block"))
        return pages[t]

    pipe._read_page_both_layouts = read
    pipe._compare_fallback_segmentation = lambda b, i, d, m, alt_page=None: alt_page  # table kept from the block reading
    pipe._page_extraction_evidence = lambda page: evidence_by_treatment[page.name.split("-")[0]]
    return pipe


def _meta():
    from services.grocery_ocr.schemas.invoice import InvoiceProcessingMetadata
    return InvoiceProcessingMetadata(filename="x.png")


def test_e_all_lines_agree_no_second_treatment():
    pipe = _pipeline({"stretch": {"rows": 5, "verified": 5, "mismatch": 0}})
    md = _meta()
    chosen, layout = pipe._read_page_adaptive(b"img", 1, md)
    assert chosen.name == "stretch-block" and layout.name == "stretch-layout"
    assert pipe.image_processor.calls == [None]  # one preprocessing, no extra OCR
    assert md.custom_properties["contrast_selection"][0]["chosen"] == "stretch"


def test_e_weak_evidence_tries_the_other_treatment_and_keeps_it_when_better():
    pipe = _pipeline({"stretch": {"rows": 7, "verified": 5, "mismatch": 1},
                      "clahe": {"rows": 7, "verified": 7, "mismatch": 0}})
    md = _meta()
    chosen, layout = pipe._read_page_adaptive(b"img", 1, md)
    assert pipe.image_processor.calls == [None, "clahe"]
    assert chosen.name == "clahe-block" and layout.name == "clahe-layout"
    rec = md.custom_properties["contrast_selection"][0]
    assert rec["chosen"] == "clahe" and rec["other_evidence"]["verified"] == 7
    assert any("CLAHE" in w for w in md.warnings)


@pytest.mark.parametrize("other", [
    {"rows": 7, "verified": 4, "mismatch": 0},   # equal score (5 - 1 = 4): the first reading is kept
    {"rows": 6, "verified": 0, "mismatch": 6},   # spurious disagreeing rows: worse
])
def test_e_other_treatment_must_be_strictly_better(other):
    pipe = _pipeline({"stretch": {"rows": 7, "verified": 5, "mismatch": 1}, "clahe": other})
    chosen, _ = pipe._read_page_adaptive(b"img", 1, _meta())
    assert chosen.name == "stretch-block"


def test_e_no_rows_tries_the_other_treatment_and_faded_pages_work_both_ways():
    pipe = _pipeline({"clahe": {"rows": 0, "verified": 0, "mismatch": 0},
                      "stretch": {"rows": 3, "verified": 3, "mismatch": 0}}, first="clahe")
    chosen, _ = pipe._read_page_adaptive(b"img", 1, _meta())
    assert pipe.image_processor.calls == [None, "stretch"] and chosen.name == "stretch-block"


# ------------------------------------------------------------------------------ fixtures (real OCR)

def _extract(path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    import db.models  # noqa: F401
    from db.session import Base
    from services.invoice import extract_invoice_from_bytes

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return extract_invoice_from_bytes(path.read_bytes(), path.name, sessionmaker(bind=engine)(), uuid.uuid4())


@pytest.mark.parametrize("case", ["TC02_bordered_image", "TC03_phone_photo", "TC13_sri_balaji_13items",
                                  "TC17_multi_tier_gst", "TC30_beverages_breakfast"])
def test_fixture_headers_match_the_printed_values(case):
    from services.document_prep.ocr_scoring import ocr_engine_available
    if not ocr_engine_available():
        pytest.skip("OCR engine not installed")
    truth = json.loads((FIX / "printed_values.json").read_text())["cases"][case]
    res = _extract(FIX / "invoices" / truth["filename"])
    norm = lambda s: "".join(ch for ch in (s or "").lower() if ch.isalnum())
    assert norm(res.supplier_name) == norm(truth["header"]["supplier_name"])
    if case != "TC13_sri_balaji_13items":  # TC13's "Invoice No." label is unreadable in both layouts
        assert norm(res.invoice_number) == norm(truth["header"]["invoice_number"])
