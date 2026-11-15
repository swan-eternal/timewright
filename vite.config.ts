import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./src/viewer", import.meta.url)),
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./dist-viewer", import.meta.url)),
    emptyOutDir: true,
  },
});
