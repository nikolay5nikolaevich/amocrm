const test = require("node:test");
const assert = require("node:assert/strict");

const { createStore } = require("../src/store");

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// Тесты store идут против реальной Postgres. Без TEST_DATABASE_URL — пропускаем,
// чтобы CI/локалка без БД не падали (см. ТЗ §4.7). Локально БД поднимается через Docker:
//   docker run --rm -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=dashboard -p 5432:5432 postgres:16-alpine
//   TEST_DATABASE_URL=postgres://postgres:dev@localhost:5432/dashboard npm test
test(
  "store (Postgres)",
  { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL не задан — нужен Postgres" },
  async (t) => {
    const store = await createStore({ connectionString: TEST_DATABASE_URL });
    t.after(() => store.close());

    // Между тестами чистим таблицы, чтобы они не влияли друг на друга.
    // meta не чистим — там используем уникальные ключи.
    t.beforeEach(async () => {
      await Promise.all([
        store.replaceAllLeads([]),
        store.replaceAllContacts([]),
        store.replaceAllUsers([]),
        store.replaceAllPipelines([])
      ]);
    });

    await t.test("upsertLead/getAllLeads round-trip сохраняет полный объект", async () => {
      const lead = {
        id: 42,
        name: "Сделка",
        pipeline_id: 7,
        status_id: 3,
        responsible_user_id: 9,
        custom_fields_values: [{ field_name: "Сумма сделки", values: [{ value: 1000 }] }]
      };

      await store.upsertLead(lead);
      const leads = await store.getAllLeads();

      assert.equal(leads.length, 1);
      assert.deepEqual(leads[0], lead);
    });

    await t.test("upsertLead обновляет существующую строку, не плодит дубли", async () => {
      await store.upsertLead({ id: 1, name: "Старое", pipeline_id: 7 });
      await store.upsertLead({ id: 1, name: "Новое", pipeline_id: 7 });

      const leads = await store.getAllLeads();
      assert.equal(leads.length, 1);
      assert.equal(leads[0].name, "Новое");
    });

    await t.test("deleteLead удаляет строку", async () => {
      await store.upsertLead({ id: 1, name: "A" });
      await store.upsertLead({ id: 2, name: "B" });
      await store.deleteLead(1);

      const leads = await store.getAllLeads();
      assert.equal(leads.length, 1);
      assert.equal(leads[0].id, 2);
    });

    await t.test("replaceAllLeads полностью заменяет набор в транзакции", async () => {
      await store.upsertLead({ id: 1, name: "Старое" });
      await store.replaceAllLeads([
        { id: 10, name: "X" },
        { id: 11, name: "Y" },
        { id: null, name: "пропускается" }
      ]);

      const ids = (await store.getAllLeads()).map((lead) => lead.id).sort((a, b) => a - b);
      assert.deepEqual(ids, [10, 11]);
    });

    await t.test("isEmpty и hasContact", async () => {
      assert.equal(await store.isEmpty(), true);
      await store.upsertLead({ id: 1 });
      assert.equal(await store.isEmpty(), false);

      assert.equal(await store.hasContact(5), false);
      await store.upsertContact({ id: 5, name: "Контакт" });
      assert.equal(await store.hasContact(5), true);
    });

    await t.test("meta get/set", async () => {
      const key = `last_backfill_at_${Date.now()}`;
      assert.equal(await store.getMeta(key), null);
      await store.setMeta(key, "2026-06-16T00:00:00.000Z");
      assert.equal(await store.getMeta(key), "2026-06-16T00:00:00.000Z");
    });

    await t.test("справочники users/contacts/pipelines читаются как массивы объектов", async () => {
      await store.replaceAllUsers([{ id: 1, name: "Менеджер" }]);
      await store.replaceAllPipelines([{ id: 7, name: "Воронка", _embedded: { statuses: [] } }]);

      assert.deepEqual(await store.getAllUsers(), [{ id: 1, name: "Менеджер" }]);
      assert.equal((await store.getAllPipelines())[0].id, 7);
    });
  }
);
