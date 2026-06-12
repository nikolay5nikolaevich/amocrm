const DEFAULT_FIELD_NAMES = {
  dealAmount: ["сумма сделки"],
  prepaymentAmount: ["сумма предоплаты"],
  plannedTopUpDate: ["плановая дата доплаты"]
};

const DEFAULT_EXCLUDED_STAGE_NAMES = [
  "Успешно реализовано",
  "Отложено / заморожено",
  "Закрыто и не реализовано"
];

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function createStageNameMap(pipelines) {
  const stageNameMap = new Map();

  for (const pipeline of pipelines || []) {
    const statuses = pipeline.statuses || pipeline?._embedded?.statuses || [];

    for (const status of statuses) {
      stageNameMap.set(`${pipeline.id}:${status.id}`, status.name || "");
    }
  }

  return stageNameMap;
}

function getFieldValue(entity, fieldNames) {
  const wanted = new Set((fieldNames || []).map(normalizeText));

  for (const field of entity.custom_fields_values || []) {
    if (wanted.has(normalizeText(field.field_name))) {
      const firstValue = field.values?.[0]?.value;
      return firstValue ?? null;
    }
  }

  return null;
}

function getContactPhone(contact) {
  for (const field of contact?.custom_fields_values || []) {
    const matchesPhoneField =
      normalizeText(field.field_code) === "phone" || normalizeText(field.field_name) === "телефон";

    if (!matchesPhoneField) {
      continue;
    }

    for (const item of field.values || []) {
      if (item?.value) {
        return String(item.value).trim();
      }
    }
  }

  return null;
}

function getPrimaryContactId(lead) {
  return lead?._embedded?.contacts?.[0]?.id ?? null;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const cleaned = String(value)
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateOnly(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 9999999999 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : formatDateOnly(date);
  }

  const stringValue = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return stringValue;
  }

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(stringValue)) {
    const [day, month, year] = stringValue.split(".");
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(stringValue);
  return Number.isNaN(parsed.getTime()) ? null : formatDateOnly(parsed);
}

function buildDashboardData({
  from,
  to,
  managerIds = [],
  leads,
  users,
  contacts,
  pipelines,
  fieldNames = {},
  excludedStageNames = DEFAULT_EXCLUDED_STAGE_NAMES
}) {
  const selectedManagerIds = Array.isArray(managerIds) ? managerIds : [];
  const selectedManagerIdSet = new Set(selectedManagerIds);
  const hasManagerFilter = selectedManagerIdSet.size > 0;
  const stageNameMap = createStageNameMap(pipelines);
  const excludedStages = new Set(excludedStageNames.map(normalizeText));
  const userMap = new Map((users || []).map((user) => [user.id, user.name]));
  const contactMap = new Map((contacts || []).map((contact) => [contact.id, contact]));
  const managerOptions = (users || [])
    .filter((user) => user?.id && user?.name)
    .map((user) => ({
      managerId: user.id,
      managerName: user.name
    }))
    .sort((left, right) => left.managerName.localeCompare(right.managerName, "ru"));
  const groupsByManager = new Map();
  let dealCount = 0;
  let topUpTotal = 0;

  for (const lead of leads || []) {
    if (hasManagerFilter && !selectedManagerIdSet.has(lead.responsible_user_id)) {
      continue;
    }

    const stageName = stageNameMap.get(`${lead.pipeline_id}:${lead.status_id}`) || "";

    if (excludedStages.has(normalizeText(stageName))) {
      continue;
    }

    const plannedTopUpDate = parseDateValue(
      getFieldValue(lead, fieldNames.plannedTopUpDate || DEFAULT_FIELD_NAMES.plannedTopUpDate)
    );

    if (!plannedTopUpDate || plannedTopUpDate < from || plannedTopUpDate > to) {
      continue;
    }

    const dealAmount =
      parseMoney(getFieldValue(lead, fieldNames.dealAmount || DEFAULT_FIELD_NAMES.dealAmount)) ??
      parseMoney(lead.price);
    const prepaymentAmount = parseMoney(
      getFieldValue(lead, fieldNames.prepaymentAmount || DEFAULT_FIELD_NAMES.prepaymentAmount)
    );

    if (dealAmount === null || prepaymentAmount === null) {
      continue;
    }

    const topUp = dealAmount - prepaymentAmount;

    if (topUp <= 0) {
      continue;
    }

    const currentManagerId = lead.responsible_user_id ?? null;
    const managerName = userMap.get(currentManagerId) || "Без ответственного";
    const groupKey = currentManagerId ?? "unassigned";
    const group =
      groupsByManager.get(groupKey) ||
      {
        managerId: currentManagerId,
        managerName,
        deals: [],
        summary: {
          dealCount: 0,
          topUpTotal: 0
        }
      };
    const contactPhone = getContactPhone(contactMap.get(getPrimaryContactId(lead))) || "—";

    group.deals.push({
      leadId: lead.id ?? null,
      dealName: lead.name || "Без названия",
      contactPhone,
      plannedTopUpDate,
      topUpTotal: topUp
    });
    group.summary.dealCount += 1;
    group.summary.topUpTotal += topUp;

    groupsByManager.set(groupKey, group);
    dealCount += 1;
    topUpTotal += topUp;
  }

  const groups = Array.from(groupsByManager.values())
    .map((group) => ({
      managerId: group.managerId,
      managerName: group.managerName,
      deals: group.deals.slice().sort((left, right) => {
        if (right.topUpTotal !== left.topUpTotal) {
          return right.topUpTotal - left.topUpTotal;
        }

        return left.dealName.localeCompare(right.dealName, "ru");
      }),
      summary: {
        dealCount: group.summary.dealCount,
        topUpTotal: group.summary.topUpTotal
      }
    }))
    .sort((left, right) => {
      if (right.summary.topUpTotal !== left.summary.topUpTotal) {
        return right.summary.topUpTotal - left.summary.topUpTotal;
      }

      return left.managerName.localeCompare(right.managerName, "ru");
    });

  const managerSummaries = groups.map((group) => ({
    managerId: group.managerId,
    managerName: group.managerName,
    dealCount: group.summary.dealCount,
    topUpTotal: group.summary.topUpTotal
  }));

  return {
    period: {
      from,
      to
    },
    filters: {
      managers: managerOptions,
      selectedManagerIds
    },
    summary: {
      managerCount: groups.length,
      dealCount,
      topUpTotal
    },
    groups,
    managerSummaries
  };
}

module.exports = {
  buildDashboardData
};
