// Tests for CustomJS/timeReport.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
// The class is loaded with vm, the way CustomJS evaluates it; only the methods that don't touch
// `app` are tested. Checks against a real vault's data can go in
// timeReport.private.test.mjs, which git ignores.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const TimeReport = vm.runInContext(
    fs.readFileSync(new URL("../CustomJS/timeReport.js", here), "utf8") + "\n;TimeReport",
    vm.createContext({}),
);
const tr = new TimeReport();
// Objects made inside the vm context have that context's prototypes; compare as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

const LOG = "30 Reference/36 Planner/days";
const ORCHARD_WEB = "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Web 2026/Orchard Lane Web 2026.md";
const ORCHARD = "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane 2026.md";
const KESTREL = "90 Archive/Freelance/Kestrel Newsletter/Kestrel Newsletter.md";
const PINECONE = "20 Projects/Freelance/Pinecone Studio/Pinecone Studio.md";
const BUDGET = "20 Projects/Productivity/Budget Book/Budget Book.md";

const note = (date, text) => ({ date, path: `${LOG}/${date}.md`, text });
const entriesOf = (text, date = "2026-09-01") => plain(tr.parseNote(text, date));

// ------------------------------------------------------------------ times

test("minutes: am/pm, noon and midnight", () => {
    assert.equal(tr.minutes("12:00am"), 0);
    assert.equal(tr.minutes("12:30pm"), 750);
    assert.equal(tr.minutes("9:01am"), 541);
    assert.equal(tr.minutes("11:59 PM"), 1439);
    assert.equal(tr.minutes("13:00pm"), null);
    assert.equal(tr.minutes("9:60am"), null);
    assert.equal(tr.formatTime(0), "12:00am");
    assert.equal(tr.formatTime(750), "12:30pm");
    assert.equal(tr.formatTime(1440 + 351), "5:51am");
});

// ------------------------------------------------------------------ parsing

const SPEC_EXAMPLE = [
    "---",
    "aliases: 9/1/26 Tuesday",
    "---",
    "- [x] Finish launch checklist [[Finish launch checklist|🔗]] [[Orchard Lane Web 2026|⭕]]",
    "\t- 9:05am - 9:44am: prepping, sending the change list",
    "\t- 10:50am - 11:40am",
    "\t- 5:15pm - 7:15pm: 🆓 fixing my own mistake, not billing for this",
    "\t\t- Invoiced with the April batch on INV-004",
    "\t\t- 1:00pm - 2:00pm: a range inside a note about an entry",
    "- [<] 4:00pm\t[[2026-04-02 Content Calendar Sync|Content Calendar Sync]] [[Orchard Lane Web 2026|⭕]]",
    "\t- 12:55pm",
    "\t- 5:00pm - 5:30pm: 🆓",
].join("\n");

test("parseNote: the entry format from the spec", () => {
    const { entries, problems } = entriesOf(SPEC_EXAMPLE);
    assert.deepEqual(problems, []);
    assert.deepEqual(entries.map((e) => [e.line, e.minutes, e.free, e.note, e.task]), [
        [5, 39, false, "prepping, sending the change list", "Finish launch checklist"],
        [6, 50, false, "", "Finish launch checklist"],
        [7, 120, true, "fixing my own mistake, not billing for this", "Finish launch checklist"],
        [12, 30, true, "", "Content Calendar Sync"],
    ]);
});

test("parseNote: every entry line still counts as worked on for Schedule", () => {
    const wasWorkedOn = /\b\d{1,2}:\d{2}\s?[ap]m\b/i;
    const lines = SPEC_EXAMPLE.split("\n");
    for (const e of entriesOf(SPEC_EXAMPLE).entries) assert.match(lines[e.line - 1], wasWorkedOn);
});

test("parseNote: open entries are problems, not hours", () => {
    const { entries, problems } = entriesOf("- [ ] Backfill\n\t- 5:35pm - \n\t- 6:00pm -: with a note");
    assert.equal(entries.length, 0);
    assert.deepEqual(problems.map((p) => [p.line, p.kind]), [[2, "open"], [3, "open"]]);
});

test("parseNote: past midnight", () => {
    const { entries, problems } = entriesOf("- [x] Late\n\t- 10:30pm - 5:51am\n\t- 11:30pm - 12:30am: 🆓\n\t- 12:00am - 12:15am");
    assert.deepEqual(problems, []);
    assert.deepEqual(entries.map((e) => [e.minutes, e.crossesMidnight]), [[441, true], [60, true], [15, false]]);
});

test("parseNote: an end before the start that isn't pm → am is a problem", () => {
    const { entries, problems } = entriesOf("- [x] Typo\n\t- 3:00pm - 1:00pm\n\t- 11:30am - 12:15am\n\t- 2:00pm - 2:00pm");
    assert.equal(entries.length, 0);
    assert.deepEqual(problems.map((p) => p.kind), ["order", "order", "zero"]);
});

test("parseNote: lines that look like ranges but aren't are problems; other lines are left alone", () => {
    const text = [
        "- [x] Things",
        "\t- 10:00 - 11:00am",
        "\t- 4:34pm - 5:38",
        "\t- 9am - 10am",
        "\t- 9:01am - 9:40am prepping",
        "\t- 12:55pm",
        "\t- 3-4 ideas to try",
        "\t- 40 mins @ level 3",
        "\t- 9:00am to 10:00am",
    ].join("\n");
    const { entries, problems } = entriesOf(text);
    assert.equal(entries.length, 0);
    assert.deepEqual(problems.map((p) => p.line), [2, 3, 4, 5, 9]);
    assert.ok(problems.every((p) => p.kind === "format"));
});

test("parseNote: en and em dashes and capital AM/PM are accepted", () => {
    const { entries, problems } = entriesOf("- [x] Phone\n\t- 9:00am – 9:30am\n\t- 10:00 AM—10:45 AM: 🆓");
    assert.deepEqual(problems, []);
    assert.deepEqual(entries.map((e) => [e.minutes, e.free]), [[30, false], [45, true]]);
});

test("parseNote: 🆓 after other text on an entry is flagged and billed; 🆓 on the task line frees its entries (OBS-24)", () => {
    const { entries, problems } = entriesOf("- [x] Mixed\n\t- 1:00pm - 2:00pm: call 🆓");
    assert.equal(entries[0].free, false);
    assert.deepEqual(problems.map((p) => p.kind), ["free"]);
    const whole = entriesOf("- [x] Mixed 🆓\n\t- 1:00pm - 2:00pm: call 🆓");
    assert.equal(whole.entries[0].free, true);
    assert.deepEqual(whole.problems.map((p) => p.kind), ["free"]);
});

test("parseNote: entries not under a task or event count, and are flagged", () => {
    const { entries, problems } = entriesOf("## Notes\n\n- 9:00am - 10:00am\nSome text\n\t- 11:00am - 11:30am");
    assert.equal(entries.length, 2);
    assert.deepEqual(problems.map((p) => [p.line, p.kind]), [[3, "anchor"], [5, "anchor"]]);
});

test("parseNote: long entries are flagged but counted", () => {
    const { entries, problems } = entriesOf("- [x] Marathon\n\t- 7:00am - 9:30pm");
    assert.equal(entries[0].minutes, 870);
    assert.deepEqual(problems.map((p) => p.kind), ["long"]);
});

test("parseNote: skips frontmatter, code blocks and the report's own block", () => {
    const text = [
        "---", "note: 9:00am - 10:00am", "---",
        "```", "- [x] code", "\t- 9:00am - 10:00am", "```",
        "%% time:start %%", "- [x] report", "\t- 9:00am - 10:00am", "- 4:34pm - 5:38", "%% time:end %%",
        "- [x] Real", "\t- 1:00pm - 1:30pm",
    ].join("\n");
    const { entries, problems } = entriesOf(text);
    assert.deepEqual(entries.map((e) => e.line), [14]);
    assert.deepEqual(problems, []);
});

test("parseNote: old-style meeting lines under ## Meetings are events", () => {
    const text = [
        "---", "aliases: 2/7/24 Wednesday", "---",
        "## Meetings", "",
        "11:00am \t[[Weekly Team Meeting#2024-02-07 Wed Feb 7|Team Meeting]]",
        "\t- 11:00am - 11:45am",
        "12:00pm\t[[Check-in with Corwin]]",
        "- 12:00pm - 12:30pm: 🆓",
        "- 12:30pm - 12:40pm",
        "\t- a note about it",
        "2:30pm \tChart review check-in",
        "",
        "- 2:30pm - 3:00pm",
        "## To Do",
        "- 4:00pm - 5:00pm",
    ].join("\n");
    const { entries, problems } = entriesOf(text, "2024-02-07");
    assert.deepEqual(entries.map((e) => [e.line, e.minutes, e.task]), [
        [7, 45, "Team Meeting"],
        [9, 30, "Check-in with Corwin"],
        [10, 10, "Check-in with Corwin"],
        [14, 30, "Chart review check-in"],
        [16, 60, ""],
    ]);
    assert.deepEqual(problems.map((p) => [p.line, p.kind]), [[16, "anchor"]]);
});

// ------------------------------------------------------------------ projects

const INDEX = tr.makeIndex([
    { path: "20 Projects/Freelance/Freelance.md", tags: ["area"] },
    { path: ORCHARD, tags: ["project"], area: "[[Freelance|🗃️.Freelance]]" },
    { path: ORCHARD_WEB, tags: ["project"], area: "[[Orchard Lane 2026|⭕.Freelance.Orchard Lane 2026]]" },
    { path: "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Web 2026/Update chart data.md", tags: ["task"] },
    { path: "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Web 2026/logs/2026-04-02 Content Calendar Sync.md", tags: ["log"] },
    { path: `${LOG}/2026-04-01 Meeting (1 hr) — Imogen Fenwick.md`, tags: ["log"], area: "[[Orchard Lane Web 2026|⭕]]" },
    { path: PINECONE, tags: ["project"] },
    { path: "20 Projects/Freelance/Pinecone Studio/logs/2026-09-02 Launch wrapup.md", tags: ["log"] },
    { path: KESTREL, tags: ["project"], area: "[[Freelance|🗃.Freelance]]" },
    { path: "90 Archive/Freelance/Kestrel Newsletter/Kestrel Handoff Report.md", tags: [] },
    { path: "20 Projects/Personal/Renew lease for 2026.md", tags: ["task"] },
    { path: "30 Reference/33 Subjects/System notes.md", tags: ["subject"] },
    { path: "20 Projects/Productivity/Tidy up old queries.md", tags: ["task", "project"] },
    { path: "20 Projects/Productivity/Nested tag.md", tags: ["project/sample"] },
]);
const projectFor = (line, context = []) => tr.resolve([{ body: line }, ...context.map((body) => ({ body }))], `${LOG}/2026-09-01.md`, INDEX);

test("resolve: a project link wins over everything, whatever its alias", () => {
    assert.equal(projectFor("[x] Task [[2026-09-02 Launch wrapup|🔗]] [[Orchard Lane Web 2026|⭕]]"), ORCHARD_WEB);
    assert.equal(projectFor("[>] Work on [[Orchard Lane Web 2026|⭕️.Freelance.Orchard Lane Web 2026]] [[Work on|🔗]]"), ORCHARD_WEB);
    assert.equal(projectFor("[>] [[2024-12-10|12/10]] [[Kestrel Newsletter]]"), KESTREL);
    // on a line the task is nested under, it still beats the task's own 🔗
    assert.equal(projectFor("[x] Subtask [[2026-09-02 Launch wrapup|🔗]]", ["[ ] Parent [[Orchard Lane Web 2026|⭕]]"]), ORCHARD_WEB);
    // a ⭕ says where the time goes, ahead of a project mentioned earlier in the text (OBS-36)
    assert.equal(projectFor("[x] Send the [[Kestrel Newsletter]] invoice [[Orchard Lane Web 2026|⭕]]"), ORCHARD_WEB);
    assert.equal(projectFor("[x] Send the [[Kestrel Newsletter]] invoice [[Orchard Lane Web 2026|⭕️]]"), ORCHARD_WEB, "with U+FE0F");
    assert.equal(projectFor("[x] Subtask", ["[ ] Parent [[Kestrel Newsletter]] work [[Orchard Lane Web 2026|⭕]]"]), ORCHARD_WEB, "on a parent line too");
    assert.equal(projectFor("[x] Send the [[Kestrel Newsletter]] invoice [[Orchard Lane Web 2026|⭕ Orchard]]"), KESTREL, "⭕ with a name after it is an ordinary alias, as the report itself writes them");
    // An area's 🗃️ link is stripped from task text like the other suffixes, and (once areas count, OBS-51) outranks a prose link the same way
    assert.equal(tr.taskText("[x] Water the beds [[Household|🗃️]] [[Water the beds|🔗]]"), "Water the beds");
});

test("resolve: the 🔗 note's project folder, then its area", () => {
    assert.equal(projectFor("[x] Wrap up [[2026-09-02 Launch wrapup|🔗]]"), PINECONE);
    assert.equal(projectFor("[x] Update [[Update chart data|🔗]]"), ORCHARD_WEB);
    assert.equal(projectFor("[x] Handoff [[Kestrel Handoff Report|🔗]]"), KESTREL);
    assert.equal(projectFor("[x] Rent [[Renew lease for 2026|🔗]]"), null);
    assert.equal(projectFor("[x] Queries [[Tidy up old queries|🔗]]"), "20 Projects/Productivity/Tidy up old queries.md");
});

test("resolve: a linked log note's folder or area", () => {
    assert.equal(projectFor("[<] 5:00pm\t[[2026-04-02 Content Calendar Sync|Content Calendar Sync]]"), ORCHARD_WEB);
    assert.equal(projectFor("[<] 4:00pm\t[[2026-04-01 Meeting (1 hr) — Imogen Fenwick|Meeting]]"), ORCHARD_WEB);
});

test("resolve: date links, nested #project/ tags and plain text resolve to nothing", () => {
    assert.equal(projectFor("[x] Pay [[2026-09-14|🚩 9/14]]"), null);
    assert.equal(projectFor("[x] Something [[Nested tag]]"), null);
    assert.equal(projectFor("[x] Just a task"), null);
    assert.equal(projectFor("[x] Setup [[System notes|🔗]]"), null);
});

test("parentProject: sub-projects by folder, archived projects too", () => {
    assert.equal(tr.parentProject(ORCHARD_WEB, INDEX), ORCHARD);
    assert.equal(tr.parentProject(ORCHARD, INDEX), null);
    assert.equal(tr.parentProject(KESTREL, INDEX), null);
});

// ------------------------------------------------------------------ areas (OBS-51)

const CYCLING = "20 Projects/Cycling/Cycling.md";
const CENTURY = "20 Projects/Cycling/Century Ride/Century Ride.md";
const AREA_INDEX = tr.makeIndex([
    { path: CYCLING, tags: ["area"] },
    { path: CENTURY, tags: ["project"], area: "[[Cycling|🗃️.Cycling]]", props: { rate_type: "non-billable" } },
    { path: "20 Projects/Cycling/Tune the gears.md", tags: ["task"] },
    { path: "20 Projects/Cycling/Century Ride/Route plan.md", tags: ["task"] },
    { path: "30 Reference/Logs/2026-09-01 Group ride.md", tags: ["log"], area: "[[Cycling|🗃️]]" },
    { path: "90 Archive/Hobbies/Hobbies.md", tags: ["area"] },
    { path: PINECONE, tags: ["project"] },
]);
const areaFor = (line, context = [], live = false) =>
    tr.resolve([{ body: line }, ...context.map((body) => ({ body }))], `${LOG}/2026-09-01.md`, AREA_INDEX, live);

test("OBS-51 resolve: time linked to an area, on the line or through a note filed under it, counts toward the area", () => {
    assert.equal(areaFor("[x] Run [[Cycling|⭕]]"), CYCLING);
    assert.equal(areaFor("[x] Run [[Cycling|🗃️]]"), CYCLING, "the 🗃️ mark too");
    assert.equal(areaFor("[x] Run [[Cycling]]"), CYCLING, "any alias");
    assert.equal(areaFor("[x] Stretch [[Tune the gears|🔗]]"), CYCLING, "a task note filed straight under the area");
    assert.equal(areaFor("[<] 7:00am\t[[2026-09-01 Group ride|Group ride]]"), CYCLING, "a log whose `area` is the area");
    assert.equal(areaFor("[x] Subtask", ["[ ] Parent [[Cycling|⭕]]"]), CYCLING, "on a line it's nested under");
    // A project inside the area keeps its own time: the nearest folder note wins
    assert.equal(areaFor("[x] Plan [[Route plan|🔗]]"), CENTURY);
    // A ⭕ area beats a project merely mentioned, and a ⭕ project beats an area mentioned
    assert.equal(areaFor("[x] Rest day, no [[Pinecone Studio]] work [[Cycling|⭕]]"), CYCLING);
    assert.equal(areaFor("[x] Skip [[Cycling]] today [[Pinecone Studio|⭕]]"), PINECONE);
    // An archived area is passed over like an archived project
    assert.equal(areaFor("[x] Paint [[Hobbies|⭕]]", [], true), null);
});

