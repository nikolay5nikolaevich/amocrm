const { Pool } = require("pg");

// Убирает только параметр sslmode из query-части строки, не трогая логин/пароль/хост.
function stripSslmode(connectionString) {
  const queryIndex = connectionString.indexOf("?");
  if (queryIndex === -1) {
    return connectionString;
  }

  const base = connectionString.slice(0, queryIndex);
  const params = connectionString
    .slice(queryIndex + 1)
    .split("&")
    .filter((part) => part && !/^sslmode=/i.test(part));

  return params.length > 0 ? `${base}?${params.join("&")}` : base;
}

// Neon и большинство managed-Postgres требуют SSL, локальный Postgres (Docker) — нет.
// Решаем по строке подключения: sslmode=require или нелокальный хост → SSL включён;
// sslmode=disable или localhost → SSL выключен. Единый источник правды для store и db-reset.
function buildPoolConfig(connectionString) {
  const cs = connectionString || process.env.DATABASE_URL || "";

  let ssl = false;
  if (/sslmode=require/i.test(cs)) {
    ssl = { rejectUnauthorized: false };
  } else if (!/sslmode=disable/i.test(cs) && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(cs)) {
    // Нелокальный хост без явного sslmode — считаем managed (Neon) и включаем SSL.
    ssl = { rejectUnauthorized: false };
  }

  // SSL задаётся явным объектом ssl выше, поэтому sslmode в строке лишний. Убираем его, иначе
  // pg-connection-string печатает SECURITY WARNING про смену семантики sslmode в pg v9.
  return { connectionString: ssl ? stripSslmode(cs) : cs, ssl, max: 5 };
}

// Схема создаётся при старте идемпотентно (CREATE TABLE IF NOT EXISTS),
// поэтому несколько инстансов сервиса не мешают друг другу.
const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS leads (
    id BIGINT PRIMARY KEY,
    pipeline_id BIGINT,
    status_id BIGINT,
    responsible_user_id BIGINT,
    updated_at BIGINT,
    data JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads (pipeline_id);
  CREATE TABLE IF NOT EXISTS contacts  (id BIGINT PRIMARY KEY, data JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS users     (id BIGINT PRIMARY KEY, data JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS pipelines (id BIGINT PRIMARY KEY, data JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS meta      (key TEXT PRIMARY KEY, value TEXT);
`;

// Фабрика async: нужно поднять пул соединений и создать схему до первого запроса.
async function createStore({ connectionString } = {}) {
  const pool = new Pool(buildPoolConfig(connectionString));
  await pool.query(SCHEMA_DDL);

  // upsert-функции принимают первым аргументом «исполнителя» запроса (pool или client),
  // чтобы один и тот же код работал и вне транзакции, и внутри replaceAll.
  function upsertLead(q, lead) {
    return q.query(
      `INSERT INTO leads (id, pipeline_id, status_id, responsible_user_id, updated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         pipeline_id = $2,
         status_id = $3,
         responsible_user_id = $4,
         updated_at = $5,
         data = $6::jsonb`,
      [
        lead.id,
        lead.pipeline_id ?? null,
        lead.status_id ?? null,
        lead.responsible_user_id ?? null,
        lead.updated_at ?? null,
        JSON.stringify(lead)
      ]
    );
  }

  function upsertSimple(q, table, item) {
    return q.query(
      `INSERT INTO ${table} (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = $2::jsonb`,
      [item.id, JSON.stringify(item)]
    );
  }

  // Полная замена набора строго в транзакции на отдельном соединении: при сбое
  // backfill таблица не остаётся полупустой (BEGIN/COMMIT/ROLLBACK как в SQLite-версии).
  async function replaceAll(table, items, upsertOne) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ${table}`);
      for (const item of items || []) {
        if (item && item.id != null) {
          await upsertOne(client, item);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function readAll(table) {
    const result = await pool.query(`SELECT data FROM ${table}`);
    return result.rows.map((row) => row.data); // JSONB уже распарсен драйвером
  }

  return {
    upsertLead: (lead) => upsertLead(pool, lead),
    deleteLead: async (id) => {
      await pool.query("DELETE FROM leads WHERE id = $1", [id]);
    },
    upsertContact: (contact) => upsertSimple(pool, "contacts", contact),
    upsertUser: (user) => upsertSimple(pool, "users", user),
    upsertPipeline: (pipeline) => upsertSimple(pool, "pipelines", pipeline),
    hasContact: async (id) => {
      const result = await pool.query("SELECT 1 FROM contacts WHERE id = $1", [id]);
      return result.rowCount > 0;
    },
    replaceAllLeads: (leads) => replaceAll("leads", leads, upsertLead),
    replaceAllContacts: (contacts) =>
      replaceAll("contacts", contacts, (q, item) => upsertSimple(q, "contacts", item)),
    replaceAllUsers: (users) =>
      replaceAll("users", users, (q, item) => upsertSimple(q, "users", item)),
    replaceAllPipelines: (pipelines) =>
      replaceAll("pipelines", pipelines, (q, item) => upsertSimple(q, "pipelines", item)),
    getAllLeads: () => readAll("leads"),
    getAllContacts: () => readAll("contacts"),
    getAllUsers: () => readAll("users"),
    getAllPipelines: () => readAll("pipelines"),
    isEmpty: async () => {
      const result = await pool.query("SELECT 1 FROM leads LIMIT 1");
      return result.rowCount === 0;
    },
    getMeta: async (key) => {
      const result = await pool.query("SELECT value FROM meta WHERE key = $1", [key]);
      return result.rows[0]?.value ?? null;
    },
    setMeta: async (key, value) => {
      await pool.query(
        `INSERT INTO meta (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, String(value)]
      );
    },
    close: () => pool.end()
  };
}

module.exports = {
  createStore,
  buildPoolConfig
};
