"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");

const apiDataHandler = require("./api/data");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function isSafePath(filePath) {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(ROOT);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(ROOT, requestedPath);
  if (!isSafePath(filePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  fs.stat(filePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    fs.createReadStream(filePath).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      const contentType = String(req.headers["content-type"] || "");
      if (!raw) {
        resolve({});
        return;
      }
      if (contentType.includes("application/json")) {
        try {
          resolve(JSON.parse(raw));
          return;
        } catch (error) {
          reject(new Error("Invalid JSON body"));
          return;
        }
      }
      resolve(raw);
    });
    req.on("error", reject);
  });
}

async function handleApiData(req, res, url) {
  try {
    req.query = Object.fromEntries(url.searchParams.entries());
    req.body =
      req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
        ? await readBody(req)
        : {};
    await apiDataHandler(req, res);
  } catch (error) {
    sendJson(res, 400, {
      error: "Bad request",
      detail: error && error.message ? error.message : String(error),
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "ITAssetTrack",
      api: "/api/data",
      now: new Date().toISOString(),
    });
    return;
  }

  if (pathname === "/api/data") {
    await handleApiData(req, res, url);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`ITAssetTrack server running on http://${HOST}:${PORT}`);
});
