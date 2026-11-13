// Tests for the demo vault's sample notes (Welcome.md, Projects/, Reference/, Inbox/, Archive/).
// Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The time reports in the notes are rendered by tests/demo/renderReports.mjs; after changing a sample
// note, run that script and commit what it writes. These checks keep the demo opening cleanly: the
// startup report run finds nothing to rewrite, the only Problems are the deliberate ones, and every
// `parent` and link is right.
import { test as baseTest } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { DAYS, FOLDERS, NOTE_FOLDERS, loadTimeReport, loadBilling, readVault, planReports, dailyNotes } from "./demo/renderReports.mjs";
import { compactTables, obsidianPadded, tablesIn } from "./tables.mjs";
import { convert } from "./demo/addProjectLinks.mjs";

// Only the demo vault has Welcome.md. In a vault of real notes these checks would fail, and the
// failure text says to run renderReports.mjs, which writes report blocks into notes: so skip them,
// and don't even read the vault (a real one holds thousands of notes).
const isDemoVault = fs.existsSync(new URL("../../../Welcome.md", import.meta.url));
const test = isDemoVault ? baseTest : (name, fn) => baseTest.skip(name, fn);

const tr = isDemoVault ? loadTimeReport() : null;
const vault = isDemoVault ? readVault() : { root: "", files: [], notes: new Map() };
const plan = isDemoVault ? planReports(tr, vault) : { targets: { project: [], week: [], month: [], year: [] }, blocks: new Map(), changes: [], errors: [], model: { entries: [], problems: [], projectProblems: [], money: new Map(), parent: new Map() }, index: null };
const plain = (x) => JSON.parse(JSON.stringify(x));
const basename = (p) => p.split("/").pop().replace(/\.md$/, "");
const dirname = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const demoNotes = [...vault.notes.keys()].filter((p) => p === "Welcome.md" || NOTE_FOLDERS.some((f) => p.startsWith(f)));
const PROBLEM_NOTE = `${DAYS}/2026-09-16.md`;
const PROBLEM_PROJECT = "Projects/Personal/Block Party Poster/Block Party Poster.md";
const KESTREL_PROJECT = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Outfitters 2026.md";
const DEMO_INVOICE = "Reference/Invoices/1001-KES.md";

// ------------------------------------------------------------------ where the bases and invoices are (OBS-112)

test("demo vault: invoices and their base in the folder Invoice Settings names; the Projects base beside the projects", () => {
    const billing = loadBilling();
    const settings = vault.notes.get("Config/Invoice Settings.md");
    assert.ok(settings, "the demo's own settings note, with invented details");
    const folder = billing.folderOf(settings.fm.folder).folder;
    assert.equal(folder, "Reference/Invoices");
    assert.ok(vault.files.includes(`${folder}/Invoices.base`), "the Invoices base beside the invoices");
    // named like its folder, so Notebook Navigator makes it the folder's note (OBS-115), as Projects.base is
    assert.equal(basename(folder), "Invoices");
    const invoices = [...vault.notes].filter(([, { fm }]) => [].concat(fm.tags ?? []).includes("invoice")).map(([p]) => p);
    assert.ok(invoices.length > 0);
    for (const p of invoices) assert.equal(dirname(p), folder, p);
    // last_number is where the numbers stand
    assert.equal(billing.nextNumber(invoices.map((p) => ({ number: vault.notes.get(p).fm.number })), settings.fm.last_number),
        settings.fm.last_number + 1);
    assert.ok(vault.files.includes("Projects/Projects.base"));
    // one copy of each base
    for (const name of ["Invoices.base", "Projects.base"]) {
        assert.equal(vault.files.filter((p) => p.endsWith(`/${name}`)).length, 1, name);
    }
});

// ------------------------------------------------------------------ time reports

