// Dev-only: serves the UI against the local DBM backend on 5110 through a
// same-origin proxy (avoids CORS). `/node` is deliberately absent from the
// prefix list — it would swallow /node_modules. Safe to delete.
import { defineConfig, loadEnv } from "vite";
import baseFactory from "./vite.config";

export default defineConfig(async (env) => {
  const base = typeof baseFactory === "function" ? await (baseFactory as any)(env) : baseFactory;
  return {
    ...base,
    server: {
      ...(base as any).server,
      port: 5190,
      strictPort: true,
      proxy: {
        "/api": { target: "http://localhost:5110", changeOrigin: true },
        "/config": { target: "http://localhost:5110", changeOrigin: true },
        "/auth": { target: "http://localhost:5110", changeOrigin: true },
      },
    },
  };
});
