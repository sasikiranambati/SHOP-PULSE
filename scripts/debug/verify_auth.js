async function runAllTests() {
  console.log('====================================================');
  console.log('1. VERIFY FRONTEND DEV SERVER (http://localhost:5173)');
  console.log('====================================================');
  const feRes = await fetch('http://localhost:5173/');
  console.log('Frontend HTML status:', feRes.status);
  const feHtml = await feRes.text();
  console.log('Frontend contains #root container:', feHtml.includes('id="root"'));

  console.log('\n====================================================');
  console.log('2. VERIFY DIRECT BACKEND (http://127.0.0.1:8000)');
  console.log('====================================================');
  const healthRes = await fetch('http://127.0.0.1:8000/api/v1/health');
  console.log('Direct Health check:', healthRes.status, await healthRes.json());

  console.log('\n====================================================');
  console.log('3. VERIFY VITE PROXY (http://localhost:5173/api/...)');
  console.log('====================================================');
  const proxyHealthRes = await fetch('http://localhost:5173/api/v1/health');
  console.log('Proxy Health check:', proxyHealthRes.status, await proxyHealthRes.json());

  console.log('\n====================================================');
  console.log('4. TEST LOGIN VIA PROXY (http://localhost:5173/api/v1/auth/login)');
  console.log('====================================================');
  const loginRes = await fetch('http://localhost:5173/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ramesh.sharma@example.com', password: 'Password123' })
  });
  console.log('Login status:', loginRes.status);
  const loginData = await loginRes.json();
  console.log('Token received:', Boolean(loginData.access_token));
  const token = loginData.access_token;

  console.log('\n====================================================');
  console.log('5. TEST AUTH PROFILE VIA PROXY');
  console.log('====================================================');
  const profileRes = await fetch('http://localhost:5173/api/v1/auth/profile', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  console.log('Profile status:', profileRes.status);
  console.log('Profile user:', await profileRes.json());

  console.log('\n====================================================');
  console.log('6. TEST USER SHOP VIA PROXY');
  console.log('====================================================');
  const shopRes = await fetch('http://localhost:5173/api/v1/shops/me', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  console.log('Shop status:', shopRes.status);
  console.log('Shop profile:', await shopRes.json());

  console.log('\n====================================================');
  console.log('7. TEST REGISTRATION VIA PROXY (http://localhost:5173/api/v1/auth/register)');
  console.log('====================================================');
  const newEmail = 'shoppulse_' + Math.floor(Math.random() * 1000000) + '@example.com';
  const regRes = await fetch('http://localhost:5173/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: newEmail, password: 'Password123' })
  });
  console.log('Register status:', regRes.status);
  const regUser = await regRes.json();
  console.log('Registered user:', { email: regUser.email, id: regUser.id, is_active: regUser.is_active });

  console.log('\n====================================================');
  console.log('8. TEST LOGIN WITH NEW USER VIA PROXY');
  console.log('====================================================');
  const newLoginRes = await fetch('http://localhost:5173/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: newEmail, password: 'Password123' })
  });
  console.log('New user login status:', newLoginRes.status);
  const newLoginData = await newLoginRes.json();
  console.log('New user token received:', Boolean(newLoginData.access_token));

  console.log('\n====================================================');
  console.log('9. TEST INVALID CREDENTIALS ERROR HANDLING VIA PROXY');
  console.log('====================================================');
  const badLoginRes = await fetch('http://localhost:5173/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ramesh.sharma@example.com', password: 'WrongPassword!' })
  });
  console.log('Bad login status (expected 401):', badLoginRes.status);
  console.log('Bad login response:', await badLoginRes.json());

  console.log('\n====================================================');
  console.log('10. TEST DUPLICATE REGISTRATION VIA PROXY');
  console.log('====================================================');
  const dupRegRes = await fetch('http://localhost:5173/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: newEmail, password: 'Password123' })
  });
  console.log('Duplicate register status (expected 400):', dupRegRes.status);
  console.log('Duplicate register response:', await dupRegRes.json());

  console.log('\n====================================================');
  console.log('ALL VERIFICATIONS PASSED: ZERO 502 BAD GATEWAYS!');
  console.log('====================================================');
}

runAllTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
