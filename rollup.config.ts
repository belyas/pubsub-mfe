import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import { dts } from "rollup-plugin-dts";
import { defineConfig } from "rollup";
import type { RollupOptions } from "rollup";

const isWatchMode = process.argv.includes("--watch");

const typescriptPlugin = typescript({
  tsconfig: "./tsconfig.json",
  declaration: false, // We'll generate declarations separately
  declarationMap: false,
});

const mainBundle: RollupOptions = {
  input: "src/index.ts",
  output: {
    file: "dist/index.js",
    format: "esm",
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
    exports: "named",
  },
  plugins: [resolve(), typescriptPlugin],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

const workerBundle: RollupOptions = {
  input: "src/workers/cross-tab-shared-worker.ts",
  output: {
    file: "dist/workers/cross-tab-shared-worker.js",
    format: "esm",
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
  },
  plugins: [resolve(), typescriptPlugin],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

const adapterBundle: RollupOptions = {
  input: "src/adapters/cross-tab/index.ts",
  output: {
    file: "dist/adapters/cross-tab.js",
    format: "esm",
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
    exports: "named",
  },
  plugins: [resolve(), typescriptPlugin],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

const iframeAdapterBundle: RollupOptions = {
  input: "src/adapters/iframe/index.ts",
  output: {
    file: "dist/adapters/iframe.js",
    format: "esm",
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
    exports: "named",
  },
  plugins: [resolve(), typescriptPlugin],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

const historyAdapterBundle: RollupOptions = {
  input: "src/adapters/history/index.ts",
  output: {
    file: "dist/adapters/history.js",
    format: "esm",
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
    exports: "named",
  },
  plugins: [resolve(), typescriptPlugin],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

const dtsBundle: RollupOptions = {
  input: "src/index.ts",
  output: {
    file: "dist/index.d.ts",
    format: "esm",
  },
  plugins: [dts()],
};

const workerDtsBundle: RollupOptions = {
  input: "src/workers/cross-tab-shared-worker.ts",
  output: {
    file: "dist/workers/cross-tab-shared-worker.d.ts",
    format: "esm",
  },
  plugins: [dts()],
};

const adapterDtsBundle: RollupOptions = {
  input: "src/adapters/cross-tab/index.ts",
  output: {
    file: "dist/adapters/cross-tab.d.ts",
    format: "esm",
  },
  plugins: [dts()],
};

const iframeAdapterDtsBundle: RollupOptions = {
  input: "src/adapters/iframe/index.ts",
  output: {
    file: "dist/adapters/iframe.d.ts",
    format: "esm",
  },
  plugins: [dts()],
};

const historyAdapterDtsBundle: RollupOptions = {
  input: "src/adapters/history/index.ts",
  output: {
    file: "dist/adapters/history.d.ts",
    format: "esm",
  },
  plugins: [dts()],
};

// In watch mode, skip dts bundles for faster iteration
export default defineConfig(
  isWatchMode
    ? [mainBundle, workerBundle, adapterBundle, iframeAdapterBundle, historyAdapterBundle]
    : [
        mainBundle,
        workerBundle,
        adapterBundle,
        iframeAdapterBundle,
        historyAdapterBundle,
        dtsBundle,
        workerDtsBundle,
        adapterDtsBundle,
        iframeAdapterDtsBundle,
        historyAdapterDtsBundle,
      ]
);