// Every table the system wrote into the demo (a report block's, a timesheet's, an invoice's) is padded the
// way Obsidian's table editor would pad it, so entering one changes nothing (OBS-184)
test("demo vault: every table in a report block, a timesheet or an invoice is already as Obsidian writes it", () => {
    let checked = 0;
    for (const p of demoNotes) {
        const { text, fm } = vault.notes.get(p);
        const tags = [].concat(fm.tags ?? []);
        const whole = tags.includes("timesheet") || tags.includes("invoice");
        const start = text.indexOf("%% time:start %%"), end = text.indexOf("%% time:end %%");
        const part = whole ? text : start !== -1 && end > start ? text.slice(start, end) : "";
        const lines = part.split("\n");
        for (const t of tablesIn(lines)) {
            const table = lines.slice(t.from, t.to + 1);
            assert.deepEqual(table, obsidianPadded(table), `${p}, the table starting "${table[0].slice(0, 40)}"; re-render with renderReports.mjs`);
            checked++;
        }
    }
    assert.ok(checked >= 30, `only ${checked} tables checked`);
});

test("demo vault: the reports in the notes are exactly what TimeReport would write", () => {
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.changes.map((c) => `${c.before === null ? "missing" : "stale"}: ${c.path}`), [],
        "run node \"Config/Scripts/tests/demo/renderReports.mjs\" and commit the result");
    // Every note with a block is one TimeReport writes to, so no block goes stale unnoticed
    const withBlock = demoNotes.filter((p) => tr.hasBlock(vault.notes.get(p).text)).sort();
    assert.deepEqual(withBlock, [...plan.blocks.keys()].sort());
});

test("demo vault: reports go to every project with time, archived ones too (OBS-213), and every period with entries", () => {
    const P = "Projects/Freelance";
    assert.deepEqual(plan.targets.project.slice().sort(), [
        "Archive/Freelance/Marlowe Bakery Rebrand/Marlowe Bakery Rebrand.md",
        `${P}/Kestrel Outfitters 2026/Kestrel Fall Catalog/Kestrel Fall Catalog.md`,
        `${P}/Kestrel Outfitters 2026/Kestrel Outfitters 2026.md`,
        `${P}/Pinecrest Library Brochure/Pinecrest Library Brochure.md`,
        "Projects/Household/Household.md",
        PROBLEM_PROJECT,
        "Projects/Personal/Garden Club Newsletter/Garden Club Newsletter.md",
    ]);
    // Household has time (OBS-51); Freelance, an area with none, gets no block
    assert.ok(plan.model.entries.some((e) => e.project === "Projects/Household/Household.md"));
    assert.ok(!tr.hasBlock(vault.notes.get(`${P}/Freelance.md`).text));
    assert.deepEqual(plan.targets.week, ["2026w35", "2026w36", "2026w37", "2026w38"].map((k) => `${FOLDERS.week}/${k}.md`));
    assert.deepEqual(plan.targets.month, ["2026-08", "2026-09"].map((k) => `${FOLDERS.month}/${k}.md`));
    assert.deepEqual(plan.targets.year, [`${FOLDERS.year}/2026.md`]);
    // The link text the app would use is the plain name, so names must stay unique
    for (const p of [...plan.targets.project, ...plan.targets.week, ...plan.targets.month, ...plan.targets.year]) {
        assert.equal([...vault.notes.keys()].filter((q) => basename(q) === basename(p)).length, 1, `${basename(p)} isn't a unique name`);
    }
});

