const path = require("node:path");

const { createStore } = require("./store");
const { loadEnvFile } = require("./load-env");

// Быстрая проверка здоровья БД: подключаемся по DATABASE_URL и печатаем счётчики зеркала.
// Если подключиться не удалось — выходим с ненулевым кодом и понятным сообщением.
async function main() {
  loadEnvFile(path.join(__dirname, "..", ".env"));

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL не задан в .env");
  }

  const store = await createStore();
  try {
    const [leads, contacts, users, pipelines] = await Promise.all([
      store.getAllLeads(),
      store.getAllContacts(),
      store.getAllUsers(),
      store.getAllPipelines()
    ]);
    const lastBackfill = (await store.getMeta("last_backfill_at")) ?? "—";

    console.log("БД доступна. Содержимое зеркала:");
    console.log(`  сделок:            ${leads.length}`);
    console.log(`  контактов:         ${contacts.length}`);
    console.log(`  пользователей:     ${users.length}`);
    console.log(`  воронок:           ${pipelines.length}`);
    console.log(`  последний бэкфилл: ${lastBackfill}`);
  } finally {
    await store.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("БД недоступна:", error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
