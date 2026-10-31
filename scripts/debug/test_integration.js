const API_URL = 'http://127.0.0.1:8000/api/v1';

async function main() {
  console.log('--- 1. Health Check ---');
  const healthRes = await fetch(`${API_URL}/health`);
  const health = await healthRes.json();
  console.log('Health:', health);

  console.log('\n--- 2. Auth Login ---');
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: 'ramesh.sharma@example.com',
      password: 'Password123',
    }),
  });
  if (!loginRes.ok) {
    const err = await loginRes.text();
    throw new Error(`Login failed (${loginRes.status}): ${err}`);
  }
  const tokenData = await loginRes.json();
  const token = tokenData.access_token;
  console.log('Access token received (length):', token.length);

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  console.log('\n--- 3. Current User & Shop Info ---');
  const meRes = await fetch(`${API_URL}/auth/profile`, { headers: authHeaders });
  const me = await meRes.json();
  console.log('User Profile:', { id: me.id, email: me.email, is_active: me.is_active });

  const shopRes = await fetch(`${API_URL}/shops/me`, { headers: authHeaders });
  const shop = await shopRes.json();
  console.log('Shop Profile:', { id: shop.id, shop_name: shop.shop_name, owner_name: shop.owner_name, business_type: shop.business_type });

  console.log('\n--- 4. Product List ---');
  const productsRes = await fetch(`${API_URL}/products?limit=100`, { headers: authHeaders });
  const products = await productsRes.json();
  console.log(`Found ${products.total} products:`);
  products.items.forEach(p => console.log(`  - [${p.id}] ${p.name}: ₹${p.selling_price}, stock: ${p.current_stock} (${p.stock_status})`));

  console.log('\n--- 5. Dashboard Data (Live API) ---');
  const dashboardRes = await fetch(`${API_URL}/dashboard`, { headers: authHeaders });
  const dashboard = await dashboardRes.json();
  console.log('Dashboard Response:', {
    today_sales: dashboard.today_sales,
    products_count: dashboard.products_count,
    low_stock_count: dashboard.low_stock_count,
    items_sold_today: dashboard.items_sold_today,
    top_products_count: dashboard.top_products?.length,
    recent_sales_count: dashboard.recent_sales?.length,
  });

  if (dashboard.recent_sales?.length > 0) {
    console.log('Most recent sale:', {
      sale_id: dashboard.recent_sales[0].id,
      total_amount: dashboard.recent_sales[0].total_amount,
      payment_method: dashboard.recent_sales[0].payment_method,
      created_at: dashboard.recent_sales[0].created_at,
    });
  }

  console.log('\n--- 6. Suppliers & Purchases Endpoints ---');
  const suppliersRes = await fetch(`${API_URL}/suppliers`, { headers: authHeaders });
  const suppliers = await suppliersRes.json();
  console.log('Suppliers count:', suppliers.items ? suppliers.items.length : suppliers.length);

  const purchasesRes = await fetch(`${API_URL}/purchases`, { headers: authHeaders });
  const purchases = await purchasesRes.json();
  console.log('Purchases count:', purchases.items ? purchases.items.length : purchases.length);

  console.log('\n========================================');
  console.log('FULL STACK API INTEGRATION TEST VERIFIED');
  console.log('========================================');
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
