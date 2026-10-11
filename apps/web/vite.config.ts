import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { viteStaticCopy } from "vite-plugin-static-copy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  // useRecommendedBuildConfig is off because its inlineDynamicImports breaks
  // module workers. The build options below are that recommended config minus
  // inlineDynamicImports, so the main bundle still inlines into dist/index.html
  // while the vision worker (and its lazy OpenCV chunk) emit as separate files.
  // See README "Build Notes".
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile({ useRecommendedBuildConfig: false }),
    // ONNX Runtime Web loads its .wasm backends at runtime (relative to
    // ort.env.wasm.wasmPaths, served from "ort/"). They live only in
    // node_modules, so copy them for dev serving and dist output alike instead
    // of committing binaries to the repo. Only the two builds the app uses:
    // plain threaded (wasm EP) and jsep + asyncify (webgpu EP — the webgpu
    // bundle dynamically imports the asyncify .mjs/.wasm at session init).
    viteStaticCopy({
      targets: [
        {
          src: "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{mjs,wasm,jsep.mjs,jsep.wasm,asyncify.mjs,asyncify.wasm}",
          dest: "ort",
          // Strip the node_modules/.../dist base dirs so files land flat in
          // ort/ instead of ort/node_modules/onnxruntime-web/dist/.
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5193",
    },
  },
  build: {
    assetsInlineLimit: () => true,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    assetsDir: "",
  },
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Use the extern-wasm ORT builds: the default subpath bundle inlines
      // every backend's .wasm as base64 (~110MB across engines), while these
      // load the statically-copied files from ort/ at runtime instead.
      "onnxruntime-web/wasm": path.resolve(
        __dirname,
        "../../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs",
      ),
      "onnxruntime-web/webgpu": path.resolve(
        __dirname,
        "../../node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs",
      ),
    },
  },
});
