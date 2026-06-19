const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAmoPeriod, parsePeriodFromQuery } = require("../public/period.js");

// Хелпер: локальная дата на полдень (полдень исключает сдвиги на границах суток).
// ВНИМАНИЕ: monthIndex здесь 0-based (июнь = 5), а в ожидаемых строках месяц 1-based.
function at(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12, 0, 0);
}

test("resolveAmoPeriod today -> один день", () => {
  assert.deepEqual(resolveAmoPeriod("today", at(2026, 5, 19)), {
    from: "2026-06-19",
    to: "2026-06-19"
  });
});

test("resolveAmoPeriod yesterday -> предыдущий день через границу месяца", () => {
  assert.deepEqual(resolveAmoPeriod("yesterday", at(2026, 6, 1)), {
    from: "2026-06-30",
    to: "2026-06-30"
  });
});

test("resolveAmoPeriod week -> понедельник..воскресенье (пятница)", () => {
  // 2026-06-19 — пятница => неделя пн 15 .. вс 21
  assert.deepEqual(resolveAmoPeriod("week", at(2026, 5, 19)), {
    from: "2026-06-15",
    to: "2026-06-21"
  });
});

test("resolveAmoPeriod week в воскресенье остаётся в той же неделе", () => {
  // 2026-06-21 — воскресенье => пн 15 .. вс 21
  assert.deepEqual(resolveAmoPeriod("week", at(2026, 5, 21)), {
    from: "2026-06-15",
    to: "2026-06-21"
  });
});

test("resolveAmoPeriod week через границу года", () => {
  // 2027-01-01 — пятница => неделя пн 2026-12-28 .. вс 2027-01-03
  assert.deepEqual(resolveAmoPeriod("week", at(2027, 0, 1)), {
    from: "2026-12-28",
    to: "2027-01-03"
  });
});

test("resolveAmoPeriod month -> первое..последнее число", () => {
  assert.deepEqual(resolveAmoPeriod("month", at(2026, 5, 19)), {
    from: "2026-06-01",
    to: "2026-06-30"
  });
});

test("resolveAmoPeriod month: високосный февраль", () => {
  assert.deepEqual(resolveAmoPeriod("month", at(2028, 1, 10)), {
    from: "2028-02-01",
    to: "2028-02-29"
  });
});

test("resolveAmoPeriod month: невисокосный февраль", () => {
  assert.deepEqual(resolveAmoPeriod("month", at(2026, 1, 10)), {
    from: "2026-02-01",
    to: "2026-02-28"
  });
});

test("resolveAmoPeriod -> null для неизвестного/пустого", () => {
  assert.equal(resolveAmoPeriod("decade", at(2026, 5, 19)), null);
  assert.equal(resolveAmoPeriod("", at(2026, 5, 19)), null);
  assert.equal(resolveAmoPeriod(undefined, at(2026, 5, 19)), null);
});

test("parsePeriodFromQuery берёт явные from/to", () => {
  assert.deepEqual(
    parsePeriodFromQuery("?from=2026-03-01&to=2026-03-31", at(2026, 5, 19)),
    { from: "2026-03-01", to: "2026-03-31" }
  );
});

test("parsePeriodFromQuery: from/to приоритетнее period", () => {
  assert.deepEqual(
    parsePeriodFromQuery("?period=today&from=2026-03-01&to=2026-03-31", at(2026, 5, 19)),
    { from: "2026-03-01", to: "2026-03-31" }
  );
});

test("parsePeriodFromQuery маппит ключевое слово period", () => {
  assert.deepEqual(parsePeriodFromQuery("?period=month", at(2026, 5, 19)), {
    from: "2026-06-01",
    to: "2026-06-30"
  });
});

test("parsePeriodFromQuery -> null при перевёрнутом диапазоне", () => {
  assert.equal(
    parsePeriodFromQuery("?from=2026-03-31&to=2026-03-01", at(2026, 5, 19)),
    null
  );
});

test("parsePeriodFromQuery -> null при невалидной дате", () => {
  assert.equal(
    parsePeriodFromQuery("?from=2026-02-30&to=2026-03-01", at(2026, 5, 19)),
    null
  );
});

test("parsePeriodFromQuery -> null для пустой строки", () => {
  assert.equal(parsePeriodFromQuery("", at(2026, 5, 19)), null);
  assert.equal(parsePeriodFromQuery("?", at(2026, 5, 19)), null);
});
