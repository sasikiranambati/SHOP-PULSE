"""
ShopPulse Phase 10: Ground Truth Dataset Generator and Compiler.
Compiles existing test cases (TC01-TC12, Sri Balaji, etc.) and generates
additional realistic grocery invoice scenarios into:
- backend/tests/fixtures/ground_truth/invoices/
- backend/tests/fixtures/ground_truth/ground_truth.json
"""

import io
import json
import math
import os
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
FIXTURES_DIR = Path(__file__).resolve().parent / "ground_truth"
INVOICES_DIR = FIXTURES_DIR / "invoices"
ANNOTATIONS_FILE = FIXTURES_DIR / "ground_truth.json"

INVOICES_DIR.mkdir(parents=True, exist_ok=True)

def get_font(size=20):
    try:
        return ImageFont.truetype("arial.ttf", size)
    except Exception:
        return ImageFont.load_default(size=size)

def get_bold_font(size=22):
    try:
        return ImageFont.truetype("arialbd.ttf", size)
    except Exception:
        return ImageFont.load_default(size=size)

def create_table_invoice_image(
    filename: str,
    header_title: str,
    invoice_no: str,
    date_str: str,
    columns: list[tuple[str, int]], # (col_name, x_pos)
    rows: list[list[str]],
    total_str: str,
    bordered: bool = True,
    width: int = 1200,
    rotate_angle: float = 0.0,
    faded: bool = False,
) -> Path:
    row_height = 42
    height = 280 + len(rows) * row_height + 150
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    font = get_font(20)
    bold_font = get_bold_font(24)
    small_font = get_font(16)

    # Header
    draw.text((50, 40), header_title, fill="black", font=bold_font)
    draw.text((50, 80), f"TAX INVOICE | Inv No: {invoice_no} | Date: {date_str}", fill="black", font=small_font)
    draw.text((50, 105), "GSTIN: 27AABCS1429B1Z | Wholesale Grocery Distributors", fill="#444444", font=small_font)

    header_y = 150
    if bordered:
        draw.line([(40, header_y - 5), (width - 40, header_y - 5)], fill="#333333", width=2)
        draw.line([(40, header_y + 35), (width - 40, header_y + 35)], fill="#333333", width=2)

    # Print Header Columns
    for col_name, x in columns:
        draw.text((x, header_y), col_name, fill="black", font=bold_font)

    # Print Rows
    current_y = header_y + 45
    for r_idx, row in enumerate(rows):
        for val, (_, x) in zip(row, columns):
            draw.text((x, current_y), str(val), fill="#111111", font=font)
        if bordered:
            draw.line([(40, current_y + 32), (width - 40, current_y + 32)], fill="#cccccc", width=1)
        current_y += row_height

    # Footer Total
    if bordered:
        draw.line([(40, current_y), (width - 40, current_y)], fill="#333333", width=2)
    draw.text((width - 450, current_y + 15), f"Grand Total: {total_str}", fill="black", font=bold_font)

    if faded:
        # Simulate faded thermal receipt
        from PIL import ImageEnhance
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(0.4)

    if rotate_angle != 0.0:
        img = img.rotate(rotate_angle, expand=True, fillcolor="white")

    out_path = INVOICES_DIR / filename
    img.save(out_path)
    return out_path

