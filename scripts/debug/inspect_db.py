import sqlite3
import sys

con = sqlite3.connect('backend/shoppulse.db')
cur = con.cursor()
tables = [t[0] for t in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables in shoppulse.db:")
for t in tables:
    if not t.startswith("sqlite_"):
        count = cur.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
        print(f"  {t}: {count} rows")

print("\nUsers sample:")
for row in cur.execute("SELECT id, email FROM users LIMIT 5").fetchall():
    print(" ", row)

print("\nShops sample:")
for row in cur.execute("SELECT id, shop_name, owner_id FROM shops LIMIT 5").fetchall():
    print(" ", row)

print("\nProducts sample:")
for row in cur.execute("SELECT id, name, category, current_stock, selling_price, shop_id FROM products LIMIT 5").fetchall():
    print(" ", row)

print("\nSales sample:")
for row in cur.execute("SELECT id, total_amount, shop_id, created_at FROM sales LIMIT 5").fetchall():
    print(" ", row)

con.close()
