// Tests for the demo vault's sample notes (Welcome.md, Projects/, 30 Reference/, 10 Inbox/, 90 Archive/).
// Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
// The time reports in the notes are rendered by tests/demo/renderReports.mjs; after changing a sample
// note, run that script and commit what it writes. These checks keep the demo opening cleanly: the
// startup report run finds nothing to rewrite, the only Problem is the deliberate one, and every
// `area` and link is right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DAYS, FOLDERS, NOTE_FOLDERS, loadTimeReport, readVault, planReports, dailyNotes } from "./demo/renderReports.mjs";

const tr = loadTimeReport();
const vault = readVault();
const plan = planReports(tr, vault);
const plain = (x) => JSON.parse(JSON.stringify(x));
const basename = (p) => p.split("/").pop().replace(/\.md$/, "");
const dirname = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const demoNotes = [...vault.notes.keys()].filter((p) => p === "Welcome.md" || NOTE_FOLDERS.some((f) => p.startsWith(f)));
const PROBLEM_NOTE = `${DAYS}/2026-09-16.md`;

// ------------------------------------------------------------------ time reports

test("demo vault: the reports in the notes are exactly what TimeReport would write", () => {
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.changes.map((c) => `${c.before === null ? "missing" : "stale"}: ${c.path}`), [],
        "run node \"00 Meta/02 Scripts/tests/demo/renderReports.mjs\" and commit the result");
    // Every note with a block is one TimeReport writes to, so no block goes stale unnoticed
    const withBlock = demoNotes.filter((p) => tr.hasBlock(vault.notes.get(p).text)).sort();
    assert.deepEqual(withBlock, [...plan.blocks.keys()].sort());
});

test("demo vault: reports go to every live project with time and every period with entries", () => {
    const P = "Projects/Freelance";
    assert.deepEqual(plan.targets.project.slice().sort(), [
        `${P}/Kestrel Outfitters 2026/Kestrel Fall Catalog/Kestrel Fall Catalog.md`,
        `${P}/Kestrel Outfitters 2026/Kestrel Outfitters 2026.md`,
        `${P}/Pinecrest Library Brochure/Pinecrest Library Brochure.md`,
        "Projects/Personal/Garden Club Newsletter/Garden Club Newsletter.md",
    ]);
    assert.deepEqual(plan.targets.week, ["2026w35", "2026w36", "2026w37", "2026w38"].map((k) => `${FOLDERS.week}/${k}.md`));
    assert.deepEqual(plan.targets.month, ["2026-08", "2026-09"].map((k) => `${FOLDERS.month}/${k}.md`));
    assert.deepEqual(plan.targets.year, [`${FOLDERS.year}/2026.md`]);
    // The link text the app would use is the plain name, so names must stay unique
    for (const p of [...plan.targets.project, ...plan.targets.week, ...plan.targets.month, ...plan.targets.year]) {
        assert.equal([...vault.notes.keys()].filter((q) => basename(q) === basename(p)).length, 1, `${basename(p)} isn't a unique name`);
    }
});

