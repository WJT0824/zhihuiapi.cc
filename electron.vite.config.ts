import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __ZH_BILLING_ENABLED__: process.env.ZH_CANVAS_BILLING === "disabled" ? "false" : "true",
  },
  build: {
    outDir: "dist-electron",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "electron/main.ts"),
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: ["electron", "node:path", "node:fs", "node:fs/promises", "node:crypto", "node:url", "node:module"],
    },
  },
});