test("demo vault: the only Problems are the deliberate ones: a mistyped entry on 9/16 and a project with no rate_type", () => {
    const { model } = plan;
    const lines = vault.notes.get(PROBLEM_NOTE).text.split("\n");
    const line = lines.findIndex((l) => l.trim() === "- 2:30 - 3:45pm") + 1;
    assert.ok(line > 0);
    assert.match(lines[line], /Deliberate mistake for the demo/, "the example is labeled in the note");
    assert.deepEqual(plain(model.problems).map((p) => [p.path, p.line, p.kind]), [[PROBLEM_NOTE, line, "format"]]);
    // One project-level Problem (OBS-85): a project made from the template, its `rate_type` never
    // filled in, so its one hour on 9/17 counts as billable
    const { fm, text } = vault.notes.get(PROBLEM_PROJECT);
    assert.equal(fm.rate_type, null);
    assert.match(text, /Deliberate mistake for the demo/, "the example is labeled in the note");
    assert.deepEqual(plain(model.projectProblems.filter((p) => !p.invoice)).map((p) => [p.project, p.message]),
        [[PROBLEM_PROJECT, "has no `rate_type`, so its time counts as billable; set one (`hourly`, `flat`, `non-billable`)"]]);
    // And one invoice Problem (OBS-5): an entry billed on the paid 1001-KES, edited afterward, labeled in its note
    assert.deepEqual(plain(model.projectProblems.filter((p) => p.invoice).map((p) => [p.project, p.invoice.name, p.change.kind, p.change.row.date])),
        [[KESTREL_PROJECT, "1001-KES", "times", "2026-09-11"]]);
    assert.match(vault.notes.get(`${DAYS}/2026-09-11.md`).text, /Deliberate change for the demo: invoice \[\[1001-KES\]\] billed this entry as 1:00pm - 2:30pm/);
    assert.deepEqual(plain(model.entries.filter((e) => e.project === PROBLEM_PROJECT).map((e) => [e.date, e.minutes, e.billable])), [["2026-09-17", 60, true]]);
    // The only Unassigned time is the busy events with no project: they count from their end lines (OBS-24)
    assert.deepEqual(plain(model.entries.filter((e) => !e.project).map((e) => [e.date, e.task, e.minutes])), [
        ["2026-08-27", "Weekly planning", 15], ["2026-09-11", "Coffee with Esme", 60], ["2026-09-14", "Weekly planning", 30], ["2026-09-15", "Run with the club", 60],
    ]);
    // Rendered: the mistyped entry under the brochure project, the rate_type under the poster project,
    // both under the week, month and year of 9/16 and 9/17, plus the count of Unassigned entries in
    // every period with a busy event that has no project; no Problems heading anywhere else (OBS-133)
    // Timesheets are checked on their own (OBS-132)
    const reports = [...plan.blocks].filter(([p]) => !plan.targets.sheet.includes(p));
    const flagged = reports.filter(([, b]) => b.includes("> [!warning] Problems")).map(([p]) => p).sort();
    assert.deepEqual(flagged, [
        `${FOLDERS.month}/2026-08.md`, `${FOLDERS.month}/2026-09.md`,
        `${FOLDERS.week}/2026w35.md`, `${FOLDERS.week}/2026w37.md`, `${FOLDERS.week}/2026w38.md`, `${FOLDERS.year}/2026.md`,
        "Projects/Freelance/Pinecrest Library Brochure/Pinecrest Library Brochure.md", PROBLEM_PROJECT, KESTREL_PROJECT,
    ].sort());
    // The poster's Problem is on its own note and on the week, month and year of its hour, and nowhere else
    const said = "- [[Block Party Poster]] has no `rate_type`";
    for (const [p, b] of reports) {
        const listed = [PROBLEM_PROJECT, `${FOLDERS.week}/2026w38.md`, `${FOLDERS.month}/2026-09.md`, `${FOLDERS.year}/2026.md`].includes(p);
        assert.equal((b.split("> [!warning] Problems")[1] ?? "").split("\n").some((l) => l.startsWith(`> ${said}`)), listed, p);
    }
    for (const p of [`${FOLDERS.week}/2026w35.md`, `${FOLDERS.week}/2026w37.md`, `${FOLDERS.month}/2026-08.md`]) {
        assert.match(plan.blocks.get(p), /> \[!warning\] Problems\n> - 1 entry has no project \(see Unassigned\)\n/, p);
    }
});

test("demo vault: no running clocks, and nothing that hasn't ended by the last demo day", () => {
    for (const n of dailyNotes(vault)) {
        const { problems } = tr.parseNote(n.text, n.date);
        assert.ok(!problems.some((p) => p.kind === "open"), `${n.path} has a running clock`);
    }
    // The committed reports are built without a clock, so the demo has to be opened after its last
    // entry has ended, or the startup run would leave that entry out and rewrite the notes
    assert.ok(plan.model.entries.every((e) => e.date <= "2026-09-18"), "entries after 9/18 would drop out of a report run before they end");
});

