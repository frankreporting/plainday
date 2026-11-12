// Tests for CustomJS/errorLog.js (OBS-218). Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm, next to TimeReport and Billing, whose
// model it reads. Every project, note and entry here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const source = (file) => fs.readFileSync(new URL(`../CustomJS/${file}`, here), "utf8");
const load = (file, name, context = {}) => vm.runInContext(source(file) + `\n;${name}`, vm.createContext(context));
const tr = new (load("timeReport.js", "TimeReport"))();
const billing = new (load("billing.js", "Billing"))();
const log = new (load("errorLog.js", "ErrorLog"))();
const plain = (x) => JSON.parse(JSON.stringify(x));

const DAYS = "Reference/Planner/days";
const WEB = "Projects/Work/Harbor Web/Harbor Web.md";
const FREE = "Projects/Work/Loose Ends/Loose Ends.md";
const index = tr.makeIndex([
    { path: WEB, tags: ["project"], props: { rate: 80, rate_type: "hourly" } },
    { path: FREE, tags: ["project"], props: {} },
]);
const day = (date, text) => ({ date, path: `${DAYS}/${date}.md`, text });
const link = (p) => tr.reportLink(tr.basename(p), p);

test("fromModel: one line per kind per note, counted, billing first, then entries, then projects; time with no project isn't listed", () => {
    const notes = [
        day("2026-09-01", "- [x] Site map [[Harbor Web|⭕]]\n\t- 1:00pm - 2:30pm\n\t- 2:00pm - 3:00pm\n- [x] Errand\n\t- 4:00pm - 4:30pm"),
        day("2026-09-02", "- [x] Build pages [[Harbor Web|⭕]]\n\t- 2:30 - 3:45pm\n\t- 9 - 10am\n- [x] Copy [[Loose Ends|⭕]]\n\t- 11:00am - 11:30am"),
    ];
    const rows = [{ date: "2026-08-31", start: 540, end: 600, minutes: 60, billed: 60, cents: 8000, project: WEB, task: "Kickoff", note: "" }];
    const inv = { path: "Projects/Work/Harbor Web/invoices/1001-HBR.md", props: { status: "sent", project: "[[Harbor Web]]" }, text: billing.billedLines(rows, tr, (p) => tr.basename(p)).join("\n") };
    const m = tr.attachBilling(tr.build(notes, index), [inv], index, billing);
    assert.deepEqual(plain(log.fromModel(m, link).map((g) => [g.kind, g.link, g.count])), [
        // Linked to the invoice's project, whose Problems callout has the line and the daily note's link
        ["Billed entry missing", "[[Harbor Web]]", 1],
        ["Overlapping time entries", "[[2026-09-01]]", 1],
        ["Bad formatting", "[[2026-09-02]]", 2],
        ["No rate_type", "[[Loose Ends]]", 1],
    ]);
});

