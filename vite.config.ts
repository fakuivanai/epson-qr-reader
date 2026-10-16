/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  // Relative asset paths so the build works under any GitHub Pages subpath.
  base: "./",
  plugins: [solid(), tailwindcss()],
  // The tests cover pure decoding logic and need no DOM.
  test: { environment: "node" },
});
