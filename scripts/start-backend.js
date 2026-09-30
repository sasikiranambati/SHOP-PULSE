/**
 * @file start-backend.js
 * @description Cross-platform runner for the ShopPulse FastAPI backend.
 * Automatically locates the project's virtual environment (.venv) or system Python.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');

export function getPythonPath() {
  const isWindows = process.platform === 'win32';
  
  const possiblePaths = [
    path.join(backendDir, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python'),
    path.join(rootDir, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python'),
    path.join(backendDir, 'venv', isWindows ? 'Scripts/python.exe' : 'bin/python'),
    path.join(rootDir, 'venv', isWindows ? 'Scripts/python.exe' : 'bin/python'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback to system python
  return isWindows ? 'python' : 'python3';
}

export function startBackend(options = {}) {
  const pythonBin = getPythonPath();
  const scriptPath = path.join(backendDir, 'main.py');

  console.log(`[ShopPulse] Starting FastAPI backend with Python: ${pythonBin}`);

  const child = spawn(pythonBin, [scriptPath], {
    cwd: rootDir,
    stdio: options.silent ? 'ignore' : 'inherit',
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
  });

  child.on('error', (err) => {
    console.error('[ShopPulse Backend Error]:', err.message);
  });

  return child;
}

// If executed directly from command line
if (process.argv[1] && process.argv[1].endsWith('start-backend.js')) {
  const proc = startBackend();
  proc.on('close', (code) => {
    process.exit(code || 0);
  });

  const cleanup = () => {
    try {
      proc.kill();
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
