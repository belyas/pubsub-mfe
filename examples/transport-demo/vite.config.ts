import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  server: {
    port: 5174,
    open: true,
    fs: {
      // Allow serving files from the parent pubsub-mfe directory
      allow: ['..', '../..'],
    },
  },
  build: {
    target: "esnext",
  },
  resolve: {
    alias: {
      '@pubsub': resolve(__dirname, '../../src'),
    },
  },
});
