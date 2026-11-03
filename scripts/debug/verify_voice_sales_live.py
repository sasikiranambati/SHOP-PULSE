import httpx
import uuid

BASE_URL = "http://127.0.0.1:8000"

def test_live_voice_to_bill_sales_and_stock():
    print("=" * 70)
    print("LIVE INTEGRATION VERIFICATION: Voice-to-Bill -> Sales -> Inventory")
    print("=" * 70)
    
    with httpx.Client(base_url=BASE_URL, timeout=15.0) as client:
        # 1. Health check
        h_res = client.get("/api/v1/health")
        assert h_res.status_code == 200, f"Health check failed: {h_res.text}"
        print(f"1. Health check: OK -> {h_res.json()}")

        # 2. Register & login a unique test user
        rand_id = uuid.uuid4().hex[:6]
        email = f"voice_tester_{rand_id}@example.com"
        pwd = "password123"

        reg_res = client.post("/api/v1/auth/register", json={"email": email, "password": pwd})
        assert reg_res.status_code == 201, f"Register failed: {reg_res.text}"
        
        login_res = client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
        assert login_res.status_code == 200, f"Login failed: {login_res.text}"
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print(f"2. Auth: Registered & logged in as {email}")

        # 3. Create shop
        shop_res = client.post("/api/v1/shops", json={
            "shop_name": "Balaji Provisions Store",
            "owner_name": "Balaji Rao",
            "business_type": "Grocery/Kirana",
            "location": "Dilsukhnagar, Hyderabad"
        }, headers=headers)
        assert shop_res.status_code == 201, f"Create shop failed: {shop_res.text}"
        shop_id = shop_res.json()["id"]
        print(f"3. Shop profile created: {shop_res.json()['shop_name']} ({shop_id})")

        # 4. Create products
        # Tata Salt 1kg: 40 stock @ ₹28
        p1_res = client.post("/api/v1/products", json={
            "name": "Tata Salt 1kg",
            "category": "Staples",
            "selling_price": 28.0,
            "purchase_price": 22.0,
            "current_stock": 40,
            "unit": "pkt"
        }, headers=headers)
        salt_id = p1_res.json()["id"]

        # Fortune Sunflower Oil (1L): 20 stock @ ₹165
        p2_res = client.post("/api/v1/products", json={
            "name": "Fortune Sunflower Oil (1L)",
            "category": "Oils",
            "selling_price": 165.0,
            "purchase_price": 140.0,
            "current_stock": 20,
            "unit": "pouch"
        }, headers=headers)
        oil_id = p2_res.json()["id"]

        print(f"4. Seeded Inventory:")
        print(f"   - Tata Salt 1kg: Stock = 40, Price = Rs.28")
        print(f"   - Fortune Sunflower Oil (1L): Stock = 20, Price = Rs.165")

        # 5. Voice Input Processing (Simulated multilingual spoken speech)
        voice_query = "2 Tata Salt 1kg and 1 Fortune Sunflower Oil (1L)"
        v_res = client.post("/api/v1/voice/process", json={
            "simulation_text": voice_query,
            "language_code": "en-IN"
        }, headers=headers)
        assert v_res.status_code == 200, f"Voice process failed: {v_res.text}"
        v_data = v_res.json()

        print(f"5. Voice Processing for '{voice_query}':")
        assert len(v_data["matched_items"]) == 2, f"Expected 2 matches, got {len(v_data['matched_items'])}"
        for item in v_data["matched_items"]:
            print(f"   Matched: {item['name']} | Qty: {item['quantity']} | Unit Price: Rs.{item['unit_price']} | Total: Rs.{item['total_price']}")
        print(f"   Voice Bill Subtotal: Rs.{v_data['subtotal']}, Total: Rs.{v_data['total']}")

        expected_total = (2 * 28.0) + (1 * 165.0)  # 56 + 165 = 221
        assert v_data["total"] == expected_total

        # 6. Record Sale via /api/v1/sales
        sales_payload = {
            "items": [
                {
                    "product_id": item["product_id"],
                    "quantity": item["quantity"],
                    "unit_price": item["unit_price"]
                }
                for item in v_data["matched_items"]
            ],
            "payment_method": "upi"
        }
        sale_res = client.post("/api/v1/sales", json=sales_payload, headers=headers)
        assert sale_res.status_code == 201, f"Sale recording failed: {sale_res.text}"
        sale_data = sale_res.json()
        print(f"6. Sales Transaction Recorded:")
        print(f"   Sale ID: {sale_data['id']}")
        print(f"   Amount: Rs.{sale_data['total_amount']}, Payment: {sale_data['payment_method']}")

        # 7. Verify Inventory Deductions
        salt_after = client.get(f"/api/v1/products/{salt_id}", headers=headers).json()
        oil_after = client.get(f"/api/v1/products/{oil_id}", headers=headers).json()

        print(f"7. Inventory Verification:")
        print(f"   Tata Salt: Initial=40, Sold=2, Remaining={salt_after['current_stock']}")
        print(f"   Fortune Oil: Initial=20, Sold=1, Remaining={oil_after['current_stock']}")
        assert salt_after["current_stock"] == 38, f"Expected 38 salt, got {salt_after['current_stock']}"
        assert oil_after["current_stock"] == 19, f"Expected 19 oil, got {oil_after['current_stock']}"

        # 8. Test Telugu Voice Recognition
        te_query = "రెండు టాటా సాల్ట్"  # 2 Tata Salt
        te_res = client.post("/api/v1/voice/process", json={
            "simulation_text": te_query,
            "language_code": "te-IN"
        }, headers=headers)
        assert te_res.status_code == 200
        te_data = te_res.json()
        assert len(te_data["matched_items"]) == 1
        assert te_data["matched_items"][0]["name"] == "Tata Salt 1kg"
        assert te_data["matched_items"][0]["quantity"] == 2
        print(f"8. Telugu Voice Recognition '{te_query}':")
        print(f"   Matched: {te_data['matched_items'][0]['name']} | Qty: {te_data['matched_items'][0]['quantity']}")

        # Deduct 2 more Tata Salt
        sale2_res = client.post("/api/v1/sales", json={
            "items": [{"product_id": salt_id, "quantity": 2, "unit_price": 28.0}],
            "payment_method": "cash"
        }, headers=headers)
        assert sale2_res.status_code == 201
        salt_final = client.get(f"/api/v1/products/{salt_id}", headers=headers).json()
        print(f"   Tata Salt after Telugu bill: Remaining={salt_final['current_stock']} (Expected: 36)")
        assert salt_final["current_stock"] == 36

        # 9. Verify Insufficient Stock Prevention
        print(f"9. Testing Insufficient Stock Safeguard:")
        oversell_res = client.post("/api/v1/sales", json={
            "items": [{"product_id": salt_id, "quantity": 100, "unit_price": 28.0}],
            "payment_method": "cash"
        }, headers=headers)
        assert oversell_res.status_code == 400
        print(f"   Oversell correctly blocked with status 400: {oversell_res.json()['detail']}")
        
        print("\nALL LIVE E2E VOICE-TO-BILL & SALES INVENTORY TESTS PASSED!")

if __name__ == "__main__":
    test_live_voice_to_bill_sales_and_stock()
