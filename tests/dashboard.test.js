const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDashboardData } = require("../src/dashboard");

test("buildDashboardData groups valid deals by responsible manager and sums top-ups", () => {
  const from = "2026-06-01";
  const to = "2026-06-30";

  const result = buildDashboardData({
    from,
    to,
    leads: [
      {
        id: 1,
        name: "River Park / doors",
        responsible_user_id: 10,
        pipeline_id: 1,
        status_id: 101,
        price: 1000000,
        custom_fields_values: [
          { field_name: "сумма предоплаты", values: [{ value: 400000 }] },
          { field_name: "плановая дата доплаты", values: [{ value: "2026-06-15" }] }
        ]
      },
      {
        id: 2,
        name: "Sadovy / parquet",
        responsible_user_id: 10,
        pipeline_id: 1,
        status_id: 102,
        price: 700000,
        custom_fields_values: [
          { field_name: "сумма предоплаты", values: [{ value: 300000 }] },
          { field_name: "плановая дата доплаты", values: [{ value: "2026-06-20" }] }
        ]
      },
      {
        id: 3,
        name: "Closed lead",
        responsible_user_id: 11,
        pipeline_id: 1,
        status_id: 199,
        price: 500000,
        custom_fields_values: [
          { field_name: "сумма предоплаты", values: [{ value: 100000 }] },
          { field_name: "плановая дата доплаты", values: [{ value: "2026-06-10" }] }
        ]
      }
    ],
    users: [
      { id: 10, name: "Матвей" },
      { id: 11, name: "Nikolay" }
    ],
    pipelines: [
      {
        id: 1,
        statuses: [
          { id: 101, name: "Ожидание доплаты" },
          { id: 102, name: "Отгрузка" },
          { id: 199, name: "Закрыто и не реализовано" }
        ]
      }
    ]
  });

  assert.deepEqual(result.summary, {
    managerCount: 1,
    dealCount: 2,
    topUpTotal: 1000000
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].managerName, "Матвей");
  assert.equal(result.rows[0].dealCount, 2);
  assert.equal(result.rows[0].topUpTotal, 1000000);
});

test("buildDashboardData excludes deals outside the period or with non-positive top-up", () => {
  const result = buildDashboardData({
    from: "2026-06-01",
    to: "2026-06-30",
    leads: [
      {
        id: 1,
        responsible_user_id: 10,
        pipeline_id: 1,
        status_id: 101,
        price: 500000,
        custom_fields_values: [
          { field_name: "сумма предоплаты", values: [{ value: 500000 }] },
          { field_name: "плановая дата доплаты", values: [{ value: "2026-06-12" }] }
        ]
      },
      {
        id: 2,
        responsible_user_id: 10,
        pipeline_id: 1,
        status_id: 101,
        price: 500000,
        custom_fields_values: [
          { field_name: "сумма предоплаты", values: [{ value: 100000 }] },
          { field_name: "плановая дата доплаты", values: [{ value: "2026-07-12" }] }
        ]
      }
    ],
    users: [{ id: 10, name: "Матвей" }],
    pipelines: [{ id: 1, statuses: [{ id: 101, name: "Ожидание доплаты" }] }]
  });

  assert.equal(result.summary.dealCount, 0);
  assert.equal(result.rows.length, 0);
});
