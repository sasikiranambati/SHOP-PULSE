"""MRP lookup tests with mocked provider responses (no live external service)."""

import json
import time

import httpx
import pytest

from core.config import settings
from services import mrp_lookup
from services.mrp_lookup import (
    CustomHttpMrpProvider,
    LookupQuery,
    MrpLookupResult,
    OpenMRPProvider,
    lookup_mrp_batch,
    resolve_line_mrp,
    validate_mrp_value,
)

API_KEY = "test_mrp_key_9f8e7d6c5b4a"
VALID_GTIN = "8901030865275"  # mod-10 check digit verified by normalize_gtin


@pytest.fixture(autouse=True)
def provider_settings(monkeypatch):
    mrp_lookup.clear_cache()
    values = {
        "MRP_PROVIDER": "custom_http",
        "MRP_LOOKUP_ENABLED": True,
        "MRP_LOOKUP_TIME_BUDGET_SECONDS": 5.0,
        "MRP_API_BASE_URL": "https://mrp.example.test/api",
        "MRP_API_KEY": API_KEY,
        "MRP_API_AUTH_HEADER": "Authorization",
        "MRP_API_AUTH_SCHEME": "Bearer",
        "MRP_API_BARCODE_PATH": "/products/{barcode}",
        "MRP_API_SEARCH_PATH": "/products/search",
        "MRP_API_SEARCH_PARAM": "q",
        "MRP_API_RESULTS_FIELD": "products",
        "MRP_API_MRP_FIELD": "pricing.mrp",
        "MRP_API_NAME_FIELD": "name",
        "MRP_API_BRAND_FIELD": "brand",
        "MRP_API_BARCODE_FIELD": "gtin",
        "MRP_API_TIMEOUT_SECONDS": 2.0,
    }
    for k, v in values.items():
        monkeypatch.setattr(settings, k, v)
    yield
    mrp_lookup.clear_cache()


def provider_with(handler):
    seen = []

    def wrapped(request: httpx.Request):
        seen.append(request)
        return handler(request)

    client = httpx.Client(transport=httpx.MockTransport(wrapped))
    return CustomHttpMrpProvider(client=client), seen


def product(name, mrp, gtin=None, brand="Tata"):
    p = {"name": name, "brand": brand, "pricing": {"mrp": mrp, "selling_price": 99}}
    if gtin:
        p["gtin"] = gtin
    return p


