import { generateIdeas } from "./src/lib/ideas/generate";
import fs from "node:fs";
const db = JSON.parse(fs.readFileSync(".data/db.json", "utf8"));
const { ideas, signals } = generateIdeas(db, db.brands[0].id, new Date("2026-09-11"));
console.log("SIGNALS READ:");
for (const s of signals.read) console.log("  -", s);
console.log(`\n${ideas.length} IDEAS:`);
for (const i of ideas) console.log(`  [${i.score}] ${i.format.padEnd(8)} ${i.title}\n        why: ${i.reason}`);
