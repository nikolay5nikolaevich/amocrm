const test = require("node:test");
const assert = require("node:assert/strict");

const { parseWebhook, createWebhookHandler } = require("../src/sync");

test("parseWebhook извлекает (событие, id) из bracketed-формы amoCRM", () => {
  const body =
    "leads[status][0][id]=123&leads[status][0][status_id]=456" +
    "&leads[add][0][id]=789&leads[delete][0][id]=111&account[subdomain]=test";

  const events = parseWebhook(body);
  const byId = new Map(events.map((event) => [event.id, event.event]));

  assert.equal(byId.get(123), "status");
  assert.equal(byId.get(789), "add");
  assert.equal(byId.get(111), "delete");
  assert.equal(events.length, 3);
});

test("parseWebhook: delete имеет приоритет над update для одной сделки", () => {
  const body = "leads[update][0][id]=5&leads[delete][0][id]=5";
  const events = parseWebhook(body);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { id: 5, event: "delete" });
});

test("parseWebhook игнорирует мусор и нечисловые id", () => {
  assert.deepEqual(parseWebhook(""), []);
  assert.deepEqual(parseWebhook("leads[status][0][id]=abc"), []);
  assert.deepEqual(parseWebhook("contacts[add][0][id]=10"), []);
});

function createFakeStore() {
  const upserted = [];
  const deleted = [];
  const contacts = new Set();
  return {
    upserted,
    deleted,
    upsertLead: (lead) => upserted.push(lead),
    deleteLead: (id) => deleted.push(id),
    hasContact: (id) => contacts.has(id),
    upsertContact: (contact) => contacts.add(contact.id),
    _contacts: contacts
  };
}

test("handleWebhook: add/update — фетчит сделку и делает upsert", async () => {
  const store = createFakeStore();
  const client = {
    fetchLeadById: async (id) => ({ id, name: "Сделка", pipeline_id: 7 }),
    fetchContactById: async (id) => ({ id, name: "Контакт" })
  };
  const { handleWebhook } = createWebhookHandler({ client, store, pipelineId: 7 });

  await handleWebhook([{ id: 100, event: "update" }]);

  assert.equal(store.upserted.length, 1);
  assert.equal(store.upserted[0].id, 100);
  assert.equal(store.deleted.length, 0);
});

test("handleWebhook: delete — удаляет сделку без обращения к API", async () => {
  const store = createFakeStore();
  let fetched = false;
  const client = {
    fetchLeadById: async () => {
      fetched = true;
      return null;
    }
  };
  const { handleWebhook } = createWebhookHandler({ client, store, pipelineId: 7 });

  await handleWebhook([{ id: 55, event: "delete" }]);

  assert.deepEqual(store.deleted, [55]);
  assert.equal(fetched, false);
});

test("handleWebhook: сделка из чужой воронки удаляется из зеркала", async () => {
  const store = createFakeStore();
  const client = {
    fetchLeadById: async (id) => ({ id, pipeline_id: 999 })
  };
  const { handleWebhook } = createWebhookHandler({ client, store, pipelineId: 7 });

  await handleWebhook([{ id: 100, event: "status" }]);

  assert.equal(store.upserted.length, 0);
  assert.deepEqual(store.deleted, [100]);
});

test("handleWebhook: подтягивает отсутствующий первичный контакт", async () => {
  const store = createFakeStore();
  const client = {
    fetchLeadById: async (id) => ({
      id,
      pipeline_id: 7,
      _embedded: { contacts: [{ id: 500 }] }
    }),
    fetchContactById: async (id) => ({ id, name: "Контакт 500" })
  };
  const { handleWebhook } = createWebhookHandler({ client, store, pipelineId: 7 });

  await handleWebhook([{ id: 100, event: "add" }]);

  assert.equal(store._contacts.has(500), true);
});
