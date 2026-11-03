import sqlite3

conn = sqlite3.connect('backend/shoppulse.db')
c = conn.cursor()

print("Shops and Users:")
for row in c.execute("SELECT s.id, s.shop_name, s.owner_name, u.email FROM shops s JOIN users u ON s.owner_id=u.id").fetchall():
    print(" ", row)

print("\nSales summary by date:")
for row in c.execute("SELECT substr(created_at, 1, 10) as d, count(*), sum(total_amount) FROM sales GROUP BY d ORDER BY d DESC").fetchall():
    print(" ", row)
