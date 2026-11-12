import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./", // relative paths so the build works on Vercel, GitHub Pages or any static host
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom"], genlayer: ["genlayer-js"] },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/frontend/**/*.test.{js,jsx}"],
    setupFiles: ["tests/frontend/setup.js"],
  },
});