test("fromModel: each kind of project Problem, billing from the model's invoices, a task Problem once at its line's note, and an unknown kind still listed", () => {
    const model = {
        problems: [
            { kind: "task", path: `${DAYS}/2026-09-03.md` },
            { kind: "task", note: "Projects/Work/Harbor Web/Brief.md", path: "Projects/Work/Harbor Web/Brief.md" },
            { kind: "someday", path: `${DAYS}/2026-09-04.md` },
            { kind: "subtime", path: `${DAYS}/2026-09-06.md` },
            { kind: "subtask", path: `${DAYS}/2026-09-06.md` },
            { kind: "task", rule: "notes", path: `${DAYS}/2026-09-06.md` },
            { kind: "task", rule: "ownNotes", path: `${DAYS}/2026-09-06.md` },
        ],
        projectProblems: [
            // A task line in a project note is on each of its projects: listed once, at its note
            { project: WEB, kind: "task", path: "Projects/Work/Harbor Web/Plan.md", line: 7, message: "has a task line in [[Plan]] that disagrees" },
            { project: FREE, kind: "task", path: "Projects/Work/Harbor Web/Plan.md", line: 7, message: "has a task line in [[Plan]] that disagrees" },
            // Another Problem on the same line counts too (review round 2)
            { project: WEB, kind: "task", path: "Projects/Work/Harbor Web/Plan.md", line: 7, message: "has a task line in [[Plan]] that has its ID twice" },
            { project: WEB, message: "has a `rate` that isn't a positive number (x), so it has no Earned" },
            { project: WEB, message: "is hourly but has no `rate`, so it has no Earned" },
            { project: WEB, message: "has an `earned` that isn't a date (x), so its fee isn't counted as earned" },
            { project: WEB, message: "something new" },
            { project: WEB, parent: FREE },
            // A line that disagrees is on each project it names: listed once, at the note it's in
            { project: WEB, conflict: { side: "line", path: `${DAYS}/2026-09-05.md`, line: 3 } },
            { project: FREE, conflict: { side: "note", path: `${DAYS}/2026-09-05.md`, line: 3 } },
            { project: WEB, conflict: { side: "line", links: [WEB, FREE], path: `${DAYS}/2026-09-05.md`, line: 4 } },
            { project: FREE, conflict: { side: "note", links: [WEB, FREE], path: `${DAYS}/2026-09-05.md`, line: 4 } },
            { project: WEB, conflict: { side: "line", inbox: true, path: `${DAYS}/2026-09-05.md`, line: 5 } },
            { project: WEB, kind: "subtask", path: "Projects/Work/Harbor Web/Plan.md", line: 9, message: "is a sub-task" },
            // A `parent` is on both projects too
            { project: WEB, kind: "parent", path: "Inbox/Lamp.md" },
            { project: FREE, kind: "parent", path: "Inbox/Lamp.md" },
            // Listed from the model's billing below, not from here
            { project: WEB, invoice: { path: "I/1001-HBR.md" }, change: { kind: "free" } },
        ],
        billing: {
            invoices: [{ path: "I/1002-HBR.md", project: WEB, status: "sent", problem: "has no rows in its Billed entries" }, { path: "I/1005-HBR.md", status: "canceled", problem: "x" },
                { path: "I/1006-HBR.md", status: "paid", project: null }],
            byInvoice: new Map([[{ path: "I/1001-HBR.md" }, [{ kind: "free" }, { kind: "wording" }]], [{ path: "Reference/0900-X.md", project: null }, [{ kind: "gone" }]],
                [{ path: "I/0700-LE.md", project: FREE }, [{ kind: "gone" }]]]),
            ledger: { twice: [{ invoices: [{ path: "I/1001-HBR.md" }, { path: "I/1003-HBR.md" }] }] },
        },
    };
    assert.deepEqual(plain(log.fromModel(model, link).map((g) => `${g.kind} · ${g.name}`)), [
        "Billed entry missing · 0900-X",
        "Billed entry missing · Loose Ends",
        "Billed entry now 🆓 · 1001-HBR",
        "Entry on two invoices · 1003-HBR",
        "Billed entries need fixing · Harbor Web",
        "Invoice with no project · 1006-HBR",
        "Bad formatting · 2026-09-04",
        "Time under a nested task · 2026-09-06",
        "Rate isn't a number · Harbor Web",
        "Hourly with no rate · Harbor Web",
        "Earned date problem · Harbor Web",
        "Projects inside each other · Harbor Web",
        "Note's parent differs from its folder · Lamp",
        "Project setting · Harbor Web",
        "Line and note name different projects · 2026-09-05",
        "Two project links on one line · 2026-09-05",
        "Line's note waits in the Inbox · 2026-09-05",
        "Mark on a nested task · 2026-09-06",
        "Mark on a nested task · Plan",
        "Task lines disagree · 2026-09-03",
        "Task lines disagree · Brief",
        "Task lines disagree · Plan",
        "Task in two notes · 2026-09-06",
        "Two ⋯ notes on one task · 2026-09-06",
    ]);
    assert.equal(log.fromModel(model, link).find((g) => g.kind === "Task lines disagree" && g.name === "Plan").count, 2);
});