test("OBS-51 parentProject: an area is never a parent, so a project's time doesn't roll up into it", () => {
    assert.equal(tr.parentProject(CENTURY, AREA_INDEX), null, "not by folder, nor by `area`");
    assert.equal(tr.parentProject(CYCLING, AREA_INDEX), null);
    assert.equal(tr.projectOfNote(CYCLING, AREA_INDEX), CYCLING);

    const model = tr.build([note("2026-09-01", [
        "- [x] Run [[Cycling|⭕]]",
        "\t- 7:00am - 7:45am",
        "- [x] Hill repeats [[Century Ride|⭕]]",
        "\t- 8:00am - 9:30am",
    ].join("\n"))], AREA_INDEX);
    assert.deepEqual(plain(model.entries.map((e) => [e.project, e.minutes])), [[CYCLING, 45], [CENTURY, 90]]);
    assert.equal(model.parent.get(CENTURY), null);
    assert.equal(model.parent.get(CYCLING), null);
    assert.deepEqual(plain([...tr.projectTargets(model)].sort()), [CENTURY, CYCLING]);

    // The area's own report has only its own time, with no row for the project inside it
    const block = tr.render(model, { kind: "project", path: CYCLING }, "s", (p) => `[[${tr.basename(p)}|${tr.linkMark(p, AREA_INDEX)} ${tr.basename(p)}]]`);
    assert.ok(!block.includes("Century Ride"), block);
    assert.match(block, /\| 1 \|  \| 0\.75 \| 0\.75 \| 0\.75 \|  \| non-billable \|/, "45 minutes, 🆓 since the area sets no rate");
    assert.match(block, /### Problems\n\nNone\./, "and it isn't asked for a rate_type");
});

test("OBS-51 money: an area with its own rate bills; an area filed inside a project is no sub-project of it", () => {
    const idx = tr.makeIndex([
        { path: "P/Client/Client.md", tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
        { path: "P/Client/Admin/Admin.md", tags: ["area"] },
        { path: "P/Coaching/Coaching.md", tags: ["area"], props: { rate: 60 } },
    ]);
    assert.equal(tr.parentProject("P/Client/Admin/Admin.md", idx), null);
    const model = tr.build([note("2026-09-01", [
        "- [x] Timesheets [[Admin|⭕]]",
        "\t- 7:00am - 8:00am",
        "- [x] Session [[Coaching|🗃️]]",
        "\t- 9:00am - 10:00am",
    ].join("\n"))], idx);
    assert.deepEqual(plain(model.entries.map((e) => [e.project, e.billable])), [["P/Client/Admin/Admin.md", false], ["P/Coaching/Coaching.md", true]]);
    assert.equal(model.parent.get("P/Client/Admin/Admin.md"), null, "not rolled into the client's hours");
    assert.equal(model.money.get("P/Client/Admin/Admin.md").rate, null, "nor billed at its rate");
    assert.equal(model.money.get("P/Coaching/Coaching.md").rate, 60);
    assert.ok(!tr.projectTargets(model).has("P/Client/Client.md"));
    assert.deepEqual(plain(model.projectProblems), []);
});

test("OBS-51 links: an area's report link is 🗃️; a note tagged both is a project", () => {
    assert.equal(tr.linkMark(CYCLING, AREA_INDEX), "🗃️");
    assert.equal(tr.linkMark(CENTURY, AREA_INDEX), "⭕");
    assert.equal(tr.isAreaOnly(CYCLING, AREA_INDEX), true);
    assert.equal(tr.isAreaOnly(CENTURY, AREA_INDEX), false);
    const both = tr.makeIndex([{ path: "P/Both/Both.md", tags: ["area", "project"] }]);
    assert.equal(tr.isAreaOnly("P/Both/Both.md", both), false, "a note tagged both is a project");
    assert.equal(tr.linkMark("P/Both/Both.md", both), "⭕");
});

test("OBS-51 writing: an area note with time gets a report block added, like a project note", async () => {
    const { planReports, frontmatter } = await import("./demo/renderReports.mjs");
    const vaultOf = (files) => ({ notes: new Map(Object.entries(files).map(([p, text]) => [p, { text, fm: frontmatter(text) }])) });
    const day = "- [x] Run [[Cycling|⭕]]\n\t- 7:00am - 7:45am\n- [x] Paint [[Studio|⭕]]\n\t- 9:00am - 9:30am\n";
    const files = {
        "30 Reference/36 Planner/days/2026-09-01.md": day,
        "Projects/Cycling/Cycling.md": "---\ntags: area\n---\nRides.\n",
        "Projects/Studio/Studio.md": "---\ntags: area\n---\n## Time tracking\n\n%% time:start %%\n%% time:end %%\n",
        "Projects/Idle/Idle.md": "---\ntags: area\n---\nNothing logged here.\n",
    };
    const plan = planReports(tr, vaultOf(files));
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plain(plan.targets.project.slice().sort()), ["Projects/Cycling/Cycling.md", "Projects/Studio/Studio.md"], "an area with no time and no block is left alone");
    const cycling = plan.changes.find((c) => c.path === "Projects/Cycling/Cycling.md").after;
    assert.match(cycling, /^Rides\.\n\n## Time tracking\n\n%% time:start %%/m, "added under a new heading at the end");
    assert.match(cycling, /\| 1 \|  \| 0\.75 \| 0\.75 \| 0\.75 \|  \| non-billable \|/, cycling);
    const studio = plan.changes.find((c) => c.path === "Projects/Studio/Studio.md").after;
    assert.match(studio, /\| 1 \|  \| 0\.50 \| 0\.50 \| 0\.50 \|/, "an existing block is filled in place");
    // The weekly note lists both areas as rows of their own, linked with 🗃️
    const week = plan.changes.find((c) => c.path.includes("/weeks/")).after;
    assert.match(week, /\[\[Cycling\\\|🗃️ Cycling\]\]/, week);
    assert.match(week, /\[\[Studio\\\|🗃️ Studio\]\]/, week);
});

test("table cells: hours always with two decimals, and blank for zero hours or zero Earned", () => {
    assert.equal(tr.hoursCell(60), "1.00");
    assert.equal(tr.hoursCell(45), "0.75");
    assert.equal(tr.hoursCell(0), "");
    assert.equal(tr.moneyCell(0), "");
    assert.equal(tr.moneyCell(8000), "$80.00");
});

test("rounded: each entry up to the next 15 minutes, as invoices are billed", () => {
    const cases = [[0, 0], [1, 15], [3, 15], [15, 15], [16, 30], [20, 30], [45, 45], [50, 60],
        [120, 120], [121, 135], [126, 135], [441, 450]];
    for (const [minutes, expected] of cases) assert.equal(tr.rounded(minutes), expected, `${minutes} min`);
});

test("archived projects are left out; entries past midnight count for live projects", () => {
    const text = [
        "---", "aliases: 12/9/24 Monday", "---", "", "## Meetings", "", "", "## To Do", "",
        "- [>] [[2024-12-10|12/10]] [[Kestrel Newsletter]]",
        "\t- [x] Sort the backlog into themes",
        "\t\t- 10:30pm - 5:51am",
        "\t- 1:00pm - 2:00pm",
        "\t- 4:34pm - 5:38",
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]",
        "\t- 10:30pm - 5:51am",
    ].join("\n");
    const model = tr.build([note("2024-12-09", text)], INDEX);
    // Kestrel lives in 90 Archive: its entries and problems are gone, so is its project note
    assert.deepEqual(plain(model.entries.map((e) => [e.project, e.minutes, e.crossesMidnight])), [[ORCHARD_WEB, 441, true]]);
    // The archived entry still counts for overlaps with live work (both 10:30pm - 5:51am)
    assert.deepEqual(plain(model.problems.map((p) => [p.kind, p.projects])), [["overlap", [null, ORCHARD_WEB]]]);
    assert.ok(![...model.parent.keys()].includes(KESTREL));
});

test("overlaps are found across midnight", () => {
    const model = tr.build([
        note("2024-12-09", "- [x] Late [[Orchard Lane Web 2026|⭕]]\n\t- 10:30pm - 5:51am"),
        note("2024-12-10", "- [x] Early [[Orchard Lane Web 2026|⭕]]\n\t- 5:30am - 6:00am"),
    ], INDEX);
    assert.deepEqual(plain(model.problems.map((p) => [p.date, p.kind])), [["2024-12-10", "overlap"]]);
});

// ------------------------------------------------------------------ events: free and busy (OBS-47)

const overlaps = (model) => plain(model.problems.filter((p) => p.kind === "overlap").map((p) => [p.date, p.line, p.text, p.message]));
const D = "2026-09-15";

test("parseNote: a timed event line is read with its end line, its free mark and whether it has entries", () => {
    const { events, entries } = entriesOf([
        "- [<] All day\tFarmers market",
        "- [<] 2:00pm\tDelivery window ℹ️ [[Household|⭕]]",
        "\t- 4:00pm",
        "- [<] 9:00am\tStandup [[Orchard Lane Web 2026|⭕]]",
        "\t- 9:00am - 9:20am",
        "\t- 9:30am",
        "- [<] 11:00pm\tRed-eye check-in",
        "\t- 1:00am",
        "- [<] 5:00pm\tNo end line",
        "- [-] 3:00pm\tCanceled",
        "\t- 3:30pm",
    ].join("\n"), D);
    assert.deepEqual(events.map((e) => [e.line, e.start, e.end, e.free, e.ranges, e.text]), [
        [2, 840, 960, true, false, "- [<] 2:00pm Delivery window ℹ️ [[Household|⭕]]"],
        [4, 540, null, false, true, "- [<] 9:00am Standup [[Orchard Lane Web 2026|⭕]]"],   // entries under it: the end line is ignored
        [7, 1380, 1440 + 60, false, false, "- [<] 11:00pm Red-eye check-in"],
        [9, 1020, null, false, false, "- [<] 5:00pm No end line"],
    ]);
    // The end line is still not an entry, and the entry under the standup counts as always
    assert.deepEqual(entries.map((e) => [e.line, e.minutes]), [[5, 20]]);
});

test("freeEvent and taskText: ℹ️ after the title, with or without U+FE0F, before ⭕ links; never in table text", () => {
    assert.equal(tr.freeEvent("[<] 2:00pm\tDelivery window ℹ️"), true);
    assert.equal(tr.freeEvent("[<] 2:00pm\tDelivery window ℹ [[Household|⭕]]"), true);
    assert.equal(tr.freeEvent("[<] 2:00pm\tℹ️ Delivery window"), false);
    assert.equal(tr.freeEvent("[<] 2:00pm\tDelivery window"), false);
    assert.equal(tr.taskText("[<] 2:00pm\tDelivery window ℹ️ [[Household|⭕]]"), "Delivery window");
    assert.equal(tr.taskText("[<] 2:00pm\t[[2026-09-15 Flight|Flight]] ℹ️"), "Flight");
});

test("a busy event that has ended overlaps a typed entry, and another busy event; both events count (OBS-24)", () => {
    const model = tr.build([note(D, [
        "- [<] 2:00pm\tClient call [[Orchard Lane Web 2026|⭕]]",
        "\t- 3:00pm",
        "- [<] 2:30pm\tDentist",
        "\t- 3:15pm",
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]",
        "\t- 2:45pm - 4:00pm",
    ].join("\n"))], INDEX);
    assert.deepEqual(overlaps(model), [
        [D, 3, "- [<] 2:30pm Dentist", "overlaps the event 2:00pm - 3:00pm (line 1)"],
        [D, 6, "- 2:45pm - 4:00pm", "overlaps the event 2:30pm - 3:15pm (line 3)"],
    ]);
    // The event's project is where its overlap is listed; the entry's overlap names both
    assert.deepEqual(plain(model.problems.map((p) => p.projects)), [[null, ORCHARD_WEB], [ORCHARD_WEB, null]]);
    // The client call is an hour on its project; the dentist is 45 minutes Unassigned
    assert.deepEqual(plain(model.entries.map((e) => [e.line, e.minutes, e.project, e.task, e.free])),
        [[6, 75, ORCHARD_WEB, "Charts", false], [1, 60, ORCHARD_WEB, "Client call", false], [3, 45, null, "Dentist", false]]);
});

test("a free event never overlaps: free × busy, free × free, free × a typed entry, and an entry typed under it still counts", () => {
    const model = tr.build([note(D, [
        "- [<] 2:00pm\tDelivery window ℹ️",
        "\t- 4:00pm",
        "- [<] 2:00pm\tClient call [[Orchard Lane Web 2026|⭕]]",
        "\t- 3:00pm",
        "- [<] 2:30pm\tSchool pickup ℹ️ [[Household|⭕]]",
        "\t- 3:30pm",
        "- [<] 3:00pm\tOpen house ℹ️",
        "\t- 3:15pm - 3:45pm: dropped by",
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]",
        "\t- 3:00pm - 4:00pm",
    ].join("\n"))], INDEX);
    assert.deepEqual(overlaps(model), [[D, 8, "- 3:15pm - 3:45pm", "overlaps 3:00pm - 4:00pm (line 10)"]]);
    // The free events never count; the busy client call does
    assert.deepEqual(plain(model.entries.map((e) => [e.line, e.minutes, e.task])), [[8, 30, "Open house"], [10, 60, "Charts"], [3, 60, "Client call"]]);
});

test("an event with time entries under it has no span of its own; without an end line, all day, canceled or forwarded, none either", () => {
    const model = tr.build([note(D, [
        "- [<] All day\tOffsite",
        "- [<] 9:00am\tStandup",
        "\t- 9:00am - 9:20am",
        "\t- 9:30am",
        "- [<] 9:10am\tNo end line",
        "- [-] 9:00am\tCanceled",
        "\t- 9:30am",
        "- [>] [[2026-09-16|9/16]] 9:00am\tMoved",
        "\t- 9:30am",
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]",
        "\t- 9:05am - 10:00am",
    ].join("\n"))], INDEX);
    // Only the typed entries overlap each other, and only they count
    assert.deepEqual(overlaps(model), [[D, 11, "- 9:05am - 10:00am", "overlaps 9:00am - 9:20am (line 3)"]]);
    assert.deepEqual(plain(model.entries.map((e) => e.line)), [3, 11]);
    // The busy event with no end line is a Problem, like a running clock
    assert.deepEqual(plain(model.problems.filter((p) => p.kind !== "overlap").map((p) => [p.line, p.kind, p.message])),
        [[5, "open", "has no end time under it, so it isn't counted"]]);
});

test("events overlap across midnight, unless free", () => {
    const busy = tr.build([
        note("2024-12-09", "- [<] 11:00pm\tRed-eye check-in\n\t- 1:00am"),
        note("2024-12-10", "- [x] Early [[Orchard Lane Web 2026|⭕]]\n\t- 12:30am - 1:30am"),
    ], INDEX);
    assert.deepEqual(overlaps(busy), [["2024-12-10", 2, "- 12:30am - 1:30am", "overlaps the event 11:00pm - 1:00am (12/9/24 line 1)"]]);
    const free = tr.build([
        note("2024-12-09", "- [<] 11:00pm\tRed-eye check-in ℹ️\n\t- 1:00am"),
        note("2024-12-10", "- [x] Early [[Orchard Lane Web 2026|⭕]]\n\t- 12:30am - 1:30am"),
    ], INDEX);
    assert.deepEqual(overlaps(free), []);
    // An end before the start that isn't pm → am is no end at all, and a Problem
    const odd = tr.build([note(D, "- [<] 9:00am\tOdd\n\t- 8:00am\n- [x] Charts\n\t- 8:30am - 9:30am")], INDEX);
    assert.deepEqual(overlaps(odd), []);
    assert.deepEqual(plain(odd.problems.map((p) => [p.line, p.kind])), [[1, "order"]]);
    assert.deepEqual(plain(odd.entries.map((e) => e.line)), [4]);
});

test("an event that hasn't ended yet doesn't overlap anything and isn't counted (the sync writes days ahead)", () => {
    const notes = [note(D, "- [<] 2:00pm\tClient call\n\t- 3:00pm\n- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 2:30pm - 3:30pm")];
    const early = tr.build(notes, INDEX, { now: { date: D, minutes: 14 * 60 + 45 } });
    assert.equal(overlaps(early).length, 0);
    assert.deepEqual(plain(early.entries.map((e) => e.line)), [], "the entry hasn't ended either");
    const later = tr.build(notes, INDEX, { now: { date: D, minutes: 15 * 60 + 30 } });
    assert.equal(overlaps(later).length, 1);
    assert.deepEqual(plain(later.entries.map((e) => e.line)), [4, 1]);
    assert.equal(overlaps(tr.build(notes, INDEX)).length, 1);
    // Days ahead: two synced events that overlap each other on a future day aren't a Problem yet
    const ahead = tr.build([note("2026-09-20", "- [<] 2:00pm\tA\n\t- 3:00pm\n- [<] 2:30pm\tB\n\t- 3:30pm")], INDEX, { now: { date: D, minutes: 600 } });
    assert.deepEqual(overlaps(ahead), []);
    assert.deepEqual(plain(ahead.entries), []);
});

test("an event of an archived project overlaps live work but isn't reported on its own", () => {
    const model = tr.build([note(D, [
        "- [<] 2:00pm\tOld standup [[Kestrel Newsletter|⭕]]",
        "\t- 3:00pm",
        "- [<] 2:30pm\tOld review [[Kestrel Newsletter|⭕]]",
        "\t- 3:30pm",
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]",
        "\t- 2:45pm - 4:00pm",
    ].join("\n"))], INDEX);
    assert.deepEqual(overlaps(model).map((p) => p[1]), [6]);
    assert.deepEqual(plain(model.entries.map((e) => e.line)), [6], "archived events are overlap-only");
});

