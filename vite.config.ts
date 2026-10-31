import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'
// @ts-expect-error untyped helper script
import { startBackend } from './scripts/start-backend.js'

function autoBackendPlugin(): Plugin {
  let backendProc: any = null;

  return {
    name: 'auto-start-backend',
    apply: 'serve',
    configureServer() {
      let resolved = false;
      const triggerStart = () => {
        if (resolved) return;
        resolved = true;
        console.log('\x1b[36m[ShopPulse] FastAPI backend not detected on port 8000. Auto-starting backend...\x1b[0m');
        try {
          backendProc = startBackend();
        } catch (err: any) {
          console.error('[ShopPulse] Failed to auto-start backend:', err?.message);
        }
      };

      // Check if backend is already alive on port 8000 with a fast 350ms timeout
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port: 8000,
          path: '/api/v1/health',
          timeout: 350,
        },
        (res) => {
          if (res.statusCode === 200) {
            resolved = true;
            console.log('\x1b[32m[ShopPulse] FastAPI backend is already running on http://127.0.0.1:8000\x1b[0m');
          } else {
            triggerStart();
          }
        }
      );

      req.on('timeout', () => {
        req.destroy();
        triggerStart();
      });

      req.on('error', () => {
        triggerStart();
      });

      const killProc = () => {
        if (backendProc) {
          try {
            backendProc.kill();
          } catch {}
          backendProc = null;
        }
      };

      process.on('exit', killProc);
      process.on('SIGINT', killProc);
      process.on('SIGTERM', killProc);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), autoBackendPlugin()],
  optimizeDeps: {
    include: ['react', 'react-dom', 'lucide-react'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: [
        '**/backend/**',
        '**/android/**',
        '**/.pytest_cache/**',
        '**/.ocr-cache/**',
        '**/dist/**',
        '**/*.db*',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error('[ShopPulse Vite Proxy] Error proxying to backend (http://127.0.0.1:8000):', err.message);
          });
        },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@firebase/firestore') || id.includes('node_modules/firebase/firestore')) {
            return 'vendor-firestore';
          }
          if (id.includes('node_modules/@firebase/auth') || id.includes('node_modules/firebase/auth')) {
            return 'vendor-auth';
          }
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'vendor-firebase';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'vendor-icons';
          }
          if (id.includes('node_modules/pdfjs-dist/')) {
            return 'vendor-pdfjs';
          }
          if (id.includes('node_modules/tesseract.js')) {
            return 'vendor-ocr';
          }
        }
      }
    }
  }
})


