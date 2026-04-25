import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: false,
  clean: true,
  target: "es2022",
  splitting: false,
  treeshake: true,
  external: ["jose", "react", "react/jsx-runtime"],
});