// ------------------------------------------------------------------ events count (OBS-24)

test("parseNote: the end line's note, its 🆓, and 🆓 on the event line are read; the time comes off the line first", () => {
    const { events, problems } = entriesOf([
        "- [<] 11:00pm\tRed-eye check-in",
        "\t- 1:00am: 🆓 not my time",
        "- [<] 9:00am\tStandup 🆓 [[Orchard Lane Web 2026|⭕]]",
        "\t- 9:20am",
        "- [<] 10:00am\tReview [[Orchard Lane Web 2026|⭕]]",
        "\t- 10:30am : went long",
    ].join("\n"), D);
    assert.deepEqual(events.map((e) => [e.line, e.start, e.end, e.endText, e.endNote, e.endFree, e.lineFree]), [
        [1, 1380, 1440 + 60, "1:00am", "not my time", true, false],
        [3, 540, 560, "9:20am", "", false, true],
        [5, 600, 630, "10:30am", "went long", false, false],
    ]);
    assert.deepEqual(problems, []);
});

test("parseNote: a bare end line wins over a noted bullet; a note with a time in it isn't a Problem", () => {
    const { events, problems } = entriesOf([
        "- [<] 3:00pm\tPitch",
        "\t- 3:00pm: they were late",
        "\t- 4:30pm",
        "- [<] 5:00pm\tCall",
        "\t- 5:30pm: 🆓 ran on to 6:00pm",
    ].join("\n"), D);
    assert.deepEqual(events.map((e) => [e.line, e.end, e.endNote]), [[1, 990, ""], [4, 1050, "ran on to 6:00pm"]]);
    assert.deepEqual(problems, []);
});

test("build: a busy event with an end line counts from start to end, on its project or Unassigned, once it has ended", () => {
    const model = tr.build([note(D, [
        "- [<] 8:00am\tCoffee with Esme",
        "\t- 9:00am",
        "- [<] 9:00am\tStandup [[Orchard Lane Web 2026|⭕]]",
        "\t- 9:20am",
        "- [<] 10:00am\t[[2026-04-02 Content Calendar Sync|Content Calendar Sync]]",
        "\t- 10:45am",
        "- [<] 2:00pm\tDelivery window ℹ️ [[Household|⭕]]",
        "\t- 4:00pm",
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]",
        "\t- 11:00am - 11:30am",
    ].join("\n"))], INDEX);
    assert.deepEqual(plain(model.entries.map((e) => [e.line, e.start, e.end, e.minutes, e.project, e.task, e.note, e.free, e.billable])), [
        [10, 660, 690, 30, ORCHARD_WEB, "Charts", "", false, true],
        [1, 480, 540, 60, null, "Coffee with Esme", "", false, false],
        [3, 540, 560, 20, ORCHARD_WEB, "Standup", "", false, true],
        [5, 600, 645, 45, ORCHARD_WEB, "Content Calendar Sync", "", false, true],
    ]);
    assert.deepEqual(plain(model.problems), []);
    // The summary counts them like typed entries: rounded up to 15 minutes each
    const t = plain(tr.totals(model.entries.filter((e) => e.project === ORCHARD_WEB)));
    assert.deepEqual([t.count, t.billable, t.exact], [3, 30 + 30 + 45, 30 + 20 + 45]);
});

test("build: 🆓 on the end line, or on the event line, makes the event's time 🆓; both at once is a Problem", () => {
    const model = tr.build([note(D, [
        "- [<] 9:00am\tStandup [[Orchard Lane Web 2026|⭕]]",
        "\t- 9:20am: 🆓 not billing this one",
        "- [<] 10:00am\tReview 🆓 [[Orchard Lane Web 2026|⭕]]",
        "\t- 10:30am",
        "- [<] 11:00am\tSync 🆓 [[Orchard Lane Web 2026|⭕]]",
        "\t- 11:30am: 🆓",
        "- [<] 1:00pm\tCall [[Orchard Lane Web 2026|⭕]]",
        "\t- 1:30pm: not billing 🆓",
    ].join("\n"))], INDEX);
    assert.deepEqual(plain(model.entries.map((e) => [e.line, e.free, e.note, e.task])), [
        [1, true, "not billing this one", "Standup"], [3, true, "", "Review"], [5, true, "", "Sync"], [7, false, "not billing 🆓", "Call"],
    ]);
    assert.deepEqual(plain(model.problems.map((p) => [p.line, p.kind, p.message])), [
        [5, "free", "has 🆓 on the event line and on its end line; one is enough"],
        [7, "free", "has 🆓 after other text on its end line, so it doesn't count; put 🆓 right after the colon"],
    ]);
});

test("build: ranges under an event still win; a 🆓 left on the end line then doesn't apply, and says so", () => {
    const model = tr.build([note(D, [
        "- [<] 9:00am\tStandup [[Orchard Lane Web 2026|⭕]]",
        "\t- 9:30am: 🆓",
        "\t- 9:00am - 9:10am",
        "\t- 9:20am - 9:30am",
        "- [<] 10:00am\tReview [[Orchard Lane Web 2026|⭕]]",
        "\t- 11:00am",
        "\t- 10:00am - 10:40am",
    ].join("\n"))], INDEX);
    assert.deepEqual(plain(model.entries.map((e) => [e.line, e.minutes, e.free])), [[3, 10, false], [4, 10, false], [7, 40, false]]);
    assert.deepEqual(plain(model.problems.map((p) => [p.line, p.kind, p.message])),
        [[1, "free", "has 🆓 on its end line, but the entries under it are its time, so it doesn't apply; put 🆓 on the entries or the event line"]]);
});

test("build: a sub-task's entries under an event are its own; the event still counts", () => {
    const model = tr.build([note(D, [
        "- [<] 9:00am\tStandup [[Orchard Lane Web 2026|⭕]]",
        "\t- 9:30am",
        "\t- [ ] Send notes",
        "\t\t- 9:30am - 9:45am",
    ].join("\n"))], INDEX);
    assert.deepEqual(plain(model.entries.map((e) => [e.line, e.minutes, e.task])), [[4, 15, "Send notes"], [1, 30, "Standup"]]);
    assert.deepEqual(overlaps(model), []);
});

test("build: zero-length events are silently nothing; long events are flagged but counted; free events with no end are silent", () => {
    const model = tr.build([note(D, [
        "- [<] 9:00am\tCheck in",
        "\t- 9:00am",
        "- [<] 6:00am\tTravel day",
        "\t- 7:00pm",
        "- [<] 8:00pm\tFlight ℹ️",
    ].join("\n"))], INDEX);
    assert.deepEqual(plain(model.entries.map((e) => [e.line, e.minutes])), [[3, 13 * 60]]);
    assert.deepEqual(plain(model.problems.map((p) => [p.line, p.kind])), [[3, "long"]]);
});

test("🆓 on a task line frees every entry under it and under its sub-tasks; on an entry only that one; both is a Problem", () => {
    const { entries, problems } = entriesOf([
        "- [x] Rework 🆓 [[Orchard Lane Web 2026|⭕]]",
        "\t- 9:00am - 9:30am",
        "\t- 10:00am - 10:30am: 🆓 also here",
        "\t- [x] Sub-task",
        "\t\t- 11:00am - 11:15am",
        "- [x] Fix [[Notes 🆓 Sweep|🔗]]",
        "\t- 1:00pm - 1:30pm",
        "- [x] Mixed (🆓)",
        "\t- 2:00pm - 2:30pm",
        "- [x] Stray🆓",
        "\t- 3:00pm - 3:30pm",
    ].join("\n"), D);
    assert.deepEqual(entries.map((e) => [e.line, e.free, e.note]), [
        [2, true, ""], [3, true, "also here"], [5, true, ""], [7, false, ""], [9, true, ""], [11, false, ""],
    ]);
    assert.deepEqual(problems.map((p) => [p.line, p.kind, p.message]), [
        [3, "free", "has 🆓 here and on the line above; one is enough"],
        [10, "free", "has a 🆓 that isn't on its own, so it doesn't count; put a space before it"],
    ]);
    // Said once, on the line that has it, however many entries sit under it
    const many = entriesOf("- [ ] Task🆓\n\t- 1:00pm - 1:30pm\n\t- 2:00pm - 2:30pm\n\t- 3:00pm - 3:30pm", D);
    assert.deepEqual(many.problems.map((p) => [p.line, p.kind]), [[1, "free"]]);
    assert.equal(tr.taskText("[ ] Call (🆓) client"), "Call client");
});

test("build: what's wrong with an event waits until the event has started (the sync writes months ahead)", () => {
    const notes = [note("2026-10-20", [
        "- [<] 4:00pm\tNo end yet",
        "- [<] 8:00am\tConference",
        "\t- 9:00pm",
        "- [<] 1:00pm\tOdd",
        "\t- 12:00pm",
    ].join("\n"))];
    const before = tr.build(notes, INDEX, { now: { date: D, minutes: 600 } });
    assert.deepEqual(plain(before.problems), []);
    assert.deepEqual(plain(before.entries), []);
    const started = tr.build(notes, INDEX, { now: { date: "2026-10-20", minutes: 16 * 60 + 5 } });
    assert.deepEqual(plain(started.problems.map((p) => [p.line, p.kind])), [[1, "open"], [2, "long"], [4, "order"]]);
    assert.deepEqual(plain(started.entries), [], "the conference hasn't ended, so it isn't counted yet");
    const over = tr.build(notes, INDEX, { now: { date: "2026-10-21", minutes: 0 } });
    assert.deepEqual(plain(over.problems.map((p) => [p.line, p.kind])), [[1, "open"], [2, "long"], [4, "order"]]);
    assert.deepEqual(plain(over.entries.map((e) => e.line)), [2]);
    // Without a clock everything is said, as in the other tests
    assert.deepEqual(plain(tr.build(notes, INDEX).problems.map((p) => p.kind)), ["open", "long", "order"]);
});

test("parseNote: an end line that isn't a real time is a format Problem, and a real one after it still counts", () => {
    const { events, problems } = entriesOf("- [<] 4:00pm\tPlanning\n\t- 13:00pm\n\t- 5:00pm", D);
    assert.deepEqual(events.map((e) => [e.end, e.endText]), [[1020, "5:00pm"]]);
    assert.deepEqual(problems.map((p) => [p.line, p.kind]), [[2, "format"]]);
});

test("freeEvent and taskText: a 🆓 word beside ℹ️, in either order, doesn't hide the free mark", () => {
    assert.equal(tr.freeEvent("[<] 2:00pm\tDelivery window ℹ️ 🆓 [[Household|⭕]]"), true);
    assert.equal(tr.freeEvent("[<] 2:00pm\tDelivery window 🆓 ℹ️"), true);
    assert.equal(tr.freeEvent("[<] 2:00pm\tDelivery window 🆓"), false);
    assert.equal(tr.freeEvent("[<] 2:00pm\tDelivery window ℹ️ (🆓)"), true);
    assert.equal(tr.taskText("[<] 2:00pm\tDelivery window ℹ️ 🆓 [[Household|⭕]]"), "Delivery window");
    assert.equal(tr.taskText("[x] Rework 🆓 [[Orchard Lane Web 2026|⭕]]"), "Rework");
    // A free event marked 🆓 is still just free: never counted
    const model = tr.build([note(D, "- [<] 2:00pm\tDelivery window ℹ️ 🆓\n\t- 4:00pm")], INDEX);
    assert.deepEqual(plain(model.entries), []);
    assert.deepEqual(plain(model.problems), []);
});

// ------------------------------------------------------------------ the report

// Billing properties as they'd come from the project notes
const MONEY_INDEX = tr.makeIndex([
    ...["20 Projects/Freelance/Freelance.md"].map((path) => ({ path, tags: ["area"] })),
    { path: ORCHARD, tags: ["project"], props: { rate: "80", rate_type: "hourly", contract_max: 9600 } },
    { path: ORCHARD_WEB, tags: ["project"] },
    { path: PINECONE, tags: ["project"], props: { rate: 120, rate_type: "hourly", max_hours: 42 } },
    { path: "20 Projects/Freelance/Bramble/Bramble.md", tags: ["project"], props: { rate: 640, rate_type: "flat", max_hours: 36 } },
    { path: KESTREL, tags: ["project"], props: { rate: 75, rate_type: "hourly" } },
]);
const SMALL = tr.build([
    note("2026-09-01", [
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]", "\t- 9:00am - 9:50am", "\t- 1:00pm - 1:10pm: 🆓 fix | pipe",
        "- [x] Contract [[Orchard Lane 2026|⭕]]", "\t- 2:00pm - 3:00pm",
        "- [x] Rent", "\t- 4:00pm - 4:20pm", "\t- 5:00pm - ",
    ].join("\n")),
    note("2026-10-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am\n- [x] Build [[Pinecone Studio|⭕]]\n\t- 1:00pm - 3:07pm\n- [x] Bramble [[Bramble|⭕]]\n\t- 4:00pm - 5:00pm\n- [x] Old [[Kestrel Newsletter]]\n\t- 6:00pm - 7:00pm"),
], MONEY_INDEX);

test("render month: summary by project with Max Hrs, Rate, Earned and a total; that month's Problems", () => {
    const block = tr.render(SMALL, { kind: "period", unit: "month", key: "2026-09" }, "2026-09-13 7:00pm");
    const lines = block.split("\n");
    assert.equal(lines[0], "%% time:start %%");
    assert.equal(lines[1], "*Updated 2026-09-13 7:00pm*");
    assert.equal(lines.at(-1), "%% time:end %%");
    assert.ok(lines.includes("| Project | Entries | Billable | 🆓 | Total | Exact | Max Hrs | Rate | Earned |"));
    // Each row is that project's own entries, so the rows add up to All: Orchard Lane's own 60 min
    // (cap 9600 ÷ 80 = 120 h), and Orchard Lane Web's two entries on their own row, not indented under it
    assert.ok(lines.includes("| [[Orchard Lane 2026\\|⭕ Orchard Lane 2026]] | 1 | 1.00 |  | 1.00 | 1.00 | 120.00 | $80/hr | $80.00 |"), block);
    // Orchard Lane Web has no rate of its own: it uses its parent's
    assert.ok(lines.includes("| [[Orchard Lane Web 2026\\|⭕ Orchard Lane Web 2026]] | 2 | 1.00 | 0.25 | 1.25 | 1.00 |  | $80/hr | $80.00 |"));
    assert.ok(!block.includes("↳"));
    // Time with no project is nobody's to bill, so it lands in 🆓
    assert.ok(lines.includes("| Unassigned | 1 |  | 0.50 | 0.50 | 0.33 |  |  |  |"), block);
    assert.ok(lines.includes("| **All** | **4** | **2.00** | **0.75** | **2.75** | **2.33** |  |  | **$160.00** |"), block);
    assert.ok(!block.includes("Pinecone Studio") && !block.includes("Kestrel"), "October and archived projects stay out");
    assert.ok(!block.includes("| Date |") && !block.includes("9:50am"), "no per-entry detail");
    assert.ok(lines.some((l) => l.startsWith("- [[2026-09-01|9/1/26]] line 8: `- 5:00pm -` clock still running")));
    assert.ok(lines.includes("- 1 entry has no project (see Unassigned)"));
});

test("render year: Earned and Hours tables, a column per month linking the monthly note, a row per project", () => {
    const block = tr.render(SMALL, { kind: "period", unit: "year", key: "2026" }, "s");
    const lines = block.split("\n");
    const earnedAt = lines.indexOf("### Earned"), hoursAt = lines.indexOf("### Hours"), problemsAt = lines.indexOf("### Problems");
    assert.ok(earnedAt > 0 && earnedAt < hoursAt && hoursAt < problemsAt);
    const head = "| Project | " + tr.constructor.SHORT_MONTHS.map((m, i) => `[[2026-${String(i + 1).padStart(2, "0")}\\|${m}]]`).join(" | ") + " | 2026 |";
    assert.equal(lines[earnedAt + 2], head);
    assert.equal(lines[hoursAt + 2], head);
    const blanks = (n) => Array(n).fill("").map(() => " ").join("|");
    const earned = lines.slice(earnedAt, hoursAt), hours = lines.slice(hoursAt, problemsAt);
    // Sep and Oct columns (the 9th and 10th months)
    const cells = (table, name) => table.find((l) => l.startsWith(`| ${name} |`)).split(/(?<!\\)\|/).slice(2, -1).map((c) => c.trim());
    assert.deepEqual(cells(earned, "[[Bramble\\|⭕ Bramble]]").slice(8, 10), ["", ""], "flat-rate projects earn nothing here");
    assert.deepEqual(cells(hours, "[[Bramble\\|⭕ Bramble]]").slice(8, 10), ["", "1.00"], "but their hours show");
    assert.deepEqual(cells(earned, "[[Pinecone Studio\\|⭕ Pinecone Studio]]").slice(8, 13), ["", "$270", "", "", "$270"]);
    // Orchard Lane's row is its own September hour only; the sub-project's rows are its own
    assert.deepEqual(cells(earned, "[[Orchard Lane 2026\\|⭕ Orchard Lane 2026]]").slice(8, 13), ["$80", "", "", "", "$80"]);
    assert.deepEqual(cells(earned, "[[Orchard Lane Web 2026\\|⭕ Orchard Lane Web 2026]]").slice(8, 13), ["$80", "$80", "", "", "$160"]);
    assert.deepEqual(cells(hours, "[[Orchard Lane Web 2026\\|⭕ Orchard Lane Web 2026]]").slice(8, 13), ["1.25", "1.00", "", "", "2.25"]);
    assert.deepEqual(cells(hours, "Unassigned").slice(8, 13), ["0.50", "", "", "", "0.50"]);
    assert.deepEqual(cells(earned, "**All**").slice(8, 13), ["**$160**", "**$350**", "", "", "**$510**"]);
    assert.deepEqual(cells(hours, "**All**").slice(8, 13), ["**2.75**", "**4.25**", "", "", "**7.00**"]);
    assert.ok(!block.includes("Kestrel"));
});

