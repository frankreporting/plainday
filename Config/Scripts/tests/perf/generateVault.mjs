// Writes an invented vault for timing (OBS-185, OBS-182): daily notes for `years` years ending
// 2026-10-15, with tasks, time entries and project links; projects with task lines sent to days
// (a forward date and a shared ID); task notes; and reference notes up to `notes` in all. Every name is made
// up. Usage: node generateVault.mjs --notes 40000 --years 10 --out /path/outside/the/repo [--seed 1]
import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; };
const total = Number(arg("notes", 4000)), years = Number(arg("years", 10)), out = arg("out", null);
if (!out) { console.error("--out is required"); process.exit(1); }
let seed = Number(arg("seed", 1));
const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (list) => list[Math.floor(random() * list.length)];
const id = () => Array.from({ length: 6 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)]).join("");
const write = (rel, text) => { const p = path.join(out, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const day = (d) => d.toISOString().slice(0, 10);
const md = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

write(".obsidian/daily-notes.json", JSON.stringify({ folder: "Reference/Planner/days", format: "YYYY-MM-DD" }));
const VERBS = ["Draft", "Review", "Send", "Plan", "Fix", "Call about", "Order", "Update"];
const THINGS = ["the brochure", "the invoice", "the homepage", "the photos", "the schedule", "the budget", "the proposal", "the printer"];
let count = 0;

const projects = [];
const nProjects = Math.max(20, Math.round(total / 200));
for (let p = 0; p < nProjects; p++) {
    const area = `Area ${p % 8}`, name = `Project ${p}`;
    projects.push({ area, name, file: `Projects/${area}/${name}/${name}.md`, sent: [] });
}

const end = new Date(Date.UTC(2026, 9, 15));
const days = [];
for (let d = new Date(end.getTime() - years * 365 * 864e5); d <= end; d = new Date(d.getTime() + 864e5)) days.push(new Date(d));
for (const d of days) {
    const lines = ["---", `aliases: ${md(d)}/${String(d.getUTCFullYear()).slice(2)}`, "---"];
    for (let t = 0; t < 6; t++) {
        const proj = pick(projects);
        let line = `- [${pick(["x", "x", " ", ">"])}] ${pick(VERBS)} ${pick(THINGS)} [[${proj.name}|⭕]]`;
        if (random() < 0.15) { const tid = id(); line += ` ^${tid}`; proj.sent.push({ tid, day: day(d), label: md(d) }); }
        lines.push(line);
        if (random() < 0.5) lines.push(`\t- ${1 + Math.floor(random() * 11)}:00am - ${1 + Math.floor(random() * 11)}:30pm`);
    }
    write(`Reference/Planner/days/${day(d)}.md`, lines.join("\n") + "\n");
    count++;
}
// An ID after the ⭕ and 🗒️ links, and one in mixed case, for the checks in lookupBench.js
write("Reference/Planner/days/2026-10-16.md", "- [ ] Probe line [[Project 0|⭕]] [[Probe note|🗒️]] ^pr0be1\n- [ ] Mixed case [[Project 0|⭕]] ^AbC-12\n");
count++;

for (const proj of projects) {
    const sent = proj.sent.map((s) => `- [>] Sent task [[${s.day}#^${s.tid}|${s.label}]] ^${s.tid}`);
    write(proj.file, ["---", "tags:", "  - project", "---", "## To Do", "", ...sent, "- [ ] Not sent yet", "", "## Time Report", ""].join("\n"));
    count++;
    for (let t = 0; t < 2 && count < total; t++) { write(`Projects/${proj.area}/${proj.name}/Task ${t}.md`, ["---", "tags:", "  - task", "---", "- [ ] Sub-task one", "- [x] Sub-task two", ""].join("\n")); count++; }
}
for (let n = 0; count < total; n++, count++) {
    write(`Reference/Notes/${Math.floor(n / 1000)}/Note ${n}.md`, ["---", "tags:", "  - note", "---", "Some invented text.", "", "- a point", "- another point", `- see [[Note ${Math.max(0, n - 1)}]]`, ""].join("\n"));
}
console.log(`Wrote ${count} notes to ${out}`);