test("demo vault: the only Problem is the deliberate mistyped entry on 9/16", () => {
    const { model } = plan;
    const lines = vault.notes.get(PROBLEM_NOTE).text.split("\n");
    const line = lines.findIndex((l) => l.trim() === "- 2:30 - 3:45pm") + 1;
    assert.ok(line > 0);
    assert.match(lines[line], /Deliberate mistake for the demo/, "the example is labeled in the note");
    assert.deepEqual(plain(model.problems).map((p) => [p.path, p.line, p.kind]), [[PROBLEM_NOTE, line, "format"]]);
    assert.deepEqual(plain(model.projectProblems), []);
    assert.ok(model.entries.every((e) => e.project), "no Unassigned time");
    // Rendered: under the brochure project and the week, month and year of 9/16; None. everywhere else
    const flagged = [...plan.blocks].filter(([, b]) => !/### Problems\n\nNone\.\n/.test(b)).map(([p]) => p).sort();
    assert.deepEqual(flagged, [
        `${FOLDERS.month}/2026-09.md`, `${FOLDERS.week}/2026w38.md`, `${FOLDERS.year}/2026.md`,
        "Projects/Freelance/Pinecrest Library Brochure/Pinecrest Library Brochure.md",
    ].sort());
});

test("demo vault: no running clocks, and nothing that hasn't ended by the last demo day", () => {
    for (const n of dailyNotes(vault)) {
        const { problems } = tr.parseNote(n.text, n.date);
        assert.ok(!problems.some((p) => p.kind === "open"), `${n.path} has a running clock`);
    }
    assert.ok(plan.model.entries.every((e) => e.date <= "2026-09-16"), "entries after 9/16 would drop out of a report run before they end");
});

test("demo vault: the archived project's entries are in the daily notes but left out of every report", () => {
    const archived = "90 Archive/Freelance/Marlowe Bakery Rebrand/Marlowe Bakery Rebrand.md";
    const index = plan.index;
    const logged = dailyNotes(vault).flatMap((n) => tr.parseNote(n.text, n.date).entries.map((e) => ({ ...e, path: n.path })))
        .filter((e) => tr.resolve(e.context, e.path, index) === archived);
    assert.equal(logged.length, 2);
    assert.ok(!plan.model.entries.some((e) => e.project === archived));
    for (const block of plan.blocks.values()) assert.ok(!block.includes("Marlowe"));
});

test("demo vault: every convention the README describes shows up at least once", () => {
    const days = dailyNotes(vault).map((n) => n.text).join("\n");
    const entries = plan.model.entries;
    assert.match(days, /^- \[<\] \d{1,2}:\d{2}[ap]m\t/m, "event line");
    assert.match(days, /^- \[<\] All day\t/m, "all-day event");
    assert.match(days, /^- \[-\] \d{1,2}:\d{2}[ap]m\t/m, "canceled event");
    assert.match(days, /^- \[>\] .*\|🔗\]\]/m, "forwarded task");
    assert.match(days, /^- \[\/\] |^- \[x\] /m, "started or done task");
    assert.match(days, /\[\[\d{4}-\d{2}-\d{2}\|🚩 \d{1,2}\/\d{1,2}\]\]/, "due date");
    assert.match(days, /^## Notes$/m, "notes section");
    assert.match(days, /^- \[<\] [^\n]*\t\[\[\d{4}-\d{2}-\d{2} [^\]|]+\|[^\]]+\]\]\n\t- \d/m, "event linking a meeting log");
    assert.match(days, /^- \[<\] [^\n]*\|⭕\]\]\n\t- \d{1,2}:\d{2}[ap]m - /m, "event with a ⭕ link and a time entry");
    assert.ok(entries.some((e) => e.free), "🆓 entry");
    assert.ok(entries.some((e) => !e.free && e.note), "entry with a note");
    assert.ok(entries.some((e) => e.context.length > 1 && /^\[.\]/.test(e.context[1].body)), "sub-task with its own entries");
    // One task note threads entries on two days through its 🔗 link, with no ⭕ on the line
    const threaded = new Map();
    for (const e of entries) {
        const chain = e.context[0].body.match(/\[\[([^\]|]+)\|🔗\]\]/);
        if (chain && !e.context[0].body.includes("⭕")) threaded.set(chain[1], new Set([...(threaded.get(chain[1]) ?? []), e.date]));
    }
    assert.ok([...threaded.values()].some((d) => d.size >= 2), "task with entries across two days through its task note");
    // Billing kinds
    const types = new Set([...plan.model.money.values()].map((m) => m.type));
    for (const t of ["hourly", "flat", "non-billable"]) assert.ok(types.has(t), t);
    assert.ok([...plan.model.parent.values()].some(Boolean), "a sub-project");
    // A task note forwarded to a day from outside the daily notes
    assert.ok(demoNotes.some((p) => !p.startsWith(DAYS) && /^- \[>\] \[\[\d{4}-\d{2}-\d{2}\|\d{1,2}\/\d{1,2}\]\] /m.test(vault.notes.get(p).text)));
});

// ------------------------------------------------------------------ areas and links

