const path = require("node:path");

const { createAmoClient } = require("./amocrm");
const { createStore } = require("./store");
const { loadEnvFile } = require("./load-env");

function parsePipelineId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

// Полный импорт сделок воронки и справочников в локальную БД. Запускается один раз
// (npm run backfill) либо автоматически, когда БД пуста.
async function runBackfill({ client, store, pipelineId = null, logger = console }) {
  logger.log("Бэкфилл: загружаю данные из amoCRM…");

  const [leads, users, contacts, pipelines] = [
    await client.fetchAllLeads(),
    await client.fetchUsers(),
    await client.fetchContacts(),
    await client.fetchPipelines()
  ];

  const scopedLeads =
    pipelineId == null ? leads : leads.filter((lead) => lead.pipeline_id === pipelineId);

  await store.replaceAllLeads(scopedLeads);
  await store.replaceAllUsers(users);
  await store.replaceAllContacts(contacts);
  await store.replaceAllPipelines(pipelines);
  await store.setMeta("last_backfill_at", new Date().toISOString());

  logger.log(
    `Бэкфилл завершён: сделок ${scopedLeads.length}, контактов ${contacts.length}, ` +
      `пользователей ${users.length}, воронок ${pipelines.length}.`
  );

  return { leads: scopedLeads.length, contacts: contacts.length, users: users.length };
}

async function main() {
  loadEnvFile(path.join(__dirname, "..", ".env"));

  const baseUrl = process.env.AMO_BASE_URL;
  const accessToken = process.env.AMO_ACCESS_TOKEN;

  const missing = ["AMO_BASE_URL", "AMO_ACCESS_TOKEN", "DATABASE_URL"].filter(
    (key) => !process.env[key]
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const client = createAmoClient({ baseUrl, accessToken, requestDelayMs: 150 });
  const store = await createStore();

  try {
    await runBackfill({
      client,
      store,
      pipelineId: parsePipelineId(process.env.PIPELINE_ID)
    });
  } finally {
    await store.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  runBackfill,
  parsePipelineId
};