test("fromModel: a task line in a project note whose day doesn't have it reaches the log, once (review round 1)", async () => {
    const { standIn, PLANNER } = await import(new URL("standInVault.mjs", here));
    const KES = "Projects/Freelance/Kestrel/Kestrel.md";
    const notes = {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-16#^k3x9m2|9/16]] ^k3x9m2\n",
        [`${PLANNER}/days/2026-09-16.md`]: "- [x] Something else\n",
    };
    const t = standIn({ notes }).customJS.TimeReport;
    const model = { problems: [], projectProblems: [], entries: [] };
    t.addTaskProblems(model, t.appIndex(), Object.entries(notes).map(([path, text]) => ({ path, kind: path === KES ? "other" : "day", text })));
    assert.ok(model.projectProblems.length >= 1, "the task check finds it");
    assert.deepEqual(plain(log.fromModel(model, (p) => `[[${tr.basename(p)}]]`).map((g) => [g.kind, g.link, g.count])), [["Task lines disagree", "[[Kestrel]]", 1]]);
});

test("fromModel: an invoice with no project says so, and still lists its missing rows (review round 1)", () => {
    const rows = [{ date: "2026-08-31", start: 540, end: 600, minutes: 60, billed: 60, cents: 8000, project: WEB, task: "Kickoff", note: "" }];
    const inv = { path: "Reference/Invoices/0900-X.md", props: { status: "sent" }, text: billing.billedLines(rows, tr, (p) => tr.basename(p)).join("\n") };
    const m = tr.attachBilling(tr.build([], index), [inv], index, billing);
    assert.equal(m.billing.invoices[0].project, null);
    assert.deepEqual(plain(log.fromModel(m, link).map((g) => [g.kind, g.name])), [["Billed entry missing", "0900-X"], ["Invoice with no project", "0900-X"]]);
});

const GROUPS = log.group([
    { kind: "Bad formatting", link: "[[2026-09-16]]", name: "2026-09-16" },
    { kind: "Billed entry missing", link: "[[1001-KES]]", name: "1001-KES" },
    { kind: "Bad formatting", link: "[[2026-09-16]]", name: "2026-09-16" },
    { kind: "Overlapping time entries", link: "[[2026-09-02]]", name: "2026-09-02" },
]);

test("render: the heading, when it changed and how many are open, then the lines; nothing to fix says so", () => {
    assert.equal(log.render("Time report", GROUPS, "10/29 9:14am"), [
        "## Time report", "", "Updated 10/29 9:14am · 4 open", "",
        "- Billed entry missing · [[1001-KES]]",
        "- Overlapping time entries · [[2026-09-02]]",
        "- Bad formatting (2) · [[2026-09-16]]",
    ].join("\n"));
    assert.equal(log.render("Calendar sync", [], "10/29 8:00am"), "## Calendar sync\n\nUpdated 10/29 8:00am · nothing to fix");
});

test("place: a new note gets frontmatter; a section is replaced whole, the other kept, in their order, with what you wrote above them", () => {
    const time = log.render("Time report", GROUPS, "10/29 9:14am");
    const made = log.place("", "Time report", time, "2026102909140000");
    assert.equal(made, `---\nid: 2026102909140000\ntags:\n---\n\n${time}\n`);
    const cal = log.render("Calendar sync", log.group([{ kind: "Held back changes", link: "[[Calendar Sync]]", name: "Calendar Sync" }]), "10/29 8:00am");
    const both = log.place(made, "Calendar sync", cal);
    assert.equal(both, `---\nid: 2026102909140000\ntags:\n---\n\n${time}\n\n${cal}\n`);
    // The calendar's section first in the text still comes second; a note of yours above stays
    const mine = `---\nid: 1\ntags:\n---\n\nMy note.\n\n${cal}\n\n${time}\n`;
    const fixed = log.render("Time report", [], "10/30 9:00am");
    assert.equal(log.place(mine, "Time report", fixed), `---\nid: 1\ntags:\n---\n\nMy note.\n\n${fixed}\n\n${cal}\n`);
});

