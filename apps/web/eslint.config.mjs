import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import { rackPlugin } from "./eslint-rack.mjs";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Design-system guard: see eslint-rack.mjs and DESIGN.md → Enforcement.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { rack: rackPlugin },
    rules: { "rack/no-template-look": "error" },
  },
];

export default eslintConfig;
