"""
Live Backend API Inspector Script.
Tests authentication, shop status, and invoice extraction against http://127.0.0.1:8000.
Uses Python standard library (urllib) for zero external dependencies.
"""

import sys
import json
import urllib.request
import urllib.error
import uuid

# Ensure clean UTF-8 console output on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_URL = "http://127.0.0.1:8000"


def post_json(url: str, data: dict, headers: dict = None):
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers=req_headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def get_json_or_text(url: str, headers: dict = None):
    req_headers = {}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers, method="GET")
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        text = resp.read().decode("utf-8")
        try:
            return resp.status, json.loads(text)
        except Exception:
            return resp.status, text


def post_multipart(url: str, field_name: str, filename: str, content: bytes, content_type: str, headers: dict = None):
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    req_headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if headers:
        req_headers.update(headers)

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        headers=req_headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        text = resp.read().decode("utf-8")
        try:
            return resp.status, json.loads(text)
        except Exception:
            return resp.status, text


def test_live_backend():
    print(f"Connecting to live backend at {BASE_URL}...")
    email = "diag_test_user@example.com"
    pwd = "password123"

    token = None
    try:
        status, login_data = post_json(f"{BASE_URL}/api/v1/auth/login", {"email": email, "password": pwd})
        token = login_data.get("access_token")
        print(f"[1] Login successful: HTTP {status}, token acquired: {bool(token)}")
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="replace")
        print(f"[1] Login returned HTTP {e.code}: {err_msg}")
        # Try registering if user doesn't exist
        try:
            print(f"    Attempting registration for {email}...")
            r_status, r_data = post_json(f"{BASE_URL}/api/v1/auth/register", {"email": email, "password": pwd})
            print(f"    Registered successfully: HTTP {r_status}")
            status, login_data = post_json(f"{BASE_URL}/api/v1/auth/login", {"email": email, "password": pwd})
            token = login_data.get("access_token")
            print(f"    Login successful: token acquired: {bool(token)}")
        except Exception as reg_err:
            print(f"    Registration/Login fallback error: {reg_err}")
            return
    except Exception as e:
        print(f"Cannot reach backend server at {BASE_URL}: {e}")
        return

    if not token:
        print("Could not obtain access token.")
        return

    auth_headers = {"Authorization": f"Bearer {token}"}

    # Check or create shop for user
    try:
        s_status, s_data = get_json_or_text(f"{BASE_URL}/api/v1/shops/me", headers=auth_headers)
        shop_name = s_data.get("shop_name") if isinstance(s_data, dict) else s_data
        print(f"[2] My shop: HTTP {s_status}, shop_name: {shop_name}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"[2] Shop not found (HTTP 404), creating shop...")
            try:
                c_status, c_data = post_json(
                    f"{BASE_URL}/api/v1/shops",
                    {
                        "shop_name": "Diagnostic Store",
                        "owner_name": "Test Owner",
                        "business_type": "Grocery/Kirana",
                    },
                    headers=auth_headers,
                )
                print(f"    Shop created: HTTP {c_status}, id: {c_data.get('id') if isinstance(c_data, dict) else c_data}")
            except Exception as shop_err:
                print(f"    Failed to create shop: {shop_err}")
        else:
            print(f"[2] Shop check returned HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}")

    # Test invoice extraction
    invoice_text = (
        "S.No. | Item Description | Rate | Qty | Amount\n"
        "1 | Aashirvaad Atta 10kg | 250 | 10 | 2500\n"
        "2 | Tata Salt 1kg | 25 | 20 | 500\n"
    )
    try:
        ex_status, ex_data = post_multipart(
            f"{BASE_URL}/api/v1/invoices/extract",
            field_name="file",
            filename="invoice.txt",
            content=invoice_text.encode("utf-8"),
            content_type="text/plain",
            headers=auth_headers,
        )
        print(f"[3] Extract invoice: HTTP {ex_status}")
        if isinstance(ex_data, dict):
            items = ex_data.get("items", [])
            print(f"    Extracted {len(items)} items, total: {ex_data.get('total_amount')}")
            for it in items:
                p_name = it.get('product_name')
                qty = it.get('quantity')
                pur = it.get('purchase_price')
                tot = it.get('line_total')
                print(f"    - {p_name}: Qty {qty} @ Rs.{pur} | Total: Rs.{tot}")
        else:
            print(f"    Response: {ex_data}")
    except urllib.error.HTTPError as e:
        print(f"[3] Extract invoice HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}")


if __name__ == "__main__":
    test_live_backend()