test("fresh and same: a new line or a higher count is new; the same list is neither new nor written again", () => {
    const before = log.place("", "Time report", log.render("Time report", GROUPS, "s"), "1");
    assert.deepEqual(plain(log.fresh(before, "Time report", GROUPS)), []);
    assert.ok(log.same(before, "Time report", GROUPS));
    const more = log.group([{ kind: "Bad formatting", link: "[[2026-09-16]]", name: "2026-09-16" }, { kind: "Bad formatting", link: "[[2026-09-16]]", name: "2026-09-16" },
        { kind: "Bad formatting", link: "[[2026-09-16]]", name: "2026-09-16" }, { kind: "No end time", link: "[[2026-09-17]]", name: "2026-09-17" }]);
    assert.deepEqual(plain(log.fresh(before, "Time report", more).map((g) => [g.kind, g.count])), [["Bad formatting", 3], ["No end time", 1]]);
    assert.ok(!log.same(before, "Time report", more));
    // Fewer is not new, but the list changed
    const fewer = GROUPS.slice(0, 1);
    assert.deepEqual(plain(log.fresh(before, "Time report", fewer)), []);
    assert.ok(!log.same(before, "Time report", fewer));
    // Every line is new to a note that isn't there yet, or to another section
    assert.equal(log.fresh("", "Time report", GROUPS).length, 3);
    assert.equal(log.fresh(before, "Calendar sync", GROUPS).length, 3);
});

test("toastText: how many are new, the first three by kind and note, and how many more", () => {
    assert.equal(log.toastText("Time report", GROUPS.slice(0, 2)), "Time report: 2 new problems: Billed entry missing (1001-KES), Overlapping time entries (2026-09-02).");
    const five = log.group(["a", "b", "c", "d", "e"].map((n) => ({ kind: "No end time", link: `[[${n}]]`, name: n })));
    assert.equal(log.toastText("Time report", five), "Time report: 5 new problems: No end time (a), No end time (b), No end time (c), and 2 more.");
    // A line with several new ones says how many, so the named ones and "more" add up (review round 2)
    const mixed = log.group([...[1, 2, 3].map(() => ({ kind: "Bad formatting", link: "[[2026-09-16]]", name: "2026-09-16" })),
        ...[1, 2].map(() => ({ kind: "No end time", link: "[[2026-09-17]]", name: "2026-09-17" })),
        { kind: "Overlapping time entries", link: "[[2026-09-18]]", name: "2026-09-18" }, { kind: "Misplaced 🆓", link: "[[2026-09-19]]", name: "2026-09-19" }]);
    assert.equal(log.toastText("Time report", log.fresh("", "Time report", mixed)),
        "Time report: 7 new problems: Overlapping time entries (2026-09-18), Bad formatting ×3 (2026-09-16), No end time ×2 (2026-09-17), and 1 more.");
    assert.equal(log.toastText("Calendar sync", log.group([{ kind: "Skipped lines", link: "[[Calendar Sync]]", name: "Calendar Sync" }])), "Calendar sync: 1 new problem: Skipped lines (Calendar Sync).");
});

test("fresh and toastText count only what's new: a line that went from 2 to 3 is 1 new problem; a CRLF note reads the same (review round 1)", () => {
    const two = log.group([1, 2].map(() => ({ kind: "Bad formatting", link: "[[Plan (2)]]", name: "Plan (2)" })));
    const three = log.group([1, 2, 3].map(() => ({ kind: "Bad formatting", link: "[[Plan (2)]]", name: "Plan (2)" })));
    const before = log.place("", "Time report", log.render("Time report", two, "s"), "1");
    const fresh = log.fresh(before, "Time report", three);
    assert.deepEqual(plain(fresh.map((g) => [g.count, g.added])), [[3, 1]]);
    assert.equal(log.toastText("Time report", fresh), "Time report: 1 new problem: Bad formatting (Plan (2)).");
    const crlf = before.replace(/\n/g, "\r\n");
    assert.ok(log.same(crlf, "Time report", two));
    assert.deepEqual(plain(log.fresh(crlf, "Time report", two)), []);
});

