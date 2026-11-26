#!/usr/bin/env node
/**
 * Isolated browser-check launcher (Phase 4, workstream 9a).
 *
 *   node scripts/e2e/run.cjs                 # all checks
 *   node scripts/e2e/run.cjs <check> [...]   # e.g. fractional_quantity_block_check
 *
 * 1. Port guard: the test backend port (default 8765) and test Vite port (default 5174) must be free.
 *    If either is in use the run stops - it never talks to a server it did not start. The development
 *    ports 8000 / 5173 are refused outright.
 * 2. Starts its own backend (SHOPPULSE_TEST_MODE=1, DATABASE_URL = a new temporary SQLite file; the
 *    backend's own guard refuses anything else) and its own Vite (no auto-started backend, /api proxied
 *    to the test backend). Both must stay alive and answer before any check runs.
 * 3. Runs the asset preparation and the checks against those servers only (E2E_LAUNCHED=1).
 * 4. Stops only the processes it started and removes the temporary directory.
 * 5. Fails if backend/shoppulse.db (or its -wal / -shm files) changed during the run.
 *
 * Environment: E2E_BACKEND_PORT, E2E_WEB_PORT, E2E_ARTIFACT_DIR (keep screenshots), E2E_KEEP=1 (keep temp dir).
 */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const PROTECTED = ['shoppulse.db', 'shoppulse.db-wal', 'shoppulse.db-shm'].map((f) => path.join(BACKEND_DIR, f));
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8765);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5174);

// check -> asset preparation script (or null)
const CHECKS = {
  mobile_capture_check: 'prepare_mobile_assets.py',
  invoice_metadata_check: 'prepare_metadata_assets.py',
  direct_upload_warning_check: 'prepare_warning_assets.py',
  review_promotions_precision_check: null,
  fractional_quantity_block_check: null,
  unit_registry_check: null,
  invoice_units_fraction_check: null,
  voice_bill_price_check: null,
  voice_pos_401_and_responsive_check: null,
  role_access_check: null,
  stage_6_7_1_browser_acceptance: null,
  demand_forecast_check: null,
  ai_assistant_check: null,
  edit_product_pricing_basis_check: null,
};

const log = (msg) => console.log(`[e2e] ${msg}`);
function die(msg, code = 2) {
  console.error(`[e2e] STOPPED: ${msg}`);
  process.exit(code);
}

// ---------------------------------------------------------------------------- port guard

function connects(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 500 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

function canBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function portProblem(port) {
  if (await connects('127.0.0.1', port)) return 'a server is already listening on 127.0.0.1';
  if (await connects('::1', port)) return 'a server is already listening on [::1]';
  if (!(await canBind(port))) return 'the port cannot be bound';
  return null;
}

// ---------------------------------------------------------------------------- protected database

function fingerprint() {
  return PROTECTED.map((f) => {
    if (!fs.existsSync(f)) return `${path.basename(f)}: absent`;
    const st = fs.statSync(f);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    return `${path.basename(f)}: ${hash} ${st.size}B mtime=${st.mtimeMs}`;
  });
}

// ---------------------------------------------------------------------------- servers

function pythonBin() {
  for (const p of [
    path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT, '.venv', 'Scripts', 'python.exe'),
    path.join(BACKEND_DIR, '.venv', 'bin', 'python'),
    path.join(ROOT, '.venv', 'bin', 'python')
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return 'python3';
}

function get(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
  });
}

function start(name, cmd, args, opts, logFile) {
  const out = fs.openSync(logFile, 'a');
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', out, out], detached: process.platform !== 'win32' });
  child.exitCode_ = null;
  child.on('exit', (code, signal) => { child.exitCode_ = code ?? signal; });
  log(`started ${name} (pid ${child.pid}); log: ${logFile}`);
  return child;
}

