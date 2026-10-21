import { createServer } from "node:http";
import { PublicError } from "./security.js";

const MAX_JSON_BYTES = 64 * 1024;

function clientIp(request, trustProxy) {
  const forwarded = request.headers["x-forwarded-for"];
  return (trustProxy && typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "")
    || request.socket.remoteAddress
    || "unknown";
}

async function readJson(request) {
  const contentType = String(request.headers["content-type"] || "").split(";")[0].trim();
  if (contentType !== "application/json") throw new PublicError(415, "Content-Type must be application/json.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new PublicError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PublicError(400, "Request body must contain valid JSON.");
  }
}

function applyCors(request, response, config) {
  const origin = request.headers.origin || "";
  if (origin && config.allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Upload-Token");
    response.setHeader("Access-Control-Max-Age", "600");
    return origin;
  }
  if (origin) throw new PublicError(403, "This application origin is not allowed.");
  return "";
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

export function createUploadServer({ config, authorizationService, secureUploadService }) {
  return createServer(async (request, response) => {
    try {
      const origin = applyCors(request, response, config);
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      const url = new URL(request.url || "/", "http://upload-service.local");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, providerConfigured: Boolean(config.pinataJwt) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/upload/challenge") {
        const result = authorizationService.createChallenge(await readJson(request), {
          ip: clientIp(request, config.trustProxy), origin,
        });
        sendJson(response, 201, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/upload/authorize") {
        const result = await authorizationService.authorize(await readJson(request), {
          ip: clientIp(request, config.trustProxy), origin,
        });
        sendJson(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/upload") {
        const token = request.headers["x-upload-token"];
        const identity = authorizationService.consumeUploadToken(Array.isArray(token) ? "" : token);
        const result = await secureUploadService.process({ request, identity });
        sendJson(response, 201, result);
        return;
      }
      throw new PublicError(404, "Endpoint not found.");
    } catch (error) {
      const status = error instanceof PublicError ? error.status : 500;
      const message = error instanceof PublicError ? error.message : "Unexpected upload service error.";
      sendJson(response, status, { error: message });
    }
  });
}