// write, toast and open against a stub of the little of `app` they use
const harness = ({ text = null } = {}) => {
    const state = { text, created: [], folders: [], notices: [], opened: [] };
    const file = () => (state.text === null ? null : { path: "Config/Error Log.md" });
    const context = {
        app: {
            vault: {
                getFileByPath: (p) => (p === "Config/Error Log.md" ? file() : null),
                getFolderByPath: (p) => (state.folders.includes(p) ? {} : null),
                createFolder: async (p) => { state.folders.push(p); },
                read: async () => state.text,
                process: async (_f, fn) => { state.text = fn(state.text); },
                create: async (p, t) => { state.created.push(p); state.text = t; },
            },
            workspace: { getLeaf: () => ({ openFile: async (f) => state.opened.push(f.path) }) },
        },
        window: { moment: () => ({ format: (f) => (f === "M/D h:mma" ? "10/29 9:14am" : "2026102909140000") }) },
        Notice: class { constructor(m, d) { state.notices.push({ m: typeof m === "string" ? m : m.text, d }); } },
        createFragment: (fn) => { const f = { text: "", appendText: (t) => { f.text += t; }, createEl: (_t, o) => { f.text += o.text; return { addEventListener: () => {} }; } }; fn(f); return f; },
    };
    return { state, log: new (load("errorLog.js", "ErrorLog", context))() };
};

test("write: the desktop makes the note when it's missing, a phone doesn't; an unchanged list isn't written again; it returns the new lines", async () => {
    const phone = harness();
    assert.deepEqual(plain(await phone.log.write("Time report", GROUPS, { create: false })), []);
    assert.equal(phone.state.text, null, "a phone leaves a missing log missing");
    const desk = harness();
    assert.equal((await desk.log.write("Time report", GROUPS, { create: true })).length, 3, "all new");
    assert.deepEqual(plain([desk.state.created, desk.state.folders]), [["Config/Error Log.md"], ["Config"]]);
    assert.ok(desk.state.text.startsWith("---\nid: 2026102909140000\ntags:\n---\n\n## Time report\n\nUpdated 10/29 9:14am · 4 open"));
    const written = desk.state.text;
    desk.state.text = written.replace("10/29 9:14am", "10/28 8:00am");
    assert.deepEqual(plain(await desk.log.write("Time report", GROUPS, { create: true })), []);
    assert.ok(desk.state.text.includes("Updated 10/28 8:00am"), "the same list isn't written again, so Updated says when it last changed");
    // A fix: the line leaves, nothing is new, and the section is written
    assert.deepEqual(plain(await desk.log.write("Time report", GROUPS.slice(0, 1), { create: true })), []);
    assert.ok(desk.state.text.includes("Updated 10/29 9:14am · 1 open") && !desk.state.text.includes("Bad formatting"));
});

test("toast: one notice for a run's new lines, with a View Error Logs link; none when nothing is new; open says when there's no log yet", async () => {
    const h = harness({ text: "" });
    h.log.toast("Time report", []);
    assert.equal(h.state.notices.length, 0);
    h.log.toast("Time report", GROUPS.slice(0, 1));
    assert.deepEqual(plain(h.state.notices), [{ m: "Time report: 1 new problem: Billed entry missing (1001-KES). View Error Logs", d: 0 }]);
    await h.log.open();
    assert.deepEqual(plain(h.state.opened), ["Config/Error Log.md"]);
    const none = harness();
    await none.log.open();
    assert.deepEqual(plain(none.state.notices), [{ m: "No error log yet: the time report makes it, on the desktop" }]);
});

test("the calendar sync's section: held-back changes and skipped lines, each one line with a count, linking the Calendar Sync note", async () => {
    const h = harness({ text: "" });
    const Sync = load("calendarSync.js", "CalendarSync", { customJS: { ErrorLog: h.log }, app: { isMobile: false } });
    await new Sync().logProblems({ held: ["a", "b"], skipped: ["c"] });
    assert.ok(h.state.text.includes("## Calendar sync\n\nUpdated 10/29 9:14am · 3 open\n\n- Held back changes (2) · [[Calendar Sync]]\n- Skipped lines · [[Calendar Sync]]"), h.state.text);
    assert.deepEqual(plain(h.state.notices.map((n) => n.m)), ["Calendar sync: 3 new problems: Held back changes ×2 (Calendar Sync), Skipped lines (Calendar Sync). View Error Logs"]);
    // A run with nothing held or skipped empties the section, with no toast
    await new Sync().logProblems({ held: [], skipped: [] });
    assert.ok(h.state.text.includes("## Calendar sync\n\nUpdated 10/29 9:14am · nothing to fix"));
    assert.equal(h.state.notices.length, 1);
});
