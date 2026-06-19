const filtersForm = document.querySelector("#filters");
const fromInput = document.querySelector("#from");
const toInput = document.querySelector("#to");
const managerListNode = document.querySelector("#managerList");
const managerCountNode = document.querySelector("#managerCount");
const dealCountNode = document.querySelector("#dealCount");
const topUpTotalNode = document.querySelector("#topUpTotal");
const managerChartNode = document.querySelector("#managerChart");
const monthChartNode = document.querySelector("#monthChart");
const periodLabelNode = document.querySelector("#periodLabel");
const statusMessageNode = document.querySelector("#statusMessage");
const dealsTableBodyNode = document.querySelector("#dealsTableBody");
const summaryTableBodyNode = document.querySelector("#summaryTableBody");
const DEFAULT_FROM_DATE = "2026-02-01";
const DEFAULT_TO_DATE = "2026-10-31";

function formatMoney(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function setDefaultDates() {
  fromInput.value = DEFAULT_FROM_DATE;
  toInput.value = DEFAULT_TO_DATE;
}

function createCell(text, className, colSpan) {
  const cell = document.createElement("td");
  cell.textContent = text;

  if (className) {
    cell.className = className;
  }

  if (colSpan) {
    cell.colSpan = colSpan;
  }

  return cell;
}

function formatMoneyShort(value) {
  if (value >= 1000000) {
    const millions = value / 1000000;
    return `${millions.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн`;
  }

  if (value >= 1000) {
    return `${Math.round(value / 1000).toLocaleString("ru-RU")} тыс.`;
  }

  return Math.round(value).toLocaleString("ru-RU");
}

function renderSummary(summary) {
  managerCountNode.textContent = String(summary.managerCount);
  dealCountNode.textContent = String(summary.dealCount);
  topUpTotalNode.textContent = formatMoney(summary.topUpTotal);
}

function renderChartEmpty(node) {
  node.innerHTML = "";
  const note = document.createElement("p");
  note.className = "chart-empty";
  note.textContent = "Нет данных за выбранный период";
  node.appendChild(note);
}

function renderManagerChart(rows) {
  managerChartNode.innerHTML = "";

  if (rows.length === 0) {
    renderChartEmpty(managerChartNode);
    return;
  }

  const maxTotal = Math.max(...rows.map((row) => row.topUpTotal), 1);

  rows.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "bar-row";

    const name = document.createElement("span");
    name.className = "bar-name";
    name.textContent = row.managerName;
    name.title = `${row.managerName} — сделок: ${row.dealCount}`;

    const track = document.createElement("div");
    track.className = "bar-track";

    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.max((row.topUpTotal / maxTotal) * 100, 1.5)}%`;
    fill.style.animationDelay = `${index * 70}ms`;
    track.appendChild(fill);

    const value = document.createElement("span");
    value.className = "bar-value money";
    value.textContent = formatMoney(row.topUpTotal);

    item.append(name, track, value);
    managerChartNode.appendChild(item);
  });
}

const MONTH_LABELS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function listMonths(from, to) {
  const months = [];
  let [year, month] = from.slice(0, 7).split("-").map(Number);
  const [endYear, endMonth] = to.slice(0, 7).split("-").map(Number);

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push({
      key: `${year}-${String(month).padStart(2, "0")}`,
      year,
      month
    });

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

function renderMonthChart(groups, period) {
  monthChartNode.innerHTML = "";

  const totalsByMonth = new Map();

  for (const group of groups) {
    for (const deal of group.deals) {
      const key = String(deal.plannedTopUpDate).slice(0, 7);
      totalsByMonth.set(key, (totalsByMonth.get(key) || 0) + deal.topUpTotal);
    }
  }

  const months = listMonths(period.from, period.to);

  if (months.length === 0 || totalsByMonth.size === 0) {
    renderChartEmpty(monthChartNode);
    return;
  }

  const multiYear = new Set(months.map((item) => item.year)).size > 1;
  const maxTotal = Math.max(...months.map((item) => totalsByMonth.get(item.key) || 0), 1);

  months.forEach((item, index) => {
    const total = totalsByMonth.get(item.key) || 0;

    const column = document.createElement("div");
    column.className = "col";

    const value = document.createElement("span");
    value.className = "col-value";
    value.textContent = total > 0 ? formatMoneyShort(total) : "";

    const track = document.createElement("div");
    track.className = "col-track";

    const fill = document.createElement("div");
    fill.className = total > 0 ? "col-fill" : "col-fill col-fill-empty";
    fill.style.height = total > 0 ? `${Math.max((total / maxTotal) * 100, 2)}%` : "2px";
    fill.style.animationDelay = `${index * 60}ms`;
    fill.title = `${MONTH_LABELS[item.month - 1]} ${item.year} — ${formatMoney(total)}`;
    track.appendChild(fill);

    const label = document.createElement("span");
    label.className = "col-label";
    label.textContent = multiYear
      ? `${MONTH_LABELS[item.month - 1]} ’${String(item.year).slice(2)}`
      : MONTH_LABELS[item.month - 1];

    column.append(value, track, label);
    monthChartNode.appendChild(column);
  });
}

function renderDeals(groups) {
  dealsTableBodyNode.innerHTML = "";

  for (const group of groups) {
    for (const deal of group.deals) {
      const row = document.createElement("tr");
      row.append(
        createCell(group.managerName),
        createCell(deal.dealName),
        createCell(deal.contactPhone),
        createCell(deal.plannedTopUpDate),
        createCell(formatMoney(deal.topUpTotal), "money")
      );
      dealsTableBodyNode.appendChild(row);
    }
  }
}

function renderManagerSummaries(rows) {
  summaryTableBodyNode.innerHTML = "";

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.append(
      createCell(row.managerName),
      createCell(String(row.dealCount)),
      createCell(formatMoney(row.topUpTotal), "money")
    );
    summaryTableBodyNode.appendChild(tr);
  }
}

function getSelectedManagerIds() {
  return Array.from(managerListNode.querySelectorAll('input[name="managerIds"]:checked'))
    .map((input) => input.value)
    .filter(Boolean);
}

function renderManagerFilter(filters) {
  const selectedManagerIds = new Set((filters?.selectedManagerIds || []).map(String));
  managerListNode.innerHTML = "";

  for (const manager of filters?.managers || []) {
    const label = document.createElement("label");
    label.className = "manager-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "managerIds";
    input.value = String(manager.managerId);
    input.checked = selectedManagerIds.has(String(manager.managerId));

    const text = document.createElement("span");
    text.textContent = manager.managerName;

    label.append(input, text);
    managerListNode.appendChild(label);
  }
}

async function loadDashboard(from, to, managerIds) {
  statusMessageNode.textContent = "Загружаю данные…";
  statusMessageNode.classList.remove("status-error");
  statusMessageNode.hidden = false;

  const params = new URLSearchParams({
    from,
    to
  });

  if (managerIds.length > 0) {
    params.set("managerIds", managerIds.join(","));
  }

  const response = await fetch(`/api/dashboard?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Не удалось загрузить данные");
  }

  return payload;
}