test("demo vault: the archived project's entries count in the August, week 35 and 2026 reports, and its note and timesheet are written (OBS-213)", () => {
    const archived = "Archive/Freelance/Marlowe Bakery Rebrand/Marlowe Bakery Rebrand.md";
    const index = plan.index;
    const logged = dailyNotes(vault).flatMap((n) => {
        const { entries, visible } = tr.parseNote(n.text, n.date);
        return entries.filter((e) => tr.resolve((k) => visible[k], e.top, n.path, index, e.top).project === archived);
    });
    assert.equal(logged.length, 2);
    const counted = plan.model.entries.filter((e) => e.project === archived);
    assert.equal(counted.length, 2);
    assert.ok(counted.every((e) => e.archived), "marked archived, so the Invoice command leaves them out");
    for (const p of [`${FOLDERS.week}/2026w35.md`, `${FOLDERS.month}/2026-08.md`, `${FOLDERS.year}/2026.md`]) {
        assert.ok(compactTables(plan.blocks.get(p)).includes("| [[Marlowe Bakery Rebrand]] |"), p);
    }
    assert.ok(compactTables(plan.blocks.get(`${FOLDERS.month}/2026-08.md`)).includes("| [[Marlowe Bakery Rebrand]] | 1.50 | $80/hr | $120.00 |"));
    assert.ok(plan.targets.project.includes(archived) && plan.blocks.get(archived).includes("**Earned:**\t\t$120.00"));
    assert.ok(plan.targets.sheet.includes("Archive/Freelance/Marlowe Bakery Rebrand/Marlowe Bakery Rebrand timesheet.md"));
});

test("demo vault: every convention the README describes shows up at least once", () => {
    const days = dailyNotes(vault).map((n) => n.text).join("\n");
    const entries = plan.model.entries;
    assert.match(days, /^- \[<\] \d{1,2}:\d{2}[ap]m\t/m, "event line");
    assert.match(days, /^- \[<\] All day\t/m, "all-day event");
    assert.match(days, /^- \[-\] \d{1,2}:\d{2}[ap]m\t/m, "canceled event");
    assert.match(days, /^- \[>\] .*\|⋯\]\]/m, "forwarded task");
    assert.match(days, /^- \[\/\] |^- \[x\] /m, "started or done task");
    assert.match(days, /\[\[\d{4}-\d{2}-\d{2}\|🚩 \d{1,2}\/\d{1,2}\]\]/, "due date");
    assert.match(days, /^## Notes$/m, "notes section");
    assert.match(days, /^- \[<\] [^\n]*\t[^\n[]+ \[\[[^\]|]+\|⭕\]\] \[\[\d{4}-\d{2}-\d{2} [^\]|]+\|⋯\]\]\n\t- \d/m, "event linking its project, then its meeting log at the end of its line");
    assert.match(days, /^- \[<\] [^\t\n[]+ \[\[[^\]|]+\|⭕\]\] \[\[\d{4}-\d{2}-\d{2} [^\]|]+\|⋯\]\]$/m, "a log's line with no time yet");
    assert.doesNotMatch(days, /\|\s*(?:🗒|🔗)/u, "the demo's note links are ⋯ and ↗, none of the old marks (OBS-208)");
    assert.match(days, /^- \[ \] [^\n]*\[\[[^\]|]+\|⭕\]\] \[\[[^\]|#]+#\^([a-z0-9]{6})\|↗\]\] \^\1$/m, "a line sent from its task note, with its ⭕ and a ↗ back to the task's line there, by its ID (OBS-208)");
    assert.doesNotMatch(days, /^- \[.\] (?:[^\t\n]*\t)?\[\[\d{4}-\d{2}-\d{2} [^\]|]+\|(?!⋯)[^\]]+\]\]/m, "no event title wrapped in its log link (OBS-57)");
    assert.match(days, /^- \[<\] [^\n]*\|⭕\]\]\n\t- \d{1,2}:\d{2}[ap]m - /m, "event with a ⭕ link and a time entry");
    assert.ok(entries.some((e) => e.free), "🆓 entry");
    assert.ok(entries.some((e) => !e.free && e.note), "entry with a note");
    // A sub-task has no time of its own (OBS-181 rule 5): every entry sits right under its task or event
    assert.ok(!entries.some((e) => e.context.length > 1 && /^\[.\]/.test(e.context[1].body)), "no time under a sub-task");
    // One task note threads entries on two days through its ⋯ link, which ends the line, after the ⭕ for the note's project (OBS-90)
    const threaded = new Map();
    for (const e of entries) {
        const chain = e.context[0].body.match(/\|⭕\]\] \[\[([^\]|]+)\|⋯\]\]$/);
        if (chain) threaded.set(chain[1], new Set([...(threaded.get(chain[1]) ?? []), e.date]));
    }
    assert.ok([...threaded.values()].some((d) => d.size >= 2), "task with entries across two days through its task note");
    // Billing kinds
    const types = new Set([...plan.model.money.values()].map((m) => m.type));
    for (const t of ["hourly", "flat", "non-billable"]) assert.ok(types.has(t), t);
    assert.ok([...plan.model.parent.values()].some(Boolean), "a sub-project");
    // A task note forwarded to a day from outside the daily notes
    assert.ok(demoNotes.some((p) => !p.startsWith(DAYS) && /^- \[>\] .* \[\[\d{4}-\d{2}-\d{2}#\^[a-z0-9]{6}\|[^\]]+\]\] \^[a-z0-9]{6}$/m.test(vault.notes.get(p).text)));
});

test("demo vault: every line that links a note also links its project or area, before the note link (OBS-90)", () => {
    const tasks = new (vm.runInContext(fs.readFileSync(new URL("../../../plugin/src/classes/addTaskNote.js", import.meta.url), "utf8") + "\n;AddTaskNote", vm.createContext({})))();
    const { changes, skipped, moved } = convert(vault, tr, tr, tasks);
    assert.deepEqual(changes.map((c) => `${c.path}:${c.line}: ${c.after}`), [], "the conversion (tests/demo/addProjectLinks.mjs) finds nothing left to do");
    assert.deepEqual([skipped, moved].map((l) => l.length), [0, 0]);
    const noted = dailyNotes(vault).flatMap((n) => n.text.split("\n")).filter((l) => /^\s*- \[.\] .*\|(?:⋯|↗)\]\](?: \^[a-z0-9]{6})?$/.test(l));
    assert.ok(noted.length >= 10, "the demo has lines to show it");
    for (const l of noted) assert.match(l, /\|(?:⭕|🗃️)\]\] \[\[[^\]]+\|(?:⋯|↗)\]\](?: \^[a-z0-9]{6})?$/, l);
});

