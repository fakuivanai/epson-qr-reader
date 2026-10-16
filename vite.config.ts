import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  // Relative asset paths so the build works under any GitHub Pages subpath.
  base: "./",
  plugins: [solid(), tailwindcss()],
});
