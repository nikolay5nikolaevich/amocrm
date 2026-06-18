const path = require("node:path");

const { Pool } = require("pg");

const { buildPoolConfig } = require("./store");
const { loadEnvFile } = require("./load-env");

// Локальная пересборка схемы: дропаем все таблицы, после чего следующий старт
// сервиса (или backfill) создаст их заново. Удобно для тестов с Docker-Postgres.
async function main() {
  loadEnvFile(path.join(__dirname, "..", ".env"));

  if (!process.env.DATABASE_URL) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  const pool = new Pool(buildPoolConfig(process.env.DATABASE_URL));
  try {
    await pool.query("DROP TABLE IF EXISTS leads, contacts, users, pipelines, meta CASCADE");
    console.log("Схема сброшена: таблицы удалены. Следующий старт пересоздаст их.");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { main };
