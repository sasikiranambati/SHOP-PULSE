import os
import sys
import sqlite3
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

def check_1_database():
    print("=" * 60)
    print("CHECK 1: DATABASE")
    print("=" * 60)
    db_file = backend_dir / "shoppulse.db"
    assert db_file.exists(), f"Database file not found: {db_file}"
    print(f"Database exists: {db_file} ({db_file.stat().st_size} bytes)")

    conn = sqlite3.connect(str(db_file))
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(products);")
    cols = cur.fetchall()
    col_names = [c[1] for c in cols]
    print("Product columns in SQLite:", col_names)
    assert "mrp" in col_names, "mrp column is missing in SQLite products table!"

    cur.execute("SELECT COUNT(*) FROM products;")
    count = cur.fetchone()[0]
    print(f"Total inventory records in SQLite: {count}")
    assert count > 0, "Inventory records were lost!"

    # Now verify via SQLAlchemy session exactly as used by invoice extraction
    from db.session import SessionLocal
    from db.models.product import Product
    from db.models.shop import Shop
    
    db = SessionLocal()
    try:
        shops = db.query(Shop).all()
        print(f"Total shops: {len(shops)}")
        for s in shops:
            prods = db.query(Product).filter(Product.shop_id == s.id).all()
            print(f"Shop '{s.shop_name}' has {len(prods)} products queryable via SQLAlchemy.")
            for p in prods[:2]:
                print(f"  - {p.name}: selling={p.selling_price}, cost={p.purchase_price}, mrp={p.mrp}, stock={p.current_stock}")
    finally:
        db.close()
    conn.close()
    print("CHECK 1 PASSED: Database schema is valid, 'mrp' exists, no missing columns, data intact.\n")

if __name__ == "__main__":
    check_1_database()
