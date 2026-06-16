const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const { createAmoClient } = require("./amocrm");
const { buildDashboardData } = require("./dashboard");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function validateConfig(env) {
  const missing = ["AMO_BASE_URL", "AMO_ACCESS_TOKEN"].filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    baseUrl: env.AMO_BASE_URL,
    accessToken: env.AMO_ACCESS_TOKEN,
    port: Number(env.PORT || 3000)
  };
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

function createServer({ loadDashboardData, publicDir = path.join(__dirname, "..", "public") }) {
  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");

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

async function loadDashboardDataFactory(config) {
  const client = createAmoClient(config);

  return async ({ from, to, managerIds }) => {
    const [leads, users, contacts, pipelines] = await Promise.all([
      client.fetchAllLeads(),
      client.fetchUsers(),
      client.fetchContacts(),
      client.fetchPipelines()
    ]);

    return buildDashboardData({
      from,
      to,
      managerIds,
      leads,
      users,
      contacts,
      pipelines
    });
  };
}

async function main() {
  loadEnvFile(path.join(__dirname, "..", ".env"));
  const config = validateConfig(process.env);
  const loadDashboardData = await loadDashboardDataFactory(config);
  const server = createServer({ loadDashboardData });

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
