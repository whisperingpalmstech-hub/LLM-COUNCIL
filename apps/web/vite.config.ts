import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": target,
      "/uploads": target,
      "/ws": { target: target.replace("http", "ws"), ws: true }
    }
  }
});