test("render project: summary without a Project column, then weeks (total first, newest next) linking weekly notes", () => {
    const project = tr.render(SMALL, { kind: "project", path: ORCHARD_WEB }, "s");
    const lines = project.split("\n");
    const at = lines.indexOf("| Entries | Billable | 🆓 | Total | Exact | Max Hrs | Rate | Earned |");
    assert.equal(at, 3, project);
    assert.equal(lines[at + 2], "| 3 | 2.00 | 0.25 | 2.25 | 2.00 |  | $80/hr | $160.00 |");
    assert.ok(!project.includes("[[Orchard Lane Web 2026"), "no link back to the note itself");
    const weeks = lines.indexOf("| Week | Entries | Billable | 🆓 | Total | Exact | Earned |");
    assert.deepEqual(plain(lines.slice(weeks + 2, weeks + 5)), [
        "| **Total** | **3** | **2.00** | **0.25** | **2.25** | **2.00** | **$160.00** |",
        "| [[2026w40\\|9/27-10/3]] | 1 | 1.00 |  | 1.00 | 1.00 | $80.00 |",
        "| [[2026w36\\|8/30-9/5]] | 2 | 1.00 | 0.25 | 1.25 | 1.00 | $80.00 |",
    ]);
    assert.ok(!project.includes("Orchard Lane 2026"), "a sub-project's block doesn't show its parent");
    assert.ok(!project.includes("5:00pm"), "problems from other projects stay out");
    assert.match(project, /### Problems\n\nNone\.\n%% time:end %%$/);

    // A parent with sub-project time: Project column back, a row each, and a Total with the parent's cap;
    // its weeks show only the time logged to the parent itself
    const parent = tr.render(SMALL, { kind: "project", path: ORCHARD }, "s").split("\n");
    assert.deepEqual(plain(parent.slice(3, 8)), [
        "| Project | Entries | Billable | 🆓 | Total | Exact | Max Hrs | Rate | Earned |",
        "| ------- | ------: | -------: | -: | ----: | ----: | ------: | ---: | -----: |",
        "| [[Orchard Lane 2026\\|⭕ Orchard Lane 2026]] | 1 | 1.00 |  | 1.00 | 1.00 |  | $80/hr | $80.00 |",
        "| [[Orchard Lane Web 2026\\|⭕ Orchard Lane Web 2026]] | 3 | 2.00 | 0.25 | 2.25 | 2.00 |  | $80/hr | $160.00 |",
        "| **Total** | **4** | **3.00** | **0.25** | **3.25** | **3.00** | **120.00** |  | **$240.00** |",
    ]);
    const parentWeeks = parent.indexOf("| Week | Entries | Billable | 🆓 | Total | Exact | Earned |");
    assert.deepEqual(plain(parent.slice(parentWeeks + 2, parentWeeks + 4)), [
        "| **Total** | **1** | **1.00** |  | **1.00** | **1.00** | **$80.00** |",
        "| [[2026w36\\|8/30-9/5]] | 1 | 1.00 |  | 1.00 | 1.00 | $80.00 |",
    ]);
    assert.ok(!parent.some((l) => l.startsWith("| [[2026w40")), "October was the sub-project's time, not the parent's");
    // A flat-rate project shows no Earned anywhere
    const flat = tr.render(SMALL, { kind: "project", path: "20 Projects/Freelance/Bramble/Bramble.md" }, "s").split("\n");
    // A name shared with another note links by full path instead
    const shared = tr.render(SMALL, { kind: "project", path: ORCHARD_WEB, linkTarget: (unit, key) => (key === "2026w36" ? `30 Reference/36 Planner/weeks/${key}` : key) }, "s");
    assert.ok(shared.includes("| [[30 Reference/36 Planner/weeks/2026w36\\|8/30-9/5]] |") && shared.includes("| [[2026w40\\|9/27-10/3]] |"));
    assert.equal(flat[5], "| 1 | 1.00 |  | 1.00 | 1.00 | 36.00 | $640 flat |  |");
    assert.ok(flat.includes("| **Total** | **1** | **1.00** |  | **1.00** | **1.00** |  |"));
});

test("money: rate types, inheritance, caps, cents", () => {
    const idx = tr.makeIndex([
        { path: "P/Parent/Parent.md", tags: ["project"], props: { Rate: "$1,250.50", RATE_TYPE: "Hourly" } },
        { path: "P/Parent/Child/Child.md", tags: ["project"], props: { rate_type: "non-billable" } },
        { path: "P/Parent/Kid/Kid.md", tags: ["project"] },
        { path: "P/Flat/Flat.md", tags: ["project"], props: { rate: 640, rate_type: "flat" } },
        { path: "P/Task/Task.md", tags: ["project"], props: { rate_type: "by-task", max_hours: "12.5" } },
        { path: "P/Bare/Bare.md", tags: ["project"], props: { rate: 80 } },
    ]);
    const m = tr.build([note("2026-09-01", ["Parent", "Child", "Kid", "Flat", "Task", "Bare"].map((n) => `- [x] ${n} [[${n}|⭕]]\n\t- 9:07am - 9:20am`).join("\n"))], idx);
    const money = (p) => plain(m.money.get(p));
    assert.deepEqual(money("P/Parent/Parent.md"), { rate: 1250.5, type: "hourly", label: "$1,250.50/hr", capMinutes: null });
    // Child's own non-billable type wins; the parent's rate still shows in its label only for hourly/flat
    assert.deepEqual(money("P/Parent/Child/Child.md"), { rate: null, type: "non-billable", label: "non-billable", capMinutes: null });
    assert.deepEqual(money("P/Parent/Kid/Kid.md"), { rate: 1250.5, type: "hourly", label: "$1,250.50/hr", capMinutes: null });
    assert.deepEqual(money("P/Flat/Flat.md"), { rate: null, type: "flat", label: "$640 flat", capMinutes: null });
    assert.deepEqual(money("P/Task/Task.md"), { rate: null, type: "by-task", label: "by-task", capMinutes: 750 });
    assert.deepEqual(money("P/Bare/Bare.md"), { rate: 80, type: "hourly", label: "$80/hr", capMinutes: null });
    // 13 minutes → 15 minutes billed; Earned in whole cents
    assert.equal(tr.totals(m.entries.filter((e) => e.project === "P/Parent/Parent.md"), m.money).cents, 31263);
    assert.equal(tr.money(123456789), "$1,234,567.89");
});

test("billable: only time on a project with a billable rate type counts as billable", () => {
    const idx = tr.makeIndex([
        { path: "P/Hourly/Hourly.md", tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
        { path: "P/Flat/Flat.md", tags: ["project"], props: { rate: 640, rate_type: "flat" } },
        { path: "P/Free/Free.md", tags: ["project"], props: { rate_type: "Non-Billable" } },
        { path: "P/Free/Sub/Sub.md", tags: ["project"] },
        { path: "P/Free/Paid/Paid.md", tags: ["project"], props: { rate: 90, rate_type: "hourly" } },
        { path: "P/Untyped/Untyped.md", tags: ["project"] },
        { path: "P/Rated/Rated.md", tags: ["project"], props: { rate: 80 } },
    ]);
    const names = ["Hourly", "Flat", "Free", "Sub", "Paid", "Untyped", "Rated"];
    const text = names.map((n) => `- [x] ${n} [[${n}|⭕]]\n\t- 9:00am - 10:00am`).join("\n")
        + "\n- [x] Nothing linked\n\t- 9:00am - 10:00am";
    const m = tr.build([note("2026-09-01", text)], idx);
    const hours = (p) => {
        const t = tr.totals(m.entries.filter((e) => (p ? e.project === p : !e.project)), m.money);
        return [t.billable / 60, t.free / 60];
    };
    assert.deepEqual(hours("P/Hourly/Hourly.md"), [1, 0]);
    assert.deepEqual(hours("P/Flat/Flat.md"), [1, 0], "a flat project is still billable work");
    assert.deepEqual(hours("P/Free/Free.md"), [0, 1], "non-billable, whatever the case");
    assert.deepEqual(hours("P/Free/Sub/Sub.md"), [0, 1], "a sub-project inherits non-billable");
    assert.deepEqual(hours("P/Free/Paid/Paid.md"), [1, 0], "its own hourly type beats a non-billable parent");
    assert.deepEqual(hours("P/Untyped/Untyped.md"), [1, 0], "no rate type at all still bills, loudly (see Problems)");
    assert.deepEqual(hours("P/Rated/Rated.md"), [1, 0], "a bare rate still means hourly");
    assert.deepEqual(hours(null), [0, 1], "unassigned time isn't billable to anyone");

    // Earned follows the same line: a non-billable project earns nothing, and free hours never earn
    assert.equal(tr.totals(m.entries.filter((e) => e.project === "P/Free/Paid/Paid.md"), m.money).cents, 9000);
    assert.equal(tr.totals(m.entries.filter((e) => e.project === "P/Free/Free.md"), m.money).cents, 0);
    assert.equal(tr.totals(m.entries.filter((e) => e.project === "P/Rated/Rated.md"), m.money).cents, 8000);

    // A project with logged time and no rate type is a Problem, so it can't quietly bill nothing
    const said = m.projectProblems.map((p) => `${tr.basename(p.project)}: ${p.message}`);
    assert.ok(said.some((s) => s.startsWith("Untyped: ") && s.includes("`rate_type`")), said.join(" | "));
    assert.ok(!said.some((s) => s.startsWith("Free: ")), "non-billable is a choice, not a problem");
    assert.ok(!said.some((s) => s.startsWith("Rated: ")), "a bare rate is hourly, not missing");
    assert.ok(!said.some((s) => s.startsWith("Sub: ")), "an inherited type is a type");
});

test("render: the same data renders the same block, apart from the stamp", () => {
    const a = tr.render(SMALL, { kind: "period", unit: "month", key: "2026-09" }, "one");
    const b = tr.render(SMALL, { kind: "period", unit: "month", key: "2026-09" }, "two");
    assert.ok(tr.sameBlock(`intro\n${a}\noutro`, b));
    assert.ok(!tr.sameBlock(`intro\n${a}\noutro`, tr.render(SMALL, { kind: "period", unit: "month", key: "2026-10" }, "two")));
});

test("render: Problems quotes stop at 80 characters", () => {
    const long = "- [x] Task\n\t- " + "9:00 - 10:00am " + "x".repeat(200);
    const block = tr.render(tr.build([note("2026-09-01", long)], INDEX), { kind: "period", unit: "month", key: "2026-09" }, "s");
    const line = block.split("\n").find((l) => l.includes("line 2:"));
    const quoted = line.match(/`([^`]*)`/)[1];
    assert.equal(quoted.length, 80);
    assert.ok(quoted.endsWith("…"));
});

// ------------------------------------------------------------------ writing the block

const apply = (content, plan) => content.slice(0, plan.start) + plan.text + content.slice(plan.end);
const BLOCK = "%% time:start %%\nnew\n%% time:end %%";

test("placeBlock: replaces only what's between the markers", () => {
    const content = "# Title\n\nabove\n%% time:start %%\nold\nold\n%% time:end %%\nbelow\n";
    assert.equal(apply(content, tr.placeBlock(content, BLOCK, { cursorLine: 0 })),
        "# Title\n\nabove\n%% time:start %%\nnew\n%% time:end %%\nbelow\n");
});

test("placeBlock: broken markers are left alone", () => {
    for (const content of ["%% time:start %%\nx", "x\n%% time:end %%", "%% time:end %%\n%% time:start %%",
        "%% time:start %%\n%% time:end %%\n%% time:start %%\n%% time:end %%"]) {
        assert.ok(tr.placeBlock(content, BLOCK, { cursorLine: 0 }).error, content);
    }
});

test("placeBlock: never at a cursor, only under the heading", () => {
    // placeBlock has no cursor option any more; whatever note is open, a new block goes under ## Time tracking
    const content = "- [x] one\n\t- 9:00am - 10:00am\n- [ ] two\n\n## Notes\n";
    assert.equal(apply(content, tr.placeBlock(content, BLOCK, { cursorLine: 1 })),
        "- [x] one\n\t- 9:00am - 10:00am\n- [ ] two\n\n## Notes\n\n## Time tracking\n\n" + BLOCK + "\n");
});

test("placeBlock: under a heading at the end of a project note", () => {
    for (const [content, expected] of [
        ["---\ntags: [project]\n---\nIntro", "---\ntags: [project]\n---\nIntro\n\n## Time tracking\n\n" + BLOCK + "\n"],
        ["Intro\n", "Intro\n\n## Time tracking\n\n" + BLOCK + "\n"],
        ["Intro\n\n\n", "Intro\n\n\n## Time tracking\n\n" + BLOCK + "\n"],
        ["", "## Time tracking\n\n" + BLOCK + "\n"],
    ]) {
        assert.equal(apply(content, tr.placeBlock(content, BLOCK, { heading: "## Time tracking" })), expected);
    }
});

test("placeBlock: a project note's ## Invoices section is left exactly as it was", () => {
    const invoices = [
        "## Invoices", "",
        "*Imported from a spreadsheet on 2026-09-13.*", "",
        "| Invoice | Period | Hours | Amount | Status |",
        "| ------- | ------ | ----: | -----: | ------ |",
        "| INV-003 | April 2026 | 12 | $960.00 | Paid |",
        "| INV-004 | May 2026 | 8.5 | $680.00 | Paid |",
    ].join("\n");
    const content = `---\ntags:\n  - project\n---\nIntro\n\n${invoices}`;
    const once = apply(content, tr.placeBlock(content, BLOCK, { heading: "## Time tracking" }));
    assert.equal(once, `${content}\n\n## Time tracking\n\n${BLOCK}\n`);
    const again = apply(once, tr.placeBlock(once, BLOCK.replace("new", "newer"), { heading: "## Time tracking" }));
    assert.ok(again.startsWith(`${content}\n\n## Time tracking\n\n`));
    assert.ok(again.includes("newer"));
});

test("placeBlock: running twice changes nothing more", () => {
    const content = "Intro\n- a\n\t- b\nEnd";
    const once = apply(content, tr.placeBlock(content, BLOCK));
    const twice = apply(once, tr.placeBlock(once, BLOCK));
    assert.equal(twice, once);
});

test("shiftFolds: folds after the block move, folds inside go, folds around stretch", () => {
    const content = "- a\n\t- a1\n%% time:start %%\n- old\n\t- old1\n%% time:end %%\n- b\n\t- b1";
    const plan = tr.placeBlock(content, "%% time:start %%\n1\n2\n3\n4\n%% time:end %%", {});
    const folds = [{ from: 0, to: 0 }, { from: 0, to: 1 }, { from: 3, to: 4 }, { from: 6, to: 7 }];
    assert.deepEqual(plain(tr.shiftFolds(folds, content, plan.start, plan.end, plan.text)),
        [{ from: 0, to: 0 }, { from: 0, to: 1 }, { from: 8, to: 9 }]);

    const heading = "## H\nx\n%% time:start %%\n%% time:end %%\ny";
    const p2 = tr.placeBlock(heading, "%% time:start %%\n1\n%% time:end %%", {});
    assert.deepEqual(plain(tr.shiftFolds([{ from: 0, to: 4 }], heading, p2.start, p2.end, p2.text)), [{ from: 0, to: 5 }]);

    // Inserted under an existing heading: folds below it move down
    const insert = "## Time tracking\n\n- b\n\t- b1";
    const p3 = tr.placeBlock(insert, BLOCK);
    const after = apply(insert, p3);
    assert.equal(after.split("\n")[6], "- b");
    assert.deepEqual(plain(tr.shiftFolds([{ from: 2, to: 3 }], insert, p3.start, p3.end, p3.text)), [{ from: 6, to: 7 }]);
});

// ------------------------------------------------------------------ start/stop hotkeys

// Applies a startEntry { from, to, text } or stopEntry { line, text } result, as the templates do
const edit = (lines, r) => {
    if (r.error) return r.error;
    const out = lines.slice();
    if (r.from) {
        const head = out[r.from.line].slice(0, r.from.ch);
        const tail = out[r.to.line].slice(r.to.ch);
        out.splice(r.from.line, r.to.line - r.from.line + 1, head + r.text + tail);
    } else out[r.line] = r.text;
    return out.join("\n").split("\n");
};

test("startEntry: adds a running entry at the end of the task's sub-bullets", () => {
    const lines = ["- [<] 9:00am\tStandup", "\t- 9:30am", "- [ ] Charts [[Orchard Lane Web 2026|⭕]]", "\t- 8:00am - 8:30am", "\t\t- note", "- [ ] Next"];
    assert.deepEqual(edit(lines, tr.startEntry(lines, 2, "10:05am")),
        ["- [<] 9:00am\tStandup", "\t- 9:30am", "- [ ] Charts [[Orchard Lane Web 2026|⭕]]", "\t- 8:00am - 8:30am", "\t\t- note", "\t- 10:05am - ", "- [ ] Next"]);
    // from a sub-bullet, and on a task with nothing under it yet
    assert.deepEqual(edit(lines, tr.startEntry(lines, 4, "10:05am"))[5], "\t- 10:05am - ");
    assert.deepEqual(edit(lines, tr.startEntry(lines, 5, "10:05am")).slice(5), ["- [ ] Next", "\t- 10:05am - "]);
    assert.deepEqual(plain(tr.startEntry(lines, 5, "10:05am").cursor), { line: 6, ch: 13 });
});

test("startEntry: refuses without a task, or with a clock already running", () => {
    assert.match(tr.startEntry(["Just text"], 0, "1:00pm").error, /task or event/);
    assert.match(tr.startEntry(["- [ ] a", ""], 1, "1:00pm").error, /task or event/);
    assert.match(tr.startEntry(["- [ ] a", "\t- 9:00am - "], 0, "1:00pm").error, /since 9:00am/);
});

test("stopEntry: fills in the end time on the right running entry", () => {
    const lines = ["- [ ] a", "\t- 9:00am - ", "- [ ] b", "\t- 10:00am - : draft note", "\t- 8:00am - 8:30am"];
    assert.deepEqual(edit(lines, tr.stopEntry(lines, 1, "9:45am"))[1], "\t- 9:00am - 9:45am");
    assert.deepEqual(edit(lines, tr.stopEntry(lines, 4, "11:00am"))[3], "\t- 10:00am - 11:00am: draft note");
    assert.match(tr.stopEntry(lines, 99, "1:00pm").error, /2 running entries/);

    const one = ["- [ ] a", "\t- 11:30pm - ", "- [ ] b"];
    assert.deepEqual(edit(one, tr.stopEntry(one, 2, "12:10am"))[1], "\t- 11:30pm - 12:10am");
    assert.match(tr.stopEntry(["- [ ] a", "\t- 8:00am - 9:00am"], 0, "1:00pm").error, /No running/);

    const filled = edit(lines, tr.stopEntry(lines, 1, "9:45am"));
    assert.equal(entriesOf(filled.join("\n")).entries[0].minutes, 45);
});

// ------------------------------------------------------------------ toggle hotkey (OBS-14)

test("toggleEntry: no entries starts one, a running one stops, all stopped starts another", () => {
    const none = ["- [ ] Charts [[Orchard Lane Web 2026|⭕]]", "- [ ] Next"];
    const start = tr.toggleEntry(none, 0, "9:01am");
    assert.equal(start.action, "start");
    assert.deepEqual(edit(none, start.edit), ["- [ ] Charts [[Orchard Lane Web 2026|⭕]]", "\t- 9:01am - ", "- [ ] Next"]);
    assert.equal(start.summary, "Started 9:01am: Charts ⭕");

    const running = edit(none, start.edit);
    const stop = tr.toggleEntry(running, 0, "9:40am");
    assert.equal(stop.action, "stop");
    assert.deepEqual(edit(running, stop.edit)[1], "\t- 9:01am - 9:40am");
    assert.equal(stop.summary, "Stopped 9:01am - 9:40am: Charts ⭕");

    // all stopped: a new entry goes after the last one, from the task line or a note under it
    const stopped = ["- [<] 9:00am\tStandup", "\t- 9:01am - 9:40am", "\t\t- note", "- [ ] Next"];
    for (const cursor of [0, 2]) {
        const again = tr.toggleEntry(stopped, cursor, "1:00pm");
        assert.equal(again.action, "start");
        assert.deepEqual(edit(stopped, again.edit), ["- [<] 9:00am\tStandup", "\t- 9:01am - 9:40am", "\t\t- note", "\t- 1:00pm - ", "- [ ] Next"]);
    }
});

test("toggleEntry: the entry on the cursor's line wins", () => {
    const lines = ["- [ ] a", "\t- 9:00am - 10:00am", "\t- 11:00am - : draft", "- [ ] b"];
    // on a running entry: that one stops
    assert.deepEqual(edit(lines, tr.toggleEntry(lines, 2, "11:30am").edit)[2], "\t- 11:00am - 11:30am: draft");
    // on a stopped entry: its task's running entry stops
    assert.deepEqual(edit(lines, tr.toggleEntry(lines, 1, "11:30am").edit)[2], "\t- 11:00am - 11:30am: draft");
    // a running entry that isn't under a task still stops from its own line
    const loose = ["Notes", "- 2:00pm - "];
    assert.deepEqual(edit(loose, tr.toggleEntry(loose, 1, "2:30pm").edit)[1], "- 2:00pm - 2:30pm");
    assert.equal(tr.toggleEntry(loose, 1, "2:30pm").summary, "Stopped 2:00pm - 2:30pm");
});

test("toggleEntry: two running entries under the task ask which, labelled with the task each is under", () => {
    const lines = ["- [ ] Charts [[Orchard Lane Web 2026|⭕]]", "\t- 9:00am - : draft", "\t- Prep", "\t\t- 10:30am - ", "\t- [ ] Legend", "\t\t- 10:45am - ", "- [ ] b"];
    // the sub-task's timer isn't the parent's; an entry under a plain bullet is
    assert.deepEqual(plain(tr.toggleEntry(lines, 0, "11:00am").choose),
        [{ line: 1, label: "Stop 9:00am: Charts ⭕" }, { line: 3, label: "Stop 10:30am: Charts ⭕" }]);
    // the one picked is then toggled from its own line
    assert.deepEqual(edit(lines, tr.toggleEntry(lines, 3, "11:00am").edit)[3], "\t\t- 10:30am - 11:00am");
});

test("toggleEntry: off any task, it asks for the dropdown instead", () => {
    assert.deepEqual(plain(tr.toggleEntry(["Just text", "- [ ] a", "\t- 9:00am - "], 0, "1:00pm")), { pick: true });
    assert.deepEqual(plain(tr.toggleEntry(["- [ ] a", ""], 1, "1:00pm")), { pick: true });
    assert.deepEqual(plain(tr.toggleEntry([], 0, "1:00pm")), { pick: true });
});

test("toggleChoices: running timers first, then open tasks and events; done, cancelled and forwarded left out", () => {
    const lines = [
        "---", "id: 1", "---",
        "- [<] All day\tConference",
        "- [<] 9:00am\t[[2026-09-15 Planning call|Planning call]]",
        "\t- 9:00am - 9:45am",
        "- [ ] Charts [[Orchard Lane Web 2026|⭕]] %%private%%",
        "\t- 10:30am - : Work on OBS-15",
        "- [/] Draft [proposal](https://example.com)",
        "- [x] Done task",
        "- [-] Cancelled task",
        "- [>] Forwarded task",
        "- [ ] ",
        "- Plain bullet",
        "```", "- [ ] In a code block", "```",
        "%% time:start %%", "- [ ] In the report", "%% time:end %%",
    ];
    assert.deepEqual(plain(tr.toggleChoices(lines)), [
        { line: 7, label: "⏱ Stop 10:30am: Charts ⭕" },
        { line: 3, label: "All day Conference" },
        { line: 4, label: "9:00am Planning call" },
        { line: 8, label: "Draft proposal" },
    ]);
    // a checked-off task whose clock is still running is listed, so the clock can be stopped
    assert.deepEqual(plain(tr.toggleChoices(["- [x] Done", "\t- 9:00am - "])), [{ line: 1, label: "⏱ Stop 9:00am: Done" }]);
    // a timer that isn't under any task shows just its time
    assert.deepEqual(plain(tr.toggleChoices(["Notes", "- 9:00am - "])), [{ line: 1, label: "⏱ Stop 9:00am" }]);
    assert.deepEqual(plain(tr.toggleChoices(["Nothing here"])), []);
});

test("toggleText: toggles a line of a note that isn't open, keeping its line endings", () => {
    const text = "- [ ] a\r\n\t- 9:00am - \r\n- [ ] b";
    const stop = tr.toggleText(text, 0, "9:30am");
    assert.equal(stop.content, "- [ ] a\r\n\t- 9:00am - 9:30am\r\n- [ ] b");
    assert.equal(stop.summary, "Stopped 9:00am - 9:30am: a");
    const start = tr.toggleText("- [ ] a\n- [ ] b", 1, "9:30am");
    assert.equal(start.content, "- [ ] a\n- [/] b\n\t- 9:30am - ");
    const crlfStart = tr.toggleText("- [ ] a\r\n\t- 8:00am - 8:30am\r\n- [ ] b", 0, "9:30am");
    assert.equal(crlfStart.content, "- [/] a\r\n\t- 8:00am - 8:30am\r\n\t- 9:30am - \r\n- [ ] b");
    // nothing to write: the result as toggleEntry gave it
    assert.deepEqual(plain(tr.toggleText("text", 0, "9:30am")), { pick: true });
});

test("review (OBS-14): a comment on a running entry doesn't break stopping it or the dropdown", () => {
    const lines = ["- [ ] Task", "\t- 9:00am - %%billable%%", "- [ ] Other", "\t- 10:00am - : draft <!-- x -->"];
    assert.deepEqual(plain(tr.toggleChoices(lines)), [{ line: 1, label: "⏱ Stop 9:00am: Task" }, { line: 3, label: "⏱ Stop 10:00am: Other" }]);
    const stop = tr.toggleEntry(lines, 0, "9:40am");
    assert.equal(stop.summary, "Stopped 9:00am - 9:40am: Task");
    const done = edit(lines, stop.edit);
    assert.equal(done[1], "\t- 9:00am - 9:40am %%billable%%");
    assert.equal(edit(lines, tr.stopEntry(lines, 3, "10:30am"))[3], "\t- 10:00am - 10:30am: draft <!-- x -->");
    assert.deepEqual(entriesOf(edit(done, tr.stopEntry(done, 3, "10:30am")).join("\n")).entries.map((e) => e.minutes), [40, 30]);
});

test("review (OBS-14): a running entry marked 🆓 from the start stops as 🆓, and isn't billed", () => {
    const lines = ["- [ ] Task", "\t- 9:00am - : 🆓", "\t- 9:50am - :🆓 my mistake"];
    const first = edit(lines, tr.toggleEntry(lines, 1, "9:40am").edit);
    assert.equal(first[1], "\t- 9:00am - 9:40am: 🆓");
    const both = edit(first, tr.toggleEntry(first, 0, "10:00am").edit);
    assert.equal(both[2], "\t- 9:50am - 10:00am: 🆓 my mistake");
    const parsed = entriesOf(both.join("\n"));
    assert.deepEqual(parsed.entries.map((e) => [e.minutes, e.free]), [[40, true], [10, true]]);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(plain(tr.toggleChoices(lines)).map((c) => c.label), ["⏱ Stop 9:00am: Task", "⏱ Stop 9:50am: Task"]);
});

test("review (OBS-14): timers from another day's note carry its date; only today's note offers tasks", () => {
    const lines = ["- [ ] Late task", "\t- 11:00pm - ", "- [ ] Open task"];
    assert.deepEqual(plain(tr.runningChoices(lines, "9/14")), [{ line: 1, label: "⏱ Stop 11:00pm: Late task · 9/14" }]);
    assert.deepEqual(plain(tr.taskChoices(lines)), [{ line: 2, label: "Open task" }]);
    assert.deepEqual(plain(tr.toggleChoices(lines)), [...plain(tr.runningChoices(lines)), ...plain(tr.taskChoices(lines))]);
});

test("toggleEntry: a stop that would make an entry of 12 hours or more jumps to the entry instead", () => {
    const lines = ["- [ ] Task", "\t- 9:00am - : 🆓", "- [ ] Late", "\t- 11:00pm - "];
    // a timer three days old: the cursor goes right after the dash, ready for the end time
    const old = tr.toggleEntry(lines, 0, "10:00am", 3);
    assert.deepEqual(plain(old.jump), { line: 1, ch: "\t- 9:00am - ".length });
    assert.equal(old.summary, "Running since 9:00am (3 days ago): type its end time");
    assert.equal(old.action, undefined);
    // typing a time there makes a whole entry, 🆓 kept
    const typed = lines.slice(); typed[1] = typed[1].slice(0, old.jump.ch) + "5:00pm" + typed[1].slice(old.jump.ch);
    assert.equal(typed[1], "\t- 9:00am - 5:00pm: 🆓");
    // yesterday 11pm to 1am is 2 hours: it stops
    assert.equal(tr.toggleEntry(lines, 2, "1:00am", 1).action, "stop");
    // today, 13 hours: jumps; from its own line too
    assert.deepEqual(plain(tr.toggleEntry(lines, 1, "10:00pm").jump), { line: 1, ch: "\t- 9:00am - ".length });
    assert.equal(tr.toggleEntry(lines, 1, "10:00pm").summary, "Running since 9:00am: type its end time");
    assert.equal(tr.toggleEntry(lines, 1, "8:59pm").action, "stop");
    // a start later than now in today's note runs past midnight, so it's long: jumps
    assert.ok(tr.toggleEntry(["- [ ] a", "\t- 3:00pm - "], 0, "2:00pm").jump);
    // nothing to write
    assert.equal(tr.toggleText(lines.join("\n"), 1, "10:00am", 3).content, undefined);
});

test("toggleEntry: starting a timer marks an open task [/], and nothing else changes status", () => {
    const lines = ["- [ ] Task", "- [<] 9:00am\tStandup", "- [x] Done", "- [/] Started", "\t- [ ] Subtask", "\t\t- note", "- [ ] Other"];
    const apply = (ls, r) => { const out = ls.slice(); if (r.status) out[r.status.line] = r.status.text; return edit(out, r.edit); };
    const task = tr.toggleEntry(lines, 0, "9:01am");
    assert.deepEqual(plain(task.status), { line: 0, text: "- [/] Task" });
    assert.deepEqual(apply(lines, task).slice(0, 2), ["- [/] Task", "\t- 9:01am - "]);
    for (const cursor of [1, 2, 3]) assert.equal(tr.toggleEntry(lines, cursor, "9:01am").status, undefined);
    // from a note under a subtask, the subtask is the one marked
    assert.deepEqual(plain(tr.toggleEntry(lines, 5, "9:01am").status), { line: 4, text: "\t- [/] Subtask" });
    // stopping leaves [/] as it is
    const running = apply(lines, task);
    const stop = tr.toggleEntry(running, 0, "9:30am");
    assert.equal(stop.status, undefined);
    assert.equal(edit(running, stop.edit)[0], "- [/] Task");
    // a closed note gets both changes, in its line endings
    assert.equal(tr.toggleText("- [ ] a\r\n\t- 8:00am - 8:30am\r\n- [ ] b", 0, "9:30am").content, "- [/] a\r\n\t- 8:00am - 8:30am\r\n\t- 9:30am - \r\n- [ ] b");
});

test("toggleEntry: where a timer can't start, a start opens the dropdown instead; stops still work", () => {
    const lines = ["- [ ] Future task", "- [ ] Running", "\t- 3:00pm - "];
    assert.deepEqual(plain(tr.toggleEntry(lines, 0, "3:30pm", -1, false)), { pick: true, elsewhere: true });
    // a stop is fine (here it would be negative, so it goes to the entry)
    assert.ok(tr.toggleEntry(lines, 1, "3:30pm", -1, false).jump);
    assert.equal(tr.toggleEntry(lines, 1, "3:30pm", 0, false).action, "stop");
    // off any task it's the plain dropdown
    assert.deepEqual(plain(tr.toggleEntry(["text"], 0, "3:30pm", -1, false)), { pick: true });
});

test("a task's own timers are the ones under it, not its sub-tasks'", () => {
    const lines = ["- [ ] Chores", "\t- 2:35pm - 2:36pm", "\t- [/] Laundry", "\t\t- 2:57pm - 2:58pm", "\t- [/] Espresso", "\t\t- 3:20pm - ", "- [ ] Next"];
    // the parent is offered, and so is the sub-task's timer; the sub-task with a running timer isn't listed as a task
    assert.deepEqual(plain(tr.toggleChoices(lines)).map((c) => c.label), ["⏱ Stop 3:20pm: Espresso", "Chores", "Laundry", "Next"]);
    // picking the parent starts its own timer, above its first sub-task, and leaves the sub-task's running
    const start = tr.toggleEntry(lines, 0, "3:50pm");
    assert.equal(start.action, "start");
    assert.deepEqual(edit(lines, start.edit).slice(0, 4), ["- [ ] Chores", "\t- 2:35pm - 2:36pm", "\t- 3:50pm - ", "\t- [/] Laundry"]);
    assert.equal(tr.startEntry(lines, 0, "3:50pm").error, undefined);
    // with the parent's own timer running too, ⌘T on the parent stops the parent's
    const both = edit(lines, start.edit);
    const stop = tr.toggleEntry(both, 0, "4:00pm");
    assert.equal(stop.action, "stop");
    assert.equal(stop.edit.line, 2);
    // and the sub-task's own timer still stops from the sub-task
    assert.equal(tr.toggleEntry(both, 5, "4:00pm").edit.line, 6);
    // the dropdown lists both timers, each with its own task
    assert.deepEqual(plain(tr.runningChoices(both)).map((c) => c.label), ["⏱ Stop 3:50pm: Chores", "⏱ Stop 3:20pm: Espresso"]);
});

test("startEntry: a task's own entry goes above its first sub-task, after its end time, entries and notes", () => {
    const lines = ["- [ ] Chores", "\t- 2:35pm - 2:36pm", "\t- Goal: tidy", "\t- [/] Laundry", "\t\t- 2:37pm - 2:37pm", "\t- [x] Litter", "- [ ] Next"];
    const start = tr.toggleEntry(lines, 0, "3:00pm");
    assert.deepEqual(edit(lines, start.edit), ["- [ ] Chores", "\t- 2:35pm - 2:36pm", "\t- Goal: tidy", "\t- 3:00pm - ", "\t- [/] Laundry", "\t\t- 2:37pm - 2:37pm", "\t- [x] Litter", "- [ ] Next"]);
    assert.deepEqual(plain(start.edit.cursor), { line: 3, ch: "\t- 3:00pm - ".length });
    // with only sub-tasks, the entry is the first line under the task
    const only = ["- [ ] Chores", "\t- [ ] Laundry", "\t\t- note"];
    assert.deepEqual(edit(only, tr.startEntry(only, 0, "3:00pm")), ["- [ ] Chores", "\t- 3:00pm - ", "\t- [ ] Laundry", "\t\t- note"]);
    // the sub-task's own entry still goes under the sub-task
    assert.deepEqual(edit(lines, tr.startEntry(lines, 3, "3:00pm")).slice(3, 6), ["\t- [/] Laundry", "\t\t- 2:37pm - 2:37pm", "\t\t- 3:00pm - "]);
    // once stopped, the report reads the new entry as the parent's
    const started = edit(lines, start.edit);
    const stopped = edit(started, tr.toggleEntry(started, 0, "3:30pm").edit).join("\n");
    assert.deepEqual(entriesOf(stopped).entries.map((e) => [e.task, e.minutes]).slice(0, 2), [["Chores", 1], ["Chores", 30]]);
    // a closed note's folds: the task's fold takes it in, the sub-tasks' folds move down
    const folds = tr.foldsAfterInsert([{ from: 0, to: 5 }, { from: 3, to: 4 }], lines, start.edit.from.line, "\t- 3:00pm - ");
    assert.deepEqual(plain(folds), [{ from: 0, to: 6 }, { from: 4, to: 5 }]);
});

test("lineCursor: after the dash on a running entry, else the end of the line", () => {
    const lines = ["- [ ] Task [[Note|🔗]]", "\t- 9:00am - ", "\t- 8:00am - 8:30am"];
    assert.deepEqual(plain(tr.lineCursor(lines, 0)), { line: 0, ch: lines[0].length });
    assert.deepEqual(plain(tr.lineCursor(lines, 1)), { line: 1, ch: lines[1].length });
    assert.deepEqual(plain(tr.lineCursor(["\t- 9:00am -: x"], 0)), { line: 0, ch: "\t- 9:00am -".length });
    assert.deepEqual(plain(tr.lineCursor(lines, 2)), { line: 2, ch: lines[2].length });
    assert.deepEqual(plain(tr.lineCursor(["- 9:00am - %%billable%%"], 0)), { line: 0, ch: "- 9:00am - ".length });
});

test("review (OBS-14): checkboxes nested under an entry aren't offered, since time there wouldn't count", () => {
    const lines = ["- [ ] Parent", "\t- 9:00am - 9:30am", "\t\t- [ ] follow up", "\t- [ ] Subtask"];
    assert.deepEqual(plain(tr.toggleChoices(lines)).map((c) => c.label), ["Parent", "Subtask"]);
});

test("foldsAfterInsert: a folded task takes in its new entry; a folded note above it and folds below don't", () => {
    const lines = ["---", "id: 1", "---", "- [ ] a", "\t- Prep", "\t\t- detail", "- [ ] b", "\t- note"];
    const folds = [{ from: 0, to: 0 }, { from: 3, to: 5 }, { from: 4, to: 5 }, { from: 6, to: 7 }];
    assert.deepEqual(plain(tr.foldsAfterInsert(folds, lines, 5, "\t- 9:00am - ")),
        [{ from: 0, to: 0 }, { from: 3, to: 6 }, { from: 4, to: 5 }, { from: 7, to: 8 }]);
});

// ------------------------------------------------------------------ review findings (2026-09-13)

test("review: an area loop between two projects doesn't hide hours or count them twice", () => {
    const index = tr.makeIndex([
        { path: "P/A.md", tags: ["project"], area: "[[B]]" },
        { path: "P/B.md", tags: ["project"], area: "[[A]]" },
    ]);
    const model = tr.build([note("2026-09-01", "- [x] Work [[A|⭕]]\n\t- 9:00am - 11:00am\n- [x] More [[B|⭕]]\n\t- 1:00pm - 2:00pm")], index);
    const loops = model.projectProblems.filter((p) => !p.message);
    assert.equal(loops.length, 1);
    const month = tr.render(model, { kind: "period", unit: "month", key: "2026-09" }, "s");
    assert.ok(month.includes("| **All** | **2** | **3.00** |"), month);
    // The loop is reported on the project notes involved
    assert.ok(tr.render(model, { kind: "project", path: loops[0].project }, "s").includes("are each inside the other"));
    const a = tr.render(model, { kind: "project", path: "P/A.md" }, "s");
    const b = tr.render(model, { kind: "project", path: "P/B.md" }, "s");
    // The project's whole total: its one summary row, or the Total row when it lists sub-projects
    const total = (block) => {
        const ls = block.split("\n");
        const head = ls.findIndex((l) => /^\| (Project|Entries) \|/.test(l));
        let last = head + 2;
        while (ls[last + 1]?.startsWith("|")) last++;
        return ls[last].split(/(?<!\\)\|/)[ls[head].startsWith("| Project") ? 5 : 4].replace(/\*/g, "").trim();
    };
    assert.notEqual(total(a), total(b), "only one of them can include the other");
});

test("review: near-miss time lines are always Problems", () => {
    const text = [
        "- [x] Task",
        "\t- [x] 9:00am - 10:00am",
        "\t- **11:00am - 12:00pm**",
        "\t- ~1:00pm - 2:00pm",
        "\t9:00am - 10:00am",
        "9:00am - 10:00am: worked",
        "\t- 9:00a - 10:00a",
        "\t- 9.00am - 10.00am",
        "\t- 9:00:00am - 10:00:00am",
        "\t- 9:00am until 10:00am",
        "\t- 9:00am − 10:00am",
        "\t- 9-10am",
        "> - 9:00am - 10:00am",
    ].join("\n");
    const { entries, problems } = entriesOf(text);
    assert.equal(entries.length, 0);
    assert.deepEqual(problems.map((p) => p.line), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test("review: ordinary lines with numbers aren't flagged", () => {
    const text = [
        "- [<] 9:00am\tTeam standup",
        "\t- 10:15am",
        "- [>] [[2026-09-20|9/20]] 1:00pm\tPlanning call 2-3pm",
        "- [x] Pay the phone bill [[Pay the phone bill|🔗]] [[2026-09-14|🚩 9/14]]",
        "\t- 40 mins @ level 3",
        "\t- 3-4 ideas, v2.10 - 3.4 release",
        "- [x] Timed thing",
        "\t- 9:00am - 9:30am",
        "\t\t- Logged as 10:30am - 12:01pm. 40 min of it is billed in the 3:00pm - 4:00pm entry.",
        "11:00am \t[[Weekly Team Meeting]]",
        "- [x] Confirm the plumber visit Thu. Mar. 12 9:15am-11:45am",
        "\t- [ ] Call back 2-3pm",
    ].join("\n");
    assert.deepEqual(entriesOf(text).problems, []);
});

test("review: Windows line endings", () => {
    const { entries, problems } = entriesOf("- [x] Task [[Orchard Lane Web 2026|⭕]]\r\n\t- 9:00am - 10:00am\r\n\t- 11:00am - 11:30am: 🆓\r\n");
    assert.deepEqual(problems, []);
    assert.deepEqual(entries.map((e) => [e.minutes, e.free]), [[60, false], [30, true]]);
    const crlf = "Intro\r\n%% time:start %%\r\nold\r\n%% time:end %%\r\nEnd\r\n";
    const out = apply(crlf, tr.placeBlock(crlf, BLOCK, {}));
    assert.equal(out, "Intro\r\n%% time:start %%\r\nnew\r\n%% time:end %%\r\nEnd\r\n");
    assert.ok(tr.sameBlock(out, BLOCK));
});

test("review: code fences follow CommonMark, and an unclosed one is a Problem", () => {
    const inline = entriesOf("```npm test``` failed today\n- [x] Other\n\t- 1:00pm - 3:00pm");
    assert.equal(inline.entries.length, 1);
    const reopened = entriesOf("```\ncode\n```js\n- [x] in code\n\t- 1:00pm - 3:00pm\n```\n- [x] Real\n\t- 4:00pm - 5:00pm");
    assert.deepEqual(reopened.entries.map((e) => e.line), [8]);
    const unclosed = entriesOf("- [x] Real\n\t- 9:00am - 10:00am\n```\n- [x] lost\n\t- 1:00pm - 2:00pm");
    assert.equal(unclosed.entries.length, 1);
    assert.deepEqual(unclosed.problems.map((p) => [p.line, p.kind]), [[3, "unclosed"]]);
});

test("review: commented-out entries aren't billed", () => {
    const text = "%%\n- [x] Draft\n\t- 9:00am - 5:00pm\n%%\n<!--\n- [x] Old\n\t- 9:00am - 5:00pm\n-->\n- [x] Hidden %%inline%% ok\n\t- 1:00pm - 2:00pm";
    const { entries, problems } = entriesOf(text);
    assert.deepEqual(entries.map((e) => e.line), [10]);
    assert.deepEqual(problems, []);
    assert.deepEqual(entriesOf("%%\n- [x] Draft\n\t- 9:00am - 5:00pm").problems.map((p) => p.kind), ["unclosed"]);
});

test("review: a time:start with no end is a Problem and doesn't hide entries", () => {
    const { entries, problems } = entriesOf("%% time:start %%\n- [x] Task\n\t- 9:00am - 10:00am");
    assert.equal(entries.length, 1);
    assert.deepEqual(problems.map((p) => [p.line, p.kind]), [[1, "markers"]]);
});

test("review: markers inside code blocks are examples, not the report", () => {
    const example = "Intro\n```\n%% time:start %%\nexample\n%% time:end %%\n```\nEnd";
    assert.equal(tr.hasBlock(example), false);
    assert.equal(apply(example, tr.placeBlock(example, BLOCK, { heading: "## Time tracking" })),
        example + "\n\n## Time tracking\n\n" + BLOCK + "\n");
    const daily = "```\n%% time:start %%\n```\n- [x] Task\n\t- 9:00am - 10:00am";
    assert.equal(entriesOf(daily).entries.length, 1);
});

test("review: a new block never lands inside a code block", () => {
    const code = "Intro\n```js\n## Time tracking\n```\nAfter";
    assert.equal(apply(code, tr.placeBlock(code, BLOCK)), code + "\n\n## Time tracking\n\n" + BLOCK + "\n");
});

test("review: an existing ## Time tracking heading is reused", () => {
    const content = "Intro\n\n## Time tracking\n\nMy own note about hours\n\n## Invoices\n\n| a |";
    assert.equal(apply(content, tr.placeBlock(content, BLOCK, { heading: "## Time tracking" })),
        "Intro\n\n## Time tracking\n\n" + BLOCK + "\n\nMy own note about hours\n\n## Invoices\n\n| a |");
});

test("review: a fold that starts above the block and ends inside it is kept", () => {
    const content = "#### Detail\ntext\n%% time:start %%\n*Updated x*\n\n### Summary\nold\n%% time:end %%";
    const plan = tr.placeBlock(content, "%% time:start %%\n*Updated y*\n\n### Summary\nnew\nmore\n%% time:end %%", {});
    assert.deepEqual(plain(tr.shiftFolds([{ from: 0, to: 4 }], content, plan.start, plan.end, plan.text)), [{ from: 0, to: 4 }]);
});

test("review: 12-hour entries are flagged; a meeting's plain notes don't end it; continuation text doesn't orphan entries", () => {
    assert.deepEqual(entriesOf("- [x] Long\n\t- 12:00pm - 12:00am").problems.map((p) => p.kind), ["long"]);
    const old = entriesOf("3:15pm\t[[Log A|Standup]]\n- discussed stuff\n- 3:15pm - 4:00pm", "2024-02-07");
    assert.deepEqual(old.entries.map((e) => e.task), ["Standup"]);
    assert.deepEqual(old.problems, []);
    const cont = entriesOf("- [x] A task that wraps\n  onto a second line\n\t- 9:00am - 10:00am");
    assert.deepEqual(cont.entries.map((e) => e.task), ["A task that wraps"]);
    assert.deepEqual(cont.problems, []);
});

test("review: start/stop edge cases", () => {
    // a running clock after a blank line still counts, and the entry goes after the last sub-bullet
    const gap = ["- [ ] task", "\t- 9:00am - 10:00am", "", "\t- 11:00am - "];
    assert.match(tr.startEntry(gap, 0, "1:00pm").error, /since 11:00am/);
    const gap2 = ["- [ ] task", "\t- 9:00am - 10:00am", "", "\t- 11:00am - 11:30am", "- [ ] next"];
    assert.deepEqual(edit(gap2, tr.startEntry(gap2, 0, "1:00pm")), ["- [ ] task", "\t- 9:00am - 10:00am", "", "\t- 11:00am - 11:30am", "\t- 1:00pm - ", "- [ ] next"]);
    // an empty bullet you just typed is used, not left behind
    const typed = ["- [ ] task", "\t- 9:00am - 10:00am", "\t- ", "- [ ] next"];
    assert.deepEqual(edit(typed, tr.startEntry(typed, 2, "1:00pm")), ["- [ ] task", "\t- 9:00am - 10:00am", "\t- 1:00pm - ", "- [ ] next"]);
    // running-looking lines in code blocks and report blocks don't count; * bullets stay *
    const stop = ["```", "- 9:00am - ", "```", "%% time:start %%", "- 8:00am - ", "%% time:end %%", "- [ ] task", "\t* 10:00am - "];
    assert.deepEqual(plain(tr.stopEntry(stop, 0, "11:00am")), { line: 7, text: "\t* 10:00am - 11:00am" });
});

// ------------------------------------------------------------------ OBS-3 edge cases (issue revised 2026-09-13)

test("plain bullets and their children are never entries", () => {
    const text = [
        "## Trip itinerary",
        "- Saturday",
        "\t- 9:00am - 10:00am: registration",
        "\t- 12 people",
        "- [x] Real task",
        "\t- Prep notes",
        "\t\t- 1:00pm - 2:00pm",
        "\t- [x] Subtask",
        "\t\t- 3:00pm - 3:30pm",
        "- Phone: 800-555-0199 8am-4pm",
    ].join("\n");
    const { entries, problems } = entriesOf(text);
    assert.deepEqual(entries.map((e) => [e.line, e.task]), [[9, "Subtask"]]);
    // Under a plain bullet inside a task it was probably meant as time, so it's flagged; a plain
    // itinerary with no task above stays quiet
    assert.deepEqual(problems.map((p) => [p.line, p.kind]), [[7, "plain"]]);
});

test("re-review: comments on a task line, and a link inside one, don't move hours", () => {
    const index = tr.makeIndex([{ path: "P/ProjA.md", tags: ["project"] }, { path: "P/ProjB.md", tags: ["project"] }]);
    const multi = tr.build([note("2026-09-01", "- [ ] Task A [[ProjA]]\n\t- 9:00am - 10:00am\n- [ ] Task B [[ProjB]] %% private\nstill private %%\n\t- 11:00am - 12:00pm")], index);
    assert.deepEqual(plain(multi.entries.map((e) => [e.task, e.project])), [["Task A ProjA", "P/ProjA.md"], ["Task B ProjB", "P/ProjB.md"]]);
    const html = tr.build([note("2026-09-01", "- [ ] Task A [[ProjA]]\n\t- 9:00am - 10:00am\n- [ ] Task B [[ProjB]] <!-- private\n-->\n\t- 11:00am - 12:00pm")], index);
    assert.deepEqual(plain(html.entries.map((e) => e.project)), ["P/ProjA.md", "P/ProjB.md"]);
    const inline = tr.build([note("2026-09-01", "- [ ] Task %%was [[ProjB]]%% [[ProjA]]\n\t- 9:00am - 10:00am")], index);
    assert.deepEqual(plain(inline.entries.map((e) => [e.task, e.project])), [["Task ProjA", "P/ProjA.md"]]);
    assert.deepEqual(entriesOf("- [x] Task\n\t- %%10:00am - 11:00am%%").problems, []);
});

test("re-review: an unclosed code block or comment stops a new block, so runs don't pile up copies", () => {
    for (const content of ["Intro\n```\ncode", "- [ ] task\n%% draft"]) {
        assert.match(tr.placeBlock(content, BLOCK, { heading: "## Time tracking" }).error, /never closes/);
    }
    // An existing block above the unclosed part is still replaced
    const ok = "%% time:start %%\nold\n%% time:end %%\n```\ncode";
    assert.ok(!tr.placeBlock(ok, BLOCK, {}).error);
});

test("re-review: quoted text can't open a comment that hides the report's end marker", () => {
    const model = tr.build([note("2026-09-01", "- [ ] strip `<!--` from export %%x\n\t- 9:00 - 10:00am\n- [ ] a --> b %% c\n\t- 4:34pm - 5:38")], INDEX);
    const block = tr.render(model, { kind: "period", unit: "month", key: "2026-09" }, "s");
    const scanned = tr.scan(block.split("\n"));
    assert.equal(scanned.unclosed.length, 0);
    assert.equal(scanned.ends.length, 1);
    const doc = `Intro\n${block}\nOutro`;
    assert.ok(tr.sameBlock(doc, block));
    assert.ok(!tr.placeBlock(doc, block, {}).error);
});

test("re-review: meeting titles with times, numbered-list tasks, and Start under a plain bullet", () => {
    const index = tr.makeIndex([{ path: "P/ProjA.md", tags: ["project"] }]);
    const old = tr.build([note("2024-02-07", "3:15pm\t[[ProjA|Call 3:15pm]]\n\t- 3:15pm - 4:00pm")], index);
    assert.deepEqual(plain(old.entries.map((e) => e.project)), ["P/ProjA.md"]);
    assert.deepEqual(plain(old.problems), []);
    const numbered = entriesOf("1. [ ] Task\n\t- 9:00am - 10:00am");
    assert.deepEqual(numbered.entries.map((e) => e.task), ["Task"]);
    assert.deepEqual(numbered.problems, []);
    const lines = ["- [ ] Task", "\t- call with client", "\t\t- "];
    assert.deepEqual(edit(lines, tr.startEntry(lines, 2, "9:01am")), ["- [ ] Task", "\t- call with client", "\t\t- ", "\t- 9:01am - "]);
});

test("live check: %% and <!-- inside inline code aren't comments", () => {
    // Found running the report on a note whose text says "`%%` / `<!-- -->` comments are skipped"
    const doc = "Code blocks and `%%` / `<!-- -->` comments are skipped.\n- [x] Task\n\t- 9:00am - 10:00am\nMore `` %% `` text";
    assert.equal(tr.scan(doc.split("\n")).unclosed.length, 0);
    assert.equal(entriesOf(doc).entries.length, 1);
    assert.ok(!tr.placeBlock(doc, BLOCK).error);
    // A traceback's "    ~~~~^^" is indented code, not a fence; a tab-indented fence in a list is a fence
    assert.equal(tr.scan(["Traceback:", "    ~~~~^^", "- [x] Task"]).unclosed.length, 0);
    assert.deepEqual(plain(tr.scan(["- [x] Task", "\t```", "\t- 9:00am - 10:00am", "\t```"]).hidden), [false, true, true, true]);
    // A real comment after inline code still hides
    assert.equal(entriesOf("`code` %%\n- [x] Hidden\n\t- 9:00am - 10:00am\n%%").entries.length, 0);
});

// ------------------------------------------------------------------ overview review (2026-09-13)

test("overview review: an archived link doesn't swallow hours that belong to a live project", () => {
    const index = tr.makeIndex([
        { path: "P/Live/Live.md", tags: ["project"] },
        { path: "90 Archive/Old/Old.md", tags: ["project"] },
    ]);
    const model = tr.build([note("2026-09-01", "- [ ] [[Live|⭕]] work\n\t- [x] follow-up from [[Old]]\n\t\t- 9:00am - 10:00am\n- [ ] [[Old]] only\n\t- 11:00am - 12:00pm")], index);
    assert.deepEqual(plain(model.entries.map((e) => [e.project, e.minutes])), [["P/Live/Live.md", 60]]);
    assert.deepEqual(plain(model.problems), []);
});

test("overview review: rate and rate_type are inherited separately; bad or missing rates are Problems", () => {
    const index = tr.makeIndex([
        { path: "P/Par/Par.md", tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
        { path: "P/Par/Typed/Typed.md", tags: ["project"], props: { rate: "", rate_type: "hourly" } },
        { path: "P/Par/Zero/Zero.md", tags: ["project"], props: { rate: 0 } },
        { path: "P/Par/Tbd/Tbd.md", tags: ["project"], props: { rate: "TBD" } },
        { path: "P/Alone/Alone.md", tags: ["project"], props: { rate_type: "hourly" } },
        { path: "90 Archive/Arch/Arch.md", tags: ["project"], props: { rate: 75, rate_type: "hourly" } },
        { path: "P/Sub/Sub.md", tags: ["project"], area: "[[Arch]]" },
    ]);
    const names = ["Typed", "Zero", "Tbd", "Alone", "Sub"];
    const model = tr.build([note("2026-09-01", names.map((n) => `- [x] ${n} [[${n}|⭕]]\n\t- 9:00am - 10:00am`).join("\n"))], index);
    const money = (p) => plain(model.money.get(p));
    assert.equal(money("P/Par/Typed/Typed.md").rate, 100, "a blank rate with a type inherits the parent's rate");
    assert.equal(money("P/Par/Zero/Zero.md").rate, null, "an explicit 0 doesn't inherit");
    assert.equal(money("P/Par/Tbd/Tbd.md").rate, null);
    assert.equal(money("P/Alone/Alone.md").rate, null);
    assert.equal(money("P/Sub/Sub.md").rate, 75, "a live sub-project still gets an archived parent's rate");
    const messages = plain(model.projectProblems.map((p) => [tr.basename(p.project), p.message]));
    assert.deepEqual(messages.map((m) => m[0]).sort(), ["Alone", "Tbd", "Zero"]);
    const block = tr.render(model, { kind: "period", unit: "month", key: "2026-09" }, "s");
    // Rate problems show on each project's own note
    assert.ok(tr.render(model, { kind: "project", path: "P/Par/Zero/Zero.md" }, "s").includes("- [[Zero|⭕ Zero]] has a `rate` that isn't a positive number (0), so it has no Earned"));
    assert.ok(tr.render(model, { kind: "project", path: "P/Alone/Alone.md" }, "s").includes("- [[Alone|⭕ Alone]] is hourly but has no `rate`, so it has no Earned"));
});

test("overview review: Earned is billed per rate like an invoice, and blank on non-hourly rows", () => {
    const idx = tr.makeIndex([
        { path: "P/Odd/Odd.md", tags: ["project"], props: { rate: 33.33 } },
        { path: "P/Flat/Flat.md", tags: ["project"], props: { rate: 640, rate_type: "flat" } },
        { path: "P/Flat/Hour/Hour.md", tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
    ]);
    const m = tr.build([note("2026-09-01", [
        "- [x] Odd [[Odd|⭕]]", "\t- 9:00am - 9:15am", "\t- 10:00am - 10:15am", "\t- 11:00am - 11:15am", "\t- 12:00pm - 12:15pm",
        "- [x] Hour [[Hour|⭕]]", "\t- 1:00pm - 2:00pm",
    ].join("\n"))], idx);
    assert.equal(tr.totals(m.entries.filter((e) => e.project === "P/Odd/Odd.md"), m.money).cents, 3333);
    // $0.29/hr × 30 min is 15¢, not 14¢
    assert.equal(tr.totals([{ project: "x", minutes: 30, free: false, billable: true }], new Map([["x", { rate: 0.29 }]])).cents, 15);
    const block = tr.render(m, { kind: "period", unit: "month", key: "2026-09" }, "s");
    assert.ok(!block.includes("[[Flat"), "a parent with nothing logged to it directly has no row");
    assert.ok(block.includes("| [[Hour\\|⭕ Hour]] | 1 | 1.00 |  | 1.00 | 1.00 |  | $100/hr | $100.00 |"));
});

test("overview review: quotes cut on whole characters; a differently-cased heading is reused", () => {
    const text = "- [x] Task\n\t- 9:00 - 10:00am " + "x".repeat(58) + "🆓🆓🆓 tail";
    const block = tr.render(tr.build([note("2026-09-01", text)], INDEX), { kind: "period", unit: "month", key: "2026-09" }, "s");
    assert.ok(!block.includes("�") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(block));
    assert.ok(tr.sameBlock(`x\n${block}`, tr.render(tr.build([note("2026-09-01", text)], INDEX), { kind: "period", unit: "month", key: "2026-09" }, "t")));
    const content = "Intro\n\n## Time Tracking\n\nEnd";
    assert.equal(apply(content, tr.placeBlock(content, BLOCK)), "Intro\n\n## Time Tracking\n\n" + BLOCK + "\n\nEnd");
});

// ------------------------------------------------------------------ periodic notes (weekly, monthly, yearly)

test("weekKey matches Notebook Navigator's gggg[w]ww names (checked against Obsidian's moment, 2020–2030)", () => {
    // Values from window.moment(date).format("gggg[w]ww") in Obsidian ("en" locale: weeks start Sunday,
    // week 1 holds January 1st); the same function matched moment on all 4,018 days 2020-01-01..2030-12-31
    for (const [date, key] of [["2026-01-01", "2026w01"], ["2026-09-13", "2026w38"], ["2026-09-19", "2026w38"],
        ["2026-12-27", "2027w01"], ["2027-01-02", "2027w01"], ["2025-12-28", "2026w01"], ["2021-01-01", "2021w01"], ["2022-12-31", "2022w53"]]) {
        assert.equal(tr.weekKey(date), key, date);
    }
    assert.deepEqual(plain(tr.weekRange("2026w38")), ["2026-09-13", "2026-09-19"]);
    assert.deepEqual(plain(tr.weekRange("2027w01")), ["2026-12-27", "2027-01-02"]);
});

test("periodic reports: the periods with entries, and a week's report with its own total and Problems", () => {
    const model = tr.build([
        note("2026-09-12", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am"),                  // Saturday: week 37
        note("2026-09-13", "- [x] Build [[Pinecone Studio|⭕]]\n\t- 1:00pm - 3:07pm\n- [x] Rent\n\t- 4:00pm - "), // Sunday: week 38
        note("2026-09-19", "- [x] Bramble [[Bramble|⭕]]\n\t- 4:00pm - 5:00pm"),                                   // Saturday: week 38
        note("2026-10-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:50am"),
    ], MONEY_INDEX);
    assert.deepEqual(plain(tr.periodsWithEntries(model)), {
        week: ["2026w37", "2026w38", "2026w40"], month: ["2026-09", "2026-10"], year: ["2026"],
    });

    const week = tr.render(model, { kind: "period", unit: "week", key: "2026w38" }, "s");
    assert.ok(!week.includes("Week of"), "no title line");
    assert.ok(week.includes("| [[Pinecone Studio\\|⭕ Pinecone Studio]] | 1 | 2.25 |  | 2.25 | 2.12 | 42.00 | $120/hr | $270.00 |"), week);
    assert.ok(week.includes("| [[Bramble\\|⭕ Bramble]] | 1 | 1.00 |  | 1.00 | 1.00 | 36.00 | $640 flat |  |"));
    assert.ok(week.includes("| **All** | **2** | **3.25** |  | **3.25** | **3.12** |  |  | **$270.00** |"));
    assert.ok(!week.includes("Orchard"), "entries from other weeks stay out");
    assert.ok(week.includes("line 4: `- 4:00pm -` clock still running"), "the week's own problems are listed");

    // A single project still gets its total row at the bottom
    const oct = tr.render(model, { kind: "period", unit: "month", key: "2026-10" }, "s");
    assert.ok(oct.includes("| [[Orchard Lane Web 2026\\|⭕ Orchard Lane Web 2026]] | 1 | 1.00 |  | 1.00 | 0.83 |  | $80/hr | $80.00 |"), oct);
    assert.ok(oct.includes("| **All** | **1** | **1.00** |"));
    assert.match(oct, /### Problems\n\nNone\.\n%% time:end %%$/);
    // A period with no entries gets Totals (saying so) but no By Day / By Week table
    const empty = tr.render(model, { kind: "period", unit: "week", key: "2026w39" }, "s");
    assert.match(empty, /### Totals\n\nNo time entries\.\n\n### Problems/);
    assert.ok(!empty.includes("### By Day"));

    const year = tr.render(model, { kind: "period", unit: "year", key: "2026" }, "s");
    assert.ok(year.includes("### Earned") && year.includes("### Hours"));
    assert.equal(year.split("\n").filter((l) => l.startsWith("| **All** |")).length, 2);
    assert.ok(tr.render(model, { kind: "period", unit: "year", key: "2025" }, "s").includes("No time entries."));
});

test("periodic review: report text can't carry Templater syntax into a synced note", () => {
    const model = tr.build([note("2026-09-14", "- [x] Try <% tp.file.title %>\n\t- 9:00 - 10:00am <%* app.vault.delete() %>")], INDEX);
    const block = tr.render(model, { kind: "period", unit: "week", key: "2026w38" }, "s");
    assert.ok(!block.includes("<%"), block);
});

test("periodic notes: new notes get the templates' frontmatter, and a block the next run finds", () => {
    assert.equal(tr.periodFrontmatter("week", "2026w37"), "---\naliases: Week of 9/6/26\n---\n");
    assert.equal(tr.periodFrontmatter("week", "2027w01"), "---\naliases: Week of 12/27/26\n---\n");
    assert.equal(tr.periodFrontmatter("month", "2026-05"), "---\naliases: May 2026\n---\n");
    assert.equal(tr.periodFrontmatter("year", "2026"), "");
    const model = tr.build([note("2026-09-07", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am")], INDEX);
    const block = tr.render(model, { kind: "period", unit: "week", key: "2026w37" }, "s");
    const content = `${tr.periodFrontmatter("week", "2026w37")}## Time tracking\n\n${block}\n`;
    // Refreshing it later replaces just that block, and an unchanged block isn't rewritten
    assert.ok(tr.sameBlock(content, tr.render(model, { kind: "period", unit: "week", key: "2026w37" }, "later")));
    const plan = tr.placeBlock(content, block);
    assert.equal(plan.inserted, false);
});

test("a blank line always sits above ## Time tracking, so there's room to add tasks at the top", () => {
    const fix = (content) => { const e = tr.blankLineAbove(content); return e ? apply(content, e) : content; };
    // What the frontmatter repair left in 2026-05, 2026-07, 2026-08
    assert.equal(fix(`---\naliases: May 2026\n---\n## Time tracking\n\n${BLOCK}\n`), `---\naliases: May 2026\n---\n\n## Time tracking\n\n${BLOCK}\n`);
    // Tasks typed right up against the heading
    assert.equal(fix("- [ ] one\n- [ ] two\n## Time tracking\n"), "- [ ] one\n- [ ] two\n\n## Time tracking\n");
    // Heading on the first line of a note without frontmatter
    assert.equal(fix("## Time tracking\n\nx"), "\n## Time tracking\n\nx");
    // Already right, no heading, or the heading only inside a code block: nothing to do
    for (const ok of ["- [ ] a\n\n## Time tracking\n", "---\nx: 1\n---\n\n## Time tracking", "No report here", "```\n## Time tracking\n```"]) {
        assert.equal(tr.blankLineAbove(ok), null, ok);
    }
    // Windows line endings keep theirs
    assert.equal(fix("- [ ] a\r\n## Time tracking\r\n"), "- [ ] a\r\n\r\n## Time tracking\r\n");
    // Folds below move down with the added line
    const content = "- [ ] a\n\t- b\n## Time tracking\n\n%% time:start %%\nx\n%% time:end %%";
    const e = tr.blankLineAbove(content);
    assert.deepEqual(plain(tr.shiftFolds([{ from: 0, to: 1 }, { from: 2, to: 6 }], content, e.start, e.end, e.text)), [{ from: 0, to: 1 }, { from: 3, to: 7 }]);
});

test("only entries that have already ended count, for hours and Earned; the block has no explanatory text", () => {
    const text = "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am\n\t- 2:00pm - 3:00pm";
    const at = (minutes) => tr.build([note("2026-09-14", text)], MONEY_INDEX, { now: { date: "2026-09-14", minutes } });
    const earned = (model) => tr.totals(model.entries, model.money).cents;
    assert.equal(earned(at(8 * 60)), 0, "before either entry ends");
    assert.equal(earned(at(12 * 60)), 8000, "the morning entry has ended");
    assert.equal(earned(at(15 * 60)), 16000, "both have ended");
    const noon = at(12 * 60);
    // Hours leave it out too: it isn't work yet
    assert.equal(tr.totals(noon.entries, noon.money).billable, 60);
    const block = tr.render(noon, { kind: "period", unit: "week", key: "2026w38" }, "2026-09-14 12:00pm");
    assert.ok(block.includes("| **All** | **1** | **1.00** |  | **1.00** | **1.00** |  |  | **$80.00** |"), block);
    const lines = block.split("\n");
    assert.deepEqual(plain(lines.slice(0, 6)), ["%% time:start %%", "*Updated 2026-09-14 12:00pm*", "", "### Totals", "", "| Project | Entries | Billable | 🆓 | Total | Exact | Max Hrs | Rate | Earned |"]);
    assert.ok(!/round each entry|Earned is|Max Hrs is/.test(block));
});

test("tables listing projects: a parent with nothing logged to it directly has no row; rows add up to All", () => {
    const model = tr.build([note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am\n\t- 11:00am - 11:30am")], MONEY_INDEX);
    const month = tr.render(model, { kind: "period", unit: "month", key: "2026-09" }, "s");
    assert.ok(!month.includes("Orchard Lane 2026"), month);
    assert.ok(month.includes("| [[Orchard Lane Web 2026\\|⭕ Orchard Lane Web 2026]] | 2 | 1.50 |  | 1.50 | 1.50 |  | $80/hr | $120.00 |"));
    assert.ok(month.includes("| **All** | **2** | **1.50** |"));
    const year = tr.render(model, { kind: "period", unit: "year", key: "2026" }, "s");
    assert.ok(!year.includes("Orchard Lane 2026"));
    // The parent's own note still totals its sub-projects
    assert.ok(tr.render(model, { kind: "project", path: ORCHARD }, "s").includes("| **Total** | **2** | **1.50** |  | **1.50** | **1.50** | **120.00** |  | **$120.00** |"));
});

test("project note for a parent with no time of its own: sub-project rows and Total, no weekly table", () => {
    const model = tr.build([note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am")], MONEY_INDEX);
    const lines = tr.render(model, { kind: "project", path: ORCHARD }, "s").split("\n");
    assert.ok(!lines.some((l) => l.startsWith("| [[Orchard Lane 2026\\|")), "no row for the parent's own (empty) time");
    assert.ok(lines.includes("| [[Orchard Lane Web 2026\\|⭕ Orchard Lane Web 2026]] | 1 | 1.00 |  | 1.00 | 1.00 |  | $80/hr | $80.00 |"));
    assert.ok(lines.includes("| **Total** | **1** | **1.00** |  | **1.00** | **1.00** | **120.00** |  | **$80.00** |"));
    assert.ok(lines.includes("No time logged to this project directly; see its sub-projects' notes for their weeks."));
    assert.ok(!lines.some((l) => l.startsWith("| Week |")));
});

test("weekly notes: one table of hours per project per day, day headers linking to daily notes", () => {
    const model = tr.build([
        note("2026-09-13", "- [x] Build [[Pinecone Studio|⭕]]\n\t- 1:00pm - 3:07pm\n\t- 4:00pm - 4:30pm\n- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:30am: 🆓"),
        note("2026-09-15", "- [x] Bramble [[Bramble|⭕]]\n\t- 4:00pm - 5:00pm\n- [x] Rent\n\t- 6:00pm - 6:30pm"),
        note("2026-09-21", "- [x] Next week [[Bramble|⭕]]\n\t- 4:00pm - 5:00pm"),
    ], MONEY_INDEX);
    const block = tr.render(model, { kind: "period", unit: "week", key: "2026w38" }, "s");
    const lines = block.split("\n");
    const head = lines.findIndex((l) => l.startsWith("| Project | [[2026-09-13"));
    const summaryAll = lines.findIndex((l) => l.startsWith("| **All** | **5** | "));
    assert.ok(summaryAll > 0 && summaryAll < head && head < lines.indexOf("### Problems"), block);
    assert.deepEqual(plain(lines.slice(1, 4)), ["*Updated s*", "", "### Totals"], "each table has its own H3");
    assert.deepEqual(plain(lines.slice(head - 2, head)), ["### By Day", ""]);
    assert.deepEqual(plain(lines.slice(head, head + 7)), [
        "| Project | [[2026-09-13\\|Sun 9/13]] | [[2026-09-14\\|Mon 9/14]] | [[2026-09-15\\|Tue 9/15]] | [[2026-09-16\\|Wed 9/16]] | [[2026-09-17\\|Thu 9/17]] | [[2026-09-18\\|Fri 9/18]] | [[2026-09-19\\|Sat 9/19]] | Week |",
        "| ------- | --: | --: | --: | --: | --: | --: | --: | --: |",
        "| [[Bramble\\|⭕ Bramble]] |  |  | 1.00 |  |  |  |  | 1.00 |",
        "| [[Orchard Lane Web 2026\\|⭕ Orchard Lane Web 2026]] | 0.50 |  |  |  |  |  |  | 0.50 |",
        "| [[Pinecone Studio\\|⭕ Pinecone Studio]] | 2.75 |  |  |  |  |  |  | 2.75 |",
        "| Unassigned |  |  | 0.50 |  |  |  |  | 0.50 |",
        "| **All** | **3.25** |  | **1.50** |  |  |  |  | **4.75** |",
    ]);
    assert.ok(!block.includes("### [["), "no per-day sections");
    assert.ok(!block.includes("2026-09-21"), "other weeks stay out");
    assert.ok(!tr.render(model, { kind: "period", unit: "month", key: "2026-09" }, "s").includes("Sun 9/13"), "monthly notes don't get days");
    assert.equal(tr.dayName("2026-09-19"), "Saturday");
});

test("monthly notes: hours per project per week, week headers linking to weekly notes", () => {
    const model = tr.build([
        note("2026-08-31", "- [x] Late August [[Pinecone Studio|⭕]]\n\t- 9:00am - 10:00am"),     // week 2026w36, but August
        note("2026-09-01", "- [x] Build [[Pinecone Studio|⭕]]\n\t- 1:00pm - 3:07pm"),             // 2026w36
        note("2026-09-13", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:30am: 🆓\n- [x] Rent\n\t- 6:00pm - 6:30pm"), // 2026w38
        note("2026-10-01", "- [x] Next month [[Bramble|⭕]]\n\t- 4:00pm - 5:00pm"),                // 2026w40, October
    ], MONEY_INDEX);
    const block = tr.render(model, { kind: "period", unit: "month", key: "2026-09" }, "s");
    const lines = block.split("\n");
    const head = lines.findIndex((l) => l.startsWith("| Project | [[2026w36"));
    assert.ok(head > lines.findIndex((l) => l.startsWith("| **All** | **3** |")) && head < lines.indexOf("### Problems"), block);
    assert.deepEqual(plain(lines.slice(1, 4)), ["*Updated s*", "", "### Totals"], "each table has its own H3");
    assert.deepEqual(plain(lines.slice(head - 2, head)), ["### By Week", ""]);
    assert.deepEqual(plain(lines.slice(head, head + 6)), [
        "| Project | [[2026w36\\|8/30-9/5]] | [[2026w37\\|9/6-9/12]] | [[2026w38\\|9/13-9/19]] | [[2026w39\\|9/20-9/26]] | [[2026w40\\|9/27-10/3]] | Month |",
        "| ------- | --: | --: | --: | --: | --: | --: |",
        // August 31 is in week 36 but not in September, so it stays out
        "| [[Orchard Lane Web 2026\\|⭕ Orchard Lane Web 2026]] |  |  | 0.50 |  |  | 0.50 |",
        "| [[Pinecone Studio\\|⭕ Pinecone Studio]] | 2.25 |  |  |  |  | 2.25 |",
        "| Unassigned |  |  | 0.50 |  |  | 0.50 |",
        "| **All** | **2.25** |  | **1.00** |  |  | **3.25** |",
    ]);
    // Weekly and yearly notes don't get a weeks table
    assert.ok(!tr.render(model, { kind: "period", unit: "week", key: "2026w38" }, "s").includes("| Project | [[2026w"));
    assert.ok(!tr.render(model, { kind: "period", unit: "year", key: "2026" }, "s").includes("[[2026w"));
});

test("a canceled event line (marked [-] by the calendar sync) with a time range in its title isn't a problem", () => {
    const text = ["- [-] 4:00pm\tCall 2-3pm prep", "\t- 4:00pm - 4:20pm", "- [x] 4:00pm haircut 2-3pm"].join("\n");
    const { entries, problems } = tr.parseNote(text, "2026-09-01");
    assert.equal(entries.length, 1, "time under a canceled event still counts");
    assert.equal(problems.length, 1, "a task starting with a time is still flagged");
});

test("OBS-34: a task line's ⭕ project and its 🔗 task note's project disagree → a problem on both projects", () => {
    const idx = tr.makeIndex([
        { path: "P/Hawk/Hawk.md", tags: ["project"] },
        { path: "P/Tin/Tin.md", tags: ["project"] },
        { path: "P/Hawk/Send the invoice.md", tags: ["task"] },
        { path: "P/Tin/Draft the scope.md", tags: ["task"] },
        { path: "Inbox/Loose end.md", tags: ["task"] },
        { path: "Elsewhere/Filed by area.md", tags: ["task"], area: "[[Hawk]]" },
    ]);
    const text = [
        "- [ ] Send the invoice [[Tin|⭕]] [[Send the invoice|🔗]]",   // note under Hawk, line says Tin: conflict
        "\t- 9:00am - 10:00am",
        "- [ ] Send the invoice again [[Tin|⭕]] [[Send the invoice|🔗]]", // same pair again: one problem, 2 entries
        "\t- 10:00am - 10:30am",
        "- [ ] Draft the scope [[Tin|⭕]] [[Draft the scope|🔗]]",       // note under Tin too: agrees
        "\t- 11:00am - 11:30am",
        "- [ ] Loose end [[Tin|⭕]] [[Loose end|🔗]]",                   // note has no project: nothing to disagree with
        "\t- 1:00pm - 1:15pm",
        "- [ ] By area [[Tin|⭕]] [[Filed by area|🔗]]",                 // project through `area`, like the report itself
        "\t- 2:00pm - 2:15pm",
    ].join("\n");
    const m = tr.build([note("2026-09-01", text)], idx);
    // Time still counts where the line's own link says
    assert.deepEqual(plain([...new Set(m.entries.map((e) => e.project))]), ["P/Tin/Tin.md"]);
    const conflicts = m.projectProblems.filter((p) => p.conflict);
    assert.equal(conflicts.length, 4);

    const tin = tr.render(m, { kind: "project", path: "P/Tin/Tin.md" }, "s");
    assert.ok(tin.includes("- [[Tin|⭕ Tin]] has time (2 entries) from a task line whose task note [[P/Hawk/Send the invoice|Send the invoice]] is filed under [[Hawk|⭕ Hawk]]; move the note here, or change the line's project link"), tin);
    assert.ok(tin.includes("- [[Tin|⭕ Tin]] has time (1 entry) from a task line whose task note [[Elsewhere/Filed by area|Filed by area]] is filed under [[Hawk|⭕ Hawk]]"), tin);
    assert.ok(!tin.includes("Draft the scope") && !tin.includes("Loose end"));
    assert.ok(!tin.includes("⭕ link"), "the message says project link, not ⭕ link");

    // Hawk has no time of its own, but its note still gets a report, so the problem is seen there
    assert.ok(tr.projectTargets(m).has("P/Hawk/Hawk.md"));
    const hawk = tr.render(m, { kind: "project", path: "P/Hawk/Hawk.md" }, "s");
    assert.ok(hawk.includes("No time entries."), hawk);
    assert.ok(hawk.includes("- [[Hawk|⭕ Hawk]] has a task note, [[P/Hawk/Send the invoice|Send the invoice]], whose task line links [[Tin|⭕ Tin]], so its time (2 entries) counts there; move the note, or change the line's project link"), hawk);
});

test("OBS-34: no conflict without a 🔗 note, with an archived note project, or when the ⭕ is on an outer line only", () => {
    const idx = tr.makeIndex([
        { path: "P/Hawk/Hawk.md", tags: ["project"] },
        { path: "P/Tin/Tin.md", tags: ["project"] },
        { path: "90 Archive/Old/Old.md", tags: ["project"] },
        { path: "90 Archive/Old/Old task.md", tags: ["task"] },
        { path: "P/Hawk/Nested task.md", tags: ["task"] },
    ]);
    const text = [
        "- [ ] Plain [[Tin|⭕]]", "\t- 9:00am - 9:30am",
        "- [ ] Old [[Tin|⭕]] [[Old task|🔗]]", "\t- 10:00am - 10:30am",
        "- [ ] Parent [[Tin|⭕]]", "\t- [ ] Child [[Nested task|🔗]]", "\t\t- 11:00am - 11:30am",
    ].join("\n");
    const m = tr.build([note("2026-09-01", text)], idx);
    assert.deepEqual(plain(m.projectProblems.filter((p) => p.conflict)), []);
});

test("OBS-41: refresh keeps the Schedule it started with while CustomJS rebuilds customJS", async () => {
    const schedule = {
        dailyOpts: () => ({ folder: "Planner/days", format: "YYYY-MM-DD" }),
        isDailyNote: (f) => f.path.startsWith("Planner/days/"),
    };
    const day = { path: "Planner/days/2026-09-01.md", basename: "2026-09-01" };
    const context = {
        customJS: { obsidian: {}, Schedule: schedule },
        app: {
            vault: { getMarkdownFiles: () => [day], getFileByPath: () => null, cachedRead: async () => "- 9:00am - 9:30am" },
            metadataCache: {},
            workspace: { getLeavesOfType: () => [] },
            plugins: { plugins: {} },
        },
        window: { moment: (text) => ({ format: () => text }) },
        console: { ...console, warn: () => {} },
    };
    const Loaded = vm.runInContext(fs.readFileSync(new URL("../CustomJS/timeReport.js", here), "utf8") + "\n;TimeReport", vm.createContext(context));
    const report = new Loaded();
    // With no project note in sight, refresh stops before it writes anything; it has started, though
    await report.refresh({ quiet: true });
    // A script is saved: CustomJS starts `customJS` over, and Schedule isn't back yet
    context.customJS = { obsidian: {} };
    assert.deepEqual(plain(report.periodFolders()), { week: "Planner/weeks", month: "Planner/months", year: "Planner/years" });
    assert.deepEqual(plain(await report.readDailyNotes()), [{ date: "2026-09-01", path: day.path, text: "- 9:00am - 9:30am" }]);
});

test("OBS-29: a weekly, monthly or yearly note lists the project problems of the projects with time in it", () => {
    const idx = tr.makeIndex([
        { path: "P/Par/Par.md", tags: ["project"], props: { rate: "TBD", rate_type: "hourly" } },
        { path: "P/Par/Kid/Kid.md", tags: ["project"] },
        { path: "P/Bare/Bare.md", tags: ["project"] },
        { path: "P/Late/Late.md", tags: ["project"] },
        { path: "P/A.md", tags: ["project"], area: "[[B]]", props: { rate_type: "non-billable" } },
        { path: "P/B.md", tags: ["project"], area: "[[A]]", props: { rate_type: "non-billable" } },
        { path: "P/Hawk/Hawk.md", tags: ["project"], props: { rate_type: "non-billable" } },
        { path: "P/Tin/Tin.md", tags: ["project"], props: { rate_type: "non-billable" } },
        { path: "P/Hawk/Send the invoice.md", tags: ["task"] },
    ]);
    const m = tr.build([
        note("2026-09-01", [
            "- [x] Kid [[Kid|⭕]]", "\t- 9:00am - 10:00am",
            "- [x] Bare [[Bare|⭕]]", "\t- 10:00am - 11:00am",
            "- [x] Loop [[A|⭕]]", "\t- 11:00am - 12:00pm",
            "- [ ] Send the invoice [[Tin|⭕]] [[Send the invoice|🔗]]", "\t- 1:00pm - 2:00pm",
        ].join("\n")),
        note("2026-09-08", "- [ ] Send the invoice [[Tin|⭕]] [[Send the invoice|🔗]]\n\t- 1:00pm - 2:00pm"),
        note("2026-10-05", "- [x] Late [[Late|⭕]]\n\t- 9:00am - 10:00am"),
    ], idx);
    const problems = (block) => block.slice(block.indexOf("### Problems")).split("\n").filter((l) => l.startsWith("- "));

    const week = problems(tr.render(m, { kind: "period", unit: "week", key: tr.weekKey("2026-09-01") }, "s"));
    assert.deepEqual(plain(week), [
        "- [[B|⭕ B]] and [[A|⭕ A]] are each inside the other (check their folders and `area`); [[B|⭕ B]] is counted as top-level",
        // A conflict is said once, from the project the time counts on, with this period's entries only
        "- [[Tin|⭕ Tin]] has time (1 entry) from a task line whose task note [[P/Hawk/Send the invoice|Send the invoice]] is filed under [[Hawk|⭕ Hawk]]; move the note here, or change the line's project link",
        // A parent's problem reaches the period through its sub-project's time
        "- [[Par|⭕ Par]] has a `rate` that isn't a positive number (TBD), so it has no Earned",
        "- [[Bare|⭕ Bare]] has no `rate_type`, so its time counts as billable; set one (`hourly`, `flat`, `non-billable`)",
    ]);
    // Only the conflict has time in the next week
    const next = problems(tr.render(m, { kind: "period", unit: "week", key: tr.weekKey("2026-09-08") }, "s"));
    assert.equal(next.length, 1);
    assert.ok(next[0].includes("has time (1 entry)"), next[0]);

    const sept = problems(tr.render(m, { kind: "period", unit: "month", key: "2026-09" }, "s"));
    assert.equal(sept.length, 4);
    assert.ok(sept.some((l) => l.includes("has time (2 entries)")), sept.join("\n"));
    assert.ok(!sept.some((l) => l.includes("Late")), "a project with no time in the period isn't listed");
    assert.deepEqual(plain(problems(tr.render(m, { kind: "period", unit: "month", key: "2026-10" }, "s"))),
        ["- [[Late|⭕ Late]] has no `rate_type`, so its time counts as billable; set one (`hourly`, `flat`, `non-billable`)"]);

    const year = problems(tr.render(m, { kind: "period", unit: "year", key: "2026" }, "s"));
    assert.equal(year.length, 5);
    assert.ok(year.some((l) => l.includes("has time (2 entries)")) && year.some((l) => l.includes("[[Late")));

    // The project notes are unchanged: the conflict is still said on both
    assert.ok(tr.render(m, { kind: "project", path: "P/Hawk/Hawk.md" }, "s").includes("so its time (2 entries) counts there"));
    assert.ok(tr.render(m, { kind: "project", path: "P/Tin/Tin.md" }, "s").includes("has time (2 entries)"));
});