const tagsOf = (p) => [].concat(vault.notes.get(p)?.fm.tags ?? []).filter(Boolean).map((t) => String(t).replace(/^#/, "").toLowerCase());
const isProjectOrArea = (p) => tagsOf(p).some((t) => t === "project" || t === "area");

// SyncArea.nearestProjectOrArea: the first folder note tagged #project or #area above the note
// (a folder note looks from the folder above its own)
const nearest = (p) => {
    let folder = dirname(p);
    if (basename(p) === basename(folder)) folder = dirname(folder);
    for (; folder; folder = dirname(folder)) {
        const note = `${folder}/${basename(folder)}.md`;
        if (note !== p && vault.notes.has(note) && isProjectOrArea(note)) return note;
    }
    return null;
};

const linkTarget = (value) => String(value ?? "").match(/\[\[([^\]|#]+)/)?.[1]?.trim() ?? null;

test("demo vault: every note in an area or project has `area` pointing at its nearest folder note", () => {
    let checked = 0;
    for (const p of demoNotes.filter((q) => q.startsWith("Projects/"))) {
        const parent = nearest(p);
        const area = vault.notes.get(p).fm.area;
        if (!parent) {
            assert.ok(!area, `${p} is outside any project or area but has area ${area}`);
            continue;
        }
        checked++;
        assert.equal(plan.index.linkDest(linkTarget(area) ?? "", p), parent, `${p}: area ${area}`);
        const alias = [].concat(vault.notes.get(parent).fm.aliases ?? [])[0];
        assert.equal(area, `[[${basename(parent)}|${alias}]]`, `${p}: area alias`);
    }
    assert.ok(checked >= 10);
});

test("demo vault: 🔗, ⭕, meeting log and property links all resolve", () => {
    const files = new Set(vault.files);
    const resolves = (target, from) => plan.index.linkDest(target, from) !== null || files.has(target) || vault.files.some((f) => basename(f) === target || f.endsWith(`/${target}`));
    const isPeriod = (t) => /^\d{4}(-\d{2}(-\d{2})?|w\d{2})?$/.test(t);
    let checked = 0;
    for (const p of demoNotes) {
        const { text, fm } = vault.notes.get(p);
        // Links in the note's text, outside the report block (whose day and month headers may point at notes that don't exist, as in the app)
        const body = text.replace(/%% time:start %%[\s\S]*?%% time:end %%/g, "");
        for (const m of body.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g)) {
            const target = m[1].trim();
            if (isPeriod(target)) continue;
            checked++;
            assert.ok(resolves(target, p), `${p}: [[${target}]] doesn't resolve`);
        }
        for (const key of ["area", "who", "client", "affiliation"]) {
            for (const v of [].concat(fm[key] ?? [])) {
                const target = linkTarget(v);
                if (!target) continue;
                checked++;
                assert.ok(resolves(target, p), `${p}: ${key} ${v} doesn't resolve`);
            }
        }
    }
    // Project links in the report blocks resolve too
    for (const block of plan.blocks.values()) {
        for (const m of block.matchAll(/\[\[([^\]|\\]+)\\?\|⭕/g)) assert.ok(resolves(m[1], ""), `report link [[${m[1]}]]`);
    }
    assert.ok(checked > 50);
});

test("demo vault: meeting logs' time and endTime match the event lines that link them", () => {
    const eventTimes = createRequire(import.meta.url)("../Templater/eventTimes.js");
    const logs = demoNotes.filter((p) => tagsOf(p).includes("log"));
    assert.ok(logs.length >= 3);
    for (const p of logs) {
        const { fm } = vault.notes.get(p);
        assert.equal(dirname(p).split("/").pop(), "logs", `${p} is in a logs folder`);
        const day = vault.notes.get(`${DAYS}/${fm.date}.md`);
        assert.ok(day, `${p}: no daily note for ${fm.date}`);
        assert.equal(basename(p).slice(0, 10), fm.date);
        assert.deepEqual(eventTimes(day.text, basename(p)), { time: fm.time, endTime: fm.endTime }, p);
    }
});

test("demo vault: daily notes carry only their M/D/YY dddd alias", () => {
    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const p of demoNotes.filter((q) => q.startsWith(`${DAYS}/`))) {
        const date = basename(p);
        const [y, m, d] = date.split("-").map(Number);
        const want = `${m}/${d}/${String(y).slice(2)} ${DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
        assert.deepEqual(vault.notes.get(p).fm, { aliases: want }, p);
    }
});