async function submitFilters() {
  const from = fromInput.value;
  const to = toInput.value;
  const managerIds = getSelectedManagerIds();

  try {
    const payload = await loadDashboard(from, to, managerIds);
    renderManagerFilter(payload.filters);
    renderSummary(payload.summary);
    renderManagerChart(payload.managerSummaries);
    renderMonthChart(payload.groups, payload.period);
    renderDeals(payload.groups);
    renderManagerSummaries(payload.managerSummaries);
    periodLabelNode.textContent = `${payload.period.from} — ${payload.period.to}`;

    if (payload.groups.length === 0) {
      statusMessageNode.textContent = "За выбранный период подходящих сделок нет.";
      statusMessageNode.hidden = false;
    } else {
      statusMessageNode.hidden = true;
    }
  } catch (error) {
    dealsTableBodyNode.innerHTML = "";
    summaryTableBodyNode.innerHTML = "";
    renderChartEmpty(managerChartNode);
    renderChartEmpty(monthChartNode);
    renderSummary({
      managerCount: 0,
      dealCount: 0,
      topUpTotal: 0
    });
    periodLabelNode.textContent = "Ошибка загрузки";
    statusMessageNode.textContent = error.message;
    statusMessageNode.classList.add("status-error");
    statusMessageNode.hidden = false;
  }
}

filtersForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitFilters();
});

function isAmoOrigin(origin) {
  try {
    const host = new URL(origin).hostname;
    return host === "amocrm.ru" || host.endsWith(".amocrm.ru");
  } catch (error) {
    return false;
  }
}

function readMessagePayload(data) {
  if (data && typeof data === "object") {
    return data;
  }

  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  return null;
}

// Привести payload postMessage к { from, to } через ту же логику, что и URL.
function resolveExternalPeriod(payload) {
  const data = readMessagePayload(payload);

  if (!data || !window.AmoPeriod) {
    return null;
  }

  const params = new URLSearchParams();
  if (typeof data.from === "string") {
    params.set("from", data.from);
  }
  if (typeof data.to === "string") {
    params.set("to", data.to);
  }
  if (typeof data.period === "string") {
    params.set("period", data.period);
  }

  return window.AmoPeriod.parsePeriodFromQuery(params.toString(), new Date());
}

// Стартовый период из URL самого iframe. Нет периода -> дефолтные даты (как раньше).
function applyInitialPeriod() {
  const resolved = window.AmoPeriod
    ? window.AmoPeriod.parsePeriodFromQuery(window.location.search, new Date())
    : null;

  if (resolved) {
    fromInput.value = resolved.from;
    toInput.value = resolved.to;
  } else {
    setDefaultDates();
  }
}

window.addEventListener("message", (event) => {
  if (!isAmoOrigin(event.origin)) {
    return;
  }

  const resolved = resolveExternalPeriod(event.data);
  if (!resolved) {
    return;
  }

  fromInput.value = resolved.from;
  toInput.value = resolved.to;
  void submitFilters();
});

applyInitialPeriod();
void submitFilters();
