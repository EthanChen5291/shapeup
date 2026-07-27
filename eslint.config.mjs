import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    ignores: [
      ".next/**",
      ".venv/**",
      "**/.venv/**",
      "coverage/**",
      "convex/_generated/**",
      // Vendored, not authored: emscripten glue for the face landmarker,
      // copied in by scripts/fetch-face-landmarker.mjs. Its minified GL
      // bindings trip rules-of-hooks on `GLctx.useProgram`.
      "public/mediapipe/**",
    ],
  },
];

export default eslintConfig;
