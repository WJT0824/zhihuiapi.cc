import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __ZH_BILLING_ENABLED__: process.env.ZH_CANVAS_BILLING === "disabled" ? "false" : "true",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "src/types"),
    },
  },
  build: {
    outDir: "dist",
  },
});