def test_valid_response_with_mrp_by_gtin():
    prov, seen = provider_with(lambda r: httpx.Response(200, json={"products": [product("Tata Salt 1kg", 28.0, VALID_GTIN)]}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg", gtin=VALID_GTIN))
    assert res.status == "FOUND"
    assert res.mrp == 28.0
    assert res.match_method == "GTIN"
    assert res.matched_name == "Tata Salt 1kg"
    assert res.looked_up_at
    # credentials only in the header, never in the URL or the result
    req = seen[0]
    assert req.headers["Authorization"] == f"Bearer {API_KEY}"
    assert API_KEY not in str(req.url)
    assert API_KEY not in json.dumps(res.to_dict())


def test_name_search_exact_match():
    prov, seen = provider_with(lambda r: httpx.Response(200, json={"products": [
        product("Tata Salt 1 kg", "₹28.00"), product("Tata Salt Lite 1kg", 45)]}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg"))
    assert res.status == "FOUND"
    assert res.mrp == 28.0
    assert res.match_method == "EXACT_NAME"
    assert seen[0].url.params["q"] == "Tata Salt 1kg"


def test_success_response_without_mrp_field():
    prov, _ = provider_with(lambda r: httpx.Response(200, json={"products": [{"name": "Tata Salt 1kg", "gtin": VALID_GTIN,
                                                                             "pricing": {"selling_price": 25}}]}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg", gtin=VALID_GTIN))
    assert res.status == "MRP_UNAVAILABLE"
    assert res.mrp is None  # selling_price is never used as MRP
    assert "pricing.mrp" in res.message


@pytest.mark.parametrize("bad", [None, 0, -5, "abc", "", True, "NaN", 5_000_000])
def test_invalid_mrp_values_rejected(bad):
    prov, _ = provider_with(lambda r: httpx.Response(200, json={"products": [product("Tata Salt 1kg", bad, VALID_GTIN)]}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg", gtin=VALID_GTIN))
    assert res.status == "MRP_UNAVAILABLE"
    assert res.mrp is None


def test_validate_mrp_value():
    assert validate_mrp_value("₹1,250.00") == 1250.0
    assert validate_mrp_value(28) == 28.0
    assert validate_mrp_value("28 approx") is None


def test_product_not_found_404_and_empty_list():
    prov, _ = provider_with(lambda r: httpx.Response(404, json={"error": "not found"}))
    assert prov.lookup(LookupQuery(gtin=VALID_GTIN)).status == "PRODUCT_NOT_FOUND"
    prov, _ = provider_with(lambda r: httpx.Response(200, json={"products": []}))
    assert prov.lookup(LookupQuery(product_name="Unknown Snack")).status == "PRODUCT_NOT_FOUND"


def test_missing_api_configuration(monkeypatch):
    monkeypatch.setattr(settings, "MRP_API_BASE_URL", None)
    monkeypatch.setattr(settings, "MRP_API_MRP_FIELD", None)
    prov, seen = provider_with(lambda r: httpx.Response(200, json={}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg"))
    assert res.status == "API_CONFIGURATION_ERROR"
    assert "MRP_API_BASE_URL" in res.message and "MRP_API_MRP_FIELD" in res.message
    assert seen == []


@pytest.mark.parametrize("code", [401, 403])
def test_wrong_or_missing_api_key(code):
    prov, _ = provider_with(lambda r: httpx.Response(code, text=f"invalid key {API_KEY}"))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg"))
    assert res.status == "API_AUTHENTICATION_ERROR"
    assert res.http_status == code
    assert API_KEY not in res.message


def test_rate_limited():
    prov, _ = provider_with(lambda r: httpx.Response(429, headers={"Retry-After": "30"}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg"))
    assert res.status == "API_RATE_LIMITED"
    assert "30" in res.message


def test_server_error():
    prov, _ = provider_with(lambda r: httpx.Response(500, text="boom"))
    assert prov.lookup(LookupQuery(product_name="Tata Salt 1kg")).status == "API_ERROR"


def test_timeout_and_network_failure():
    def timeout(r):
        raise httpx.ReadTimeout("slow", request=r)

    def down(r):
        raise httpx.ConnectError("dns failure", request=r)

    assert provider_with(timeout)[0].lookup(LookupQuery(product_name="Tata Salt 1kg")).status == "API_TIMEOUT"
    assert provider_with(down)[0].lookup(LookupQuery(product_name="Tata Salt 1kg")).status == "API_ERROR"


def test_malformed_json():
    prov, _ = provider_with(lambda r: httpx.Response(200, content=b"{not json", headers={"content-type": "application/json"}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg"))
    assert res.status == "API_ERROR"
    assert "malformed JSON" in res.message


def test_incorrect_product_match_rejected():
    # Same brand and word, different pack size / product: must not match
    prov, _ = provider_with(lambda r: httpx.Response(200, json={"products": [
        product("Tata Salt 500g", 15), product("Tata Tea Gold 1kg", 560)]}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg"))
    assert res.status == "PRODUCT_NOT_FOUND"
    assert res.mrp is None


def test_candidate_with_different_barcode_rejected():
    other_gtin = "8901030865268"  # valid check digit, different product
    prov, _ = provider_with(lambda r: httpx.Response(404) if "/products/" in r.url.path and "search" not in r.url.path
                            else httpx.Response(200, json={"products": [product("Tata Salt 1kg", 28, other_gtin)]}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg", gtin=VALID_GTIN))
    assert res.status == "PRODUCT_NOT_FOUND"


def test_ambiguous_matches_require_manual_review():
    prov, _ = provider_with(lambda r: httpx.Response(200, json={"products": [
        product("Britannia Good Day Butter 100g", 30, brand="Britannia"),
        product("Britannia Good Day Cashew 100g", 35, brand="Britannia")]}))
    res = prov.lookup(LookupQuery(product_name="Britannia Good Day 100g"))
    assert res.status in ("MANUAL_REVIEW_REQUIRED", "PRODUCT_NOT_FOUND")
    assert res.mrp is None


def test_duplicate_barcode_records_with_conflicting_mrp():
    prov, _ = provider_with(lambda r: httpx.Response(200, json={"products": [
        product("Tata Salt 1kg", 28, VALID_GTIN), product("Tata Salt 1kg (old)", 25, VALID_GTIN)]}))
    res = prov.lookup(LookupQuery(product_name="Tata Salt 1kg", gtin=VALID_GTIN))
    assert res.status == "MANUAL_REVIEW_REQUIRED"


def test_openmrp_provider_never_reports_an_mrp(monkeypatch):
    monkeypatch.setattr(settings, "OPENMRP_API_KEY", None)
    res = OpenMRPProvider().lookup(LookupQuery(product_name="Tata Salt 1kg"))
    assert res.status == "API_CONFIGURATION_ERROR"
    monkeypatch.setattr(settings, "OPENMRP_API_KEY", "mrp_sk_test_dummy")
    res = OpenMRPProvider().lookup(LookupQuery(product_name="Tata Salt 1kg"))
    assert res.status == "MRP_UNAVAILABLE"
    assert res.mrp is None
    assert "Material Requirements Planning" in res.message


def test_batch_short_circuits_on_authentication_error():
    prov, seen = provider_with(lambda r: httpx.Response(401))
    results = lookup_mrp_batch([LookupQuery(product_name=f"Item {i}") for i in range(5)], prov)
    assert [r.status for r in results] == ["API_AUTHENTICATION_ERROR"] * 5
    assert len(seen) == 1  # no point repeating a request that cannot succeed


def test_batch_respects_time_budget(monkeypatch):
    monkeypatch.setattr(settings, "MRP_LOOKUP_TIME_BUDGET_SECONDS", 0.3)

    class Slow:
        name = "slow"

        def lookup(self, q):
            if q.product_name != "Item 0":
                time.sleep(1.0)
            return MrpLookupResult("PRODUCT_NOT_FOUND", self.name, "none")

    start = time.monotonic()
    results = lookup_mrp_batch([LookupQuery(product_name=f"Item {i}") for i in range(3)], Slow())
    assert time.monotonic() - start < 0.9
    assert results[0].status == "PRODUCT_NOT_FOUND"
    assert {r.status for r in results[1:]} == {"SKIPPED"}


def test_provider_exception_does_not_propagate():
    class Broken:
        name = "broken"

        def lookup(self, q):
            raise RuntimeError(f"bug with {API_KEY}")

    monkeypatch_key = settings.MRP_API_KEY
    res = mrp_lookup.lookup_mrp(LookupQuery(product_name="x"), Broken())
    assert res.status == "API_ERROR"
    assert monkeypatch_key not in res.message


# ---------------------------------------------------------------- choosing the line MRP

def found(mrp):
    return MrpLookupResult("FOUND", "custom_http", "ok", mrp=mrp)


def test_invoice_and_api_mrp_disagree_is_flagged():
    mrp, source, issues, review = resolve_line_mrp(30.0, found(28.0), None)
    assert (mrp, source) == (30.0, "INVOICE")  # printed evidence is not overwritten
    assert review is True
    assert any("MRP mismatch" in i for i in issues)


def test_api_mrp_used_when_invoice_has_none():
    assert resolve_line_mrp(None, found(28.0), None)[:2] == (28.0, "API")


def test_failed_lookup_never_replaces_a_stored_mrp():
    failed = MrpLookupResult("API_TIMEOUT", "custom_http", "timeout")
    mrp, source, issues, review = resolve_line_mrp(None, failed, 30.0)
    assert (mrp, source, review) == (None, None, False)
    assert issues == []  # stored MRP (30) stays on the product; nothing to overwrite it with


def test_matching_values_are_not_flagged():
    mrp, source, issues, review = resolve_line_mrp(28.0, found(28.0), 28.0)
    assert (mrp, source, review, issues) == (28.0, "INVOICE", False, [])
