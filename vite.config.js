export default {
  plugins: [
    {
      name: "highs-create-require-shim",
      enforce: "pre",
      resolveId(id) {
        if (id === "virtual:highs-create-require-shim") {
          return "\0highs-create-require-shim";
        }
        return null;
      },
      load(id) {
        if (id !== "\0highs-create-require-shim") {
          return null;
        }

        return `
          import loadHighs from "highs";
          import highsWasmUrl from "highs/runtime?url";

          export function createRequire() {
            return (specifier) => {
              if (specifier !== "highs") {
                throw new Error(\`Unsupported browser require: \${specifier}\`);
              }
              return (options = {}) => loadHighs({
                locateFile: (file) => file.endsWith(".wasm") ? highsWasmUrl : file,
                ...options,
              });
            };
          }
        `;
      },
    },
  ],
  resolve: {
    alias: {
      "node:module": "virtual:highs-create-require-shim",
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
