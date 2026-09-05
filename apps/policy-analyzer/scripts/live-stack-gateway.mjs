#!/usr/bin/env node
/**
 * Loopback API gateway for the disposable local live-DB stack.
 * Does not log request bodies, tokens, or query strings.
 * Browser clients on loopback origins may call Auth; other origins get no CORS grant.
 */
import http from "node:http";

const AUTH = process.env.LIVE_AUTH_ORIGIN || "http://127.0.0.1:9999";
const REST = process.env.LIVE_REST_ORIGIN || "http://127.0.0.1:3000";
const STORAGE = process.env.LIVE_STORAGE_ORIGIN || "http://127.0.0.1:5000";
const PORT = Number(process.env.LIVE_GATEWAY_PORT || 54321);

function targetFor(urlPath) {
  if (urlPath === "/auth" || urlPath.startsWith("/auth/")) {
    return { origin: AUTH, path: urlPath.replace(/^\/auth\/v1/, "") || "/" };
  }
  if (urlPath === "/rest" || urlPath.startsWith("/rest/")) {
    return { origin: REST, path: urlPath.replace(/^\/rest\/v1/, "") || "/" };
  }
  if (urlPath === "/storage" || urlPath.startsWith("/storage/")) {
    return { origin: STORAGE, path: urlPath.replace(/^\/storage\/v1/, "") || "/" };
  }
  return null;
}

function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !isLoopbackOrigin(origin)) return null;
  const requested = req.headers["access-control-request-headers"];
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    "access-control-allow-headers":
      typeof requested === "string" && requested.trim()
        ? requested
        : "authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept,x-upsert",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "600",
    vary: "Origin"
  };
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  const pathOnly = url.split("?")[0];
  const mapped = targetFor(pathOnly);
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors || { vary: "Origin" });
    res.end();
    return;
  }
  if (!mapped) {
    res.statusCode = 404;
    if (cors) {
      for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
    }
    res.end("not_found");
    return;
  }
  const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  const dest = new URL(mapped.path + query, mapped.origin);
  const headers = { ...req.headers, host: dest.host };
  const upstream = http.request(
    {
      protocol: dest.protocol,
      hostname: dest.hostname,
      port: dest.port,
      path: dest.pathname + dest.search,
      method: req.method,
      headers
    },
    (up) => {
      const outgoing = { ...up.headers };
      if (cors) Object.assign(outgoing, cors);
      res.writeHead(up.statusCode || 502, outgoing);
      up.pipe(res);
    }
  );
  upstream.on("error", () => {
    if (!res.headersSent) {
      if (cors) {
        for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
      }
      res.statusCode = 502;
      res.end("upstream_unavailable");
    }
  });
  req.pipe(upstream);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`gateway listening on 127.0.0.1:${PORT}\n`);
});
