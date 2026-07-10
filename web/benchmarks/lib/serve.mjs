import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import httpProxy from "http-proxy";
import { BASE_PATH, BACKEND_URL } from "../config.mjs";
import { log } from "./util.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

// Serves a built `dist/` at BASE_PATH and proxies every other path to the real
// OpenObserve backend, so the app runs same-origin (auth cookies work) while
// pointing at live data — identical setup for both commits.
export function startServer(distDir, port) {
  // Normalize to an absolute path so the traversal guard below compares
  // like-for-like (path.join strips a leading "./", which would otherwise
  // make every file 403 when a relative distDir is passed).
  distDir = path.resolve(distDir);
  const proxy = httpProxy.createProxyServer({
    target: BACKEND_URL,
    changeOrigin: true,
    secure: false,
    // Rewrite cookies so a cross-host backend session sticks on localhost.
    cookieDomainRewrite: "",
  });

  proxy.on("error", (err, _req, res) => {
    log("proxy error:", err.message);
    if (res && !res.headersSent) res.writeHead(502);
    if (res) res.end("proxy error");
  });

  // Staging is HTTPS and may set `Secure` / `SameSite=None` auth cookies, which
  // a browser refuses to store over http://localhost. Strip those flags so the
  // proxied session actually sticks (safe: this is a throwaway local origin).
  proxy.on("proxyRes", (proxyRes) => {
    const sc = proxyRes.headers["set-cookie"];
    if (Array.isArray(sc)) {
      proxyRes.headers["set-cookie"] = sc.map((c) =>
        c
          .replace(/;\s*Secure/gi, "")
          .replace(/;\s*SameSite=None/gi, "; SameSite=Lax"),
      );
    }
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith(BASE_PATH)) {
      let rel = pathname.slice(BASE_PATH.length);
      if (rel === "" || rel.endsWith("/")) rel += "index.html";
      let filePath = path.join(distDir, rel);

      // Prevent path traversal outside distDir.
      if (!filePath.startsWith(distDir)) {
        res.writeHead(403);
        return res.end("forbidden");
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        // SPA fallback — unknown routes get index.html.
        filePath = path.join(distDir, "index.html");
      }
      const ext = path.extname(filePath);
      fs.readFile(filePath, (err, buf) => {
        if (err) {
          res.writeHead(404);
          return res.end("not found");
        }
        res.writeHead(200, {
          "content-type": MIME[ext] || "application/octet-stream",
          // No caching so repeated Lighthouse runs are cold & comparable.
          "cache-control": "no-store",
        });
        res.end(buf);
      });
      return;
    }

    // Everything else → backend (/api, /auth, /config, /aws, ...).
    proxy.web(req, res);
  });

  // Proxy websockets too (streaming search).
  server.on("upgrade", (req, socket, head) => proxy.ws(req, socket, head));

  return new Promise((resolve) => {
    server.listen(port, () => {
      const appUrl = `http://localhost:${port}${BASE_PATH}`;
      log(`serving ${distDir} at ${appUrl} → proxy ${BACKEND_URL}`);
      resolve({
        url: appUrl,
        origin: `http://localhost:${port}`,
        close: () =>
          new Promise((r) => {
            proxy.close();
            server.close(() => r());
          }),
      });
    });
  });
}
