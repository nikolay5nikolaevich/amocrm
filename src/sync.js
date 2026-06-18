const querystring = require("node:querystring");

const LEAD_EVENTS = ["add", "update", "status", "delete"];
// «delete» имеет приоритет: если в одном батче сделку и изменили, и удалили — удаляем.
const EVENT_PRIORITY = { delete: 3, status: 2, update: 1, add: 0 };

// Тело вебхука amoCRM приходит как application/x-www-form-urlencoded
// с ключами вида leads[status][0][id], leads[add][1][id], leads[delete][0][id] и т.п.
// Нам достаточно вытащить пары (событие, id сделки) — детали всё равно дочитываем через API.
function parseWebhook(rawBody) {
  const parsed = querystring.parse(String(rawBody || ""));
  const byId = new Map();

  const keyPattern = /^leads\[(add|update|status|delete)\]\[\d+\]\[id\]$/;

  for (const [key, value] of Object.entries(parsed)) {
    const match = keyPattern.exec(key);
    if (!match) {
      continue;
    }

    const event = match[1];
    const id = Number(Array.isArray(value) ? value[0] : value);

    if (!Number.isInteger(id) || id <= 0) {
      continue;
    }

    const existing = byId.get(id);
    if (!existing || EVENT_PRIORITY[event] > EVENT_PRIORITY[existing]) {
      byId.set(id, event);
    }
  }

  return [...byId.entries()].map(([id, event]) => ({ id, event }));
}

function getPrimaryContactId(lead) {
  return lead?._embedded?.contacts?.[0]?.id ?? null;
}

function createWebhookHandler({ client, store, pipelineId = null }) {
  async function applyEvent({ id, event }) {
    if (event === "delete") {
      await store.deleteLead(id);
      return;
    }

    const lead = await client.fetchLeadById(id);

    if (!lead || lead.id == null) {
      return;
    }

    // Сделка вне нашей воронки — в зеркале её быть не должно.
    if (pipelineId != null && lead.pipeline_id !== pipelineId) {
      await store.deleteLead(lead.id);
      return;
    }

    await store.upsertLead(lead);

    // Телефон берётся из контакта — подтягиваем его, если ещё не зеркалили.
    const contactId = getPrimaryContactId(lead);
    if (contactId != null && !(await store.hasContact(contactId))) {
      const contact = await client.fetchContactById(contactId);
      if (contact && contact.id != null) {
        await store.upsertContact(contact);
      }
    }
  }

  async function handleWebhook(events) {
    for (const item of events || []) {
      await applyEvent(item);
    }
  }

  return { handleWebhook };
}

module.exports = {
  parseWebhook,
  createWebhookHandler,
  LEAD_EVENTS
};
