const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createServer, validateConfig } = require("../src/server");

function request(server, path) {
  const address = server.address();

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path,
        method: "GET"
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

test("validateConfig rejects missing environment variables", () => {
  assert.throws(
    () => validateConfig({}),
    /Missing required environment variables: AMO_BASE_URL, AMO_ACCESS_TOKEN/
  );
});

test("createServer returns 400 when dashboard period is invalid", async () => {
  const server = createServer({
    loadDashboardData: async () => ({})
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await request(server, "/api/dashboard?from=bad&to=2026-06-30");
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /Invalid or missing query parameters/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createServer returns dashboard JSON for a valid request", async () => {
  const server = createServer({
    loadDashboardData: async ({ from, to }) => ({
      period: { from, to },
      summary: {
        managerCount: 1,
        dealCount: 2,
        topUpTotal: 1000000
      },
      rows: [
        {
          managerId: 10,
          managerName: "Матвей",
          dealCount: 2,
          topUpTotal: 1000000
        }
      ]
    })
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await request(server, "/api/dashboard?from=2026-06-01&to=2026-06-30");
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");

    const body = JSON.parse(response.body);
    assert.equal(body.summary.topUpTotal, 1000000);
    assert.equal(body.rows[0].managerName, "Матвей");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
