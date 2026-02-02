import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import { dts } from "rollup-plugin-dts";
import { defineConfig } from "rollup";
import type { RollupOptions } from "rollup";
import terser from '@rollup/plugin-terser';
import filesize from 'rollup-plugin-filesize';
import { visualizer } from "rollup-plugin-visualizer";

const isWatchMode = process.argv.includes("--watch");
const extraInfoPlugins = isWatchMode ? [] : [filesize(), visualizer()];

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
  plugins: [resolve(), typescriptPlugin, terser(), ...extraInfoPlugins],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

// const mainMinBundle: RollupOptions = {
//   input: "src/entry.single.ts",
//   output: {
//     file: "dist/index.min.js",
//     format: "esm",
//     sourcemap: true,
//   },
//   plugins: [resolve(), typescriptPlugin, terser()],
// };

const brokerWorkerBundle: RollupOptions = {
  input: "src/workers/cross-tab-shared-worker-broker.ts",
  output: {
    file: "dist/workers/cross-tab-shared-worker-broker.js",
    format: "iife", // IIFE format for SharedWorker
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
  },
  plugins: [resolve(), typescriptPlugin, terser(), ...extraInfoPlugins],
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
  plugins: [resolve(), typescriptPlugin, terser(), ...extraInfoPlugins],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

const broadcastChannelTransportBundle: RollupOptions = {
  input: "src/adapters/cross-tab/transports/broadcast-channel.ts",
  output: {
    file: "dist/adapters/cross-tab/transports/broadcast-channel.js",
    format: "esm",
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
    exports: "named",
  },
  plugins: [resolve(), typescriptPlugin, terser(), ...extraInfoPlugins],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

const sharedWorkerTransportBundle: RollupOptions = {
  input: "src/adapters/cross-tab/transports/shared-worker.ts",
  output: {
    file: "dist/adapters/cross-tab/transports/shared-worker.js",
    format: "esm",
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
    exports: "named",
  },
  plugins: [resolve(), typescriptPlugin, terser(), ...extraInfoPlugins],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

const storageTransportBundle: RollupOptions = {
  input: "src/adapters/cross-tab/transports/storage.ts",
  output: {
    file: "dist/adapters/cross-tab/transports/storage.js",
    format: "esm",
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
    exports: "named",
  },
  plugins: [resolve(), typescriptPlugin, terser(), ...extraInfoPlugins],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false,
  },
};

const autoTransportBundle: RollupOptions = {
  input: "src/adapters/cross-tab/transports/auto.ts",
  output: {
    file: "dist/adapters/cross-tab/transports/auto.js",
    format: "esm",
    sourcemap: true,
    generatedCode: {
      constBindings: true,
    },
    exports: "named",
  },
  plugins: [resolve(), typescriptPlugin, terser(), ...extraInfoPlugins],
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
  plugins: [resolve(), typescriptPlugin, terser(), ...extraInfoPlugins],
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
  plugins: [resolve(), typescriptPlugin, terser(), ...extraInfoPlugins],
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

const broadcastChannelTransportDtsBundle: RollupOptions = {
  input: "src/adapters/cross-tab/transports/broadcast-channel.ts",
  output: {
    file: "dist/adapters/cross-tab/transports/broadcast-channel.d.ts",
    format: "esm",
  },
  plugins: [dts()],
};

const sharedWorkerTransportDtsBundle: RollupOptions = {
  input: "src/adapters/cross-tab/transports/shared-worker.ts",
  output: {
    file: "dist/adapters/cross-tab/transports/shared-worker.d.ts",
    format: "esm",
  },
  plugins: [dts()],
};

const storageTransportDtsBundle: RollupOptions = {
  input: "src/adapters/cross-tab/transports/storage.ts",
  output: {
    file: "dist/adapters/cross-tab/transports/storage.d.ts",
    format: "esm",
  },
  plugins: [dts()],
};

const autoTransportDtsBundle: RollupOptions = {
  input: "src/adapters/cross-tab/transports/auto.ts",
  output: {
    file: "dist/adapters/cross-tab/transports/auto.d.ts",
    format: "esm",
  },
  plugins: [dts()],
};

// In watch mode, skip dts bundles for faster iteration
export default defineConfig(
  isWatchMode
    ? [
        mainBundle,
        brokerWorkerBundle,
        adapterBundle,
        broadcastChannelTransportBundle,
        sharedWorkerTransportBundle,
        storageTransportBundle,
        autoTransportBundle,
        iframeAdapterBundle,
        historyAdapterBundle,
      ]
    : [
        mainBundle,
        // mainMinBundle,
        brokerWorkerBundle,
        adapterBundle,
        broadcastChannelTransportBundle,
        sharedWorkerTransportBundle,
        storageTransportBundle,
        autoTransportBundle,
        iframeAdapterBundle,
        historyAdapterBundle,
        dtsBundle,
        adapterDtsBundle,
        broadcastChannelTransportDtsBundle,
        sharedWorkerTransportDtsBundle,
        storageTransportDtsBundle,
        autoTransportDtsBundle,
        iframeAdapterDtsBundle,
        historyAdapterDtsBundle,
      ]
);
