// Делает скриншот работающего дашборда в .agents/shots/dashboard.png
// Перед запуском поднимите дашборд: npm start
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, "shots", "dashboard.png");
const url = process.env.DASHBOARD_URL || "http://127.0.0.1:3000";

mkdirSync(path.join(root, "shots"), { recursive: true });

execSync(
  `npx playwright screenshot --full-page --viewport-size "1440,1000" --wait-for-timeout 3000 "${url}" "${out}"`,
  { stdio: "inherit" }
);

console.log(`Скриншот сохранён: ${out}`);
