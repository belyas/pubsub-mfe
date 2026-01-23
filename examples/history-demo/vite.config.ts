import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        orders: resolve(__dirname, 'orders.html'),
        inventory: resolve(__dirname, 'inventory.html'),
      },
    },
  },
  server: {
    port: 3001,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@pubsub': resolve(__dirname, '../../src'),
    },
  },
});