def build_dataset():
    ground_truth = {}

    # 1. Load Existing Invoices from docs/scanner-test-cases/
    existing_docs = ROOT_DIR / "docs" / "scanner-test-cases"
    expected_lines_path = existing_docs / "expected-lines.json"
    if expected_lines_path.exists():
        with open(expected_lines_path, "r", encoding="utf-8") as f:
            raw_expected = json.load(f)
    else:
        raw_expected = {}

    # TC01 Clean Digital
    tc01_src = existing_docs / "TC01-clean-digital.pdf"
    if tc01_src.exists():
        shutil.copy(tc01_src, INVOICES_DIR / "TC01_clean_digital.pdf")
        tc01_items = []
        for line in raw_expected.get("TC01-clean-digital", []):
            tc01_items.append({
                "product_name": line["name"],
                "quantity": float(line["qty"]),
                "unit": line["unit"],
                "purchase_price": float(line["rate"]),
                "mrp": float(line["mrp"]) if line.get("mrp") else None,
                "gst_rate": float(line.get("gst", 0)),
                "printed_amount": float(line["qty"]) * float(line["rate"]),
                "is_grocery": True,
            })
        ground_truth["TC01_clean_digital"] = {
            "invoice_id": "TC01_clean_digital",
            "filename": "TC01_clean_digital.pdf",
            "layout_type": "clean_digital_pdf",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-001",
            "grand_total": sum(it["printed_amount"] for it in tc01_items),
            "items": tc01_items,
        }

    # TC02 Clean Image
    tc02_src = existing_docs / "TC02-clean-image.png"
    if tc02_src.exists():
        shutil.copy(tc02_src, INVOICES_DIR / "TC02_bordered_image.png")
        ground_truth["TC02_bordered_image"] = {
            "invoice_id": "TC02_bordered_image",
            "filename": "TC02_bordered_image.png",
            "layout_type": "bordered_table_image",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-001",
            "grand_total": 2980.0,
            "items": ground_truth.get("TC01_clean_digital", {}).get("items", []),
        }

    # TC03 Phone Photo
    tc03_src = existing_docs / "TC03-phone-photo.jpg"
    if tc03_src.exists():
        shutil.copy(tc03_src, INVOICES_DIR / "TC03_phone_photo.jpg")
        ground_truth["TC03_phone_photo"] = {
            "invoice_id": "TC03_phone_photo",
            "filename": "TC03_phone_photo.jpg",
            "layout_type": "noisy_phone_photo",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-001",
            "grand_total": 2980.0,
            "items": ground_truth.get("TC01_clean_digital", {}).get("items", []),
        }

    # TC04 No Rate Column
    tc04_src = existing_docs / "TC04-no-rate-column.pdf"
    if tc04_src.exists():
        shutil.copy(tc04_src, INVOICES_DIR / "TC04_no_rate_column.pdf")
        tc04_items = []
        for line in raw_expected.get("TC04-no-rate-column", []):
            tc04_items.append({
                "product_name": line["name"],
                "quantity": float(line["qty"]),
                "unit": line["unit"],
                "purchase_price": None, # Rate column omitted from invoice!
                "mrp": float(line["mrp"]) if line.get("mrp") else None,
                "gst_rate": float(line.get("gst", 0)),
                "printed_amount": float(line["qty"]) * float(line.get("rate", 0)),
                "is_grocery": True,
            })
        ground_truth["TC04_no_rate_column"] = {
            "invoice_id": "TC04_no_rate_column",
            "filename": "TC04_no_rate_column.pdf",
            "layout_type": "no_rate_column_pdf",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-004",
            "grand_total": sum(it["printed_amount"] for it in tc04_items),
            "items": tc04_items,
        }

    # TC05 Amount Mismatch
    tc05_src = existing_docs / "TC05-amount-mismatch.pdf"
    if tc05_src.exists():
        shutil.copy(tc05_src, INVOICES_DIR / "TC05_amount_mismatch.pdf")
        ground_truth["TC05_amount_mismatch"] = {
            "invoice_id": "TC05_amount_mismatch",
            "filename": "TC05_amount_mismatch.pdf",
            "layout_type": "arithmetic_mismatch_pdf",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-005",
            "grand_total": 3030.0,
            "items": [
                {"product_name": "Aashirvaad Atta 5kg", "quantity": 4.0, "unit": "bag", "purchase_price": 245.0, "mrp": 289.0, "printed_amount": 980.0, "is_grocery": True},
                {"product_name": "Tata Salt 1kg", "quantity": 20.0, "unit": "pkt", "purchase_price": 22.0, "mrp": 28.0, "printed_amount": 440.0, "is_grocery": True},
                {"product_name": "Fortune Sunflower Oil 1L", "quantity": 12.0, "unit": "pcs", "purchase_price": 140.0, "mrp": 175.0, "printed_amount": 1610.0, "is_grocery": True}, # Mismatch: 12*140=1680 vs printed 1610
            ],
        }

    # TC06 No MRP Column
    tc06_src = existing_docs / "TC06-no-mrp-column.pdf"
    if tc06_src.exists():
        shutil.copy(tc06_src, INVOICES_DIR / "TC06_no_mrp_column.pdf")
        ground_truth["TC06_no_mrp_column"] = {
            "invoice_id": "TC06_no_mrp_column",
            "filename": "TC06_no_mrp_column.pdf",
            "layout_type": "no_mrp_column_pdf",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-006",
            "grand_total": 3100.0,
            "items": [
                {"product_name": "Aashirvaad Atta 5kg", "quantity": 4.0, "unit": "bag", "purchase_price": 245.0, "mrp": None, "printed_amount": 980.0, "is_grocery": True},
                {"product_name": "Tata Salt 1kg", "quantity": 20.0, "unit": "pkt", "purchase_price": 22.0, "mrp": None, "printed_amount": 440.0, "is_grocery": True},
                {"product_name": "Fortune Sunflower Oil 1L", "quantity": 12.0, "unit": "pcs", "purchase_price": 140.0, "mrp": None, "printed_amount": 1680.0, "is_grocery": True},
            ],
        }

    # TC07 Long 40 Lines
    tc07_src = existing_docs / "TC07-long-40-lines.pdf"
    if tc07_src.exists():
        shutil.copy(tc07_src, INVOICES_DIR / "TC07_long_40_lines.pdf")
        tc07_items = []
        for line in raw_expected.get("TC07-long-40-lines", []):
            tc07_items.append({
                "product_name": line["name"],
                "quantity": float(line["qty"]),
                "unit": line.get("unit", "pcs"),
                "purchase_price": float(line["rate"]),
                "mrp": float(line["mrp"]) if line.get("mrp") else None,
                "printed_amount": float(line["qty"]) * float(line["rate"]),
                "is_grocery": True,
            })
        ground_truth["TC07_long_40_lines"] = {
            "invoice_id": "TC07_long_40_lines",
            "filename": "TC07_long_40_lines.pdf",
            "layout_type": "multi_page_40_lines_pdf",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-007",
            "grand_total": sum(it["printed_amount"] for it in tc07_items),
            "items": tc07_items,
        }

    # TC08 Numbers in Names
    tc08_src = existing_docs / "TC08-numbers-in-names.pdf"
    if tc08_src.exists():
        shutil.copy(tc08_src, INVOICES_DIR / "TC08_numbers_in_names.pdf")
        ground_truth["TC08_numbers_in_names"] = {
            "invoice_id": "TC08_numbers_in_names",
            "filename": "TC08_numbers_in_names.pdf",
            "layout_type": "numbers_in_names_pdf",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-008",
            "grand_total": 4540.0,
            "items": [
                {"product_name": "7UP 2.25L", "quantity": 10.0, "unit": "bottle", "purchase_price": 85.0, "mrp": 100.0, "printed_amount": 850.0, "is_grocery": True},
                {"product_name": "Lizol Surface Cleaner 975ml x 2", "quantity": 5.0, "unit": "pkt", "purchase_price": 320.0, "mrp": 380.0, "printed_amount": 1600.0, "is_grocery": False},
                {"product_name": "Dettol Soap 125g (Pack of 4)", "quantity": 12.0, "unit": "pkt", "purchase_price": 145.0, "mrp": 180.0, "printed_amount": 1740.0, "is_grocery": False},
                {"product_name": "Good Day Cashew 600g (Buy 2 Get 1)", "quantity": 5.0, "unit": "pkt", "purchase_price": 70.0, "mrp": 90.0, "printed_amount": 350.0, "is_grocery": True},
            ],
        }

    # TC09 Discount and GST
    tc09_src = existing_docs / "TC09-discount-and-gst.pdf"
    if tc09_src.exists():
        shutil.copy(tc09_src, INVOICES_DIR / "TC09_discount_and_gst.pdf")
        ground_truth["TC09_discount_and_gst"] = {
            "invoice_id": "TC09_discount_and_gst",
            "filename": "TC09_discount_and_gst.pdf",
            "layout_type": "discount_and_gst_pdf",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-009",
            "grand_total": 2505.58,
            "items": [
                {"product_name": "Fortune Sunflower Oil 1L", "quantity": 12.0, "unit": "pcs", "purchase_price": 140.0, "mrp": None, "discount": 2.0, "gst_rate": 5.0, "printed_amount": 1675.80, "is_grocery": True},
                {"product_name": "Parle-G Biscuits 250g", "quantity": 24.0, "unit": "pkt", "purchase_price": 9.5, "mrp": None, "discount": 5.0, "gst_rate": 18.0, "printed_amount": 269.04, "is_grocery": True},
                {"product_name": "Maggi Noodles 70g", "quantity": 48.0, "unit": "pkt", "purchase_price": 11.0, "mrp": None, "discount": 0.0, "gst_rate": 18.0, "printed_amount": 560.74, "is_grocery": True},
            ],
        }

    # TC10 No Item Table
    tc10_src = existing_docs / "TC10-no-item-table.png"
    if tc10_src.exists():
        shutil.copy(tc10_src, INVOICES_DIR / "TC10_no_item_table.png")
        ground_truth["TC10_no_item_table"] = {
            "invoice_id": "TC10_no_item_table",
            "filename": "TC10_no_item_table.png",
            "layout_type": "non_table_receipt",
            "supplier_name": "HDFC Payment Gateway",
            "invoice_number": "REC-9921",
            "grand_total": 1500.0,
            "items": [], # Expect 0 items
        }

    # TC11 Empty File
    tc11_src = existing_docs / "TC11-empty-file.pdf"
    if tc11_src.exists():
        shutil.copy(tc11_src, INVOICES_DIR / "TC11_empty_file.pdf")
        ground_truth["TC11_empty_file"] = {
            "invoice_id": "TC11_empty_file",
            "filename": "TC11_empty_file.pdf",
            "layout_type": "empty_file",
            "supplier_name": None,
            "invoice_number": None,
            "grand_total": 0.0,
            "items": [],
        }

    # TC12 Text Invoice
    tc12_src = existing_docs / "TC12-text-invoice.txt"
    if tc12_src.exists():
        shutil.copy(tc12_src, INVOICES_DIR / "TC12_text_invoice.txt")
        ground_truth["TC12_text_invoice"] = {
            "invoice_id": "TC12_text_invoice",
            "filename": "TC12_text_invoice.txt",
            "layout_type": "plain_text",
            "supplier_name": "Sri Balaji Wholesale Traders",
            "invoice_number": "BAL-2024-012",
            "grand_total": 3118.0,
            "items": [
                {"product_name": "Tata Salt 1kg", "quantity": 20.0, "unit": "pkt", "purchase_price": 22.0, "mrp": 28.0, "printed_amount": 440.0, "is_grocery": True},
                {"product_name": "Parle-G Biscuits 250g", "quantity": 24.0, "unit": "pkt", "purchase_price": 9.5, "mrp": 12.0, "printed_amount": 228.0, "is_grocery": True},
                {"product_name": "Red Label Tea 500g", "quantity": 10.0, "unit": "pkt", "purchase_price": 245.0, "mrp": 290.0, "printed_amount": 2450.0, "is_grocery": True},
            ],
        }

    # TC13 Sri Balaji Scan (13 items)
    balaji_src = ROOT_DIR / "tests" / "fixtures" / "invoices" / "original_invoice_sri_balaji.png"
    if balaji_src.exists():
        shutil.copy(balaji_src, INVOICES_DIR / "TC13_sri_balaji_13items.png")
        ground_truth["TC13_sri_balaji_13items"] = {
            "invoice_id": "TC13_sri_balaji_13items",
            "filename": "TC13_sri_balaji_13items.png",
            "layout_type": "scanned_photo_grocery_bill",
            "supplier_name": "Sri Balaji General Stores",
            "invoice_number": "INV-1029",
            "grand_total": 52385.80,
            "items": [
                {"product_name": "CHANA 50 KG", "brand": None, "quantity": 1.0, "unit": "BOR", "purchase_price": 2760.00, "selling_price": 2950.00, "mrp": 3200.00, "printed_amount": 2760.00, "is_grocery": True},
                {"product_name": "FORTUNE BESAN 500 GM", "brand": "Fortune", "quantity": 10.0, "unit": "PCS", "purchase_price": 70.00, "selling_price": 78.00, "mrp": 90.00, "printed_amount": 700.00, "is_grocery": True},
                {"product_name": "FORTUNE OIL 1 KG", "brand": "Fortune", "quantity": 3.0, "unit": "PET", "purchase_price": 1378.62, "selling_price": 1520.00, "mrp": 1680.00, "printed_amount": 4015.80, "is_grocery": True},
                {"product_name": "HELLO ORGANIC CHANA DAL 1 KG", "brand": "Hello Organic", "quantity": 5.0, "unit": "PCS", "purchase_price": 129.46, "selling_price": 140.00, "mrp": 160.00, "printed_amount": 725.00, "is_grocery": True},
                {"product_name": "MASOOR DAL 50 KG", "brand": None, "quantity": 1.0, "unit": "BOR", "purchase_price": 4825.00, "selling_price": 5200.00, "mrp": 5600.00, "printed_amount": 4825.00, "is_grocery": True},
                {"product_name": "OIL CAN 10", "brand": None, "quantity": 10.0, "unit": "PCS", "purchase_price": 1975.00, "selling_price": 2150.00, "mrp": 2400.00, "printed_amount": 19750.00, "is_grocery": True},
                {"product_name": "SUGAR", "brand": None, "quantity": 2.0, "unit": "PCS", "purchase_price": 1925.00, "selling_price": 2050.00, "mrp": 2300.00, "printed_amount": 3850.00, "is_grocery": True},
                {"product_name": "SOYABEAN CHUNKS 15 KG", "brand": None, "quantity": 2.0, "unit": "BOR", "purchase_price": 1230.00, "selling_price": 1350.00, "mrp": 1500.00, "printed_amount": 2460.00, "is_grocery": True},
                {"product_name": "SURF EXCEL 1 KG", "brand": "Surf Excel", "quantity": 12.0, "unit": "PCS", "purchase_price": 130.00, "selling_price": 145.00, "mrp": 160.00, "printed_amount": 1560.00, "is_grocery": False},
                {"product_name": "TATA SALT 1 KG", "brand": "Tata", "quantity": 50.0, "unit": "PCS", "purchase_price": 22.00, "selling_price": 25.00, "mrp": 28.00, "printed_amount": 1100.00, "is_grocery": True},
                {"product_name": "TOOR DAL 30 KG", "brand": None, "quantity": 1.0, "unit": "BOR", "purchase_price": 4650.00, "selling_price": 5000.00, "mrp": 5400.00, "printed_amount": 4650.00, "is_grocery": True},
                {"product_name": "WHEAT 50 KG", "brand": None, "quantity": 1.0, "unit": "BOR", "purchase_price": 1780.00, "selling_price": 1950.00, "mrp": 2200.00, "printed_amount": 1780.00, "is_grocery": True},
                {"product_name": "JEERA 1 KG", "brand": None, "quantity": 1.0, "unit": "KG", "purchase_price": 610.00, "selling_price": 680.00, "mrp": 750.00, "printed_amount": 610.00, "is_grocery": True},
            ],
        }

    # TC14 Non-Grocery Tools
    tools_src = ROOT_DIR / "tests" / "fixtures" / "invoices" / "original_invoice_13items.jpeg"
    if tools_src.exists():
        shutil.copy(tools_src, INVOICES_DIR / "TC14_non_grocery_tools.jpeg")
        ground_truth["TC14_non_grocery_tools"] = {
            "invoice_id": "TC14_non_grocery_tools",
            "filename": "TC14_non_grocery_tools.jpeg",
            "layout_type": "industrial_non_grocery_bill",
            "supplier_name": "Gujarat Freight Tools",
            "invoice_number": "GFT-2024",
            "grand_total": 45000.0,
            "items": [], # Industrial parts, all non-grocery
        }

    # -------------------------------------------------------------
    # 2. GENERATE COMPLEMENTARY GROUND TRUTH INVOICES (TC15 to TC32)
    # -------------------------------------------------------------

    # TC15: Decimal Quantities
    cols15 = [("Description", 50), ("Qty", 480), ("Unit", 580), ("Rate", 680), ("MRP", 800), ("Amount", 940)]
    rows15 = [
        ["India Gate Basmati Rice", "1.25", "kg", "160.00", "200.00", "200.00"],
        ["Royal Cashew Nuts W320", "0.75", "kg", "880.00", "1100.00", "660.00"],
        ["Tata Sampann Moong Dal", "2.50", "kg", "140.00", "175.00", "350.00"],
    ]
    create_table_invoice_image("TC15_decimal_quantities.png", "Mahalaxmi Kirana Store", "MLX-8801", "02/11/2026", cols15, rows15, "1,210.00")
    ground_truth["TC15_decimal_quantities"] = {
        "invoice_id": "TC15_decimal_quantities",
        "filename": "TC15_decimal_quantities.png",
        "layout_type": "decimal_quantities_png",
        "supplier_name": "Mahalaxmi Kirana Store",
        "invoice_number": "MLX-8801",
        "grand_total": 1210.0,
        "items": [
            {"product_name": "India Gate Basmati Rice", "quantity": 1.25, "unit": "kg", "purchase_price": 160.0, "mrp": 200.0, "printed_amount": 200.0, "is_grocery": True},
            {"product_name": "Royal Cashew Nuts W320", "quantity": 0.75, "unit": "kg", "purchase_price": 880.0, "mrp": 1100.0, "printed_amount": 660.0, "is_grocery": True},
            {"product_name": "Tata Sampann Moong Dal", "quantity": 2.50, "unit": "kg", "purchase_price": 140.0, "mrp": 175.0, "printed_amount": 350.0, "is_grocery": True},
        ],
    }

    # TC16: Borderless Table (whitespace separated)
    cols16 = [("Particulars", 50), ("Quantity", 450), ("UOM", 560), ("Price", 660), ("Total", 880)]
    rows16 = [
        ["Aashirvaad Shudh Chakki Atta 10kg", "5", "bag", "380.00", "1900.00"],
        ["Madhur Pure Sugar 5kg", "8", "pkt", "225.00", "1800.00"],
        ["Fortune Sunlite Sunflower Oil 1L", "15", "pcs", "135.00", "2025.00"],
        ["Tata Salt Vacuum Evaporated 1kg", "30", "pkt", "23.00", "690.00"],
    ]
    create_table_invoice_image("TC16_borderless_table.png", "Apex Grain Wholesalers", "APX-4410", "01/11/2026", cols16, rows16, "6,415.00", bordered=False)
    ground_truth["TC16_borderless_table"] = {
        "invoice_id": "TC16_borderless_table",
        "filename": "TC16_borderless_table.png",
        "layout_type": "borderless_table_png",
        "supplier_name": "Apex Grain Wholesalers",
        "invoice_number": "APX-4410",
        "grand_total": 6415.0,
        "items": [
            {"product_name": "Aashirvaad Shudh Chakki Atta 10kg", "quantity": 5.0, "unit": "bag", "purchase_price": 380.0, "mrp": None, "printed_amount": 1900.0, "is_grocery": True},
            {"product_name": "Madhur Pure Sugar 5kg", "quantity": 8.0, "unit": "pkt", "purchase_price": 225.0, "mrp": None, "printed_amount": 1800.0, "is_grocery": True},
            {"product_name": "Fortune Sunlite Sunflower Oil 1L", "quantity": 15.0, "unit": "pcs", "purchase_price": 135.0, "mrp": None, "printed_amount": 2025.0, "is_grocery": True},
            {"product_name": "Tata Salt Vacuum Evaporated 1kg", "quantity": 30.0, "unit": "pkt", "purchase_price": 23.0, "mrp": None, "printed_amount": 690.0, "is_grocery": True},
        ],
    }

    # TC17: Multi-tier GST (0%, 5%, 12%, 18%)
    cols17 = [("Item Name", 50), ("Qty", 420), ("Rate", 510), ("GST%", 610), ("Tax", 710), ("Net Amount", 860)]
    rows17 = [
        ["Aashirvaad Atta 5kg", "4", "245.00", "0%", "0.00", "980.00"],
        ["Fortune Sunflower Oil 1L", "10", "140.00", "5%", "70.00", "1470.00"],
        ["Amul Pure Ghee 1L", "6", "580.00", "12%", "417.60", "3897.60"],
        ["Britannia Bourbon Biscuits", "20", "25.00", "18%", "90.00", "590.00"],
    ]
    create_table_invoice_image("TC17_multi_tier_gst.png", "Premier Consumer Brands", "PCB-5520", "28/10/2026", cols17, rows17, "6,937.60")
    ground_truth["TC17_multi_tier_gst"] = {
        "invoice_id": "TC17_multi_tier_gst",
        "filename": "TC17_multi_tier_gst.png",
        "layout_type": "multi_tier_gst_png",
        "supplier_name": "Premier Consumer Brands",
        "invoice_number": "PCB-5520",
        "grand_total": 6937.60,
        "items": [
            {"product_name": "Aashirvaad Atta 5kg", "quantity": 4.0, "purchase_price": 245.0, "gst_rate": 0.0, "printed_amount": 980.0, "is_grocery": True},
            {"product_name": "Fortune Sunflower Oil 1L", "quantity": 10.0, "purchase_price": 140.0, "gst_rate": 5.0, "printed_amount": 1470.0, "is_grocery": True},
            {"product_name": "Amul Pure Ghee 1L", "quantity": 6.0, "purchase_price": 580.0, "gst_rate": 12.0, "printed_amount": 3897.60, "is_grocery": True},
            {"product_name": "Britannia Bourbon Biscuits", "quantity": 20.0, "purchase_price": 25.0, "gst_rate": 18.0, "printed_amount": 590.0, "is_grocery": True},
        ],
    }

    # TC18: Trade and Cash Discount
    cols18 = [("Product", 50), ("Qty", 450), ("Rate", 540), ("Disc%", 650), ("Net Rate", 770), ("Line Total", 920)]
    rows18 = [
        ["Pillsbury Chakki Atta 10kg", "10", "410.00", "5%", "389.50", "3895.00"],
        ["MDH Garam Masala 100g", "25", "85.00", "8%", "78.20", "1955.00"],
        ["Brooke Bond Red Label Tea 1kg", "12", "480.00", "10%", "432.00", "5184.00"],
    ]
    create_table_invoice_image("TC18_trade_and_cash_discount.png", "Hindustan FMCG Supply", "HFS-9912", "30/10/2026", cols18, rows18, "11,034.00")
    ground_truth["TC18_trade_and_cash_discount"] = {
        "invoice_id": "TC18_trade_and_cash_discount",
        "filename": "TC18_trade_and_cash_discount.png",
        "layout_type": "trade_discount_png",
        "supplier_name": "Hindustan FMCG Supply",
        "invoice_number": "HFS-9912",
        "grand_total": 11034.0,
        "items": [
            {"product_name": "Pillsbury Chakki Atta 10kg", "quantity": 10.0, "purchase_price": 410.0, "discount": 5.0, "printed_amount": 3895.0, "is_grocery": True},
            {"product_name": "MDH Garam Masala 100g", "quantity": 25.0, "purchase_price": 85.0, "discount": 8.0, "printed_amount": 1955.0, "is_grocery": True},
            {"product_name": "Brooke Bond Red Label Tea 1kg", "quantity": 12.0, "purchase_price": 480.0, "discount": 10.0, "printed_amount": 5184.0, "is_grocery": True},
        ],
    }

    # TC19: Mixed Grocery & Non-Grocery
    cols19 = [("Item Description", 50), ("Qty", 480), ("Unit", 570), ("Rate", 670), ("Amount", 850)]
    rows19 = [
        ["Tata Sampann Toor Dal 1kg", "15", "pkt", "165.00", "2475.00"],
        ["Ariel Matic Front Load 2kg", "6", "box", "490.00", "2940.00"],
        ["Vim Dishwash Bar 300g", "30", "pcs", "28.00", "840.00"],
        ["Plastic Storage Bucket 20L", "4", "pcs", "180.00", "720.00"],
    ]
    create_table_invoice_image("TC19_mixed_grocery_fmcg.png", "City Super Mart Wholesalers", "CSM-7714", "25/10/2026", cols19, rows19, "6,975.00")
    ground_truth["TC19_mixed_grocery_fmcg"] = {
        "invoice_id": "TC19_mixed_grocery_fmcg",
        "filename": "TC19_mixed_grocery_fmcg.png",
        "layout_type": "mixed_fmcg_png",
        "supplier_name": "City Super Mart Wholesalers",
        "invoice_number": "CSM-7714",
        "grand_total": 6975.0,
        "items": [
            {"product_name": "Tata Sampann Toor Dal 1kg", "quantity": 15.0, "unit": "pkt", "purchase_price": 165.0, "printed_amount": 2475.0, "is_grocery": True},
            {"product_name": "Ariel Matic Front Load 2kg", "quantity": 6.0, "unit": "box", "purchase_price": 490.0, "printed_amount": 2940.0, "is_grocery": False},
            {"product_name": "Vim Dishwash Bar 300g", "quantity": 30.0, "unit": "pcs", "purchase_price": 28.0, "printed_amount": 840.0, "is_grocery": False},
            {"product_name": "Plastic Storage Bucket 20L", "quantity": 4.0, "unit": "pcs", "purchase_price": 180.0, "printed_amount": 720.0, "is_grocery": False},
        ],
    }

    # TC20: Faded Thermal Receipt
    cols20 = [("Item", 40), ("Qty", 320), ("Rate", 410), ("Amount", 530)]
    rows20 = [
        ["Tata Salt 1kg", "5", "22.00", "110.00"],
        ["Sugar 1kg", "3", "42.00", "126.00"],
        ["Fortune Besan 500g", "2", "68.00", "136.00"],
    ]
    create_table_invoice_image("TC20_faded_thermal_receipt.png", "Gupta Kirana Store", "RCP-119", "02/11/2026", cols20, rows20, "372.00", bordered=False, width=700, faded=True)
    ground_truth["TC20_faded_thermal_receipt"] = {
        "invoice_id": "TC20_faded_thermal_receipt",
        "filename": "TC20_faded_thermal_receipt.png",
        "layout_type": "faded_thermal_receipt",
        "supplier_name": "Gupta Kirana Store",
        "invoice_number": "RCP-119",
        "grand_total": 372.0,
        "items": [
            {"product_name": "Tata Salt 1kg", "quantity": 5.0, "purchase_price": 22.0, "printed_amount": 110.0, "is_grocery": True},
            {"product_name": "Sugar 1kg", "quantity": 3.0, "purchase_price": 42.0, "printed_amount": 126.0, "is_grocery": True},
            {"product_name": "Fortune Besan 500g", "quantity": 2.0, "purchase_price": 68.0, "printed_amount": 136.0, "is_grocery": True},
        ],
    }

    # TC21: Rotated Skewed Invoice (12 degrees)
    cols21 = [("Description", 50), ("Qty", 480), ("Price", 620), ("Amount", 780)]
    rows21 = [
        ["Fortune Mustard Oil 1L", "8", "145.00", "1160.00"],
        ["Aashirvaad Atta 10kg", "5", "375.00", "1875.00"],
        ["Tata Tea Gold 500g", "6", "290.00", "1740.00"],
    ]
    create_table_invoice_image("TC21_rotated_skewed.png", "North Agro Wholesalers", "NAW-6601", "29/10/2026", cols21, rows21, "4,775.00", rotate_angle=12.0)
    ground_truth["TC21_rotated_skewed"] = {
        "invoice_id": "TC21_rotated_skewed",
        "filename": "TC21_rotated_skewed.png",
        "layout_type": "rotated_image_png",
        "supplier_name": "North Agro Wholesalers",
        "invoice_number": "NAW-6601",
        "grand_total": 4775.0,
        "items": [
            {"product_name": "Fortune Mustard Oil 1L", "quantity": 8.0, "purchase_price": 145.0, "printed_amount": 1160.0, "is_grocery": True},
            {"product_name": "Aashirvaad Atta 10kg", "quantity": 5.0, "purchase_price": 375.0, "printed_amount": 1875.0, "is_grocery": True},
            {"product_name": "Tata Tea Gold 500g", "quantity": 6.0, "purchase_price": 290.0, "printed_amount": 1740.0, "is_grocery": True},
        ],
    }

    # TC22: Diverse Pack Sizes
    cols22 = [("Particulars", 50), ("Qty", 450), ("Unit", 550), ("Rate", 660), ("MRP", 780), ("Total", 920)]
    rows22 = [
        ["Gemini Sunflower Oil 5L", "4", "can", "640.00", "750.00", "2560.00"],
        ["Tata Tea Gold 250g", "20", "pkt", "145.00", "175.00", "2900.00"],
        ["Dabur Honey 500g", "12", "jar", "190.00", "235.00", "2280.00"],
        ["Kissan Mixed Jam 200g", "15", "jar", "70.00", "85.00", "1050.00"],
    ]
    create_table_invoice_image("TC22_diverse_pack_sizes.png", "United Packaged Goods", "UPG-3118", "01/11/2026", cols22, rows22, "8,790.00")
    ground_truth["TC22_diverse_pack_sizes"] = {
        "invoice_id": "TC22_diverse_pack_sizes",
        "filename": "TC22_diverse_pack_sizes.png",
        "layout_type": "pack_sizes_png",
        "supplier_name": "United Packaged Goods",
        "invoice_number": "UPG-3118",
        "grand_total": 8790.0,
        "items": [
            {"product_name": "Gemini Sunflower Oil 5L", "pack_size": "5L", "quantity": 4.0, "unit": "can", "purchase_price": 640.0, "mrp": 750.0, "printed_amount": 2560.0, "is_grocery": True},
            {"product_name": "Tata Tea Gold 250g", "pack_size": "250g", "quantity": 20.0, "unit": "pkt", "purchase_price": 145.0, "mrp": 175.0, "printed_amount": 2900.0, "is_grocery": True},
            {"product_name": "Dabur Honey 500g", "pack_size": "500g", "quantity": 12.0, "unit": "jar", "purchase_price": 190.0, "mrp": 235.0, "printed_amount": 2280.0, "is_grocery": True},
            {"product_name": "Kissan Mixed Jam 200g", "pack_size": "200g", "quantity": 15.0, "unit": "jar", "purchase_price": 70.0, "mrp": 85.0, "printed_amount": 1050.0, "is_grocery": True},
        ],
    }

    # TC23: Regional Spices Wholesale
    cols23 = [("Spice Name", 50), ("Qty", 480), ("Unit", 580), ("Rate", 680), ("Amount", 860)]
    rows23 = [
        ["Everest Turmeric Powder 100g", "30", "pkt", "32.00", "960.00"],
        ["MDH Deggi Mirch 100g", "25", "pkt", "78.00", "1950.00"],
        ["Catch Black Pepper Powder 50g", "20", "pkt", "65.00", "1300.00"],
        ["Tata Sampann Coriander 200g", "20", "pkt", "48.00", "960.00"],
    ]
    create_table_invoice_image("TC23_regional_spices.png", "Spice Valley Traders", "SVT-209", "31/10/2026", cols23, rows23, "5,170.00")
    ground_truth["TC23_regional_spices"] = {
        "invoice_id": "TC23_regional_spices",
        "filename": "TC23_regional_spices.png",
        "layout_type": "spices_bill_png",
        "supplier_name": "Spice Valley Traders",
        "invoice_number": "SVT-209",
        "grand_total": 5170.0,
        "items": [
            {"product_name": "Everest Turmeric Powder 100g", "brand": "Everest", "quantity": 30.0, "unit": "pkt", "purchase_price": 32.0, "printed_amount": 960.0, "is_grocery": True},
            {"product_name": "MDH Deggi Mirch 100g", "brand": "MDH", "quantity": 25.0, "unit": "pkt", "purchase_price": 78.0, "printed_amount": 1950.0, "is_grocery": True},
            {"product_name": "Catch Black Pepper Powder 50g", "brand": "Catch", "quantity": 20.0, "unit": "pkt", "purchase_price": 65.0, "printed_amount": 1300.0, "is_grocery": True},
            {"product_name": "Tata Sampann Coriander 200g", "brand": "Tata Sampann", "quantity": 20.0, "unit": "pkt", "purchase_price": 48.0, "printed_amount": 960.0, "is_grocery": True},
        ],
    }

    # TC24: Dairy and Staples
    cols24 = [("Particulars", 50), ("Quantity", 450), ("Rate", 580), ("MRP", 720), ("Total Amount", 880)]
    rows24 = [
        ["Amul Pasteurised Butter 500g", "12", "260.00", "285.00", "3120.00"],
        ["Mother Dairy Cow Ghee 1L", "8", "610.00", "675.00", "4880.00"],
        ["Fortune Soya Health Oil 1L", "15", "125.00", "150.00", "1875.00"],
        ["Aashirvaad Multigrain Atta 5kg", "6", "295.00", "340.00", "1770.00"],
    ]
    create_table_invoice_image("TC24_dairy_and_staples.png", "Heritage Food Distributors", "HFD-8890", "01/11/2026", cols24, rows24, "11,645.00")
    ground_truth["TC24_dairy_and_staples"] = {
        "invoice_id": "TC24_dairy_and_staples",
        "filename": "TC24_dairy_and_staples.png",
        "layout_type": "dairy_staples_png",
        "supplier_name": "Heritage Food Distributors",
        "invoice_number": "HFD-8890",
        "grand_total": 11645.0,
        "items": [
            {"product_name": "Amul Pasteurised Butter 500g", "brand": "Amul", "quantity": 12.0, "purchase_price": 260.0, "mrp": 285.0, "printed_amount": 3120.0, "is_grocery": True},
            {"product_name": "Mother Dairy Cow Ghee 1L", "brand": "Mother Dairy", "quantity": 8.0, "purchase_price": 610.0, "mrp": 675.0, "printed_amount": 4880.0, "is_grocery": True},
            {"product_name": "Fortune Soya Health Oil 1L", "brand": "Fortune", "quantity": 15.0, "purchase_price": 125.0, "mrp": 150.0, "printed_amount": 1875.0, "is_grocery": True},
            {"product_name": "Aashirvaad Multigrain Atta 5kg", "brand": "Aashirvaad", "quantity": 6.0, "purchase_price": 295.0, "mrp": 340.0, "printed_amount": 1770.0, "is_grocery": True},
        ],
    }

    # TC25: Split Column Headers
    cols25 = [("Description of Goods", 50), ("Qty", 480), ("Unit Price", 600), ("Total (INR)", 820)]
    rows25 = [
        ["Fortune Besan 1kg", "10", "130.00", "1300.00"],
        ["Tata Salt Lite 1kg", "15", "40.00", "600.00"],
        ["Saffola Gold Edible Oil 2L", "5", "380.00", "1900.00"],
    ]
    create_table_invoice_image("TC25_split_column_headers.png", "Reliance Retail B2B", "RRB-9011", "30/10/2026", cols25, rows25, "3,800.00")
    ground_truth["TC25_split_column_headers"] = {
        "invoice_id": "TC25_split_column_headers",
        "filename": "TC25_split_column_headers.png",
        "layout_type": "split_headers_png",
        "supplier_name": "Reliance Retail B2B",
        "invoice_number": "RRB-9011",
        "grand_total": 3800.0,
        "items": [
            {"product_name": "Fortune Besan 1kg", "quantity": 10.0, "purchase_price": 130.0, "printed_amount": 1300.0, "is_grocery": True},
            {"product_name": "Tata Salt Lite 1kg", "quantity": 15.0, "purchase_price": 40.0, "printed_amount": 600.0, "is_grocery": True},
            {"product_name": "Saffola Gold Edible Oil 2L", "quantity": 5.0, "purchase_price": 380.0, "printed_amount": 1900.0, "is_grocery": True},
        ],
    }

    # TC26: Promotional Free Goods (Scheme)
    cols26 = [("Item Name", 50), ("Billed Qty", 420), ("Free Qty", 540), ("Rate", 660), ("Amount", 840)]
    rows26 = [
        ["Parle Monaco Biscuits 120g", "20", "4", "18.00", "360.00"],
        ["Dettol Original Soap 75g", "30", "6", "35.00", "1050.00"],
        ["Tata Tea Premium 250g", "10", "1", "120.00", "1200.00"],
    ]
    create_table_invoice_image("TC26_promotional_scheme.png", "National FMCG Distributors", "NFD-7781", "29/10/2026", cols26, rows26, "2,610.00")
    ground_truth["TC26_promotional_scheme"] = {
        "invoice_id": "TC26_promotional_scheme",
        "filename": "TC26_promotional_scheme.png",
        "layout_type": "scheme_invoice_png",
        "supplier_name": "National FMCG Distributors",
        "invoice_number": "NFD-7781",
        "grand_total": 2610.0,
        "items": [
            {"product_name": "Parle Monaco Biscuits 120g", "quantity": 20.0, "purchase_price": 18.0, "printed_amount": 360.0, "is_grocery": True},
            {"product_name": "Dettol Original Soap 75g", "quantity": 30.0, "purchase_price": 35.0, "printed_amount": 1050.0, "is_grocery": False},
            {"product_name": "Tata Tea Premium 250g", "quantity": 10.0, "purchase_price": 120.0, "printed_amount": 1200.0, "is_grocery": True},
        ],
    }

    # TC27: South Indian Staples
    cols27 = [("Item Description", 50), ("Qty", 480), ("Unit", 580), ("Rate", 680), ("Amount", 860)]
    rows27 = [
        ["Ponni Boiled Rice 25kg", "4", "bag", "1350.00", "5400.00"],
        ["Urad Gota Whole 1kg", "15", "pkt", "130.00", "1950.00"],
        ["Roasted Bengal Gram 500g", "20", "pkt", "45.00", "900.00"],
        ["Idli Rava 1kg", "12", "pkt", "42.00", "504.00"],
    ]
    create_table_invoice_image("TC27_south_indian_staples.png", "Sri Meenakshi Traders", "SMT-4409", "31/10/2026", cols27, rows27, "8,754.00")
    ground_truth["TC27_south_indian_staples"] = {
        "invoice_id": "TC27_south_indian_staples",
        "filename": "TC27_south_indian_staples.png",
        "layout_type": "staples_bill_png",
        "supplier_name": "Sri Meenakshi Traders",
        "invoice_number": "SMT-4409",
        "grand_total": 8754.0,
        "items": [
            {"product_name": "Ponni Boiled Rice 25kg", "quantity": 4.0, "unit": "bag", "purchase_price": 1350.0, "printed_amount": 5400.0, "is_grocery": True},
            {"product_name": "Urad Gota Whole 1kg", "quantity": 15.0, "unit": "pkt", "purchase_price": 130.0, "printed_amount": 1950.0, "is_grocery": True},
            {"product_name": "Roasted Bengal Gram 500g", "quantity": 20.0, "unit": "pkt", "purchase_price": 45.0, "printed_amount": 900.0, "is_grocery": True},
            {"product_name": "Idli Rava 1kg", "quantity": 12.0, "unit": "pkt", "purchase_price": 42.0, "printed_amount": 504.0, "is_grocery": True},
        ],
    }

    # TC28: Bakery and Confectionery
    cols28 = [("Particulars", 50), ("Qty", 480), ("Unit", 580), ("Rate", 680), ("MRP", 790), ("Total", 920)]
    rows28 = [
        ["Britannia Good Day Cashew 200g", "24", "pkt", "38.00", "45.00", "912.00"],
        ["Parle Hide & Seek Chocolate 120g", "30", "pkt", "42.00", "50.00", "1260.00"],
        ["Cadbury Oreo Vanilla 120g", "24", "pkt", "32.00", "40.00", "768.00"],
        ["Britannia Premium Bake Toast 250g", "15", "pkt", "48.00", "60.00", "720.00"],
    ]
    create_table_invoice_image("TC28_bakery_confectionery.png", "Metro Cash & Carry", "MCC-1002", "01/11/2026", cols28, rows28, "3,660.00")
    ground_truth["TC28_bakery_confectionery"] = {
        "invoice_id": "TC28_bakery_confectionery",
        "filename": "TC28_bakery_confectionery.png",
        "layout_type": "bakery_png",
        "supplier_name": "Metro Cash & Carry",
        "invoice_number": "MCC-1002",
        "grand_total": 3660.0,
        "items": [
            {"product_name": "Britannia Good Day Cashew 200g", "brand": "Britannia", "quantity": 24.0, "unit": "pkt", "purchase_price": 38.0, "mrp": 45.0, "printed_amount": 912.0, "is_grocery": True},
            {"product_name": "Parle Hide & Seek Chocolate 120g", "brand": "Parle", "quantity": 30.0, "unit": "pkt", "purchase_price": 42.0, "mrp": 50.0, "printed_amount": 1260.0, "is_grocery": True},
            {"product_name": "Cadbury Oreo Vanilla 120g", "brand": "Cadbury", "quantity": 24.0, "unit": "pkt", "purchase_price": 32.0, "mrp": 40.0, "printed_amount": 768.0, "is_grocery": True},
            {"product_name": "Britannia Premium Bake Toast 250g", "brand": "Britannia", "quantity": 15.0, "unit": "pkt", "purchase_price": 48.0, "mrp": 60.0, "printed_amount": 720.0, "is_grocery": True},
        ],
    }

    # TC29: Flours and Pulses
    cols29 = [("Item Description", 50), ("Qty", 480), ("Unit", 580), ("Price", 680), ("Amount", 860)]
    rows29 = [
        ["Rajdhani Maida 1kg", "20", "pkt", "38.00", "760.00"],
        ["Rajdhani Sooji 500g", "25", "pkt", "26.00", "650.00"],
        ["Tata Sampann Kabuli Chana 1kg", "10", "pkt", "148.00", "1480.00"],
        ["Fortune Soya Chunks 200g", "30", "pkt", "22.00", "660.00"],
    ]
    create_table_invoice_image("TC29_flours_and_pulses.png", "Ganesh Flour Mills & Grains", "GFM-332", "27/10/2026", cols29, rows29, "3,550.00")
    ground_truth["TC29_flours_and_pulses"] = {
        "invoice_id": "TC29_flours_and_pulses",
        "filename": "TC29_flours_and_pulses.png",
        "layout_type": "flours_pulses_png",
        "supplier_name": "Ganesh Flour Mills & Grains",
        "invoice_number": "GFM-332",
        "grand_total": 3550.0,
        "items": [
            {"product_name": "Rajdhani Maida 1kg", "brand": "Rajdhani", "quantity": 20.0, "unit": "pkt", "purchase_price": 38.0, "printed_amount": 760.0, "is_grocery": True},
            {"product_name": "Rajdhani Sooji 500g", "brand": "Rajdhani", "quantity": 25.0, "unit": "pkt", "purchase_price": 26.0, "printed_amount": 650.0, "is_grocery": True},
            {"product_name": "Tata Sampann Kabuli Chana 1kg", "brand": "Tata Sampann", "quantity": 10.0, "unit": "pkt", "purchase_price": 148.0, "printed_amount": 1480.0, "is_grocery": True},
            {"product_name": "Fortune Soya Chunks 200g", "brand": "Fortune", "quantity": 30.0, "unit": "pkt", "purchase_price": 22.0, "printed_amount": 660.0, "is_grocery": True},
        ],
    }

    # TC30: Beverages and Breakfast
    cols30 = [("Product Name", 50), ("Qty", 480), ("Unit", 580), ("Rate", 680), ("MRP", 790), ("Amount", 920)]
    rows30 = [
        ["Nescafe Classic Coffee 50g", "15", "jar", "175.00", "210.00", "2625.00"],
        ["Kellogg's Corn Flakes 475g", "10", "box", "165.00", "195.00", "1650.00"],
        ["Bournvita Health Drink 500g", "12", "jar", "215.00", "255.00", "2580.00"],
        ["Taj Mahal Tea 250g", "20", "pkt", "160.00", "190.00", "3200.00"],
    ]
    create_table_invoice_image("TC30_beverages_breakfast.png", "Modern Trade Supplies", "MTS-5012", "01/11/2026", cols30, rows30, "10,055.00")
    ground_truth["TC30_beverages_breakfast"] = {
        "invoice_id": "TC30_beverages_breakfast",
        "filename": "TC30_beverages_breakfast.png",
        "layout_type": "beverages_png",
        "supplier_name": "Modern Trade Supplies",
        "invoice_number": "MTS-5012",
        "grand_total": 10055.0,
        "items": [
            {"product_name": "Nescafe Classic Coffee 50g", "brand": "Nescafe", "quantity": 15.0, "unit": "jar", "purchase_price": 175.0, "mrp": 210.0, "printed_amount": 2625.0, "is_grocery": True},
            {"product_name": "Kellogg's Corn Flakes 475g", "brand": "Kellogg's", "quantity": 10.0, "unit": "box", "purchase_price": 165.0, "mrp": 195.0, "printed_amount": 1650.0, "is_grocery": True},
            {"product_name": "Bournvita Health Drink 500g", "brand": "Bournvita", "quantity": 12.0, "unit": "jar", "purchase_price": 215.0, "mrp": 255.0, "printed_amount": 2580.0, "is_grocery": True},
            {"product_name": "Taj Mahal Tea 250g", "brand": "Taj Mahal", "quantity": 20.0, "unit": "pkt", "purchase_price": 160.0, "mrp": 190.0, "printed_amount": 3200.0, "is_grocery": True},
        ],
    }

    # TC31: High Density Compact (10 items)
    cols31 = [("Description", 50), ("Qty", 480), ("Rate", 600), ("Total", 800)]
    rows31 = [
        ["Tata Salt 1kg", "50", "22.00", "1100.00"],
        ["Fortune Besan 500g", "20", "70.00", "1400.00"],
        ["Aashirvaad Atta 5kg", "10", "245.00", "2450.00"],
        ["Fortune Sunflower Oil 1L", "24", "140.00", "3360.00"],
        ["Parle-G Biscuits 250g", "48", "9.50", "456.00"],
        ["Maggi Noodles 70g", "72", "11.00", "792.00"],
        ["Sugar M30 1kg", "40", "42.00", "1680.00"],
        ["Toor Dal Fatka 1kg", "15", "160.00", "2400.00"],
        ["Everest Turmeric 100g", "25", "32.00", "800.00"],
        ["Red Label Tea 250g", "15", "130.00", "1950.00"],
    ]
    create_table_invoice_image("TC31_high_density_compact.png", "Central Super Kirana Restock", "CSK-881", "02/11/2026", cols31, rows31, "16,388.00")
    ground_truth["TC31_high_density_compact"] = {
        "invoice_id": "TC31_high_density_compact",
        "filename": "TC31_high_density_compact.png",
        "layout_type": "high_density_png",
        "supplier_name": "Central Super Kirana Restock",
        "invoice_number": "CSK-881",
        "grand_total": 16388.0,
        "items": [
            {"product_name": "Tata Salt 1kg", "quantity": 50.0, "purchase_price": 22.0, "printed_amount": 1100.0, "is_grocery": True},
            {"product_name": "Fortune Besan 500g", "quantity": 20.0, "purchase_price": 70.0, "printed_amount": 1400.0, "is_grocery": True},
            {"product_name": "Aashirvaad Atta 5kg", "quantity": 10.0, "purchase_price": 245.0, "printed_amount": 2450.0, "is_grocery": True},
            {"product_name": "Fortune Sunflower Oil 1L", "quantity": 24.0, "purchase_price": 140.0, "printed_amount": 3360.0, "is_grocery": True},
            {"product_name": "Parle-G Biscuits 250g", "quantity": 48.0, "purchase_price": 9.5, "printed_amount": 456.0, "is_grocery": True},
            {"product_name": "Maggi Noodles 70g", "quantity": 72.0, "purchase_price": 11.0, "printed_amount": 792.0, "is_grocery": True},
            {"product_name": "Sugar M30 1kg", "quantity": 40.0, "purchase_price": 42.0, "printed_amount": 1680.0, "is_grocery": True},
            {"product_name": "Toor Dal Fatka 1kg", "quantity": 15.0, "purchase_price": 160.0, "printed_amount": 2400.0, "is_grocery": True},
            {"product_name": "Everest Turmeric 100g", "quantity": 25.0, "purchase_price": 32.0, "printed_amount": 800.0, "is_grocery": True},
            {"product_name": "Red Label Tea 250g", "quantity": 15.0, "purchase_price": 130.0, "printed_amount": 1950.0, "is_grocery": True},
        ],
    }

    # TC32: Alternate Column Order [Rate, Qty, Total, Particulars, MRP]
    cols32 = [("Rate", 50), ("Qty", 180), ("Total", 300), ("Particulars", 450), ("MRP", 900)]
    rows32 = [
        ["22.00", "20", "440.00", "Tata Salt 1kg", "28.00"],
        ["70.00", "10", "700.00", "Fortune Besan 500g", "90.00"],
        ["245.00", "4", "980.00", "Aashirvaad Atta 5kg", "289.00"],
    ]
    create_table_invoice_image("TC32_alternate_column_order.png", "Custom Layout Wholesalers", "CLW-9901", "02/11/2026", cols32, rows32, "2,120.00")
    ground_truth["TC32_alternate_column_order"] = {
        "invoice_id": "TC32_alternate_column_order",
        "filename": "TC32_alternate_column_order.png",
        "layout_type": "alternate_columns_png",
        "supplier_name": "Custom Layout Wholesalers",
        "invoice_number": "CLW-9901",
        "grand_total": 2120.0,
        "items": [
            {"product_name": "Tata Salt 1kg", "quantity": 20.0, "purchase_price": 22.0, "mrp": 28.0, "printed_amount": 440.0, "is_grocery": True},
            {"product_name": "Fortune Besan 500g", "quantity": 10.0, "purchase_price": 70.0, "mrp": 90.0, "printed_amount": 700.0, "is_grocery": True},
            {"product_name": "Aashirvaad Atta 5kg", "quantity": 4.0, "purchase_price": 245.0, "mrp": 289.0, "printed_amount": 980.0, "is_grocery": True},
        ],
    }

    # Save Master Ground Truth Annotations JSON
    with open(ANNOTATIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, indent=2, ensure_ascii=False)

    print(f"Dataset generation complete! Total invoices compiled: {len(ground_truth)}")
    total_items = sum(len(inv["items"]) for inv in ground_truth.values())
    print(f"Total ground truth items annotated: {total_items}")

if __name__ == "__main__":
    build_dataset()

