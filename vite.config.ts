import { defineConfig } from "vite";

// Fully static build. Relative base so it can be hosted in a subfolder.
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
  },
});