test("the conversion's check: an entry counted on one side only, or with other minutes or 🆓, is caught (OBS-90 review)", () => {
    const tasks = new (vm.runInContext(fs.readFileSync(new URL("../../../plugin/src/classes/addTaskNote.js", import.meta.url), "utf8") + "\n;AddTaskNote", vm.createContext({})))();
    // The old report stood in for by the new one with some of its entries changed
    const before = tr.build(dailyNotes(vault), plan.index);
    const withEntries = (change) => Object.assign(Object.create(tr), { build: () => ({ ...before, entries: change(before.entries.map((e) => ({ ...e }))) }) });
    const moved = (old) => plain(convert(vault, old, tr, tasks).moved.map((m) => [!!m.before, !!m.after]));
    assert.deepEqual(moved(withEntries((es) => es)), [], "the same entries: nothing");
    assert.deepEqual(moved(withEntries((es) => es.slice(1))), [[false, true]], "one the old report left out (archived) and the new one counts");
    assert.deepEqual(moved(withEntries((es) => [...es, { ...es[0], line: 999 }])), [[true, false]], "one the new report leaves out");
    assert.deepEqual(moved(withEntries((es) => { es[0].free = !es[0].free; return es; })), [[true, true]], "a 🆓 that changed");
    assert.deepEqual(moved(withEntries((es) => { es[0].minutes += 1; return es; })), [[true, true]], "minutes that changed");
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

test("demo vault: every note in an area or project has `parent` pointing at its nearest folder note", () => {
    let checked = 0;
    for (const p of demoNotes.filter((q) => q.startsWith("Projects/"))) {
        const parent = nearest(p);
        const link = vault.notes.get(p).fm.parent;
        if (!parent) {
            assert.ok(!link, `${p} is outside any project or area but has parent ${link}`);
            continue;
        }
        checked++;
        assert.equal(plan.index.linkDest(linkTarget(link) ?? "", p), parent, `${p}: parent ${link}`);
        const alias = [].concat(vault.notes.get(parent).fm.aliases ?? [])[0];
        assert.equal(link, `[[${basename(parent)}|${alias}]]`, `${p}: parent alias`);
    }
    assert.ok(checked >= 10);
});

test("demo vault: no sample note still has the old `area` property (OBS-175)", () => {
    const left = demoNotes.filter((p) => Object.keys(vault.notes.get(p)?.fm ?? {}).some((k) => k.toLowerCase() === "area"));
    assert.deepEqual(left, []);
});

test("demo vault: ⋯, ⭕, meeting log and property links all resolve", () => {
    const files = new Set(vault.files);
    const resolves = (target, from) => plan.index.linkDest(target, from) !== null || files.has(target) || vault.files.some((f) => basename(f) === target || f.endsWith(`/${target}`));
    const isPeriod = (t) => /^\d{4}(-\d{2}(-\d{2})?|w\d{2})?$/.test(t);
    let checked = 0;
    for (const p of demoNotes) {
        const { text, fm } = vault.notes.get(p);
        // Links in the note's text, outside the report block (whose day and month headers may point at notes that don't exist, as in the app)
        const body = text.replace(/%% time:start %%[\s\S]*?%% time:end %%/g, "");
        // A link in a table escapes its | (`[[2026-09-11\\|9/11/26]]`), so the target stops at a backslash too
        for (const m of body.matchAll(/!?\[\[([^\]|#\\]+)(?:#[^\]|]*)?(?:\\?\|([^\]]*))?\]\]/g)) {
            const target = m[1].trim();
            if (isPeriod(target)) continue;
            checked++;
            assert.ok(resolves(target, p), `${p}: [[${target}]] doesn't resolve`);
        }
        for (const key of ["parent", "who", "client", "bill_to", "affiliation"]) {
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

test("demo vault: every meeting log has its line in its daily note, and its time and endTime match that line", () => {
    const require = createRequire(import.meta.url);
    const eventTimes = require("../Templater/eventTimes.js");
    const recordEvent = require("../Templater/recordEvent.js");
    const code = fs.readFileSync(new URL("../../../plugin/src/classes/calendarSync.js", import.meta.url), "utf8");
    const sync = new (vm.runInContext(code + "\n;CalendarSync", vm.createContext({ app: {}, window: {}, customJS: {}, console })))();
    const logs = demoNotes.filter((p) => tagsOf(p).includes("log"));
    assert.ok(logs.length >= 3);
    let timeless = 0;
    for (const p of logs) {
        const { fm } = vault.notes.get(p);
        assert.equal(dirname(p).split("/").pop(), "›logs", `${p} is in a ›logs folder (OBS-164)`);
        const day = vault.notes.get(`${DAYS}/${fm.date}.md`);
        assert.ok(day, `${p}: no daily note for ${fm.date}`);
        assert.equal(basename(p).slice(0, 10), fm.date);
        // The line is there (OBS-10): recording the log again changes nothing
        assert.equal(recordEvent(day.text, { log: basename(p), title: basename(p).slice(11) }, sync).outcome, "present", `${p} has no line in ${fm.date}`);
        const times = eventTimes(day.text, basename(p));
        if (times) assert.deepEqual(times, { time: fm.time, endTime: fm.endTime }, p);
        else { assert.deepEqual({ time: fm.time, endTime: fm.endTime }, { time: null, endTime: null }, `${p}: its line has no time`); timeless++; }
    }
    assert.equal(timeless, 1, "one sample log shows a meeting the calendar didn't have");
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

// ------------------------------------------------------------------ invoices (OBS-5)

test("demo vault: the paid Kestrel invoice adds up, and is what Invoice would bill from these notes", () => {
    const billing = loadBilling();
    const { text, fm } = vault.notes.get(DEMO_INVOICE);
    const invoice = billing.readInvoice({ path: DEMO_INVOICE, props: fm, text }, tr, plan.index);
    assert.equal(invoice.problem, null, "its Billed entries read, and add up to its hours and total");
    assert.equal(invoice.status, "paid");
    assert.equal(invoice.project, KESTREL_PROJECT);
    // Its Billable hours table is its Billed entries, a line per date
    const lines = text.split("\n").filter((l) => /^\| \d{1,2}\/\d{1,2} — /.test(l)).map((l) => billing.cells(l).slice(1));
    assert.deepEqual(plain(lines), plain(billing.rows(invoice.rows).map((r) => [tr.hours(r.minutes), tr.money(r.cents), tr.money(r.amount)])));
    // The real parser, on the demo's notes, bills the same entries through 9/11, except the one edited since
    const ledger = billing.ledger(plan.model.billing.invoices, { except: DEMO_INVOICE });
    const sel = billing.select(plan.model, tr, plan.index, { project: KESTREL_PROJECT, through: "2026-09-11", ledger });
    const now = sel.entries.map((e) => billing.key(e));
    const billed = invoice.rows.map((r) => billing.key(r));
    assert.deepEqual(plain(now.filter((k) => !billed.includes(k))), ["2026-09-11 780 885"]);
    assert.deepEqual(plain(billed.filter((k) => !now.includes(k))), ["2026-09-11 780 870"]);
    // With the invoice in the ledger, that entry is held back, never billed again
    const next = billing.select(plan.model, tr, plan.index, { project: KESTREL_PROJECT, through: "2026-09-11", ledger: plan.model.billing.ledger });
    assert.deepEqual(plain(next.entries), []);
    assert.deepEqual(plain(next.heldBack.map((h) => [billing.key(h.entry), h.invoice.name])), [["2026-09-11 780 885", "1001-KES"]]);
    // Nothing printed links anywhere
    assert.ok(text.includes("\n## Billed entries\n"), "in the section invoices are made with now (OBS-145)");
    assert.ok(!text.slice(text.indexOf("# Invoice No."), text.indexOf("## Billed entries")).includes("[["));
});

test("demo vault: Pinecrest Library Brochure shows a bill-to; Kestrel, with none, bills its client (OBS-109)", () => {
    const Invoice = vm.runInContext(fs.readFileSync(new URL("../../../plugin/src/classes/invoice.js", import.meta.url), "utf8") + "\n;Invoice", vm.createContext({}));
    const inv = new Invoice();
    const brochure = inv.readBillTo("Projects/Freelance/Pinecrest Library Brochure/Pinecrest Library Brochure.md", tr, plan.index);
    assert.equal(brochure.path, "Reference/Entities/Friends of Pinecrest Library.md");
    assert.equal(brochure.client.path, "Reference/Entities/Pinecrest Public Library.md");
    assert.equal(brochure.billingName, "Friends of the Pinecrest Public Library");
    assert.equal(brochure.address.length, 2);
    assert.equal(brochure.code, "", "no code yet, so a first invoice would ask for one");
    // The demo video's invoicing is unchanged: Kestrel bills Kestrel Outfitters, as 1001-KES did
    const kestrel = inv.readBillTo(KESTREL_PROJECT, tr, plan.index);
    assert.equal(kestrel.path, "Reference/Entities/Kestrel Outfitters.md");
    assert.equal(kestrel.code, "KES");
    assert.equal(kestrel.client.path, kestrel.path);
});

test("demo vault: each project with time has its timesheet note beside it, linked from the project; an area has none", () => {
    assert.ok(plan.targets.sheet.length >= 5);
    for (const sheet of plan.targets.sheet) {
        const { fm } = vault.notes.get(sheet);
        assert.deepEqual([].concat(fm.tags ?? []), ["timesheet"], sheet);
        const project = plan.index.linkDest(linkTarget(fm.parent), sheet);
        assert.ok(vault.notes.get(project).text.includes(`[[${basename(sheet)}|Timesheet]]`), `${project} links ${sheet}`);
    }
    // Household, an area with time, gets no timesheet and no link to one (OBS-131)
    const household = "Projects/Household/Household.md";
    assert.ok(plan.targets.project.includes(household) && tr.isAreaOnly(household, plan.index));
    assert.ok(!vault.notes.has("Projects/Household/Household timesheet.md"));
    assert.ok(!vault.notes.get(household).text.includes("|Timesheet]]"));
    for (const p of plan.targets.project) {
        if (tr.isAreaOnly(p, plan.index)) assert.ok(!plan.targets.sheet.includes(tr.sheetPath(p)), p);
    }
});

test("demo vault: the Project template and the Invoices base carry the invoice properties", () => {
    const template = fs.readFileSync(new URL("../../Templates/Project.md", import.meta.url), "utf8");
    const at = (l) => template.indexOf(l);
    // In the maintainer's order (2026-10-14): bill_to after client, max_hours after rate_type
    const order = ["client: ", "bill_to: ", "rate: ", "rate_type: ", "max_hours: ", "include_subprojects: false"].map((k) => at(`tR += "${k}\\n";`));
    assert.ok(order.every((i) => i > 0), "the template writes each one");
    assert.deepEqual(order, [...order].sort((a, b) => a - b), "in that order");
    assert.ok(at('tR += "include_subprojects: false\\n";') < at('tR += "---\\n";\ntp.file.cursor(0);'), "inside the frontmatter it writes");
    // Retired (OBS-192): invoice notes record what was billed, so no date stands in for them
    assert.ok(!template.includes("billed_through"), "no billed_through");
    const base = fs.readFileSync(new URL("../../../Reference/Invoices/Invoices.base", import.meta.url), "utf8");
    assert.match(base, /file\.tags\.contains\("invoice"\)/);
    // Its columns, in order, named as Airtable named them (OBS-117); Total in dollars (the maintainer's
    // setup, 2026-10-14), grouped by status: draft, sent, paid, then canceled. Obsidian hides a status
    // missing from groupOrder, which hid every new invoice until draft was added
    assert.match(base, /order:\n\s+- invoice_date\n\s+- file\.name\n\s+- formula\.project\n\s+- invoice_status\n\s+- formula\.amount\n/);
    // Bill to (OBS-109) is there to switch on, not shown by default (the maintainer, 2026-11-03)
    assert.doesNotMatch(base, /- formula\.billed\n/);
    for (const [p, name] of [["note.invoice_date", "Date"], ["file.name", "Invoice"], ["formula.project", "Project"], ["formula.billed", "Bill to"], ["note.invoice_status", "Status"], ["formula.amount", "Total"]]) {
        assert.match(base, new RegExp(`  ${p.replace(".", "\\.")}:\\n    displayName: ${name}\\n`), p);
    }
    assert.match(base, /\n    groupBy:\n      property: invoice_status\n      direction: ASC\n    groupOrder:\n      - draft\n      - sent\n      - paid\n      - canceled\n/);
    // The project's name, linked, not parent's alias (`area` on invoices from before OBS-175)
    assert.match(base, /\n  project: if\(parent, link\(parent\.asFile\(\)\.path, parent\.asFile\(\)\.basename\), if\(area, link\(area\.asFile\(\)\.path, area\.asFile\(\)\.basename\), ""\)\)\n/);
    // Who was billed, linked: `bill_to`, or `client` on an invoice from before OBS-109, which recorded the billed note there
    // Named `billed` and reading `note.`, so the formula can't be taken for the property it reads
    assert.match(base, /\n  billed: if\(note\.bill_to, link\(note\.bill_to\.asFile\(\)\.path, note\.bill_to\.asFile\(\)\.basename\), if\(note\.client, link\(note\.client\.asFile\(\)\.path, note\.client\.asFile\(\)\.basename\), ""\)\)\n/);
    // The total as $1,235.00, and the sum of what the view shows the same way, every comma dropped
    // before adding
    assert.match(base, /\n  amount: '"\$"\+total\.toFixed\(2\)\.replace\(\/\\B\(\?=\(\\d\{3\}\)\+\(\?!\\d\)\)\/g, ","\)'\n/);
    assert.match(base, /^summaries:\n  Sum: '"\$"\+values\.reduce\(acc \+ number\(value\.slice\(1\)\.replace\(\/,\/g,""\)\),0\)/);
    assert.match(base, /\n    summaries:\n\s+formula\.amount: Sum\n/);
    assert.doesNotMatch(base, /- (status|project)\n/, "no projects' status, no project column (OBS-114)");
});

test("demo vault: every task's lines agree, and the sample shows a sent task and a forwarded one with IDs (OBS-185)", () => {
    const TaskIds = vm.runInContext(fs.readFileSync(new URL("../../../plugin/src/classes/taskIds.js", import.meta.url), "utf8") + "\n;TaskIds", vm.createContext({}));
    const kind = (p) => (p.startsWith(`${DAYS}/`) ? "day" : /\/(weeks|months|years)\//.test(p) ? "period" : "other");
    const notes = demoNotes.map((p) => ({ path: p, kind: kind(p), text: vault.notes.get(p).text }));
    const violations = TaskIds.check(notes, {
        projectOf: (note, i, lines) => tr.lineProject(note, i, lines, plan.index),
        resolve: (linkpath, from) => plan.index.linkDest(linkpath.split("#")[0], from),
    });
    assert.deepEqual(plain(violations), []);
    const ids = notes.flatMap((n) => n.text.split("\n").map((l) => TaskIds.idOf(l)).filter(Boolean));
    assert.ok(new Set(ids).size >= 3 && ids.length >= 6, "three tasks with an ID on two lines each");
});
