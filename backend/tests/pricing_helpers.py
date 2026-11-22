"""
Test helper for the Stage 4 pricing lifecycle (verify before sale).

New products start as NEEDS_REVIEW and cannot be sold until a Manager or Owner verifies their pricing
(production rule, unchanged). Tests whose products represent valid retail stock verify them explicitly
through the real API, as the shop owner, instead of creating them as VERIFIED or relaxing the checkout rule.
Tests that check the rejection of unverified products simply do not call this.
"""


def verify_product(client, owner_headers, product_id):
    """Verify a product's pricing as the shop owner (POST /products/{id}/verify) and return the product."""
    r = client.post(f"/api/v1/products/{product_id}/verify", json={"reason": "test setup: valid retail product"},
                    headers=owner_headers)
    assert r.status_code == 200, r.text
    assert r.json()["pricing_status"] == "VERIFIED"
    return r.json()
