import { buildSession } from "./session.ts";

const clean = buildSession({ swap: false, off: false, wrong: false });
const planted = buildSession({ swap: true, off: true, wrong: true });
const blocked = buildSession({ swap: false, off: false, wrong: false }, { smuggle: true });

const line = (label: string, value: string) => console.log(`${label.padEnd(20)} ${value}`);

console.log("NULLROOM");
console.log("relic kernel · original bytecode · not a third-party image\n");
line("functions", String(clean.total));
line("exact match", `${clean.exact}/${clean.total}`);
line("raw lines copied", String(clean.wall.rawLines));
line("comparisons", String(clean.comparisons));
console.log("\nplanted codegen defects");
line("armed", String(planted.plantedArmed));
line("caught", String(planted.plantedCaught));
line("exact after plants", `${planted.exact}/${planted.total}`);
for (const row of planted.rows.filter((item) => item.status === "diverge")) {
  console.log(`  ${row.id}  ${row.mismatches}/${row.samples} miss  ${row.plant ?? ""}`);
}
console.log("");
line("smuggle blocked", String(blocked.wall.rawLines));
line("room B emitted", blocked.rows.some((row) => row.js.length > 0) ? "yes" : "no");
