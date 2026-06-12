const test = require("node:test");
const assert = require("node:assert/strict");

const { createAmoClient } = require("../src/amocrm");

test("createAmoClient paginates leads until no next page exists", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.toString());

    if (url.toString().includes("page=1")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          _embedded: {
            leads: [{ id: 1 }]
          },
          _links: {
            next: { href: "/api/v4/leads?page=2&limit=250" }
          }
        })
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          leads: [{ id: 2 }]
        },
        _links: {}
      })
    };
  };

  const client = createAmoClient(
    {
      baseUrl: "https://pomaho.amocrm.ru",
      accessToken: "token"
    },
    fetchImpl
  );

  const leads = await client.fetchAllLeads();

  assert.deepEqual(leads, [{ id: 1 }, { id: 2 }]);
  assert.equal(calls.length, 2);
});

test("createAmoClient throws readable error when amoCRM responds with failure", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => "Unauthorized"
  });

  const client = createAmoClient(
    {
      baseUrl: "https://pomaho.amocrm.ru",
      accessToken: "token"
    },
    fetchImpl
  );

  await assert.rejects(
    () => client.fetchUsers(),
    /amoCRM API request failed: 401 Unauthorized/
  );
});
