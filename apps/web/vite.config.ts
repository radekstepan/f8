import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

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
    // Note: all neural heal engines run on the photo server
    // (onnxruntime-node) — the browser ships no ONNX runtime.
  ],
  server: {
    proxy: {
      // F8_API lets Playwright e2e point the app at the isolated
      // test server (127.0.0.1:5194); local dev keeps the default 5193.
      "/api": process.env.F8_API ?? "http://127.0.0.1:5193",
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
    },
  },
});
