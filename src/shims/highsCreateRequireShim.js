import loadHighs from "highs";
import highsWasmUrl from "highs/runtime?url";

export function createRequire() {
  return (specifier) => {
    if (specifier !== "highs") {
      throw new Error(`Unsupported browser require: ${specifier}`);
    }
    return (options = {}) =>
      loadHighs({
        locateFile: (file) => (file.endsWith(".wasm") ? highsWasmUrl : file),
        ...options,
      });
  };
}
