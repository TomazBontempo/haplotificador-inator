import { fileURLToPath } from "node:url";

export default {
  resolve: {
    alias: {
      "node:module": fileURLToPath(
        new URL("./src/shims/highsCreateRequireShim.js", import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    include: ["highs"],
  },
  assetsInclude: ["**/*.wasm"],
  build: {
    outDir: "dist",
  },
};
