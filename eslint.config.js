import js from "@eslint/js"
import boundaries from "eslint-plugin-boundaries"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "**/dist/**",
      ".expo/**",
      "**/android/**",
      "**/ios/**",
      "data/**",
      "projects/**",
      "scripts/**",
      "research/**",
      "planning/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/include": ["apps/**/*", "packages/**/*", "src/**/*"],
      "boundaries/elements": [
        {
          type: "app",
          pattern: "apps/*",
          capture: ["app"],
        },
        {
          type: "package",
          pattern: "packages/*",
          capture: ["package"],
        },
        {
          type: "server",
          pattern: "src/*",
          capture: ["module"],
        },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "app", allow: ["package"] },
            { from: "package", allow: ["package"] },
            { from: "server", allow: ["package"] },
          ],
        },
      ],
      "no-console": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        crypto: "readonly",
      },
    },
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-undef": "off",
    },
  }
)
