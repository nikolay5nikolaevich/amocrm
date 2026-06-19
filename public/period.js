(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.AmoPeriod = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  // Локальная дата -> "YYYY-MM-DD" (без сдвига часового пояса).
  function formatLocalDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // Строгая проверка календарной валидности (отсекает 2026-02-30 и т.п.).
  function isValidDateOnly(value) {
    if (typeof value !== "string" || !DATE_ONLY.test(value)) {
      return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  // Ключевое слово периода amoCRM -> { from, to } (YYYY-MM-DD, локально) либо null.
  function resolveAmoPeriod(period, now) {
    const base =
      now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const key = String(period || "").trim().toLowerCase();

    if (key === "today") {
      const d = formatLocalDate(base);
      return { from: d, to: d };
    }

    if (key === "yesterday") {
      const y = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
      const d = formatLocalDate(y);
      return { from: d, to: d };
    }

    if (key === "week") {
      // getDay(): 0=вс..6=сб. Сдвиг до понедельника: пн->0, вс->6.
      const deltaToMonday = (base.getDay() + 6) % 7;
      const monday = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() - deltaToMonday
      );
      const sunday = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + 6
      );
      return { from: formatLocalDate(monday), to: formatLocalDate(sunday) };
    }

    if (key === "month") {
      const first = new Date(base.getFullYear(), base.getMonth(), 1);
      // День 0 следующего месяца = последнее число текущего (корректно для 28/29/30/31).
      const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      return { from: formatLocalDate(first), to: formatLocalDate(last) };
    }

    return null;
  }

  // Строка location.search -> { from, to } либо null.
  // Приоритет: валидные from&to -> иначе period -> иначе null.
  function parsePeriodFromQuery(search, now) {
    let params;
    try {
      params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    } catch (error) {
      return null;
    }

    const from = params.get("from");
    const to = params.get("to");

    if (isValidDateOnly(from) && isValidDateOnly(to) && from <= to) {
      return { from, to };
    }

    return resolveAmoPeriod(params.get("period"), now);
  }

  return { resolveAmoPeriod, parsePeriodFromQuery };
});
