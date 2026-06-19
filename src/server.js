const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const { createAmoClient } = require("./amocrm");
const { buildDashboardData } = require("./dashboard");
const { createStore } = require("./store");
const { createWebhookHandler, parseWebhook } = require("./sync");
const { runBackfill, parsePipelineId } = require("./backfill");
const { loadEnvFile } = require("./load-env");

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

function validateConfig(env) {
  const missing = ["AMO_BASE_URL", "AMO_ACCESS_TOKEN", "DATABASE_URL"].filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    baseUrl: env.AMO_BASE_URL,
    accessToken: env.AMO_ACCESS_TOKEN,
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL,
    pipelineId: parsePipelineId(env.PIPELINE_ID),
    webhookSecret: env.AMO_WEBHOOK_SECRET || null
  };
}

function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Webhook payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function parseManagerIds(value) {
  if (value === null || value === undefined || value === "") {
    return [];
  }

  const parts = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return [];
  }

  if (parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  return [...new Set(parts.map((part) => Number(part)))];
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendFile(response, filePath, contentType) {
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length
  });
  response.end(body);
}

function createServer({
  loadDashboardData,
  handleWebhook = null,
  handleResync = null,
  webhookSecret = null,
  publicDir = path.join(__dirname, "..", "public")
}) {
  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");

    if (requestUrl.pathname.startsWith("/webhook/")) {
      if (!webhookSecret || !handleWebhook) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      const token = decodeURIComponent(requestUrl.pathname.slice("/webhook/".length));
      if (!safeEqual(token, webhookSecret)) {
        sendJson(response, 403, { error: "Forbidden" });
        return;
      }

      // amoCRM при сохранении хука проверяет URL запросом GET и ждёт 200. Сами события приходят
      // POST-ом; на любой не-POST (GET/HEAD) просто отвечаем 200, иначе amoCRM считает адрес недоступным.
      if (request.method !== "POST") {
        sendJson(response, 200, { ok: true });
        return;
      }

      try {
        const rawBody = await readBody(request, MAX_WEBHOOK_BODY_BYTES);
        await handleWebhook(parseWebhook(rawBody));
      } catch (error) {
        // amoCRM отключает вебхук после серии не-200, поэтому всегда отвечаем 200 и логируем.
        console.error("Webhook processing failed:", error.message || error);
      }

      sendJson(response, 200, { ok: true });
      return;
    }

    // Реконсиляция: ночной cron дёргает этот эндпоинт и зеркало пересобирается из amoCRM.
    // Страховка от вебхуков, потерянных во время сна/деплоя free-сервиса.
    if (request.method === "POST" && requestUrl.pathname.startsWith("/resync/")) {
      if (!webhookSecret || !handleResync) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      const token = decodeURIComponent(requestUrl.pathname.slice("/resync/".length));
      if (!safeEqual(token, webhookSecret)) {
        sendJson(response, 403, { error: "Forbidden" });
        return;
      }

      try {
        const result = await handleResync();
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        // Как и вебхук, отвечаем 200/JSON, чтобы внешний планировщик не «зашумел» ретраями;
        // фактический статус виден в теле (ok:false) и в логах.
        console.error("Resync failed:", error.message || error);
        sendJson(response, 200, { ok: false, error: error.message || String(error) });
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/") {
      sendFile(response, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/styles.css") {
      sendFile(response, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/app.js") {
      sendFile(response, path.join(publicDir, "app.js"), "application/javascript; charset=utf-8");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/period.js") {
      sendFile(response, path.join(publicDir, "period.js"), "application/javascript; charset=utf-8");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/dashboard") {
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      const managerIds = parseManagerIds(requestUrl.searchParams.get("managerIds"));

      if (
        !from ||
        !to ||
        !isValidDateOnly(from) ||
        !isValidDateOnly(to) ||
        from > to ||
        managerIds === null
      ) {
        sendJson(response, 400, {
          error: "Invalid or missing query parameters: expected from and to in YYYY-MM-DD format and optional numeric managerIds"
        });
        return;
      }

      try {
        const payload = await loadDashboardData({ from, to, managerIds });
        sendJson(response, 200, payload);
      } catch (error) {
        sendJson(response, 500, {
          error: error.message || "Unknown server error"
        });
      }
      return;
    }

    sendJson(response, 404, {
      error: "Not found"
    });
  });
}

// Дашборд читает из зеркала (store), а не из живого API amoCRM.
function loadDashboardDataFromStore(store) {
  return async ({ from, to, managerIds }) => {
    const [leads, users, contacts, pipelines] = await Promise.all([
      store.getAllLeads(),
      store.getAllUsers(),
      store.getAllContacts(),
      store.getAllPipelines()
    ]);

    return buildDashboardData({ from, to, managerIds, leads, users, contacts, pipelines });
  };
}

async function main() {
  loadEnvFile(path.join(__dirname, "..", ".env"));
  const config = validateConfig(process.env);
  const store = await createStore({ connectionString: config.databaseUrl });
  const client = createAmoClient({
    baseUrl: config.baseUrl,
    accessToken: config.accessToken,
    requestDelayMs: 150
  });

  if (await store.isEmpty()) {
    console.log("Зеркало пустое — запускаю первичный бэкфилл из amoCRM…");
    await runBackfill({ client, store, pipelineId: config.pipelineId });
  }

  const { handleWebhook } = createWebhookHandler({
    client,
    store,
    pipelineId: config.pipelineId
  });
  const handleResync = () => runBackfill({ client, store, pipelineId: config.pipelineId });
  const loadDashboardData = loadDashboardDataFromStore(store);
  const server = createServer({
    loadDashboardData,
    handleWebhook,
    handleResync,
    webhookSecret: config.webhookSecret
  });

  if (!config.webhookSecret) {
    console.warn("AMO_WEBHOOK_SECRET не задан — эндпоинт /webhook отключён, зеркало не будет обновляться.");
  }

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`Dashboard is running on port ${config.port}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  createServer,
  validateConfig,
  loadEnvFile,
  parseManagerIds
};
