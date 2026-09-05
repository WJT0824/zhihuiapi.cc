import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist-electron",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "electron/preload.ts"),
      formats: ["cjs"],
      fileName: () => "preload.cjs",
    },
    rollupOptions: {
      external: ["electron"],
    },
  },
});