async function waitReady(name, child, url, logFile, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (child.exitCode_ !== null) {
      const tail = fs.readFileSync(logFile, 'utf8').split('\n').slice(-15).join('\n');
      throw new Error(`${name} exited (${child.exitCode_}) before it was ready:\n${tail}`);
    }
    if ((await get(url)) === 200) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not answer ${url} within ${timeoutMs / 1000}s`);
}

function stop(child) {
  if (!child || child.exitCode_ !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------- main

(async () => {
  const requested = process.argv.slice(2);
  const checks = requested.length ? requested : Object.keys(CHECKS);
  const unknown = checks.filter((c) => !(c in CHECKS));
  if (unknown.length) die(`unknown check(s): ${unknown.join(', ')}. Known: ${Object.keys(CHECKS).join(', ')}`);
  for (const [name, port] of [['E2E_BACKEND_PORT', BACKEND_PORT], ['E2E_WEB_PORT', WEB_PORT]]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) die(`${name} must be a port number 1024-65535`);
    if (port === 8000 || port === 5173) die(`${name}=${port} is a development port; test servers never use it`);
  }
  if (BACKEND_PORT === WEB_PORT) die('backend and web ports must differ');

  for (const [label, port] of [['test backend', BACKEND_PORT], ['test web server', WEB_PORT]]) {
    const problem = await portProblem(port);
    if (problem) die(`port ${port} (${label}): ${problem}. Stop that process or choose another port with ${label === 'test backend' ? 'E2E_BACKEND_PORT' : 'E2E_WEB_PORT'}. Refusing to run against a server this launcher did not start.`);
  }

  const before = fingerprint();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoppulse-e2e-'));
  const artifacts = process.env.E2E_ARTIFACT_DIR ? path.resolve(process.env.E2E_ARTIFACT_DIR) : path.join(tmp, 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dbUrl = `sqlite:///${path.join(tmp, 'e2e.db').replace(/\\/g, '/')}`;
  const API_TARGET = `http://127.0.0.1:${BACKEND_PORT}`;
  const WEB = `http://127.0.0.1:${WEB_PORT}`;
  const baseEnv = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
  log(`test database: ${dbUrl}`);
  log(`test backend:  ${API_TARGET}   test web: ${WEB}`);

  let backend = null;
  let web = null;
  let ok = false;
  const results = [];
  const shutdown = () => { stop(web); stop(backend); };
  process.on('SIGINT', () => { shutdown(); process.exit(130); });
  process.on('SIGTERM', () => { shutdown(); process.exit(143); });

  try {
    const beLog = path.join(tmp, 'backend.log');
    backend = start('test backend', pythonBin(), ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
      { cwd: BACKEND_DIR, env: { ...baseEnv, SHOPPULSE_TEST_MODE: '1', AUTO_INIT_DB: '1', DATABASE_URL: dbUrl, PYTHONUNBUFFERED: '1' } }, beLog);
    await waitReady('test backend', backend, `${API_TARGET}/api/v1/health`, beLog);

    const webLog = path.join(tmp, 'web.log');
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    web = start('test web server', 'node', [viteBin, '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'],
      { cwd: ROOT, env: { ...baseEnv, SHOPPULSE_TEST_MODE: '1', SHOPPULSE_API_TARGET: API_TARGET, VITE_API_URL: '' } }, webLog);
    await waitReady('test web server', web, `${WEB}/`, webLog);
    // The page's /api calls must reach the test backend through the Vite proxy
    if ((await get(`${WEB}/api/v1/health`)) !== 200) throw new Error('the test web server does not proxy /api to the test backend');
    if (backend.exitCode_ !== null || web.exitCode_ !== null) throw new Error('a test server stopped during start-up');

    const prepared = new Set();
    for (const check of checks) {
      const prep = CHECKS[check];
      if (prep && !prepared.has(prep)) {
        const r = spawnSync(pythonBin(), [path.join(__dirname, prep), artifacts], { cwd: ROOT, env: baseEnv, encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`${prep} failed:\n${r.stderr || r.stdout}`);
        prepared.add(prep);
      }
      log(`running ${check}`);
      const r = spawnSync('node', [path.join(__dirname, `${check}.cjs`), artifacts], {
        cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        env: { ...baseEnv, E2E_LAUNCHED: '1', API_URL: `${API_TARGET}/api/v1`, WEB_URL: WEB },
      });
      process.stdout.write(r.stdout || '');
      process.stderr.write(r.stderr || '');
      const m = /(\d+)\/(\d+) checks passed/.exec(r.stdout || '');
      const passed = r.status === 0 && m && m[1] === m[2] && !/^FAIL\b/m.test(r.stdout || '');
      results.push({ check, passed, summary: m ? `${m[1]}/${m[2]}` : `exit ${r.status}` });
    }
    ok = results.every((r) => r.passed);
  } catch (err) {
    console.error(`[e2e] ERROR: ${err.message}`);
  } finally {
    shutdown();
    await new Promise((r) => setTimeout(r, 1500));
    for (const c of [web, backend]) {
      if (c && c.exitCode_ === null) { stop(c); }
    }
  }

  const after = fingerprint();
  const dbUnchanged = before.join('\n') === after.join('\n');
  console.log('\n[e2e] results');
  for (const r of results) console.log(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.check}  ${r.summary}`);
  console.log(`  ${dbUnchanged ? 'PASS' : 'FAIL'}  backend/shoppulse.db unchanged`);
  if (!dbUnchanged) console.log(`     before:\n       ${before.join('\n       ')}\n     after:\n       ${after.join('\n       ')}`);
  if (ok && dbUnchanged && process.env.E2E_KEEP !== '1' && !process.env.E2E_ARTIFACT_DIR) fs.rmSync(tmp, { recursive: true, force: true });
  else log(`kept ${tmp}`);
  process.exit(ok && dbUnchanged ? 0 : 1);
})();
