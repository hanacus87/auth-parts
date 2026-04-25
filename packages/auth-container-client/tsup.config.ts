import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "adapters/hono": "src/adapters/hono.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: false,
  clean: true,
  target: "node24",
  splitting: false,
  treeshake: true,
  external: ["jose", "hono"],
});
