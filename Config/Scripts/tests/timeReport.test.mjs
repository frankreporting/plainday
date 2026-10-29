// Tests for CustomJS/timeReport.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm, the way CustomJS evaluates it; only the methods that don't touch
// `app` are tested. Checks against a real vault's data can go in
// timeReport.private.test.mjs, which git ignores.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { standIn, PLANNER } from "./standInVault.mjs";

const here = new URL(".", import.meta.url);
const TimeReport = vm.runInContext(
    fs.readFileSync(new URL("../CustomJS/timeReport.js", here), "utf8") + "\n;TimeReport",
    vm.createContext({}),
);
const tr = new TimeReport();
const Billing = vm.runInContext(
    fs.readFileSync(new URL("../CustomJS/billing.js", here), "utf8") + "\n;Billing",
    vm.createContext({}),
);
const billing = new Billing();
// Objects made inside the vm context have that context's prototypes; compare as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

const LOG = "Reference/Planner/days";
const ORCHARD_WEB = "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Web 2026/Orchard Lane Web 2026.md";
const ORCHARD = "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane 2026.md";
const KESTREL = "Archive/Freelance/Kestrel Newsletter/Kestrel Newsletter.md";
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
    "- [x] Finish launch checklist [[Finish launch checklist|⋯]] [[Orchard Lane Web 2026|⭕]]",
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
    { path: ORCHARD, tags: ["project"], parent: "[[Freelance|🗃️.Freelance]]" },
    { path: ORCHARD_WEB, tags: ["project"], parent: "[[Orchard Lane 2026|⭕.Freelance.Orchard Lane 2026]]" },
    { path: "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Web 2026/Update chart data.md", tags: ["task"] },
    { path: "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Web 2026/logs/2026-04-02 Content Calendar Sync.md", tags: ["log"] },
    { path: `${LOG}/2026-04-01 Meeting (1 hr) — Imogen Fenwick.md`, tags: ["log"], parent: "[[Orchard Lane Web 2026|⭕]]" },
    { path: PINECONE, tags: ["project"] },
    { path: "20 Projects/Freelance/Pinecone Studio/logs/2026-09-02 Launch wrapup.md", tags: ["log"] },
    { path: KESTREL, tags: ["project"], parent: "[[Freelance|🗃.Freelance]]" },
    { path: "Archive/Freelance/Kestrel Newsletter/Kestrel Handoff Report.md", tags: [] },
    { path: "20 Projects/Personal/Renew lease for 2026.md", tags: ["task"] },
    { path: "Reference/Subjects/System notes.md", tags: ["subject"] },
    { path: "20 Projects/Productivity/Tidy up old queries.md", tags: ["task", "project"] },
    { path: "20 Projects/Productivity/Nested tag.md", tags: ["project/sample"] },
]);
const projectFor = (line, context = []) => tr.resolve([{ body: line }, ...context.map((body) => ({ body }))], `${LOG}/2026-09-01.md`, INDEX);

test("resolve: a ⭕ at the end of the line wins over its note, in either order", () => {
    assert.equal(projectFor("[x] Task [[2026-09-02 Launch wrapup|⋯]] [[Orchard Lane Web 2026|⭕]]"), ORCHARD_WEB);
    assert.equal(projectFor("[x] Task [[Orchard Lane Web 2026|⭕]] [[2026-09-02 Launch wrapup|⋯]]"), ORCHARD_WEB, "⭕ before the ⋯ (OBS-90)");
    assert.equal(projectFor("[x] Task [[2026-09-30|🚩 9/30]] [[Orchard Lane Web 2026|⭕]] [[2026-09-02 Launch wrapup|⋯]]"), ORCHARD_WEB, "after a due date");
    assert.equal(projectFor("[>] [[2024-12-10|12/10]] Newsletter [[Kestrel Newsletter|⭕]]"), KESTREL);
    // on a line the task is nested under, it still beats the task's own ⋯
    assert.equal(projectFor("[x] Subtask [[2026-09-02 Launch wrapup|⋯]]", ["[ ] Parent [[Orchard Lane Web 2026|⭕]]"]), ORCHARD_WEB);
    // a ⭕ says where the time goes, ahead of a project mentioned earlier in the text (OBS-36)
    assert.equal(projectFor("[x] Send the [[Kestrel Newsletter]] invoice [[Orchard Lane Web 2026|⭕]]"), ORCHARD_WEB);
    assert.equal(projectFor("[x] Send the [[Kestrel Newsletter]] invoice [[Orchard Lane Web 2026|⭕️]]"), ORCHARD_WEB, "with U+FE0F");
    assert.equal(projectFor("[x] Subtask", ["[ ] Parent [[Kestrel Newsletter]] work [[Orchard Lane Web 2026|⭕]]"]), ORCHARD_WEB, "on a parent line too");
    // the free mark and 🆓 can sit among the links that end a line, as the calendar sync writes them
    assert.equal(projectFor("[<] 4:00pm\tReview ℹ️ [[Orchard Lane Web 2026|⭕]]"), ORCHARD_WEB);
    assert.equal(projectFor("[x] Fix it [[Orchard Lane Web 2026|⭕]] 🆓"), ORCHARD_WEB);
    // An area's 🗃️ link is stripped from task text like the other suffixes, and (once areas count, OBS-51) outranks a prose link the same way
    assert.equal(tr.taskText("[x] Water the beds [[Household|🗃️]] [[Water the beds|⋯]]"), "Water the beds");
});

test("resolve: only the links that end a line say where its time goes; a link in the text is part of the title (OBS-90)", () => {
    // A project linked in the text doesn't count, with or without a ⭕, and whatever its alias
    assert.equal(projectFor("[>] Work on [[Orchard Lane Web 2026|⭕.Freelance.Orchard Lane Web 2026]] [[Work on|⋯]]"), null);
    assert.equal(projectFor("[x] Ask [[Orchard Lane Web 2026]] about dates"), null);
    assert.equal(projectFor("[x] Ask about dates [[Orchard Lane Web 2026]]"), null, "at the end, but not a ⭕");
    assert.equal(projectFor("[x] [[Orchard Lane Web 2026|⭕]] charts"), null, "a ⭕ before the text");
    assert.equal(projectFor("[x] Send the [[Kestrel Newsletter]] invoice [[Orchard Lane Web 2026|⭕ Orchard]]"), null, "⭕ with a name after it is an ordinary alias, as the report itself writes them");
    // nor does it beat the line's own note, as it did before
    assert.equal(projectFor("[x] Ask [[Orchard Lane Web 2026]] about [[2026-09-02 Launch wrapup|⋯]]"), PINECONE);
    assert.equal(projectFor("[x] Subtask [[2026-09-02 Launch wrapup|⋯]]", ["[ ] Parent for [[Orchard Lane Web 2026]]"]), PINECONE, "on a parent line either");
    // A note linked in the text is part of it too
    assert.equal(projectFor("[x] Read [[Update chart data]] again"), null);
    // Text after a link means it doesn't end the line
    assert.equal(projectFor("[x] Charts [[Orchard Lane Web 2026|⭕]] then more"), null);
    // A free mark before a block ID still marks the event free
    assert.equal(tr.freeEvent("[<] 4:00pm\tReview ℹ️ [[Orchard Lane Web 2026|⭕]] ^r1"), true);
    // but a block ID doesn't: Obsidian hides it, and Copy link to block adds one
    assert.equal(projectFor("[x] Charts [[Orchard Lane Web 2026|⭕]] ^a1b2c3"), ORCHARD_WEB);
    assert.equal(projectFor("[x] Wrap up [[2026-09-02 Launch wrapup|⋯]] ^wrap-up"), PINECONE);
});

test("resolve: an event whose title is wrapped in a link, the way lines were written before OBS-57, has that note", () => {
    assert.equal(projectFor("[<] 5:00pm\t[[2026-04-02 Content Calendar Sync|Content Calendar Sync]] [[Pinecone Studio|⭕]]"), PINECONE, "its ⭕ still wins");
    assert.equal(projectFor("[-] 5:00pm\t[[2026-04-02 Content Calendar Sync|Content Calendar Sync]]"), ORCHARD_WEB, "canceled");
    assert.equal(projectFor("[>] [[2026-04-03|4/3]] 5:00pm\t[[2026-04-02 Content Calendar Sync|Content Calendar Sync]]"), ORCHARD_WEB, "forwarded");
    assert.equal(projectFor("[<] [[2026-04-02 Content Calendar Sync|Content Calendar Sync]]"), ORCHARD_WEB, "a log's line with no time yet");
    assert.equal(projectFor("5:00pm \t[[2026-04-02 Content Calendar Sync#Notes|Content Calendar Sync]]"), ORCHARD_WEB, "the old layout, without a bullet");
    // Only a title that is the link: a task, or a title with more text, isn't one
    assert.equal(projectFor("[x] [[2026-04-02 Content Calendar Sync|Content Calendar Sync]]"), null);
    assert.equal(projectFor("[<] 5:00pm\t[[2026-04-02 Content Calendar Sync|Sync]] follow-up"), null);
});

test("resolve and taskText: a ↗ note link is read like ⋯ (OBS-208), with or without U+FE0F", () => {
    for (const mark of ["⋯", "↗", "↗\uFE0F"]) {
        // The note link's note decides ahead of another note merely linked in the text
        assert.equal(projectFor(`[x] Update [[Update chart data]] then wrap up [[2026-09-02 Launch wrapup|${mark}]]`), PINECONE, mark);
        assert.equal(tr.taskText(`[x] Wrap up [[2026-09-02 Launch wrapup|${mark}]] [[Orchard Lane Web 2026|⭕]]`), "Wrap up", mark);
    }
    assert.equal(tr.taskText("[<] 4:00pm\tKickoff [[2026-09-02 Launch wrapup|⋯]]"), "Kickoff", "an event's log link at the end (OBS-57)");
});

test("resolve: the ⋯ note's project folder, then its area", () => {
    assert.equal(projectFor("[x] Wrap up [[2026-09-02 Launch wrapup|⋯]]"), PINECONE);
    assert.equal(projectFor("[x] Update [[Update chart data|⋯]]"), ORCHARD_WEB);
    assert.equal(projectFor("[x] Handoff [[Kestrel Handoff Report|⋯]]"), KESTREL);
    assert.equal(projectFor("[x] Rent [[Renew lease for 2026|⋯]]"), null);
    assert.equal(projectFor("[x] Queries [[Tidy up old queries|⋯]]"), "20 Projects/Productivity/Tidy up old queries.md");
});

test("resolve: a linked log note's folder or area", () => {
    assert.equal(projectFor("[<] 5:00pm\t[[2026-04-02 Content Calendar Sync|Content Calendar Sync]]"), ORCHARD_WEB);
    assert.equal(projectFor("[<] 4:00pm\t[[2026-04-01 Meeting (1 hr) — Imogen Fenwick|Meeting]]"), ORCHARD_WEB);
});

test("resolve: date links, nested #project/ tags and plain text resolve to nothing", () => {
    assert.equal(projectFor("[x] Pay [[2026-09-14|🚩 9/14]]"), null);
    assert.equal(projectFor("[x] Something [[Nested tag]]"), null);
    assert.equal(projectFor("[x] Just a task"), null);
    assert.equal(projectFor("[x] Setup [[System notes|⋯]]"), null);
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
    { path: CENTURY, tags: ["project"], parent: "[[Cycling|🗃️.Cycling]]", props: { rate_type: "non-billable" } },
    { path: "20 Projects/Cycling/Tune the gears.md", tags: ["task"] },
    { path: "20 Projects/Cycling/Century Ride/Route plan.md", tags: ["task"] },
    { path: "Reference/Logs/2026-09-01 Group ride.md", tags: ["log"], parent: "[[Cycling|🗃️]]" },
    { path: "Archive/Hobbies/Hobbies.md", tags: ["area"] },
    { path: PINECONE, tags: ["project"] },
]);
const areaFor = (line, context = [], live = false) =>
    tr.resolve([{ body: line }, ...context.map((body) => ({ body }))], `${LOG}/2026-09-01.md`, AREA_INDEX, live);

test("OBS-51 resolve: time linked to an area, on the line or through a note filed under it, counts toward the area", () => {
    assert.equal(areaFor("[x] Run [[Cycling|⭕]]"), CYCLING);
    assert.equal(areaFor("[x] Run [[Cycling|🗃️]]"), CYCLING, "the 🗃️ mark too");
    assert.equal(areaFor("[x] Run [[Cycling]]"), null, "a link that isn't a ⭕ or 🗃️ is part of the text (OBS-90)");
    assert.equal(areaFor("[x] Stretch [[Tune the gears|⋯]]"), CYCLING, "a task note filed straight under the area");
    assert.equal(areaFor("[<] 7:00am\t[[2026-09-01 Group ride|Group ride]]"), CYCLING, "a log whose `area` is the area");
    assert.equal(areaFor("[x] Subtask", ["[ ] Parent [[Cycling|⭕]]"]), CYCLING, "on a line it's nested under");
    // A project inside the area keeps its own time: the nearest folder note wins
    assert.equal(areaFor("[x] Plan [[Route plan|⋯]]"), CENTURY);
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
    // 45 minutes, 🆓 since the area sets no rate: only Exact and Total, by month, with no rate line (OBS-133)
    assert.equal(block, ["%% time:start %%", "*Updated s*", "", "### By Month", "",
        "| Month | Exact | Total |", "| ----- | ----: | ----: |",
        "| [[2026-09\\|September 2026]] | 0.75 | 0.75 |", "| **Total** | **0.75** | **0.75** |", "", "%% time:end %%"].join("\n"));
    assert.ok(!block.includes(PROBLEMS), "and it isn't asked for a rate_type");
});

test("OBS-51 money: an area with its own rate bills; an area filed inside a project is no sub-project of it", () => {
    const idx = tr.makeIndex([
        { path: "P/Client/Client.md", tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
        { path: "P/Client/Admin/Admin.md", tags: ["area"] },
        { path: "P/Coaching/Coaching.md", tags: ["area"], props: { rate: 60 } },
        { path: "P/Tutoring/Tutoring.md", tags: ["area"], props: { rate: 50, rate_type: "hourly" } },
    ]);
    assert.equal(tr.parentProject("P/Client/Admin/Admin.md", idx), null);
    const model = tr.build([note("2026-09-01", [
        "- [x] Timesheets [[Admin|⭕]]",
        "\t- 7:00am - 8:00am",
        "- [x] Session [[Coaching|🗃️]]",
        "\t- 9:00am - 10:00am",
        "- [x] Lesson [[Tutoring|🗃️]]",
        "\t- 11:00am - 12:00pm",
    ].join("\n"))], idx);
    assert.deepEqual(plain(model.entries.map((e) => [e.project, e.billable])), [["P/Client/Admin/Admin.md", false], ["P/Coaching/Coaching.md", true], ["P/Tutoring/Tutoring.md", true]]);
    assert.equal(model.parent.get("P/Client/Admin/Admin.md"), null, "not rolled into the client's hours");
    assert.equal(model.money.get("P/Client/Admin/Admin.md").rate, null, "nor billed at its rate");
    assert.equal(model.money.get("P/Coaching/Coaching.md").rate, 60);
    assert.ok(!tr.projectTargets(model).has("P/Client/Client.md"));
    // A rate alone makes an area billable, which a rate meant to value its time doesn't want, so it
    // asks for a rate_type (OBS-156); one that says hourly isn't asked
    assert.deepEqual(plain(model.projectProblems.map((p) => [p.project, p.message])), [["P/Coaching/Coaching.md",
        "has a `rate` and no `rate_type`, so its time counts as billable; set one (`hourly`, or `non-billable` to value its time without billing it)"]]);
    // An area billed by the hour keeps its timesheet, since Invoice bills it; one that isn't, doesn't (OBS-131)
    assert.equal(tr.takesTimesheet("P/Coaching/Coaching.md", idx, model), true);
    assert.equal(tr.takesTimesheet("P/Client/Admin/Admin.md", idx, model), false);
});

test("OBS-51 links: an area's report link is 🗃️; a note tagged both is a project", () => {
    assert.equal(tr.linkMark(CYCLING, AREA_INDEX), "🗃️");
    assert.equal(tr.linkMark(CENTURY, AREA_INDEX), "⭕");
    assert.equal(tr.isAreaOnly(CYCLING, AREA_INDEX), true);
    assert.equal(tr.isAreaOnly(CENTURY, AREA_INDEX), false);
    const both = tr.makeIndex([{ path: "P/Both/Both.md", tags: ["area", "project"] }]);
    assert.equal(tr.isAreaOnly("P/Both/Both.md", both), false, "a note tagged both is a project");
    // Only a project gets a timesheet (OBS-131)
    assert.equal(tr.takesTimesheet(CYCLING, AREA_INDEX), false);
    assert.equal(tr.takesTimesheet(CENTURY, AREA_INDEX), true);
    assert.equal(tr.takesTimesheet("P/Both/Both.md", both), true);
    assert.equal(tr.linkMark("P/Both/Both.md", both), "⭕");
});

test("OBS-51 writing: an area note with time gets a report block added, like a project note", async () => {
    const { planReports, frontmatter } = await import("./demo/renderReports.mjs");
    const vaultOf = (files) => ({ notes: new Map(Object.entries(files).map(([p, text]) => [p, { text, fm: frontmatter(text) }])) });
    const day = "- [x] Run [[Cycling|⭕]]\n\t- 7:00am - 7:45am\n- [x] Paint [[Studio|⭕]]\n\t- 9:00am - 9:30am\n";
    const files = {
        "Reference/Planner/days/2026-09-01.md": day,
        "Projects/Cycling/Cycling.md": "---\ntags: area\n---\nRides.\n",
        "Projects/Studio/Studio.md": "---\ntags: area\n---\n## Time tracking\n\n%% time:start %%\n%% time:end %%\n",
        "Projects/Idle/Idle.md": "---\ntags: area\n---\nNothing logged here.\n",
    };
    const plan = planReports(tr, vaultOf(files));
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plain(plan.targets.project.slice().sort()), ["Projects/Cycling/Cycling.md", "Projects/Studio/Studio.md"], "an area with no time and no block is left alone");
    const cycling = plan.changes.find((c) => c.path === "Projects/Cycling/Cycling.md").after;
    assert.match(cycling, /^Rides\.\n\n## Time Report\n\n%% time:start %%/m, "added under a new heading at the end");
    assert.match(cycling, /\| \[\[2026-09\\\|September 2026\]\] \| 0\.75 \| 0\.75 \|/, cycling);
    const studio = plan.changes.find((c) => c.path === "Projects/Studio/Studio.md").after;
    assert.match(studio, /^## Time Report\n\n%% time:start %%[^]*\| \[\[2026-09\\\|September 2026\]\] \| 0\.50 \| 0\.50 \|/m, "an existing block is filled in place, its old heading renamed");
    assert.ok(!studio.includes("Time tracking"), studio);
    // The weekly note lists both areas as rows of their own, under an **Area** row since there are no
    // projects to list first, with plain links (OBS-167)
    const week = plan.changes.find((c) => c.path.includes("/weeks/")).after;
    assert.match(week, /\| ---[^\n]*\n\| \*\*Area\*\* \|[ |]*\n\| \[\[Cycling\]\] \|[^\n]*\n\| \[\[Studio\]\] \|/, week);
    assert.ok(!week.includes("🗃️"), week);
});

test("OBS-167: a table lists its projects, then an **Area** row and the areas; All still adds up", async () => {
    const { planReports, frontmatter } = await import("./demo/renderReports.mjs");
    const vaultOf = (files) => ({ notes: new Map(Object.entries(files).map(([p, text]) => [p, { text, fm: frontmatter(text) }])) });
    const day = [
        "- [x] Run [[Cycling|🗃️]]", "\t- 7:00am - 7:45am",
        "- [x] Draft layout [[Kestrel|⭕]]", "\t- 9:00am - 10:00am",
        "- [x] Errand", "\t- 11:00am - 11:30am",
        "- [x] Route plan [[Century|⭕]]", "\t- 12:00pm - 12:30pm",
        "- [x] Session [[Coaching|🗃️]]", "\t- 2:00pm - 3:00pm",
    ].join("\n") + "\n";
    const files = {
        "Reference/Planner/days/2026-09-01.md": day,
        "Projects/Kestrel/Kestrel.md": "---\ntags: project\nrate_type: hourly\nrate: 100\n---\n",
        "Projects/Cycling/Cycling.md": "---\ntags: area\n---\n",
        "Projects/Cycling/Century/Century.md": "---\ntags: project\nrate_type: non-billable\n---\n",
        "Projects/Coaching/Coaching.md": "---\ntags: area\nrate_type: hourly\nrate: 80\n---\n",
        "Projects/Both/Both.md": "---\ntags: [area, project]\nrate_type: non-billable\n---\n",
    };
    const plan = planReports(tr, vaultOf({ ...files, "Reference/Planner/days/2026-09-01.md": day + "- [x] Plan [[Both|⭕]]\n\t- 5:00pm - 5:15pm\n" }));
    assert.deepEqual(plan.errors, []);
    const rows = (text, heading) => text.split(`### ${heading}\n\n`)[1].split("\n\n")[0].split("\n").slice(2).map((r) => r.split(" | ")[0].slice(2));
    for (const unit of ["weeks", "months", "years"]) {
        const note = plan.changes.find((c) => c.path.includes(`/${unit}/`)).after;
        // Projects (a note tagged both counts as one), then **Area** and the areas, then Unassigned and All
        assert.deepEqual(rows(note, "Hours"), ["[[Both]]", "[[Century]]", "[[Kestrel]]", "**Area**", "[[Coaching]]", "[[Cycling]]", "Unassigned", "**All**"], `${unit}: ${note}`);
        assert.deepEqual(rows(note, "Earnings"), ["[[Kestrel]]", "**Area**", "[[Coaching]]", "**All**"], `${unit}: ${note}`);
        assert.ok(!note.includes("🗃️"), note);
    }
    // The **Area** row is a label: every other cell is blank, and All is the same with or without it
    const week = plan.changes.find((c) => c.path.includes("/weeks/")).after;
    assert.match(week, /\n\| \*\*Area\*\* \|(  \|){8}\n/, week);
    assert.match(week, /\| \*\*All\*\* \|  \|  \| \*\*4\.00\*\* \|  \|  \|  \|  \| \*\*4\.00\*\* \|/, week);
    assert.match(week, /\| \*\*All\*\* \| \*\*2\.00\*\* \|  \| \*\*\$180\.00\*\* \|/, week);

    // With no area in the period, there's no **Area** row
    const projectsOnly = planReports(tr, vaultOf({ ...files, "Reference/Planner/days/2026-09-01.md": "- [x] Draft layout [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n" }));
    assert.ok(!projectsOnly.changes.some((c) => c.after.includes("**Area**")), JSON.stringify(projectsOnly.changes.map((c) => c.after)));
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

test("an archived project's entries count like any project's, past midnight too (OBS-213)", () => {
    const text = [
        "---", "aliases: 12/9/24 Monday", "---", "", "## Meetings", "", "", "## To Do", "",
        "- [>] [[2024-12-10|12/10]] Newsletter [[Kestrel Newsletter|⭕]]",
        "\t- [x] Sort the backlog into themes",
        "\t\t- 10:30pm - 5:51am",
        "\t- 1:00pm - 2:00pm",
        "\t- 4:34pm - 5:38",
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]",
        "\t- 10:30pm - 5:51am",
    ].join("\n");
    const model = tr.build([note("2024-12-09", text)], INDEX);
    // Kestrel lives in Archive: its entries count, marked archived for Billing, and so does its project note
    assert.deepEqual(plain(model.entries.map((e) => [e.project, e.minutes, e.crossesMidnight, !!e.archived])),
        [[KESTREL, 441, true, true], [KESTREL, 60, false, true], [ORCHARD_WEB, 441, true, false]]);
    // Its Problems are listed like a live project's: the entry with no am/pm, and the overlap with live
    // work, said as it would be if Kestrel were live (a tie keeps note order)
    assert.deepEqual(plain(model.problems.map((p) => [p.kind, p.projects])), [["format", [KESTREL]], ["overlap", [ORCHARD_WEB, KESTREL]]]);
    assert.ok([...model.parent.keys()].includes(KESTREL));
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

test("an event of an archived project counts like a live one's, and its overlaps are listed (OBS-213)", () => {
    const model = tr.build([note(D, [
        "- [<] 2:00pm\tOld standup [[Kestrel Newsletter|⭕]]",
        "\t- 3:00pm",
        "- [<] 2:30pm\tOld review [[Kestrel Newsletter|⭕]]",
        "\t- 3:30pm",
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]",
        "\t- 2:45pm - 4:00pm",
    ].join("\n"))], INDEX);
    assert.deepEqual(overlaps(model).map((p) => p[1]), [3, 6], "the two archived events overlap each other, and the live entry");
    assert.deepEqual(plain(model.entries.map((e) => [e.line, e.project, !!e.archived])), [[6, ORCHARD_WEB, false], [1, KESTREL, true], [3, KESTREL, true]]);
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
        "- [x] Fix [[Notes 🆓 Sweep|⋯]]",
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
const SMALL_NOTES = [
    note("2026-09-01", [
        "- [x] Charts [[Orchard Lane Web 2026|⭕]]", "\t- 9:00am - 9:50am", "\t- 1:00pm - 1:10pm: 🆓 fix | pipe",
        "- [x] Contract [[Orchard Lane 2026|⭕]]", "\t- 2:00pm - 3:00pm",
        "- [x] Rent", "\t- 4:00pm - 4:20pm", "\t- 5:00pm - ",
    ].join("\n")),
    note("2026-10-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am\n- [x] Build [[Pinecone Studio|⭕]]\n\t- 1:00pm - 3:07pm\n- [x] Bramble [[Bramble|⭕]]\n\t- 4:00pm - 5:00pm\n- [x] Old [[Kestrel Newsletter|⭕]]\n\t- 6:00pm - 7:00pm"),
];
const SMALL = tr.build(SMALL_NOTES, MONEY_INDEX);

test("render month: that month's Problems first, then Earnings for what bills (Billable, Rate, Earned and All), then Hours", () => {
    const block = tr.render(SMALL, { kind: "period", unit: "month", key: "2026-09" }, "2026-09-13 7:00pm");
    const lines = block.split("\n");
    assert.equal(lines[0], "%% time:start %%");
    assert.equal(lines[1], "*Updated 2026-09-13 7:00pm*");
    assert.equal(lines.at(-1), "%% time:end %%");
    const earnedAt = lines.indexOf("### Earnings"), hoursAt = lines.indexOf("### Hours"), problemsAt = lines.indexOf(PROBLEMS);
    assert.ok(problemsAt === 3 && problemsAt < earnedAt && earnedAt < hoursAt, block);
    // Each row is that project's own entries, so the rows add up to All: Orchard Lane's own hour, and
    // Orchard Lane Web's on a row of its own, at its parent's rate since it has none
    assert.deepEqual(plain(lines.slice(earnedAt, hoursAt - 1)), [
        "### Earnings", "",
        "| Project | Billable | Rate | Earned |",
        "| ------- | -------: | ---: | -----: |",
        "| [[Orchard Lane 2026]] | 1.00 | $80/hr | $80.00 |",
        "| [[Orchard Lane Web 2026]] | 1.00 | $80/hr | $80.00 |",
        "| **All** | **2.00** |  | **$160.00** |",
    ]);
    assert.ok(!block.includes("↳"));
    // Time with no project is nobody's to bill: it's in Hours only
    assert.ok(lines.slice(hoursAt).some((l) => l.startsWith("| Unassigned |")), block);
    assert.ok(!block.includes("Pinecone Studio") && !block.includes("Kestrel"), "October's projects stay out");
    assert.ok(!block.includes("| Date |") && !block.includes("9:50am"), "no per-entry detail");
    assert.ok(lines.some((l) => l.startsWith("> - [[2026-09-01|9/1/26]] line 8: `- 5:00pm -` clock still running")));
    assert.ok(lines.includes("> - 1 entry has no project (see Unassigned)"));
});

test("render year: Problems first, then Earnings for the projects billed by the hour, then Hours, a column per month linking the monthly note", () => {
    const block = tr.render(SMALL, { kind: "period", unit: "year", key: "2026" }, "s");
    const lines = block.split("\n");
    const earnedAt = lines.indexOf("### Earnings"), hoursAt = lines.indexOf("### Hours"), problemsAt = lines.indexOf(PROBLEMS);
    assert.ok(problemsAt === 3 && problemsAt < earnedAt && earnedAt < hoursAt, block);
    const head = "| Project | " + tr.constructor.SHORT_MONTHS.map((m, i) => `[[2026-${String(i + 1).padStart(2, "0")}\\|${m}]]`).join(" | ") + " | 2026 |";
    assert.equal(lines[earnedAt + 2], head);
    assert.equal(lines[hoursAt + 2], head);
    const blanks = (n) => Array(n).fill("").map(() => " ").join("|");
    const earned = lines.slice(earnedAt, hoursAt), hours = lines.slice(hoursAt);
    // Sep and Oct columns (the 9th and 10th months)
    const cells = (table, name) => table.find((l) => l.startsWith(`| ${name} |`)).split(/(?<!\\)\|/).slice(2, -1).map((c) => c.trim());
    assert.ok(!earned.some((l) => l.startsWith("| [[Bramble]] |")), "a flat fee not earned yet has no row in Earnings");
    assert.deepEqual(cells(hours, "[[Bramble]]").slice(8, 10), ["", "1.00"], "but its hours show");
    assert.deepEqual(cells(earned, "[[Pinecone Studio]]").slice(8, 13), ["", "$270", "", "", "$270"]);
    // Orchard Lane's row is its own September hour only; the sub-project's rows are its own
    assert.deepEqual(cells(earned, "[[Orchard Lane 2026]]").slice(8, 13), ["$80", "", "", "", "$80"]);
    assert.deepEqual(cells(earned, "[[Orchard Lane Web 2026]]").slice(8, 13), ["$80", "$80", "", "", "$160"]);
    assert.deepEqual(cells(hours, "[[Orchard Lane Web 2026]]").slice(8, 13), ["1.25", "1.00", "", "", "2.25"]);
    assert.deepEqual(cells(hours, "Unassigned").slice(8, 13), ["0.50", "", "", "", "0.50"]);
    assert.ok(!earned.some((l) => l.startsWith("| Unassigned |")), "time nobody bills is in Hours only");
    // Kestrel Newsletter is archived and counts like any project (OBS-213): its October hour at $75
    assert.deepEqual(cells(earned, "[[Kestrel Newsletter]]").slice(8, 13), ["", "$75", "", "", "$75"]);
    assert.deepEqual(cells(earned, "**All**").slice(8, 13), ["**$160**", "**$425**", "", "", "**$585**"]);
    assert.deepEqual(cells(hours, "**All**").slice(8, 13), ["**2.75**", "**5.25**", "", "", "**8.00**"]);
});

test("render project (OBS-133): hours, Earned and effective rate, By Project only with sub-project time, then By Week with it included", () => {
    const project = tr.render(SMALL, { kind: "project", path: ORCHARD_WEB }, "s");
    // No sub-project time: no By Project, and the weeks newest first, each linking its weekly note,
    // with Total at the bottom. It bills at its parent's rate; the cap is the parent's own, so it has
    // none. With no invoices, all of Earned is unpaid. The effective rate counts the 🆓 quarter hour
    // too: $160 over 2.25 hours.
    assert.equal(project, [
        "%% time:start %%", "*Updated s*", "",
        "**Hours:**\t\t2.00 used", "**Earned:**\t\t$160.00 | $160.00 unpaid", "**Eff. rate:**\t\t$71.11/hr", "",
        "### By Week", "",
        "| Week | Exact | Total | 🆓 | Billable | Earned |",
        "| ---- | ----: | ----: | -: | -------: | -----: |",
        "| [[2026w40\\|9/27-10/3]] | 1.00 | 1.00 |  | 1.00 | $80.00 |",
        "| [[2026w36\\|8/30-9/5]] | 1.00 | 1.25 | 0.25 | 1.00 | $80.00 |",
        "| **Total** | **2.00** | **2.25** | **0.25** | **2.00** | **$160.00** |",
        "", "%% time:end %%",
    ].join("\n"));
    assert.ok(!project.includes("Orchard Lane 2026"), "a sub-project's block doesn't show its parent");
    assert.ok(!project.includes(PROBLEMS), "problems from other projects stay out, and with none there's no heading");

    // A parent with sub-project time: By Project, its own row first, and By Week including the
    // sub-project's time, so both Totals agree. Its cap counts the sub-project's billable hours too.
    const parent = tr.render(SMALL, { kind: "project", path: ORCHARD }, "s");
    assert.equal(parent, [
        "%% time:start %%", "*Updated s*", "",
        "**Hours:**\t\t3.00 used | 117.00 left", "**Earned:**\t\t$240.00 | $240.00 unpaid", "**Eff. rate:**\t\t$73.85/hr", "",
        "### By Project", "",
        "| Project | Exact | Total | 🆓 | Billable | Rate | Earned |",
        "| ------- | ----: | ----: | -: | -------: | ---: | -----: |",
        "| [[Orchard Lane 2026]] | 1.00 | 1.00 |  | 1.00 | $80/hr | $80.00 |",
        "| [[Orchard Lane Web 2026]] | 2.00 | 2.25 | 0.25 | 2.00 | $80/hr | $160.00 |",
        "| **Total** | **3.00** | **3.25** | **0.25** | **3.00** |  | **$240.00** |", "",
        "### By Week", "",
        "| Week | Exact | Total | 🆓 | Billable | Earned |",
        "| ---- | ----: | ----: | -: | -------: | -----: |",
        "| [[2026w40\\|9/27-10/3]] | 1.00 | 1.00 |  | 1.00 | $80.00 |",
        "| [[2026w36\\|8/30-9/5]] | 2.00 | 2.25 | 0.25 | 2.00 | $160.00 |",
        "| **Total** | **3.00** | **3.25** | **0.25** | **3.00** | **$240.00** |",
        "", "%% time:end %%",
    ].join("\n"));

    // A flat fee: its hours aren't billed one by one, so Exact and Total only, and every hour counts
    // against the cap; the fee over the hours is its effective rate
    const flat = tr.render(SMALL, { kind: "project", path: "20 Projects/Freelance/Bramble/Bramble.md" }, "s").split("\n");
    assert.deepEqual(flat.slice(3, 7), ["**Hours:**\t\t1.00 used | 35.00 left", "**Flat fee:**\t\t$640", "**Eff. rate:**\t\t$640.00/hr", ""]);
    assert.ok(flat.includes("| Week | Exact | Total |") && flat.includes("| **Total** | **1.00** | **1.00** |"), flat.join("\n"));
    // A name shared with another note links by full path instead
    const shared = tr.render(SMALL, { kind: "project", path: ORCHARD_WEB, linkTarget: (unit, key) => (key === "2026w36" ? `Reference/Planner/weeks/${key}` : key) }, "s");
    assert.ok(shared.includes("| [[Reference/Planner/weeks/2026w36\\|8/30-9/5]] |") && shared.includes("| [[2026w40\\|9/27-10/3]] |"));
});

test("render project (OBS-133): past 13 weeks a project reports by month; earlier years are a row each, linking their notes", () => {
    const at = (date, from = "9:00am", to = "10:00am") => note(date, `- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- ${from} - ${to}`);
    const by = (notes, linkTarget) => tr.render(tr.build(notes, MONEY_INDEX), { kind: "project", path: ORCHARD_WEB, linkTarget }, "s").split("\n");
    // 9/6 to 12/5 is 13 weeks: still weeks
    assert.ok(by([at("2026-09-06"), at("2026-12-05")]).includes("### By Week"));
    // 9/6 to 12/6 is 14: months, newest first, with Total at the bottom
    const months = by([at("2026-09-06"), at("2026-12-06"), at("2026-12-07")]);
    assert.ok(!months.includes("### By Week"));
    const table = months.slice(months.indexOf("### By Month") + 2);
    assert.deepEqual(table.slice(0, 7), [
        "| Month | Exact | Total | 🆓 | Billable | Earned |",
        "| ----- | ----: | ----: | -: | -------: | -----: |",
        "| [[2026-12\\|December 2026]] | 2.00 | 2.00 |  | 2.00 | $160.00 |",
        "| [[2026-09\\|September 2026]] | 1.00 | 1.00 |  | 1.00 | $80.00 |",
        "| **Total** | **3.00** | **3.00** |  | **3.00** | **$240.00** |",
        "", "%% time:end %%",
    ]);
    // Into the next year: that year's months, then a row for each year before it, newest first
    const years = by([at("2025-03-02"), at("2025-11-03"), at("2026-01-05"), at("2026-02-02"), at("2027-01-04", "1:00pm", "1:30pm")],
        (unit, key) => (unit === "year" ? `Reference/Planner/years/${key}` : key));
    const rows = years.slice(years.indexOf("### By Month") + 4, years.indexOf("%% time:end %%") - 1);
    assert.deepEqual(rows, [
        "| [[2027-01\\|January 2027]] | 0.50 | 0.50 |  | 0.50 | $40.00 |",
        "| [[Reference/Planner/years/2026\\|2026]] | 2.00 | 2.00 |  | 2.00 | $160.00 |",
        "| [[Reference/Planner/years/2025\\|2025]] | 2.00 | 2.00 |  | 2.00 | $160.00 |",
        "| **Total** | **4.50** | **4.50** |  | **4.50** | **$360.00** |",
    ]);
    // A year linked by its own name needs no alias
    assert.ok(by([at("2025-03-02"), at("2026-11-03")]).includes("| [[2025]] | 1.00 | 1.00 |  | 1.00 | $80.00 |"));
});

// ------------------------------------------------------------------ Invested (OBS-156)

const VALUE_INDEX = tr.makeIndex([
    { path: "P/Research/Research.md", tags: ["area"], props: { rate: 60, rate_type: "non-billable" } },
    { path: "P/Client/Client.md", tags: ["project"], props: { rate: 100, rate_type: "hourly", max_hours: 2 } },
    { path: "P/Client/Lab/Lab.md", tags: ["project"], props: { rate: 40, rate_type: "non-billable" } },
    { path: "P/Client/Comp/Comp.md", tags: ["project"], props: { rate_type: "non-billable" } },
    { path: "P/Volunteer/Volunteer.md", tags: ["project"], props: { rate_type: "non-billable" } },
    { path: "P/Volunteer/Paid/Paid.md", tags: ["project"], props: { rate: 30 } },
    { path: "P/Studio/Studio.md", tags: ["project"], props: { rate: 50, rate_type: "non-billable" } },
    { path: "P/Studio/Sketch/Sketch.md", tags: ["project"] },
    { path: "P/Studio/Notes/Notes.md", tags: ["project"], props: { rate_type: "non-billable" } },
    { path: "P/Studio/Gig/Gig.md", tags: ["project"], props: { rate_type: "hourly" } },
]);
const VALUED = tr.build([note("2026-09-01", [
    "- [x] Prototype [[Research|🗃️]]", "\t- 9:00am - 10:10am",
    "- [x] Build [[Client|⭕]]", "\t- 10:30am - 11:30am", "\t- 3:00pm - 4:15pm",
    "- [x] Experiment [[Lab|⭕]]", "\t- 1:00pm - 1:30pm",
    "- [x] Redo at no charge [[Comp|⭕]]", "\t- 2:00pm - 2:30pm",
    "- [x] Flyers [[Volunteer|⭕]]", "\t- 5:00pm - 5:30pm",
    "- [x] Signs [[Paid|⭕]]", "\t- 6:00pm - 6:30pm",
    "- [x] Sketches [[Sketch|⭕]]", "\t- 7:00pm - 7:20pm",
    "- [x] Write up [[Notes|⭕]]", "\t- 8:00pm - 8:30pm",
    "- [x] Paid gig [[Gig|⭕]]", "\t- 9:00pm - 9:30pm",
].join("\n"))], VALUE_INDEX);

test("OBS-156 money: a rate on a non-billable note values its time; a non-billable sub-project doesn't take its client's rate", () => {
    const money = (p) => plain(VALUED.money.get(`P/${p}/${p.split("/").pop()}.md`));
    assert.deepEqual(money("Research"), { rate: null, type: "non-billable", label: "$60/hr non-billable", capMinutes: null, invest: 60, fee: null, earned: null });
    assert.deepEqual(money("Client/Lab"), { rate: null, type: "non-billable", label: "$40/hr non-billable", capMinutes: null, invest: 40, fee: null, earned: null });
    assert.deepEqual(money("Client/Comp"), { rate: null, type: "non-billable", label: "non-billable", capMinutes: null, invest: null, fee: null, earned: null });
    assert.equal(money("Studio/Sketch").invest, 50, "a sub-project of a valued project takes its rate, as it takes its type");
    assert.equal(money("Studio/Notes").invest, 50, "and so does one that says non-billable itself");
    // One that bills never bills at a valuation rate: it has no rate of its own, so no Earned, and says so
    assert.deepEqual([money("Studio/Gig").rate, money("Studio/Gig").label, billing.hourly("P/Studio/Gig/Gig.md", VALUED)], [null, "hourly", false]);
    assert.equal(money("Volunteer/Paid").invest, 30);
    // Nothing valued is billable, so Invoice never bills it
    for (const p of ["P/Research/Research.md", "P/Client/Lab/Lab.md", "P/Studio/Sketch/Sketch.md"]) assert.equal(billing.hourly(p, VALUED), false, p);
    assert.ok(VALUED.entries.filter((e) => VALUED.money.get(e.project).invest).every((e) => !e.billable));
    // Priced like Earned, a day and a rate at a time, on rounded hours: 1:10 → 1:15 at $60, 0:20 → 0:30 at $50
    const t = tr.totals(VALUED.entries, VALUED.money);
    assert.equal(t.invested, 7500 + 2000 + 1500 + 2500 + 2500);
    assert.equal(t.cents, 22500, "and never counts as Earned");
    // Only an own rate under an inherited non-billable is asked about; an own non-billable with a rate isn't
    assert.deepEqual(plain(VALUED.projectProblems.map((p) => [tr.basename(p.project), p.message])).sort(), [
        ["Gig", "is hourly but has no `rate`, so it has no Earned"],
        ["Paid", "has its own `rate` but inherits `non-billable`, so its time counts as 🆓; give it a `rate_type` of its own"],
    ]);
});

test("OBS-156 render: Rate and Invested after Exact and Total; a mixed By Project table has the full set; Earned leaves Invested out", () => {
    const render = (p) => tr.render(VALUED, { kind: "project", path: p }, "s").split("\n");
    // A valued area: no summary (it doesn't bill and has no cap), Invested by month
    assert.deepEqual(render("P/Research/Research.md").slice(3), [
        "### By Month", "",
        "| Month | Exact | Total | Invested |", "| ----- | ----: | ----: | -------: |",
        "| [[2026-09\\|September 2026]] | 1.17 | 1.25 | $75.00 |",
        "| **Total** | **1.17** | **1.25** | **$75.00** |", "", "%% time:end %%",
    ]);
    // A client project with a non-billable sub-project of each kind; its cap counts billable hours only,
    // and its effective rate every hour: $225 over 3.25
    const client = render("P/Client/Client.md");
    assert.deepEqual(client.slice(3), [
        "**Hours:**\t\t2.25 used | 0.25 over", "**Earned:**\t\t$225.00 | $225.00 unpaid", "**Eff. rate:**\t\t$69.23/hr", "",
        "### By Project", "",
        "| Project | Exact | Total | 🆓 | Billable | Rate | Earned | Invested |",
        "| ------- | ----: | ----: | -: | -------: | ---: | -----: | -------: |",
        "| [[Client]] | 2.25 | 2.25 |  | 2.25 | $100/hr | $225.00 |  |",
        "| [[Comp]] | 0.50 | 0.50 | 0.50 |  | non-billable |  |  |",
        "| [[Lab]] | 0.50 | 0.50 | 0.50 |  | $40/hr non-billable |  | $20.00 |",
        "| **Total** | **3.25** | **3.25** | **1.00** | **2.25** |  | **$225.00** | **$20.00** |", "",
        "### By Week", "",
        "| Week | Exact | Total | 🆓 | Billable | Earned | Invested |",
        "| ---- | ----: | ----: | -: | -------: | -----: | -------: |",
        "| [[2026w36\\|8/30-9/5]] | 3.25 | 3.25 | 1.00 | 2.25 | $225.00 | $20.00 |",
        "| **Total** | **3.25** | **3.25** | **1.00** | **2.25** | **$225.00** | **$20.00** |",
        "", "%% time:end %%",
    ]);
    // Non-billable throughout: Exact and Total, then Rate and Invested where a row is valued; no summary
    const volunteer = render("P/Volunteer/Volunteer.md");
    assert.deepEqual(volunteer.slice(3, 6), [PROBLEMS,
        "> - [[Paid]] has its own `rate` but inherits `non-billable`, so its time counts as 🆓; give it a `rate_type` of its own", ""], "Problems first, as a callout (OBS-167)");
    assert.deepEqual(volunteer.slice(6, 13), [
        "### By Project", "",
        "| Project | Exact | Total | Rate | Invested |",
        "| ------- | ----: | ----: | ---: | -------: |",
        "| [[Volunteer]] | 0.50 | 0.50 | non-billable |  |",
        "| [[Paid]] | 0.50 | 0.50 | $30/hr non-billable | $15.00 |",
        "| **Total** | **1.00** | **1.00** |  | **$15.00** |",
    ]);
    assert.ok(volunteer.includes("| **Total** | **1.00** | **1.00** | **$15.00** |"), "By Week has no Rate column");
    // Nor do the yearly note's Earned table and the period tables count it as Earned
    const year = tr.render(VALUED, { kind: "period", unit: "year", key: "2026" }, "s");
    assert.ok(year.includes("| [[Research]] |") && !year.includes("$75"), year);
    const month = tr.render(VALUED, { kind: "period", unit: "month", key: "2026-09" }, "s");
    const earned = month.slice(month.indexOf("### Earnings"), month.indexOf("### Hours"));
    assert.ok(month.includes("| [[Research]] |") && !earned.includes("[[Research]]") && !earned.includes("non-billable"), month);
    assert.ok(earned.includes("| **All** | **2.75** |  | **$225.00** |"), month);
    // A timesheet of a valued project shows no money, as before
    assert.ok(!tr.render(VALUED, { kind: "timesheet", path: "P/Client/Lab/Lab.md" }, "s").includes("$"));
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
    assert.deepEqual(money("P/Parent/Parent.md"), { rate: 1250.5, type: "hourly", label: "$1,250.50/hr", capMinutes: null, invest: null, fee: null, earned: null });
    // Child's own non-billable type wins; the parent's rate still shows in its label only for hourly/flat
    assert.deepEqual(money("P/Parent/Child/Child.md"), { rate: null, type: "non-billable", label: "non-billable", capMinutes: null, invest: null, fee: null, earned: null });
    assert.deepEqual(money("P/Parent/Kid/Kid.md"), { rate: 1250.5, type: "hourly", label: "$1,250.50/hr", capMinutes: null, invest: null, fee: null, earned: null });
    assert.deepEqual(money("P/Flat/Flat.md"), { rate: null, type: "flat", label: "$640 flat", capMinutes: null, invest: null, fee: 640, earned: null });
    assert.deepEqual(money("P/Task/Task.md"), { rate: null, type: "by-task", label: "by-task", capMinutes: 750, invest: null, fee: null, earned: null });
    assert.deepEqual(money("P/Bare/Bare.md"), { rate: 80, type: "hourly", label: "$80/hr", capMinutes: null, invest: null, fee: null, earned: null });
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
    // placeBlock has no cursor option any more; whatever note is open, a new block goes under ## Time Report
    const content = "- [x] one\n\t- 9:00am - 10:00am\n- [ ] two\n\n## Notes\n";
    assert.equal(apply(content, tr.placeBlock(content, BLOCK, { cursorLine: 1 })),
        "- [x] one\n\t- 9:00am - 10:00am\n- [ ] two\n\n## Notes\n\n## Time Report\n\n" + BLOCK + "\n");
});

test("placeBlock: under a heading at the end of a project note", () => {
    for (const [content, expected] of [
        ["---\ntags: [project]\n---\nIntro", "---\ntags: [project]\n---\nIntro\n\n## Time report\n\n" + BLOCK + "\n"],
        ["Intro\n", "Intro\n\n## Time report\n\n" + BLOCK + "\n"],
        ["Intro\n\n\n", "Intro\n\n\n## Time report\n\n" + BLOCK + "\n"],
        ["", "## Time report\n\n" + BLOCK + "\n"],
    ]) {
        assert.equal(apply(content, tr.placeBlock(content, BLOCK, { heading: "## Time report" })), expected);
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
    const once = apply(content, tr.placeBlock(content, BLOCK, { heading: "## Time report" }));
    assert.equal(once, `${content}\n\n## Time report\n\n${BLOCK}\n`);
    const again = apply(once, tr.placeBlock(once, BLOCK.replace("new", "newer"), { heading: "## Time report" }));
    assert.ok(again.startsWith(`${content}\n\n## Time report\n\n`));
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
    const insert = "## Time report\n\n- b\n\t- b1";
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

test("toggleEntry: several running entries under the task ask which, labelled with the task; a sub-task's is the task's too (OBS-193)", () => {
    const lines = ["- [ ] Charts [[Orchard Lane Web 2026|⭕]]", "\t- 9:00am - : draft", "\t- Prep", "\t\t- 10:30am - ", "\t- [ ] Legend", "\t\t- 10:45am - ", "- [ ] b"];
    // an entry under a plain bullet, and one under a sub-task, are the task's (rule 5)
    assert.deepEqual(plain(tr.toggleEntry(lines, 0, "11:00am").choose),
        [{ line: 1, label: "Stop 9:00am: Charts ⭕" }, { line: 3, label: "Stop 10:30am: Charts ⭕" }, { line: 5, label: "Stop 10:45am: Charts ⭕" }]);
    // from the sub-task's line the question is the same
    assert.deepEqual(plain(tr.toggleEntry(lines, 4, "11:00am").choose).map((c) => c.line), [1, 3, 5]);
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
    // from a note under a sub-task, the task at the top of the nest is the one timed: its entry goes above
    // the sub-task, and its box, already [/], is left alone (OBS-193)
    const fromNote = tr.toggleEntry(lines, 5, "9:01am");
    assert.equal(fromNote.status, undefined);
    assert.deepEqual(edit(lines, fromNote.edit).slice(3, 6), ["- [/] Started", "\t- 9:01am - ", "\t- [ ] Subtask"]);
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

test("a sub-task's timer is its task's: the clock runs under the top of the nest, and the dropdown lists top lines only (OBS-193, rule 5)", () => {
    const lines = ["- [ ] Chores", "\t- 2:35pm - 2:36pm", "\t- [/] Laundry", "\t\t- 2:57pm - 2:58pm", "\t- [/] Espresso", "\t\t- 3:20pm - ", "- [ ] Next"];
    // the running clock under Espresso is Chores', so Chores isn't offered as a task; the sub-tasks never are
    assert.deepEqual(plain(tr.toggleChoices(lines)).map((c) => c.label), ["⏱ Stop 3:20pm: Chores", "Next"]);
    // ⌘T on Chores, or on either sub-task, stops that one clock
    for (const cursor of [0, 2, 4, 3]) assert.deepEqual([tr.toggleEntry(lines, cursor, "3:50pm").action, tr.toggleEntry(lines, cursor, "3:50pm").edit.line], ["stop", 5], `cursor on ${cursor}`);
    assert.match(tr.startEntry(lines, 4, "3:50pm").error, /since 3:20pm/, "no second clock under the task");
    // stopped, ⌘T on a sub-task starts the task's clock, above its first sub-task
    const stopped = edit(lines, tr.toggleEntry(lines, 4, "3:50pm").edit);
    const start = tr.toggleEntry(stopped, 4, "4:00pm");
    assert.equal(start.action, "start");
    assert.deepEqual(edit(stopped, start.edit).slice(0, 4), ["- [ ] Chores", "\t- 2:35pm - 2:36pm", "\t- 4:00pm - ", "\t- [/] Laundry"]);
    assert.deepEqual(plain(start.status), { line: 0, text: "- [/] Chores" });
    assert.equal(start.summary, "Started 4:00pm: Chores");
});

test("startEntry: a task's own entry goes above its first sub-task, after its end time, entries and notes", () => {
    const lines = ["- [ ] Chores", "\t- 2:35pm - 2:36pm", "\t- Goal: tidy", "\t- [/] Laundry", "\t\t- 2:37pm - 2:37pm", "\t- [x] Litter", "- [ ] Next"];
    const start = tr.toggleEntry(lines, 0, "3:00pm");
    assert.deepEqual(edit(lines, start.edit), ["- [ ] Chores", "\t- 2:35pm - 2:36pm", "\t- Goal: tidy", "\t- 3:00pm - ", "\t- [/] Laundry", "\t\t- 2:37pm - 2:37pm", "\t- [x] Litter", "- [ ] Next"]);
    assert.deepEqual(plain(start.edit.cursor), { line: 3, ch: "\t- 3:00pm - ".length });
    // with only sub-tasks, the entry is the first line under the task
    const only = ["- [ ] Chores", "\t- [ ] Laundry", "\t\t- note"];
    assert.deepEqual(edit(only, tr.startEntry(only, 0, "3:00pm")), ["- [ ] Chores", "\t- 3:00pm - ", "\t- [ ] Laundry", "\t\t- note"]);
    // from a sub-task, the entry is the task's too, in the same place (OBS-193)
    assert.deepEqual(edit(lines, tr.startEntry(lines, 3, "3:00pm")), edit(lines, start.edit));
    // once stopped, the report reads the new entry as the parent's
    const started = edit(lines, start.edit);
    const stopped = edit(started, tr.toggleEntry(started, 0, "3:30pm").edit).join("\n");
    assert.deepEqual(entriesOf(stopped).entries.map((e) => [e.task, e.minutes]).slice(0, 2), [["Chores", 1], ["Chores", 30]]);
    // a closed note's folds: the task's fold takes it in, the sub-tasks' folds move down
    const folds = tr.foldsAfterInsert([{ from: 0, to: 5 }, { from: 3, to: 4 }], lines, start.edit.from.line, "\t- 3:00pm - ");
    assert.deepEqual(plain(folds), [{ from: 0, to: 6 }, { from: 4, to: 5 }]);
});

test("lineCursor: after the dash on a running entry, else the end of the line", () => {
    const lines = ["- [ ] Task [[Note|⋯]]", "\t- 9:00am - ", "\t- 8:00am - 8:30am"];
    assert.deepEqual(plain(tr.lineCursor(lines, 0)), { line: 0, ch: lines[0].length });
    assert.deepEqual(plain(tr.lineCursor(lines, 1)), { line: 1, ch: lines[1].length });
    assert.deepEqual(plain(tr.lineCursor(["\t- 9:00am -: x"], 0)), { line: 0, ch: "\t- 9:00am -".length });
    assert.deepEqual(plain(tr.lineCursor(lines, 2)), { line: 2, ch: lines[2].length });
    assert.deepEqual(plain(tr.lineCursor(["- 9:00am - %%billable%%"], 0)), { line: 0, ch: "- 9:00am - ".length });
});

test("taskChoices offers top lines only: a sub-task, or a checkbox nested under an entry, is its task's (OBS-14, OBS-193)", () => {
    const lines = ["- [ ] Parent", "\t- 9:00am - 9:30am", "\t\t- [ ] follow up", "\t- [ ] Subtask", "- Plain", "\t- [ ] Under a plain bullet only"];
    assert.deepEqual(plain(tr.toggleChoices(lines)).map((c) => c.label), ["Parent", "Under a plain bullet only"], "a checklist line under nothing but plain bullets is top-level");
});

test("the timer on a sub-task: the clock starts under its task, above the sub-task, and the task is marked [/]; on the sub-task again it stops (OBS-193)", () => {
    const lines = ["- [ ] Test the timer", "\t- [ ] A sub-step"];
    const start = tr.toggleEntry(lines, 1, "9:01am");
    assert.equal(start.action, "start");
    assert.deepEqual(plain(start.status), { line: 0, text: "- [/] Test the timer" });
    assert.equal(start.summary, "Started 9:01am: Test the timer");
    const running = edit(lines, start.edit);
    assert.deepEqual(running, ["- [ ] Test the timer", "\t- 9:01am - ", "\t- [ ] A sub-step"]);
    assert.deepEqual(plain(tr.taskChoices(lines)), [{ line: 0, label: "Test the timer" }], "the dropdown lists the task, not the sub-step");
    assert.deepEqual(plain(tr.taskChoices(running)), [], "and not a task whose clock is running");
    const stop = tr.toggleEntry(running, 2, "9:30am");
    assert.equal(stop.action, "stop");
    assert.deepEqual(edit(running, stop.edit)[1], "\t- 9:01am - 9:30am");
    assert.equal(stop.summary, "Stopped 9:01am - 9:30am: Test the timer");
    // Under an event, the entry goes under the event, after its end line and above the sub-task
    const event = ["- [<] 9:00am\tStandup", "\t- 9:20am", "\t- [ ] Bring the sitemap"];
    const under = tr.toggleEntry(event, 2, "9:05am");
    assert.equal(under.status, undefined, "an event's box never changes");
    assert.deepEqual(edit(event, under.edit), ["- [<] 9:00am\tStandup", "\t- 9:20am", "\t- 9:05am - ", "\t- [ ] Bring the sitemap"]);
    // Under a meeting line in the form used before August 2025, the same
    const meeting = ["11:00am [[Team Meeting]]", "\t- [ ] Action item"];
    assert.deepEqual(edit(meeting, tr.toggleEntry(meeting, 1, "11:05am").edit), ["11:00am [[Team Meeting]]", "\t- 11:05am - ", "\t- [ ] Action item"]);
});

test("anchorLine: the top of the nest for any line under a task or event; -1 off any (OBS-193)", () => {
    const lines = ["- [ ] Task", "\t- [ ] Sub", "\t\t- 9:00am - ", "\t\t- note", "- Plain", "\t- note", "\t- [ ] Box", "Text", "", "11:00am [[Team Meeting]]", "\t- 11:00am - 11:30am"];
    assert.deepEqual([0, 1, 2, 3].map((i) => tr.anchorLine(lines, i)), [0, 0, 0, 0]);
    assert.deepEqual([4, 5, 7, 8, 99].map((i) => tr.anchorLine(lines, i)), [-1, -1, -1, -1, -1]);
    assert.equal(tr.anchorLine(lines, 6), 6, "a checklist line under nothing but plain bullets is its own top");
    assert.deepEqual([9, 10].map((i) => tr.anchorLine(lines, i)), [9, 9], "an older meeting line anchors its entries");
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
        { path: "P/A.md", tags: ["project"], parent: "[[B]]" },
        { path: "P/B.md", tags: ["project"], parent: "[[A]]" },
    ]);
    const model = tr.build([note("2026-09-01", "- [x] Work [[A|⭕]]\n\t- 9:00am - 11:00am\n- [x] More [[B|⭕]]\n\t- 1:00pm - 2:00pm")], index);
    const loops = model.projectProblems.filter((p) => !p.message);
    assert.equal(loops.length, 1);
    const month = tr.render(model, { kind: "period", unit: "month", key: "2026-09" }, "s");
    assert.ok(month.includes("| **All** | **3.00** |"), month);
    // The loop is reported on the project notes involved
    assert.ok(tr.render(model, { kind: "project", path: loops[0].project }, "s").includes("are each inside the other"));
    const a = tr.render(model, { kind: "project", path: "P/A.md" }, "s");
    const b = tr.render(model, { kind: "project", path: "P/B.md" }, "s");
    // The project's whole total: the Total column of its By Week table's Total row
    const total = (block) => block.split("\n").filter((l) => l.startsWith("| **Total** |")).at(-1).split(/(?<!\\)\|/)[3].replace(/\*/g, "").trim();
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
        "- [x] Pay the phone bill [[Pay the phone bill|⋯]] [[2026-09-14|🚩 9/14]]",
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
    assert.equal(apply(example, tr.placeBlock(example, BLOCK, { heading: "## Time report" })),
        example + "\n\n## Time report\n\n" + BLOCK + "\n");
    const daily = "```\n%% time:start %%\n```\n- [x] Task\n\t- 9:00am - 10:00am";
    assert.equal(entriesOf(daily).entries.length, 1);
});

test("review: a new block never lands inside a code block", () => {
    const code = "Intro\n```js\n## Time report\n```\nAfter";
    assert.equal(apply(code, tr.placeBlock(code, BLOCK)), code + "\n\n## Time Report\n\n" + BLOCK + "\n");
    // Nor is the old heading in one renamed
    assert.equal(tr.renameHeading("Intro\n```js\n## Time tracking\n```\nAfter"), null);
});

test("review: an existing ## Time report heading is reused", () => {
    const content = "Intro\n\n## Time report\n\nMy own note about hours\n\n## Invoices\n\n| a |";
    assert.equal(apply(content, tr.placeBlock(content, BLOCK, { heading: "## Time report" })),
        "Intro\n\n## Time report\n\n" + BLOCK + "\n\nMy own note about hours\n\n## Invoices\n\n| a |");
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
    const multi = tr.build([note("2026-09-01", "- [ ] Task A [[ProjA|⭕]]\n\t- 9:00am - 10:00am\n- [ ] Task B [[ProjB|⭕]] %% private\nstill private %%\n\t- 11:00am - 12:00pm")], index);
    assert.deepEqual(plain(multi.entries.map((e) => [e.task, e.project])), [["Task A", "P/ProjA.md"], ["Task B", "P/ProjB.md"]]);
    const html = tr.build([note("2026-09-01", "- [ ] Task A [[ProjA|⭕]]\n\t- 9:00am - 10:00am\n- [ ] Task B [[ProjB|⭕]] <!-- private\n-->\n\t- 11:00am - 12:00pm")], index);
    assert.deepEqual(plain(html.entries.map((e) => e.project)), ["P/ProjA.md", "P/ProjB.md"]);
    const inline = tr.build([note("2026-09-01", "- [ ] Task %%was [[ProjB|⭕]]%% [[ProjA|⭕]]\n\t- 9:00am - 10:00am")], index);
    assert.deepEqual(plain(inline.entries.map((e) => [e.task, e.project])), [["Task", "P/ProjA.md"]]);
    assert.deepEqual(entriesOf("- [x] Task\n\t- %%10:00am - 11:00am%%").problems, []);
});

test("re-review: an unclosed code block or comment stops a new block, so runs don't pile up copies", () => {
    for (const content of ["Intro\n```\ncode", "- [ ] task\n%% draft"]) {
        assert.match(tr.placeBlock(content, BLOCK, { heading: "## Time report" }).error, /never closes/);
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

test("overview review, reversed by OBS-213: an archived ⭕ counts like a live one, the nearest first", () => {
    const index = tr.makeIndex([
        { path: "P/Live/Live.md", tags: ["project"] },
        { path: "Archive/Old/Old.md", tags: ["project"] },
    ]);
    const model = tr.build([note("2026-09-01", "- [ ] work [[Live|⭕]]\n\t- [x] follow-up [[Old|⭕]]\n\t\t- 9:00am - 10:00am\n- [ ] only [[Old|⭕]]\n\t- 11:00am - 12:00pm")], index);
    // As with two live projects, the sub-task's own ⭕ wins over its task's until OBS-196 reads the top line
    assert.deepEqual(plain(model.entries.map((e) => [e.project, e.minutes, !!e.archived])), [["Archive/Old/Old.md", 60, true], ["Archive/Old/Old.md", 60, true]]);
    // Archived or live, the same reading, so archiving Old moves no time; a ⭕ under another isn't a disagreement on one line
    assert.deepEqual(plain(model.problems), []);
});

test("overview review: rate and rate_type are inherited separately; bad or missing rates are Problems", () => {
    const index = tr.makeIndex([
        { path: "P/Par/Par.md", tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
        { path: "P/Par/Typed/Typed.md", tags: ["project"], props: { rate: "", rate_type: "hourly" } },
        { path: "P/Par/Zero/Zero.md", tags: ["project"], props: { rate: 0 } },
        { path: "P/Par/Tbd/Tbd.md", tags: ["project"], props: { rate: "TBD" } },
        { path: "P/Alone/Alone.md", tags: ["project"], props: { rate_type: "hourly" } },
        { path: "Archive/Arch/Arch.md", tags: ["project"], props: { rate: 75, rate_type: "hourly" } },
        { path: "P/Sub/Sub.md", tags: ["project"], parent: "[[Arch]]" },
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
    assert.ok(tr.render(model, { kind: "project", path: "P/Par/Zero/Zero.md" }, "s").includes("- [[Zero]] has a `rate` that isn't a positive number (0), so it has no Earned"));
    assert.ok(tr.render(model, { kind: "project", path: "P/Alone/Alone.md" }, "s").includes("- [[Alone]] is hourly but has no `rate`, so it has no Earned"));
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
    assert.ok(block.includes("| [[Hour]] | 1.00 | $100/hr | $100.00 |"), block);
});

test("overview review: quotes cut on whole characters; a differently-cased heading is reused", () => {
    const text = "- [x] Task\n\t- 9:00 - 10:00am " + "x".repeat(58) + "🆓🆓🆓 tail";
    const block = tr.render(tr.build([note("2026-09-01", text)], INDEX), { kind: "period", unit: "month", key: "2026-09" }, "s");
    assert.ok(!block.includes("�") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(block));
    assert.ok(tr.sameBlock(`x\n${block}`, tr.render(tr.build([note("2026-09-01", text)], INDEX), { kind: "period", unit: "month", key: "2026-09" }, "t")));
    const content = "Intro\n\n## Time Report\n\nEnd";
    assert.equal(apply(content, tr.placeBlock(content, BLOCK)), "Intro\n\n## Time Report\n\n" + BLOCK + "\n\nEnd");
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
    assert.ok(week.includes("| [[Pinecone Studio]] | 2.25 | $120/hr | $270.00 |"), week);
    // A flat fee not earned yet: no billable hours, and N/A for Earned, so All is the hourly work's
    assert.ok(week.includes("| [[Bramble]] | – | $640 flat | N/A |"));
    assert.ok(week.includes("| **All** | **2.25** |  | **$270.00** |"));
    assert.ok(!week.includes("Orchard"), "entries from other weeks stay out");
    assert.ok(week.includes("line 4: `- 4:00pm -` clock still running"), "the week's own problems are listed");

    // A single project still gets its total row at the bottom
    const oct = tr.render(model, { kind: "period", unit: "month", key: "2026-10" }, "s");
    assert.ok(oct.includes("| [[Orchard Lane Web 2026]] | 1.00 | $80/hr | $80.00 |"), oct);
    assert.ok(oct.includes("| **All** | **1.00** |  | **$80.00** |"));
    // Nothing to say: no Problems heading (OBS-133)
    assert.match(oct, /### Earnings\n[^#]*\| \*\*All\*\* [^\n]*\|\n\n### Hours\n[^#]*\|\n\n%% time:end %%$/);
    assert.ok(!oct.includes(PROBLEMS));
    // A period with no entries says so under Hours, and has no Earned
    const empty = tr.render(model, { kind: "period", unit: "week", key: "2026w39" }, "s");
    assert.match(empty, /### Hours\n\nNo time entries\.\n%% time:end %%$/);
    assert.ok(!empty.includes("### Earnings"));

    const year = tr.render(model, { kind: "period", unit: "year", key: "2026" }, "s");
    assert.ok(year.includes("### Earnings") && year.includes("### Hours"));
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
    const content = `${tr.periodFrontmatter("week", "2026w37")}## Time report\n\n${block}\n`;
    // Refreshing it later replaces just that block, and an unchanged block isn't rewritten
    assert.ok(tr.sameBlock(content, tr.render(model, { kind: "period", unit: "week", key: "2026w37" }, "later")));
    const plan = tr.placeBlock(content, block);
    assert.equal(plan.inserted, false);
});

test("a blank line always sits above ## Time report, so there's room to add tasks at the top", () => {
    const fix = (content) => { const e = tr.blankLineAbove(content); return e ? apply(content, e) : content; };
    // What the frontmatter repair left in 2026-05, 2026-07, 2026-08
    assert.equal(fix(`---\naliases: May 2026\n---\n## Time report\n\n${BLOCK}\n`), `---\naliases: May 2026\n---\n\n## Time report\n\n${BLOCK}\n`);
    // Tasks typed right up against the heading
    assert.equal(fix("- [ ] one\n- [ ] two\n## Time report\n"), "- [ ] one\n- [ ] two\n\n## Time report\n");
    // Heading on the first line of a note without frontmatter
    assert.equal(fix("## Time report\n\nx"), "\n## Time report\n\nx");
    // Already right, no heading, or the heading only inside a code block: nothing to do
    for (const ok of ["- [ ] a\n\n## Time report\n", "---\nx: 1\n---\n\n## Time report", "No report here", "```\n## Time report\n```"]) {
        assert.equal(tr.blankLineAbove(ok), null, ok);
    }
    // Windows line endings keep theirs
    assert.equal(fix("- [ ] a\r\n## Time report\r\n"), "- [ ] a\r\n\r\n## Time report\r\n");
    // Folds below move down with the added line
    const content = "- [ ] a\n\t- b\n## Time report\n\n%% time:start %%\nx\n%% time:end %%";
    const e = tr.blankLineAbove(content);
    assert.deepEqual(plain(tr.shiftFolds([{ from: 0, to: 1 }, { from: 2, to: 6 }], content, e.start, e.end, e.text)), [{ from: 0, to: 1 }, { from: 3, to: 7 }]);
});


test("OBS-133: the old ## Time tracking heading, or ## Time report in another case, right above a block is renamed ## Time Report, never added twice", () => {
    const old = (body, heading = "## Time tracking") => `---\ntags: project\n---\nIntro\n\n${heading}\n\n${body}\n`;
    const write = (content, block = BLOCK) => { const edits = tr.blockEdits(content, block); return edits.error ? edits : edits.reduce(apply, content); };
    // A block under it: renamed in place, the block refreshed below it
    const once = write(old("%% time:start %%\nold\n%% time:end %%"));
    assert.equal(once, `---\ntags: project\n---\nIntro\n\n## Time Report\n\n${BLOCK}\n`);
    assert.deepEqual(plain(tr.blockEdits(once, BLOCK)), [], "and the next run has nothing to do");
    // The same block, its heading still old: only the heading changes
    assert.deepEqual(plain(tr.blockEdits(old(BLOCK), BLOCK).map((e) => e.text)), ["## Time Report"]);
    // "## Time report", as the first test round of OBS-133 wrote it, is title-cased the same way
    assert.deepEqual(plain(tr.blockEdits(old(BLOCK, "## Time report"), BLOCK).map((e) => e.text)), ["## Time Report"]);
    assert.equal(tr.renameHeading(old(BLOCK, "## Time Report")), null);
    // Any case, blank or hidden lines between (and a heading on the first line gets its blank line above)
    assert.equal(write("## Time Tracking\n\n%% a comment %%\n\n%% time:start %%\nx\n%% time:end %%"), `\n## Time Report\n\n%% a comment %%\n\n${BLOCK}`);
    // Not when something of yours sits between the heading and the block: that heading is yours
    const mine = "## Time tracking\n\nMy notes\n\n%% time:start %%\nx\n%% time:end %%";
    assert.equal(tr.renameHeading(mine), null);
    assert.equal(write(`Intro\n\n${mine}`), `Intro\n\n## Time tracking\n\nMy notes\n\n${BLOCK}`);
    // No block yet: the block goes under the old heading, renamed, rather than under a second one
    assert.equal(write("Intro\n\n## Time tracking\n\nEnd"), `Intro\n\n## Time Report\n\n${BLOCK}\n\nEnd`);
    // ...unless the note already has the new heading, in any case, which wins and the old one is left alone
    assert.equal(write("Intro\n\n## Time tracking\n\n## Time report\n"), `Intro\n\n## Time tracking\n\n## Time Report\n\n${BLOCK}\n`);
    // A "## Time Report" of your own elsewhere, in any case: the heading over the block stays, rather than make two
    assert.equal(tr.renameHeading("## Time report\n\nMine\n\n## Time tracking\n\n%% time:start %%\nx\n%% time:end %%"), null);
    assert.equal(tr.renameHeading("## Time Report\n\nMine\n\n## Time report\n\n%% time:start %%\nx\n%% time:end %%"), null);
    // Windows line endings keep theirs
    assert.equal(write("A\r\n\r\n## Time tracking\r\n\r\n%% time:start %%\r\nx\r\n%% time:end %%\r\n"), `A\r\n\r\n## Time Report\r\n\r\n${BLOCK.replace(/\n/g, "\r\n")}\r\n`);
    // Broken markers: nothing is written, the heading included
    assert.ok(tr.blockEdits("## Time tracking\n\n%% time:start %%\n%% time:start %%\n%% time:end %%", BLOCK).error);
    // Only the heading's text changes, so a fold on it, or anywhere, stays put
    const content = old("%% time:start %%\nold\n%% time:end %%");
    const e = tr.renameHeading(content);
    const folds = [{ from: 0, to: 0 }, { from: 5, to: 9 }, { from: 7, to: 9 }];
    assert.deepEqual(plain(tr.shiftFolds(folds, content, e.start, e.end, e.text)), folds);
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
    assert.ok(block.includes("| **All** | **1.00** |  | **$80.00** |"), block);
    const lines = block.split("\n");
    assert.deepEqual(plain(lines.slice(0, 6)), ["%% time:start %%", "*Updated 2026-09-14 12:00pm*", "", "### Earnings", "", "| Project | Billable | Rate | Earned |"]);
    assert.ok(!/round each entry|Earned is|Max Hrs is/.test(block));
});

test("tables listing projects: a parent with nothing logged to it directly has no row; rows add up to All", () => {
    const model = tr.build([note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am\n\t- 11:00am - 11:30am")], MONEY_INDEX);
    const month = tr.render(model, { kind: "period", unit: "month", key: "2026-09" }, "s");
    assert.ok(!month.includes("Orchard Lane 2026"), month);
    assert.ok(month.includes("| [[Orchard Lane Web 2026]] | 1.50 | $80/hr | $120.00 |"), month);
    assert.ok(month.includes("| **All** | **1.50** |  | **$120.00** |"));
    const year = tr.render(model, { kind: "period", unit: "year", key: "2026" }, "s");
    assert.ok(!year.includes("Orchard Lane 2026"));
    // The parent's own note still totals its sub-projects
    assert.ok(tr.render(model, { kind: "project", path: ORCHARD }, "s").includes("| **Total** | **1.50** | **1.50** |  | **1.50** |  | **$120.00** |"));
});

test("project note for a parent with no time of its own: its own row first, blank, and its weeks are its sub-projects'", () => {
    const model = tr.build([note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am")], MONEY_INDEX);
    const lines = tr.render(model, { kind: "project", path: ORCHARD }, "s").split("\n");
    const at = lines.indexOf("### By Project");
    assert.deepEqual(lines.slice(at + 4, at + 7), [
        "| [[Orchard Lane 2026]] |  |  |  |  | $80/hr |  |",
        "| [[Orchard Lane Web 2026]] | 1.00 | 1.00 |  | 1.00 | $80/hr | $80.00 |",
        "| **Total** | **1.00** | **1.00** |  | **1.00** |  | **$80.00** |",
    ]);
    const weeks = lines.indexOf("### By Week");
    assert.deepEqual(lines.slice(weeks + 4, weeks + 6), [
        "| [[2026w36\\|8/30-9/5]] | 1.00 | 1.00 |  | 1.00 | $80.00 |",
        "| **Total** | **1.00** | **1.00** |  | **1.00** | **$80.00** |",
    ]);
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
    const earnedAt = lines.indexOf("### Earnings");
    assert.ok(lines.indexOf(PROBLEMS) === 3 && lines.indexOf(PROBLEMS) < earnedAt && earnedAt < head, block);
    assert.deepEqual(plain(lines.slice(head - 2, head)), ["### Hours", ""], "each table has its own H3, Earnings first");
    assert.deepEqual(plain(lines.slice(head, head + 7)), [
        "| Project | [[2026-09-13\\|Sun 9/13]] | [[2026-09-14\\|Mon 9/14]] | [[2026-09-15\\|Tue 9/15]] | [[2026-09-16\\|Wed 9/16]] | [[2026-09-17\\|Thu 9/17]] | [[2026-09-18\\|Fri 9/18]] | [[2026-09-19\\|Sat 9/19]] | Week |",
        "| ------- | --: | --: | --: | --: | --: | --: | --: | --: |",
        "| [[Bramble]] |  |  | 1.00 |  |  |  |  | 1.00 |",
        "| [[Orchard Lane Web 2026]] | 0.50 |  |  |  |  |  |  | 0.50 |",
        "| [[Pinecone Studio]] | 2.75 |  |  |  |  |  |  | 2.75 |",
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
    const earnedAt = lines.indexOf("### Earnings");
    assert.ok(lines.indexOf(PROBLEMS) === 3 && lines.indexOf(PROBLEMS) < earnedAt && earnedAt < head, block);
    assert.deepEqual(plain(lines.slice(head - 2, head)), ["### Hours", ""], "each table has its own H3, Earnings first");
    assert.deepEqual(plain(lines.slice(head, head + 6)), [
        "| Project | [[2026w36\\|8/30-9/5]] | [[2026w37\\|9/6-9/12]] | [[2026w38\\|9/13-9/19]] | [[2026w39\\|9/20-9/26]] | [[2026w40\\|9/27-10/3]] | Month |",
        "| ------- | --: | --: | --: | --: | --: | --: |",
        // August 31 is in week 36 but not in September, so it stays out
        "| [[Orchard Lane Web 2026]] |  |  | 0.50 |  |  | 0.50 |",
        "| [[Pinecone Studio]] | 2.25 |  |  |  |  | 2.25 |",
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

test("OBS-34: a task line's ⭕ project and its ⋯ task note's project disagree → a problem on both projects", () => {
    const idx = tr.makeIndex([
        { path: "P/Hawk/Hawk.md", tags: ["project"] },
        { path: "P/Tin/Tin.md", tags: ["project"] },
        { path: "P/Hawk/Send the invoice.md", tags: ["task"] },
        { path: "P/Tin/Draft the scope.md", tags: ["task"] },
        { path: "Inbox/Loose end.md", tags: ["task"] },
        { path: "Elsewhere/Filed by area.md", tags: ["task"], parent: "[[Hawk]]" },
    ]);
    const text = [
        "- [ ] Send the invoice [[Tin|⭕]] [[Send the invoice|⋯]]",   // note under Hawk, line says Tin: conflict
        "\t- 9:00am - 10:00am",
        "- [ ] Send the invoice again [[Tin|⭕]] [[Send the invoice|⋯]]", // same pair again: one problem, 2 entries
        "\t- 10:00am - 10:30am",
        "- [ ] Draft the scope [[Tin|⭕]] [[Draft the scope|⋯]]",       // note under Tin too: agrees
        "\t- 11:00am - 11:30am",
        "- [ ] Loose end [[Tin|⭕]] [[Loose end|⋯]]",                   // note has no project: nothing to disagree with
        "\t- 1:00pm - 1:15pm",
        "- [ ] By area [[Tin|⭕]] [[Filed by area|⋯]]",                 // project through `area`, like the report itself
        "\t- 2:00pm - 2:15pm",
    ].join("\n");
    const m = tr.build([note("2026-09-01", text)], idx);
    // A line whose ⭕ and note disagree counts nowhere (Brian, 2026-10-28); the lines that agree count toward Tin
    assert.deepEqual(plain(m.entries.map((e) => [e.project, e.start])), [["P/Tin/Tin.md", 660], ["P/Tin/Tin.md", 780]]);
    const conflicts = m.projectProblems.filter((p) => p.conflict);
    assert.equal(conflicts.length, 4);

    const tin = tr.render(m, { kind: "project", path: "P/Tin/Tin.md" }, "s");
    assert.ok(tin.includes("- [[Tin]] has time (2 entries) from a task line whose task note [[P/Hawk/Send the invoice|Send the invoice]] is filed under [[Hawk]], so the time isn't counted on either; move the note here, or change the line's project link"), tin);
    assert.ok(tin.includes("- [[Tin]] has time (1 entry) from a task line whose task note [[Elsewhere/Filed by area|Filed by area]] is filed under [[Hawk]]"), tin);
    const tinProblems = tin.slice(tin.indexOf(PROBLEMS), tin.indexOf("### Billable time"));
    assert.ok(!tinProblems.includes("Draft the scope") && !tinProblems.includes("Loose end"));
    assert.ok(!tin.includes("⭕ link"), "the message says project link, not ⭕ link");

    // Hawk has no time of its own, but its note still gets a report, so the problem is seen there
    assert.ok(tr.projectTargets(m).has("P/Hawk/Hawk.md"));
    const hawk = tr.render(m, { kind: "project", path: "P/Hawk/Hawk.md" }, "s");
    assert.ok(hawk.includes("No time entries."), hawk);
    assert.ok(hawk.includes("- [[Hawk]] has a task note, [[P/Hawk/Send the invoice|Send the invoice]], whose task line links [[Tin]], so its time (2 entries) isn't counted on either; move the note, or change the line's project link"), hawk);
});

test("OBS-90: the conflict reads only the links that end a line, in either order", () => {
    const idx = tr.makeIndex([
        { path: "P/Hawk/Hawk.md", tags: ["project"] },
        { path: "P/Tin/Tin.md", tags: ["project"] },
        { path: "P/Hawk/Send the invoice.md", tags: ["task"] },
    ]);
    const conflictOf = (line) => plain(tr.conflict([{ body: line }], "days/2026-09-01.md", idx));
    const moved = { lineProject: "P/Tin/Tin.md", note: "P/Hawk/Send the invoice.md", noteProject: "P/Hawk/Hawk.md", event: false };
    assert.deepEqual(conflictOf("[ ] Send the invoice [[Tin|⭕]] [[Send the invoice|⋯]]"), moved, "the ⭕ before the ⋯");
    assert.deepEqual(conflictOf("[ ] Send the invoice [[Send the invoice|⋯]] [[Tin|⭕]]"), moved, "the older order");
    assert.equal(conflictOf("[ ] Send the invoice [[Hawk|⭕]] [[Send the invoice|⋯]]"), null, "they agree");
    // A project or a note linked in the text isn't the line's
    assert.equal(conflictOf("[ ] Ask [[Tin|⭕]] about it [[Send the invoice|⋯]]"), null);
    assert.equal(conflictOf("[ ] Read [[Send the invoice|⋯]] then [[Tin|⭕]]"), null);
});

test("OBS-34: no conflict without a ⋯ note, or when the ⭕ is on an outer line only; an archived note project conflicts like any (OBS-213)", () => {
    const idx = tr.makeIndex([
        { path: "P/Hawk/Hawk.md", tags: ["project"] },
        { path: "P/Tin/Tin.md", tags: ["project"] },
        { path: "Archive/Old/Old.md", tags: ["project"] },
        { path: "Archive/Old/Old task.md", tags: ["task"] },
        { path: "P/Hawk/Nested task.md", tags: ["task"] },
    ]);
    const text = [
        "- [ ] Plain [[Tin|⭕]]", "\t- 9:00am - 9:30am",
        "- [ ] Old [[Tin|⭕]] [[Old task|⋯]]", "\t- 10:00am - 10:30am",
        "- [ ] Parent [[Tin|⭕]]", "\t- [ ] Child [[Nested task|⋯]]", "\t\t- 11:00am - 11:30am",
    ].join("\n");
    const m = tr.build([note("2026-09-01", text)], idx);
    assert.deepEqual(plain(m.projectProblems.filter((p) => p.conflict).map((p) => [p.project, p.conflict.side, p.conflict.note, p.conflict.other])), [
        ["P/Tin/Tin.md", "line", "Archive/Old/Old task.md", "Archive/Old/Old.md"],
        ["Archive/Old/Old.md", "note", "Archive/Old/Old task.md", "P/Tin/Tin.md"],
    ]);
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
        { path: "P/A.md", tags: ["project"], parent: "[[B]]", props: { rate_type: "non-billable" } },
        { path: "P/B.md", tags: ["project"], parent: "[[A]]", props: { rate_type: "non-billable" } },
        { path: "P/Hawk/Hawk.md", tags: ["project"], props: { rate_type: "non-billable" } },
        { path: "P/Tin/Tin.md", tags: ["project"], props: { rate_type: "non-billable" } },
        { path: "P/Hawk/Send the invoice.md", tags: ["task"] },
    ]);
    const m = tr.build([
        note("2026-09-01", [
            "- [x] Kid [[Kid|⭕]]", "\t- 9:00am - 10:00am",
            "- [x] Bare [[Bare|⭕]]", "\t- 10:00am - 11:00am",
            "- [x] Loop [[A|⭕]]", "\t- 11:00am - 12:00pm",
            "- [ ] Send the invoice [[Tin|⭕]] [[Send the invoice|⋯]]", "\t- 1:00pm - 2:00pm",
        ].join("\n")),
        note("2026-09-08", "- [ ] Send the invoice [[Tin|⭕]] [[Send the invoice|⋯]]\n\t- 1:00pm - 2:00pm"),
        note("2026-10-05", "- [x] Late [[Late|⭕]]\n\t- 9:00am - 10:00am"),
    ], idx);
    const problems = (block) => block.slice(block.indexOf(PROBLEMS)).split("\n").filter((l) => l.startsWith("> - ")).map((l) => l.slice(2));

    const week = problems(tr.render(m, { kind: "period", unit: "week", key: tr.weekKey("2026-09-01") }, "s"));
    assert.deepEqual(plain(week), [
        "- [[B]] and [[A]] are each inside the other (check their folders and `parent`); [[B]] is counted as top-level",
        // A conflict is said once, from the project the time counts on, with this period's entries only
        "- [[Tin]] has time (1 entry) from a task line whose task note [[P/Hawk/Send the invoice|Send the invoice]] is filed under [[Hawk]], so the time isn't counted on either; move the note here, or change the line's project link",
        // A parent's problem reaches the period through its sub-project's time
        "- [[Par]] has a `rate` that isn't a positive number (TBD), so it has no Earned",
        "- [[Bare]] has no `rate_type`, so its time counts as billable; set one (`hourly`, `flat`, `non-billable`)",
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
        ["- [[Late]] has no `rate_type`, so its time counts as billable; set one (`hourly`, `flat`, `non-billable`)"]);

    const year = problems(tr.render(m, { kind: "period", unit: "year", key: "2026" }, "s"));
    assert.equal(year.length, 5);
    assert.ok(year.some((l) => l.includes("has time (2 entries)")) && year.some((l) => l.includes("[[Late")));

    // The project notes are unchanged: the conflict is still said on both
    assert.ok(tr.render(m, { kind: "project", path: "P/Hawk/Hawk.md" }, "s").includes("so its time (2 entries) isn't counted on either"));
    assert.ok(tr.render(m, { kind: "project", path: "P/Tin/Tin.md" }, "s").includes("has time (2 entries)"));
});

test("OBS-57, OBS-87: an event whose ⭕ and ⋯ log disagree is a problem worded for an event and its log; a ⋯ task note conflicts like ⋯", () => {
    const idx = tr.makeIndex([
        { path: "P/Hawk/Hawk.md", tags: ["project"] },
        { path: "P/Tin/Tin.md", tags: ["project"] },
        { path: "P/Hawk/Send the invoice.md", tags: ["task"] },
        { path: "P/Hawk/logs/2026-09-01 Kickoff.md", tags: ["log"] },
    ]);
    const text = [
        "- [<] 9:00am\tKickoff [[2026-09-01 Kickoff|⋯]] [[Tin|⭕]]",
        "\t- 9:30am",
        "- [ ] Send the invoice [[Tin|⭕]] [[Send the invoice|⋯]]",
        "\t- 10:00am - 10:30am",
    ].join("\n");
    const m = tr.build([note("2026-09-01", text)], idx);
    assert.deepEqual(plain(m.entries), [], "neither line's time counts: nothing decides between its ⭕ and its note (Brian, 2026-10-28)");
    const tin = tr.render(m, { kind: "project", path: "P/Tin/Tin.md" }, "s");
    assert.ok(tin.includes("- [[Tin]] has time (1 entry) from an event line whose log [[P/Hawk/logs/2026-09-01 Kickoff|2026-09-01 Kickoff]] is filed under [[Hawk]], so the time isn't counted on either; move the log here, or change the line's project link"), tin);
    assert.ok(tin.includes("- [[Tin]] has time (1 entry) from a task line whose task note [[P/Hawk/Send the invoice|Send the invoice]] is filed under [[Hawk]]"), tin);
    const hawk = tr.render(m, { kind: "project", path: "P/Hawk/Hawk.md" }, "s");
    assert.ok(hawk.includes("- [[Hawk]] has a log, [[P/Hawk/logs/2026-09-01 Kickoff|2026-09-01 Kickoff]], whose event line links [[Tin]], so its time (1 entry) isn't counted on either; move the log, or change the line's project link"), hawk);
});

// ------------------------------------------------------------------ timesheets and invoices (OBS-5)

// A report's Problems callout opens with this line (OBS-167)
const PROBLEMS = "> [!warning] Problems";
const section = (block, heading) => {
    const lines = block.split("\n");
    // Problems are a callout (OBS-167): its items, without the "> " that puts them in it
    if (heading === "### Problems") {
        const at = lines.indexOf(PROBLEMS);
        if (at === -1) return null;
        const end = lines.findIndex((l, i) => i > at && !l.startsWith(">"));
        return lines.slice(at + 1, end).map((l) => l.replace(/^> /, ""));
    }
    // A timesheet heading carries its total after a colon: `### Billable time: 2.00 hrs`
    const at = lines.findIndex((l) => l === heading || l.startsWith(`${heading}: `));
    if (at === -1) return null;
    // It ends at the next heading, or at a project note's summary when Problems come first (OBS-167)
    const end = lines.findIndex((l, i) => i > at && (l.startsWith("### ") || l.startsWith("**") || l === "%% time:end %%"));
    return lines.slice(at + 2, end).filter((l) => l !== "");
};

test("entries keep the 🆓 as written, for the timesheet's 🆓 time", () => {
    const { entries } = tr.parseNote("- [x] Redo it 🆓 [[P|⭕]]\n\t- 9:00am - 9:30am\n- [x] Fix [[P|⭕]]\n\t- 10:00am - 10:20am: 🆓 my typo", "2026-09-01");
    assert.deepEqual(plain(entries.map((e) => [e.task, e.taskWritten, e.note, e.noteWritten])), [
        ["Redo it", "Redo it 🆓", "", ""],
        ["Fix", "Fix", "my typo", "🆓 my typo"],
    ]);
    const m = tr.build([note("2026-09-01", "- [<] 4:00pm\tCall [[Orchard Lane 2026|⭕]]\n\t- 4:30pm: 🆓 not billing")], INDEX);
    assert.deepEqual(plain(m.entries.map((e) => [e.task, e.note, e.noteWritten])), [["Call", "not billing", "🆓 not billing"]]);
});

test("render timesheet: Billable time and 🆓 time, each total in its heading, a bold row per day, newest first", () => {
    const block = tr.render(SMALL, { kind: "timesheet", path: ORCHARD_WEB }, "s");
    const heads = block.split("\n").filter((l) => l.startsWith("### "));
    assert.deepEqual(heads, ["### Billable time: 2.00 hrs", "### 🆓 time: 0.25 hrs"]);
    assert.ok(block.startsWith("%% time:start %%\n*Updated s*\n\n### Billable time"), "no line about the table before it (OBS-167)");
    assert.deepEqual(section(block, "### Billable time"), [
        "|  | Date | Time | Hours | Task | Notes | Invoice |",
        "| :-: | --- | --- | --: | --- | --- | --- |",
        "|  | **[[2026-10-01\\|Thu 10/1]]** |  | **1.00** |  |  |  |",
        "|  |  | 9:00am - 10:00am | 1.00 | Charts |  |  |",
        "|  | **[[2026-09-01\\|Tue 9/1]]** |  | **1.00** |  |  |  |",
        "|  |  | 9:00am - 9:50am | 1.00 | Charts |  |  |",
    ]);
    // 🆓 time: the same status and Invoice columns, and the 🆓 as written; its total is the summary's 🆓
    assert.deepEqual(section(block, "### 🆓 time"), [
        "|  | Date | Time | Hours | Task | Notes | Invoice |",
        "| :-: | --- | --- | --: | --- | --- | --- |",
        "|  | **[[2026-09-01\\|Tue 9/1]]** |  | **0.25** |  |  |  |",
        "|  |  | 1:00pm - 1:10pm | 0.25 | Charts | 🆓 fix \\| pipe |  |",
    ]);
    assert.ok(tr.render(SMALL, { kind: "project", path: ORCHARD_WEB }, "s").includes("| **Total** | **2.00** | **2.25** | **0.25** | **2.00** | **$160.00** |"), "the project's note agrees");
    assert.ok(block.endsWith("🆓 fix \\| pipe |  |\n\n%% time:end %%"));
});

test("render project: include_subprojects adds a Project column and the sub-projects' entries", () => {
    const idx = tr.makeIndex([
        { path: ORCHARD, tags: ["project"], props: { rate: "80", rate_type: "hourly", contract_max: 9600, include_subprojects: true } },
        { path: ORCHARD_WEB, tags: ["project"] },
    ]);
    const m = tr.attachBilling(tr.build(SMALL_NOTES, idx), [], idx, billing);
    const sheet = section(tr.render(m, { kind: "timesheet", path: ORCHARD }, "s"), "### Billable time");
    assert.equal(sheet[0], "|  | Date | Time | Project | Hours | Task | Notes | Invoice |");
    assert.ok(tr.render(m, { kind: "timesheet", path: ORCHARD }, "s").includes("### Billable time: 3.00 hrs"), "the summary's Total: 3.00 billable");
    assert.ok(sheet.includes("|  |  | 2:00pm - 3:00pm | [[Orchard Lane 2026]] | 1.00 | Contract |  |  |"));
    assert.ok(sheet.includes("|  |  | 9:00am - 9:50am | [[Orchard Lane Web 2026]] | 1.00 | Charts |  |  |"));
    // Off: the project's own entries only
    const own = section(tr.render(SMALL, { kind: "timesheet", path: ORCHARD }, "s"), "### Billable time");
    assert.deepEqual(own.slice(2), [
        "|  | **[[2026-09-01\\|Tue 9/1]]** |  | **1.00** |  |  |  |",
        "|  |  | 2:00pm - 3:00pm | 1.00 | Contract |  |  |",
    ]);
});

test("render project: a timesheet with nothing hourly has no money columns", () => {
    const sheet = section(tr.render(SMALL, { kind: "timesheet", path: "20 Projects/Freelance/Bramble/Bramble.md" }, "s"), "### Billable time");
    assert.deepEqual(sheet.slice(0, 2), ["| Date | Time | Hours | Task | Notes |", "| --- | --- | --: | --- | --- |"]);
});

// Invoices for Orchard Lane Web 2026, as the Invoice command writes their Billed entries
const ORC = "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Web 2026/invoices";
const orcInvoice = (number, status, rows, props = {}) => ({
    path: `${ORC}/${number}.md`,
    props: { status, number, project: "[[Orchard Lane Web 2026]]", period_start: "2026-09-01", period_end: "2026-09-02", ...props },
    text: billing.billedLines(rows.map(([date, start, end]) => ({ date, start: tr.minutes(start), end: tr.minutes(end), minutes: tr.minutes(end) - tr.minutes(start),
        billed: tr.rounded(tr.minutes(end) - tr.minutes(start)), cents: 8000, project: ORCHARD_WEB, task: "Charts", note: "" })), tr, (p) => tr.basename(p)).join("\n"),
});
const ORC_NOTES = [
    note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:50am\n\t- 11:00am - 11:30am\n\t- 1:00pm - 2:45pm"),
    note("2026-09-02", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 3:00pm - 3:30pm"),
    note("2026-09-03", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am"),
];
const orcIndex = (web = {}) => tr.makeIndex([
    { path: ORCHARD, tags: ["project"], props: { rate: "80", rate_type: "hourly" } },
    { path: ORCHARD_WEB, tags: ["project"], props: web },
]);

test("timesheet: each billable entry's invoice last, its status mark first (OBS-117)", () => {
    // A leftover billed_through is ignored (OBS-192): 3:00pm - 3:30pm is on no invoice, so its cell is empty
    const idx = orcIndex({ billed_through: "2026-09-02" });
    const invoices = [
        orcInvoice("1001-ORC", "paid", [["2026-09-01", "9:00am", "9:50am"], ["2026-09-01", "1:00pm", "2:30pm"]], { paid: "2026-09-15", invoice_date: "2026-09-04" }),
        orcInvoice("1002-ORC", "draft", [["2026-09-01", "11:00am", "11:30am"]]),
    ];
    const m = tr.attachBilling(tr.build(ORC_NOTES, idx), invoices, idx, billing);
    const block = tr.render(m, { kind: "project", path: ORCHARD_WEB }, "s");
    const cells = section(tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s"), "### Billable time")
        .map((l) => billing.cells(l)).filter((c) => /^\d{1,2}:\d{2}[ap]m - /.test(c[2])).map((c) => [c[2], c[0], c.at(-1)]);
    assert.deepEqual(cells, [
        ["9:00am - 10:00am", "", ""],
        ["3:00pm - 3:30pm", "", ""],
        ["9:00am - 9:50am", "✅", "[[1001-ORC]]"],
        ["11:00am - 11:30am", "✏️", "[[1002-ORC]]"],
        ["1:00pm - 2:45pm", "⚠️", "[[1001-ORC]]"],
    ]);
    // Under Problems on the project's note; not on the month's
    assert.ok(block.includes("- [[1001-ORC]] (paid 9/15): [[2026-09-01|9/1/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm"), block);
    assert.ok(!tr.render(m, { kind: "period", unit: "month", key: "2026-09" }, "s").includes("1001-ORC"));
    // A draft that changed is a Problem too, which says how to fix it (OBS-143)
    const draftOnly = tr.attachBilling(tr.build(ORC_NOTES, idx), [orcInvoice("1003-ORC", "draft", [["2026-09-01", "1:00pm", "2:30pm"]])], idx, billing);
    assert.ok(tr.render(draftOnly, { kind: "project", path: ORCHARD_WEB }, "s").includes("- [[1003-ORC]] (draft): [[2026-09-01|9/1/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm; rebuild it"));
});

test("invoice Problems: an entry on two invoices; a leftover billed_through is none (OBS-192)", () => {
    const idx = orcIndex({ billed_through: "soon" });
    const invoices = [
        orcInvoice("1001-ORC", "sent", [["2026-09-01", "9:00am", "9:50am"]], { invoice_date: "2026-09-04" }),
        orcInvoice("1002-ORC", "sent", [["2026-09-01", "9:00am", "9:50am"]], { invoice_date: "2026-09-05" }),
    ];
    const m = tr.attachBilling(tr.build(ORC_NOTES, idx), invoices, idx, billing);
    const block = tr.render(m, { kind: "project", path: ORCHARD_WEB }, "s");
    assert.ok(block.includes("- [[2026-09-01|9/1/26]] 9:00am - 9:50am is billed on both [[1001-ORC]] and [[1002-ORC]]"), block);
    assert.ok(!block.includes("billed_through") && !block.includes("soon"), block);
    assert.ok(!tr.render(m, { kind: "period", unit: "month", key: "2026-09" }, "s").includes("is billed on both"));
});

test("render project: its invoices, newest first, each marked with its status, then a Total of all but the canceled (OBS-117)", () => {
    const idx = orcIndex();
    const invoices = [
        orcInvoice("1001-ORC", "paid", [["2026-09-01", "9:00am", "9:50am"]], { invoice_date: "2026-09-03", hours: 1, total: 80, paid: "2026-09-15" }),
        orcInvoice("1002-ORC", "canceled", [["2026-09-01", "11:00am", "11:30am"]], { invoice_date: "2026-09-04", hours: 0.5, total: 40 }),
        orcInvoice("1003-ORC", "sent", [["2026-09-02", "3:00pm", "3:30pm"]], { invoice_date: "2026-09-05", period_start: "2026-09-02", hours: 0.5, total: 40 }),
        orcInvoice("1004-ORC", "draft", [["2026-09-01", "11:00am", "11:30am"]], { invoice_date: "2026-09-06", hours: 0.5, total: 40 }),
    ];
    const m = tr.attachBilling(tr.build(ORC_NOTES, idx), invoices, idx, billing);
    assert.deepEqual(section(tr.render(m, { kind: "project", path: ORCHARD_WEB }, "s"), "### Invoices"), [
        "|  | Invoice | Date | Period | Hours | Total |",
        "| :-: | --- | --- | --- | --: | --: |",
        "| ✏️ | [[1004-ORC]] | 9/6/26 | 9/1 – 9/2/26 | 0.50 | $40.00 |",
        "| 🕒 | [[1003-ORC]] | 9/5/26 | 9/2 – 9/2/26 | 0.50 | $40.00 |",
        "| ❌ | [[1002-ORC]] | 9/4/26 | 9/1 – 9/2/26 | 0.50 | $40.00 |",
        "| ✅ | [[1001-ORC]] | 9/3/26 | 9/1 – 9/2/26 | 1.00 | $80.00 |",
        "|  | **Total** |  |  | **2.00** | **$160.00** |",
    ]);
    // A status of your own gets 📄; a project with no invoices gets no section
    assert.equal(tr.invoiceMark({ name: "1005-ORC", status: "on hold" }), "📄");
    assert.ok(!tr.render(tr.attachBilling(tr.build(ORC_NOTES, idx), [], idx, billing), { kind: "project", path: ORCHARD_WEB }, "s").includes("### Invoices"));
});

test("render project (OBS-133): unpaid is the Earned of every entry not billed on a paid invoice", () => {
    const idx = orcIndex();
    const summary = (invoices, path = ORCHARD_WEB, index = idx) => {
        const m = tr.attachBilling(tr.build(ORC_NOTES, index), invoices, index, billing);
        return tr.render(m, { kind: "project", path }, "s").split("\n").filter((l) => l.startsWith("**"));
    };
    const earned = (invoices, index) => summary(invoices, ORCHARD_WEB, index).find((l) => l.startsWith("**Earned:**"));
    // 4.75 hours at $80. Only the paid invoice's hour is paid: sent, draft and canceled ones aren't
    const invoices = [
        orcInvoice("1001-ORC", "paid", [["2026-09-01", "9:00am", "9:50am"]], { paid: "2026-09-15" }),
        orcInvoice("1002-ORC", "canceled", [["2026-09-01", "11:00am", "11:30am"]]),
        orcInvoice("1003-ORC", "sent", [["2026-09-02", "3:00pm", "3:30pm"]]),
        orcInvoice("1004-ORC", "draft", [["2026-09-01", "1:00pm", "2:30pm"]]),
    ];
    const expected = ["**Hours:**\t\t4.75 used", "**Earned:**\t\t$380.00 | $300.00 unpaid", "**Eff. rate:**\t\t$80.00/hr"];
    assert.deepEqual(summary(invoices), expected);
    assert.deepEqual(summary(invoices, ORCHARD), expected, "the parent counts its sub-project's invoices");
    // Nothing unpaid: no unpaid
    const all = [["2026-09-01", "9:00am", "9:50am"], ["2026-09-01", "11:00am", "11:30am"], ["2026-09-01", "1:00pm", "2:45pm"], ["2026-09-02", "3:00pm", "3:30pm"], ["2026-09-03", "9:00am", "10:00am"]];
    assert.equal(earned([orcInvoice("1001-ORC", "paid", all, { paid: "2026-09-15" })]), "**Earned:**\t\t$380.00");
    // A leftover billed_through is ignored (OBS-192): with no invoices, all of it is unpaid
    assert.equal(earned([], orcIndex({ billed_through: "2026-09-01" })), "**Earned:**\t\t$380.00 | $380.00 unpaid");
    // Paid at $80, the rate raised to $100 since: Earned is at today's rate, and nothing is unpaid
    assert.equal(earned([orcInvoice("1001-ORC", "paid", all)], orcIndex({ rate: 100, rate_type: "hourly" })), "**Earned:**\t\t$475.00");
    // An entry on two paid invoices is paid once
    const twice = [orcInvoice("1001-ORC", "paid", [all[0]]), orcInvoice("1002-ORC", "paid", [all[0]])];
    assert.equal(earned(twice), "**Earned:**\t\t$380.00 | $300.00 unpaid");
    // A paid entry that grew since (billed 1:00 - 2:30, now 2:45) is unpaid for the quarter hour it gained
    assert.equal(earned([orcInvoice("1001-ORC", "paid", [["2026-09-01", "1:00pm", "2:30pm"]])]), "**Earned:**\t\t$380.00 | $260.00 unpaid");
});

test("render project (OBS-133): a non-billable note's summary is only its hours against a cap; a flat fee's sub-project has no fee of its own", () => {
    const idx = tr.makeIndex([
        { path: "P/Club/Club.md", tags: ["project"], props: { rate_type: "non-billable", max_hours: 3 } },
        { path: "P/Free/Free.md", tags: ["project"], props: { rate_type: "non-billable" } },
        { path: "P/Fixed/Fixed.md", tags: ["project"], props: { rate: 900, rate_type: "flat" } },
        { path: "P/Fixed/Extra/Extra.md", tags: ["project"] },
    ]);
    const m = tr.build([note("2026-09-01", [
        "- [x] Meet [[Club|⭕]]", "\t- 9:00am - 10:00am", "\t- 10:30am - 11:00am: 🆓",
        "- [x] Read [[Free|⭕]]", "\t- 1:00pm - 2:00pm",
        "- [x] Design [[Fixed|⭕]]", "\t- 3:00pm - 5:00pm",
        "- [x] More [[Extra|⭕]]", "\t- 6:00pm - 7:00pm",
    ].join("\n"))], idx);
    const summary = (p) => tr.render(m, { kind: "project", path: p }, "s").split("\n").filter((l) => l.startsWith("**"));
    // Every hour counts against a non-billable note's cap, 🆓 or not, and it has no money lines
    assert.deepEqual(summary("P/Club/Club.md"), ["**Hours:**\t\t1.50 used | 1.50 left"]);
    assert.deepEqual(summary("P/Free/Free.md"), []);
    // A flat fee over its sub-project's hours too; the sub-project is part of that fee and has none of its own
    assert.deepEqual(summary("P/Fixed/Fixed.md"), ["**Hours:**\t\t3.00 used", "**Flat fee:**\t\t$900", "**Eff. rate:**\t\t$300.00/hr"]);
    assert.deepEqual(summary("P/Fixed/Extra/Extra.md"), ["**Hours:**\t\t1.00 used"]);
    // A flat fee of its own under a flat project is paid on top, so the parent counts it
    const mixed = tr.makeIndex([
        { path: "P/Fixed/Fixed.md", tags: ["project"], props: { rate: 900, rate_type: "flat" } },
        { path: "P/Fixed/Print/Print.md", tags: ["project"], props: { rate: 300 } },
        { path: "P/Client/Client.md", tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
        { path: "P/Client/Logo/Logo.md", tags: ["project"], props: { rate: 600, rate_type: "flat" } },
        { path: "P/Client/Kit/Kit.md", tags: ["project"], props: { rate_type: "flat" } },
    ]);
    const mm = tr.build([note("2026-09-01", ["Fixed", "Print", "Client", "Logo", "Kit"].map((n) => `- [x] ${n} [[${n}|⭕]]\n\t- 9:00am - 10:00am`).join("\n"))], mixed);
    const lines = (p) => tr.render(mm, { kind: "project", path: p }, "s").split("\n").filter((l) => l.startsWith("**"));
    assert.deepEqual(lines("P/Fixed/Fixed.md"), ["**Hours:**\t\t2.00 used", "**Flat fee:**\t\t$1,200", "**Eff. rate:**\t\t$600.00/hr"]);
    // A note billed by the hour never counts a flat sub-project's fee or time: its rate is $100, so is its effective rate
    assert.deepEqual(lines("P/Client/Client.md").slice(1), ["**Earned:**\t\t$100.00 | $100.00 unpaid", "**Eff. rate:**\t\t$100.00/hr"]);
    // A flat sub-project with no fee of its own never shows its hourly parent's rate as one
    assert.equal(mm.money.get("P/Client/Kit/Kit.md").label, "flat");
    assert.equal(mm.money.get("P/Client/Logo/Logo.md").label, "$600 flat");
    // In a period's Earned a flat fee has no hours and no Earned; a non-billable project isn't there
    const week = tr.render(m, { kind: "period", unit: "week", key: "2026w36" }, "s");
    const earned = week.slice(week.indexOf("### Earnings"), week.indexOf("### Hours"));
    assert.ok(earned.includes("| [[Extra]] | – | $900 flat | N/A |") && earned.includes("| [[Fixed]] | – | $900 flat | N/A |") && !earned.includes("[[Club]]"), week);
    assert.ok(!earned.includes("**All**"), "with only flat fees not earned here, All would be blank");
});

test("a flat fee's `earned` day puts the fee in that week's, month's and year's Earnings, and N/A elsewhere", () => {
    const idx = (earned) => tr.makeIndex([
        { path: "P/Poster/Poster.md", tags: ["project"], props: { rate: 1200, rate_type: "flat", ...(earned === undefined ? {} : { earned }) } },
        { path: "P/Poster/Print/Print.md", tags: ["project"], props: { earned: "2026-09-02" } },
        { path: "P/Client/Client.md", tags: ["project"], props: { rate: 100, rate_type: "hourly", earned: "2026-09-02" } },
    ]);
    const notes = [
        note("2026-09-01", "- [x] Sketch [[Poster|⭕]]\n\t- 9:00am - 11:00am\n- [x] Call [[Client|⭕]]\n\t- 1:00pm - 2:00pm"),
        note("2026-09-08", "- [x] Proofs [[Print|⭕]]\n\t- 9:00am - 10:00am"),
    ];
    const m = tr.build(notes, idx("2026-10-05"));
    // Only the note that sets the fee has an earned day; a sub-project's own `earned`, or an hourly note's, means nothing
    assert.deepEqual(plain([...m.money].map(([p, x]) => [tr.basename(p), x.fee, x.earned])), [["Poster", 1200, "2026-10-05"], ["Client", null, null], ["Print", null, null]]);
    // Its week and month get a note even with no time in them
    assert.deepEqual(plain(tr.periodsWithEntries(m)), { week: ["2026w36", "2026w37", "2026w41"], month: ["2026-09", "2026-10"], year: ["2026"] });
    const earnings = (unit, key) => {
        const block = tr.render(m, { kind: "period", unit, key }, "s");
        return block.slice(block.indexOf("### Earnings"), block.indexOf("### Hours")).split("\n").filter((l) => l.startsWith("| ["));
    };
    // In September it has time but wasn't earned: N/A, and All is the hourly work's alone
    assert.deepEqual(earnings("month", "2026-09"), ["| [[Client]] | 1.00 | $100/hr | $100.00 |", "| [[Poster]] | – | $1,200 flat | N/A |", "| [[Print]] | – | $1,200 flat | N/A |"]);
    assert.ok(tr.render(m, { kind: "period", unit: "month", key: "2026-09" }, "s").includes("| **All** | **1.00** |  | **$100.00** |"));
    // October, the week of 10/5 too: the fee, in All
    for (const [unit, key] of [["month", "2026-10"], ["week", "2026w41"]]) {
        const block = tr.render(m, { kind: "period", unit, key }, "s");
        assert.deepEqual(earnings(unit, key), ["| [[Poster]] | – | $1,200 flat | $1,200.00 |"], key);
        assert.ok(block.includes("| **All** |  |  | **$1,200.00** |") && block.includes("### Hours\n\nNo time entries."), block);
    }
    // The year: the fee in October's column and in the year's
    const year = tr.render(m, { kind: "period", unit: "year", key: "2026" }, "s").split("\n");
    const cells = (name) => year.find((l) => l.startsWith(`| ${name} |`)).split(/(?<!\\)\|/).slice(2, -1).map((c) => c.trim());
    assert.deepEqual(cells("[[Poster]]").slice(8, 13), ["", "$1,200", "", "", "$1,200"]);
    assert.deepEqual(cells("**All**").slice(8, 13), ["**$100**", "**$1,200**", "", "", "**$1,300**"]);
    // The project's summary says when it was earned; its effective rate is the fee over its 3 hours
    assert.deepEqual(tr.render(m, { kind: "project", path: "P/Poster/Poster.md" }, "s").split("\n").filter((l) => l.startsWith("**")),
        ["**Hours:**\t\t3.00 used", "**Flat fee:**\t\t$1,200 | earned 10/5/26", "**Eff. rate:**\t\t$400.00/hr"]);
    // Not earned yet: no date, nothing in the year, no October
    const not = tr.build(notes, idx(undefined));
    assert.ok(!tr.render(not, { kind: "period", unit: "year", key: "2026" }, "s").includes("$1,200"));
    assert.deepEqual(plain(tr.periodsWithEntries(not)).month, ["2026-09"]);
    // A date that doesn't read is a Problem, and earns nothing
    const bad = tr.build(notes, idx("next Friday"));
    assert.equal(bad.money.get("P/Poster/Poster.md").earned, null);
    assert.ok(bad.projectProblems.some((p) => p.message === "has an `earned` that isn't a date (next Friday), so its fee isn't counted as earned"));
    assert.equal(tr.isoDate("2026-02-30"), null);
    assert.equal(tr.isoDate(new Date(Date.UTC(2026, 8, 30))), "2026-09-30");
    // An `earned` on a note without a fee of its own counts for nothing, and says so
    const said = (model) => model.projectProblems.map((p) => `${tr.basename(p.project)} ${p.message}`);
    assert.ok(said(m).includes("Print has an `earned` day, but its flat fee is set above it, so the day goes there"), said(m).join("; "));
    assert.ok(said(m).includes("Client has an `earned` day but no flat fee of its own, so it counts for nothing"));
    // Earned in a year with no time in it: that year's note has the fee, and Hours says there's no time
    const next = tr.build(notes, idx("2027-01-05"));
    const y2027 = tr.render(next, { kind: "period", unit: "year", key: "2027" }, "s");
    assert.ok(y2027.includes("| **All** | **$1,200** |") && y2027.includes("### Hours\n\nNo time entries."), y2027);
    // A day still to come (a fee invoiced ahead) counts now, in its period, with nothing under Problems
    const ahead = tr.build(notes, idx("2027-02-01"), { now: { date: "2026-10-11", minutes: 600 } });
    assert.deepEqual(plain(tr.earnedFees(ahead)), [{ project: "P/Poster/Poster.md", date: "2027-02-01", cents: 120000 }]);
    assert.deepEqual(plain(tr.periodsWithEntries(ahead)).month, ["2026-09", "2027-02"]);
    assert.ok(!said(ahead).some((s) => s.startsWith("Poster ")), said(ahead).join("; "));
});

test("OBS-213: an archived project's flat fee counts in its earned period, and a week with only archived time gets its note", () => {
    const idx = tr.makeIndex([
        { path: "Archive/Poster/Poster.md", tags: ["project"], props: { rate: 1200, rate_type: "flat", earned: "2026-10-05" } },
        { path: "P/Client/Client.md", tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
    ]);
    const m = tr.build([
        note("2026-09-01", "- [x] Sketch [[Poster|⭕]]\n\t- 9:00am - 11:00am"),
        note("2026-09-15", "- [x] Call [[Client|⭕]]\n\t- 1:00pm - 2:00pm"),
    ], idx);
    assert.deepEqual(plain(tr.earnedFees(m)), [{ project: "Archive/Poster/Poster.md", date: "2026-10-05", cents: 120000 }]);
    // The week of 9/1 has only archived time, and the week of 10/5 only its fee: both are periods with a note
    assert.deepEqual(plain(tr.periodsWithEntries(m)), { week: ["2026w36", "2026w38", "2026w41"], month: ["2026-09", "2026-10"], year: ["2026"] });
    const october = tr.render(m, { kind: "period", unit: "month", key: "2026-10" }, "s");
    assert.ok(october.includes("| [[Poster]] | – | $1,200 flat | $1,200.00 |"), october);
    assert.ok(tr.render(m, { kind: "period", unit: "week", key: "2026w36" }, "s").includes("| [[Poster]] |  |  | 2.00 |  |  |  |  | 2.00 |"));
});

test("a flat fee's summary gives the earned day only once every fee in it is earned", () => {
    const idx = (print) => tr.makeIndex([
        { path: "P/Poster/Poster.md", tags: ["project"], props: { rate: 1200, rate_type: "flat", earned: "2026-09-30" } },
        { path: "P/Poster/Print/Print.md", tags: ["project"], props: { rate: 600, ...print } },
    ]);
    const notes = [note("2026-09-01", "- [x] Sketch [[Poster|⭕]]\n\t- 9:00am - 10:00am\n- [x] Proofs [[Print|⭕]]\n\t- 1:00pm - 2:00pm")];
    const fee = (print) => tr.render(tr.build(notes, idx(print)), { kind: "project", path: "P/Poster/Poster.md" }, "s").split("\n").find((l) => l.startsWith("**Flat fee:**"));
    assert.equal(fee({}), "**Flat fee:**\t\t$1,800", "Print's own $600 isn't earned yet");
    assert.equal(fee({ earned: "2026-10-02" }), "**Flat fee:**\t\t$1,800 | earned 10/2/26", "both are: the later day");
});

test("review: Earned, the timesheet and an invoice agree to the cent at a rate that isn't whole quarter-dollars", () => {
    const idx = orcIndex({ rate: 62.5, rate_type: "hourly" });
    const notes = [note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:15am"), note("2026-09-02", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:15am")];
    const m = tr.attachBilling(tr.build(notes, idx), [], idx, billing);
    const block = tr.render(m, { kind: "project", path: ORCHARD_WEB }, "s");
    const sheetBlock = tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s");
    // 15 minutes at $62.50 is $15.625 a day: $15.63 each day, as each day's invoice row bills it. The
    // timesheet is about time and shows no amounts (OBS-117).
    const sheet = section(sheetBlock, "### Billable time");
    assert.ok(sheetBlock.includes("### Billable time: 0.50 hrs"));
    assert.ok(sheet.includes("|  | **[[2026-09-02\\|Wed 9/2]]** |  | **0.25** |  |  |  |"));
    assert.ok(block.includes("| **Total** | **0.50** | **0.50** |  | **0.50** | **$31.26** |"), "Earned is priced the same way");
    const rows = billing.snapshot(m.entries, m, tr);
    assert.equal(billing.rows(rows).reduce((s, r) => s + r.amount, 0), 3126, "and so is the invoice");
});

test("review: a billed entry shows the invoice that billed it, at whatever rate, in the timesheet", () => {
    const idx = orcIndex({ rate: 100, rate_type: "hourly" });
    const m0 = tr.build([note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am")], idx);
    // Billed at $80 an hour; the project's rate is $100 now
    const inv = orcInvoice("1001-ORC", "sent", [["2026-09-01", "9:00am", "10:00am"]], { invoice_date: "2026-09-04" });
    const m = tr.attachBilling(m0, [inv], idx, billing);
    const sheet = section(tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s"), "### Billable time");
    assert.ok(sheet.includes("| 🕒 |  | 9:00am - 10:00am | 1.00 | Charts |  | [[1001-ORC]] |"), sheet.join("\n"));
    assert.equal(sheet[2], "|  | **[[2026-09-01\\|Tue 9/1]]** |  | **1.00** |  |  |  |", "no Total row: the total is in the heading");
});

test("timesheet: 🆓 time has the status and Invoice columns; a 🆓 entry an invoice billed is ⚠️", () => {
    const idx = orcIndex();
    // 1001 billed 9:00am - 9:50am, which was made 🆓 since; 3:00pm - 3:30pm is 🆓 and on no invoice, so
    // it says nothing about an invoice
    const notes = [
        note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:50am: 🆓 my mistake\n\t- 11:00am - 11:30am"),
        note("2026-09-02", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 3:00pm - 3:30pm: 🆓"),
    ];
    const inv = orcInvoice("1001-ORC", "paid", [["2026-09-01", "9:00am", "9:50am"], ["2026-09-01", "11:00am", "11:30am"]], { paid: "2026-09-15", invoice_date: "2026-09-04" });
    const m = tr.attachBilling(tr.build(notes, idx), [inv], idx, billing);
    const block = tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s");
    assert.ok(block.includes("### 🆓 time: 1.50 hrs"), block);
    const free = section(block, "### 🆓 time");
    assert.equal(free[0], "|  | Date | Time | Hours | Task | Notes | Invoice |");
    assert.ok(free.includes("| ⚠️ |  | 9:00am - 9:50am | 1.00 | Charts | 🆓 my mistake | [[1001-ORC]] |"), free.join("\n"));
    assert.ok(free.includes("|  |  | 3:00pm - 3:30pm | 0.50 | Charts | 🆓 |  |"), free.join("\n"));
    assert.ok(section(block, "### Billable time").includes("| ✅ |  | 11:00am - 11:30am | 0.50 | Charts |  | [[1001-ORC]] |"));
});

test("timesheet: Problems say why each ⚠️ entry is ⚠️, as the project's note does, drafts too; with nothing to say, no Problems (OBS-143)", () => {
    const idx = orcIndex();
    // 1001 (paid) billed 9/1 9:00am - 9:50am, made 🆓 since, and 9/2 3:00pm - 3:30pm, gone since; the
    // draft 1002 billed 9/1 1:00pm - 2:30pm, which now runs to 2:45pm
    const notes = [
        note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:50am: 🆓 my mistake\n\t- 11:00am - 11:30am\n\t- 1:00pm - 2:45pm"),
        note("2026-09-03", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am"),
    ];
    const invoices = [
        orcInvoice("1001-ORC", "paid", [["2026-09-01", "9:00am", "9:50am"], ["2026-09-02", "3:00pm", "3:30pm"]], { paid: "2026-09-15", invoice_date: "2026-09-04" }),
        orcInvoice("1002-ORC", "draft", [["2026-09-01", "1:00pm", "2:30pm"]]),
    ];
    const m = tr.attachBilling(tr.build(notes, idx), invoices, idx, billing);
    const block = tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s");
    assert.equal(block.split("\n").filter((l) => l.startsWith("| ⚠️ |")).length, 2, block);
    assert.deepEqual(section(block, "### Problems"), [
        "- [[1001-ORC]] (paid 9/15): [[2026-09-01|9/1/26]] 9:00am - 9:50am was billed, now 🆓",
        "- [[1001-ORC]] (paid 9/15): 9/2/26 3:00pm - 3:30pm `Charts` was billed, but now it's missing from [[2026-09-02|the daily note]]; put it back there to settle it",
        "- [[1002-ORC]] (draft): [[2026-09-01|9/1/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm; rebuild it",
    ]);
    assert.ok(block.startsWith(`%% time:start %%\n*Updated s*\n\n${PROBLEMS}\n> - `), "Problems come first, as a callout (OBS-167)");
    // The project's note says the same, the draft included
    const project = tr.render(m, { kind: "project", path: ORCHARD_WEB }, "s");
    assert.deepEqual(section(project, "### Problems"), section(block, "### Problems"));
    // Nothing ⚠️ and nothing changed: no Problems heading at all
    const clean = tr.attachBilling(tr.build(ORC_NOTES, idx), [orcInvoice("1003-ORC", "sent", [["2026-09-01", "9:00am", "9:50am"]], { invoice_date: "2026-09-04" })], idx, billing);
    assert.ok(!tr.render(clean, { kind: "timesheet", path: ORCHARD_WEB }, "s").includes(PROBLEMS));
    assert.ok(!tr.render(SMALL, { kind: "timesheet", path: ORCHARD_WEB }, "s").includes(PROBLEMS));
});

test("timesheet: an entry that overlaps billed time whose own entry is still there gets a Problem of its own (OBS-143)", () => {
    const idx = orcIndex();
    // 1:00pm - 2:30pm is billed and unchanged; 2:00pm - 3:00pm was added on top of it since
    const notes = [note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 1:00pm - 2:30pm\n\t- 2:00pm - 3:00pm")];
    const inv = orcInvoice("1001-ORC", "sent", [["2026-09-01", "1:00pm", "2:30pm"]], { invoice_date: "2026-09-04" });
    const m = tr.attachBilling(tr.build(notes, idx), [inv], idx, billing);
    const block = tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s");
    assert.ok(section(block, "### Billable time").some((l) => l.startsWith("| ⚠️ |  | 2:00pm - 3:00pm |")), block);
    // The overlap itself is listed first, as on the project's note (OBS-132), which marks the billed row ⚠️ too
    assert.ok(section(block, "### Billable time").some((l) => l.startsWith("| ⚠️ |  | 1:00pm - 2:30pm |")), block);
    assert.deepEqual(section(block, "### Problems"), [
        "- [[2026-09-01|9/1/26]] line 3: `- 2:00pm - 3:00pm` overlaps 1:00pm - 2:30pm (line 2)",
        "- [[1001-ORC]] (sent 9/4): [[2026-09-01|9/1/26]] 1:00pm - 2:30pm was billed, and 2:00pm - 3:00pm overlaps it",
    ]);
    // On a draft, it doesn't say to rebuild: Rebuild would bill both entries, overlap and all
    const draft = tr.attachBilling(tr.build(notes, idx), [orcInvoice("1002-ORC", "draft", [["2026-09-01", "1:00pm", "2:30pm"]])], idx, billing);
    assert.deepEqual(section(tr.render(draft, { kind: "timesheet", path: ORCHARD_WEB }, "s"), "### Problems").slice(1),
        ["- [[1002-ORC]] (draft): [[2026-09-01|9/1/26]] 1:00pm - 2:30pm was billed, and 2:00pm - 3:00pm overlaps it"]);
});

test("timesheet: its project's entry Problems come first, as its note has them, and mark the rows they name ⚠️ (OBS-132)", () => {
    const idx = orcIndex();
    // 9/1: two entries overlap, and 1:00pm - 2:00pm was billed on 1001 as 1:00pm - 2:30pm; 9/2: 🆓 on the
    // task line and on its entry; 9/3: a running clock, which has no row, and a 13-hour entry
    const notes = [
        note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am\n\t- 9:30am - 10:30am\n\t- 1:00pm - 2:00pm"),
        note("2026-09-02", "- [x] Fix 🆓 [[Orchard Lane Web 2026|⭕]]\n\t- 3:00pm - 3:30pm: 🆓 twice"),
        note("2026-09-03", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 4:00pm - \n- [x] Map [[Orchard Lane Web 2026|⭕]]\n\t- 6:00am - 7:00pm"),
    ];
    const inv = orcInvoice("1001-ORC", "sent", [["2026-09-01", "1:00pm", "2:30pm"]], { invoice_date: "2026-09-04" });
    const m = tr.attachBilling(tr.build(notes, idx), [inv], idx, billing);
    const block = tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s");
    const problems = section(block, "### Problems");
    assert.deepEqual(problems, [
        "- [[2026-09-01|9/1/26]] line 3: `- 9:30am - 10:30am` overlaps 9:00am - 10:00am (line 2)",
        "- [[2026-09-02|9/2/26]] line 2: `- 3:00pm - 3:30pm: 🆓 twice` has 🆓 here and on the line above; one is enough",
        "- [[2026-09-03|9/3/26]] line 2: `- 4:00pm -` clock still running (no end time), so it isn't counted",
        "- [[2026-09-03|9/3/26]] line 4: `- 6:00am - 7:00pm` is 13.00 hours long",
        "- [[1001-ORC]] (sent 9/4): [[2026-09-01|9/1/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:00pm",
    ]);
    // The same entry Problems as the project's note, which has the invoice's line too
    assert.deepEqual(section(tr.render(m, { kind: "project", path: ORCHARD_WEB }, "s"), "### Problems"), problems);
    // Every row a line names is ⚠️, both sides of the overlap included; nothing else is
    const warned = block.split("\n").filter((l) => l.startsWith("| ⚠️ |")).map((l) => l.split(" | ")[2]);
    assert.deepEqual(warned, ["6:00am - 7:00pm", "9:00am - 10:00am", "9:30am - 10:30am", "1:00pm - 2:00pm", "3:00pm - 3:30pm"]);
});

test("timesheet: a Problem on a task or event line, or a ⭕ and ⋯ that disagree, marks the entries under it ⚠️ (OBS-132)", () => {
    const HAWK = "20 Projects/Freelance/Hawk/Hawk.md";
    const idx = tr.makeIndex([
        { path: ORCHARD, tags: ["project"], props: { rate: "80", rate_type: "hourly" } },
        { path: ORCHARD_WEB, tags: ["project"] },
        { path: HAWK, tags: ["project"], props: { rate: "50", rate_type: "hourly" } },
        { path: "20 Projects/Freelance/Hawk/Send the invoice.md", tags: ["task"] },
    ]);
    // A 🆓 stuck to the task's text, so it doesn't count; a 🆓 on an event's end line, though entries
    // under the event are its time; a task line whose ⭕ is Web but whose task note is filed under Hawk
    const notes = [
        note("2026-09-01", "- [x] Fix my typo🆓 [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:30am\n\t- 10:00am - 10:30am\n- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 11:00am - 11:30am"),
        note("2026-09-02", "- [<] 9:00am\tReview call [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:30am\n\t- 10:00am: 🆓"),
        note("2026-09-03", "- [x] Send the invoice [[Orchard Lane Web 2026|⭕]] [[Send the invoice|⋯]]\n\t- 9:00am - 10:00am"),
    ];
    const m = tr.attachBilling(tr.build(notes, idx), [], idx, billing);
    const block = tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s");
    const problems = section(block, "### Problems");
    assert.equal(problems.length, 3, block);
    assert.ok(problems[0].includes("has a 🆓 that isn't on its own"), problems[0]);
    assert.ok(problems[1].includes("has 🆓 on its end line"), problems[1]);
    assert.ok(problems[2].includes("from a task line whose task note"), problems[2]);
    const warned = block.split("\n").filter((l) => l.startsWith("| ⚠️ |")).map((l) => l.split(" | ")[2]);
    // The line whose ⭕ and note disagree has no row: its time counts nowhere, and its Problem says so
    assert.deepEqual(warned, ["9:00am - 9:30am", "9:00am - 9:30am", "10:00am - 10:30am"]);
    assert.ok(section(block, "### Billable time").includes("|  |  | 11:00am - 11:30am | 0.50 | Charts |  |  |"), "the task with nothing wrong stays unmarked");
});

test("timesheet: a table that bills nothing gets the ⚠️ column only when a row needs it (OBS-132)", () => {
    const idx = orcIndex({ rate: "500", rate_type: "flat" });
    const clean = tr.render(tr.attachBilling(tr.build(ORC_NOTES, idx), [], idx, billing), { kind: "timesheet", path: ORCHARD_WEB }, "s");
    assert.equal(section(clean, "### Billable time")[0], "| Date | Time | Hours | Task | Notes |");
    assert.ok(!clean.includes(PROBLEMS));
    const overlap = [note("2026-09-01", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 10:00am\n\t- 9:30am - 10:30am\n\t- 1:00pm - 2:00pm")];
    const sheet = section(tr.render(tr.attachBilling(tr.build(overlap, idx), [], idx, billing), { kind: "timesheet", path: ORCHARD_WEB }, "s"), "### Billable time");
    assert.deepEqual(sheet, [
        "|  | Date | Time | Hours | Task | Notes |",
        "| :-: | --- | --- | --: | --- | --- |",
        "|  | **[[2026-09-01\\|Tue 9/1]]** |  | **3.00** |  |  |",
        "| ⚠️ |  | 9:00am - 10:00am | 1.00 | Charts |  |",
        "| ⚠️ |  | 9:30am - 10:30am | 1.00 | Charts |  |",
        "|  |  | 1:00pm - 2:00pm | 1.00 | Charts |  |",
    ]);
});

test("timesheet: it lists the Problems of the projects it shows, and only theirs (OBS-132)", () => {
    const KIDS = "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Kids 2026/Orchard Lane Kids 2026.md";
    const idx = (parent = {}) => tr.makeIndex([
        { path: ORCHARD, tags: ["project"], props: { rate: "80", rate_type: "hourly", ...parent } },
        { path: ORCHARD_WEB, tags: ["project"] },
        { path: KIDS, tags: ["project"] },
    ]);
    // An overlap between the parent's own time and Web's; a 13-hour entry on Kids
    const notes = [
        note("2026-09-01", "- [x] Plan [[Orchard Lane 2026|⭕]]\n\t- 9:00am - 10:00am\n- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 9:30am - 10:30am"),
        note("2026-09-02", "- [x] Map [[Orchard Lane Kids 2026|⭕]]\n\t- 6:00am - 7:00pm"),
    ];
    const render = (index, path) => tr.render(tr.attachBilling(tr.build(notes, index), [], index, billing), { kind: "timesheet", path }, "s");
    const overlap = "- [[2026-09-01|9/1/26]] line 4: `- 9:30am - 10:30am` overlaps 9:00am - 10:00am (line 2)";
    const long = "- [[2026-09-02|9/2/26]] line 2: `- 6:00am - 7:00pm` is 13.00 hours long";
    // Each side of the overlap lists it and marks its own row
    const web = render(idx(), ORCHARD_WEB);
    assert.deepEqual(section(web, "### Problems"), [overlap]);
    assert.ok(section(web, "### Billable time").some((l) => l.startsWith("| ⚠️ |  | 9:30am - 10:30am |")), web);
    const own = render(idx(), ORCHARD);
    assert.deepEqual(section(own, "### Problems"), [overlap]);
    assert.ok(section(own, "### Billable time").some((l) => l.startsWith("| ⚠️ |  | 9:00am - 10:00am |")), own);
    // The parent's note adds up Kids, so it lists Kids' Problem; its timesheet doesn't show Kids' time, so it doesn't
    const note_ = tr.render(tr.attachBilling(tr.build(notes, idx()), [], idx(), billing), { kind: "project", path: ORCHARD }, "s");
    assert.deepEqual(section(note_, "### Problems"), [overlap, long]);
    // With include_subprojects, the timesheet shows Kids' time, and its Problem
    assert.deepEqual(section(render(idx({ include_subprojects: true }), ORCHARD), "### Problems"), [overlap, long]);
});

test("review: an invoice whose Billed entries can't be read is a Problem on its project's note", () => {
    const idx = orcIndex();
    const inv = orcInvoice("1001-ORC", "sent", [["2026-09-01", "9:00am", "9:50am"]]);
    inv.text = inv.text.replace("| 9:00am - 9:50am |", "| 09:00 - 9:50am |");
    const m = tr.attachBilling(tr.build(ORC_NOTES, idx), [inv], idx, billing);
    assert.ok(tr.render(m, { kind: "project", path: ORCHARD_WEB }, "s").includes("- [[1001-ORC]] has a Billed entries row that doesn't read, so this project can't be invoiced until it's fixed"));
    // Twice on one invoice
    const dup = orcInvoice("1002-ORC", "sent", [["2026-09-01", "9:00am", "9:50am"], ["2026-09-01", "9:00am", "9:50am"]]);
    const m2 = tr.attachBilling(tr.build(ORC_NOTES, idx), [dup], idx, billing);
    assert.ok(tr.render(m2, { kind: "project", path: ORCHARD_WEB }, "s").includes("- [[2026-09-01|9/1/26]] 9:00am - 9:50am is on [[1002-ORC]] twice"));
});

test("review: invoices are read in number order, whatever order the vault lists them", () => {
    const idx = orcIndex();
    const a = orcInvoice("1002-ORC", "sent", [["2026-09-01", "9:00am", "9:50am"]], { invoice_date: "2026-09-05" });
    const b = orcInvoice("1001-ORC", "sent", [["2026-09-01", "9:00am", "9:50am"]], { invoice_date: "2026-09-04" });
    const render = (list) => tr.render(tr.attachBilling(tr.build(ORC_NOTES, idx), list, idx, billing), { kind: "project", path: ORCHARD_WEB }, "s");
    const one = render([a, b]);
    assert.equal(one, render([b, a]));
    assert.ok(one.includes("is billed on both [[1001-ORC]] and [[1002-ORC]]"));
});

test("review: a #tag or HTML in a task or note shows as text in the timesheet", () => {
    const idx = orcIndex();
    const m = tr.attachBilling(tr.build([note("2026-09-01", "- [x] Plan #project work [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:50am: see <b>this</b> #area")], idx), [], idx, billing);
    const row = section(tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s"), "### Billable time").find((l) => l.includes("9:00am - 9:50am"));
    assert.equal(row, "|  |  | 9:00am - 9:50am | 1.00 | Plan \\#project work | see &lt;b>this&lt;/b> \\#area |  |");
});

test("render project: the block opens with its timesheet link, beside when it was updated", () => {
    const withSheet = tr.render(SMALL, { kind: "project", path: ORCHARD_WEB, sheet: "Orchard Lane Web 2026 timesheet" }, "s");
    assert.ok(withSheet.startsWith("%% time:start %%\n[[Orchard Lane Web 2026 timesheet|Timesheet]] | *Updated s*\n\n"), withSheet.slice(0, 120));
    const without = tr.render(SMALL, { kind: "project", path: ORCHARD_WEB }, "s");
    assert.ok(without.startsWith("%% time:start %%\n*Updated s*\n\n") && !without.includes("Timesheet]]"));
    // A new stamp alone isn't a change; a timesheet link that appears is
    const note = (block) => `# P\n\n## Time Report\n\n${block}\n`;
    assert.ok(tr.sameBlock(note(withSheet), withSheet.replace("*Updated s*", "*Updated t*")));
    assert.ok(!tr.sameBlock(note(without), withSheet));
    assert.equal(tr.sheetPath(ORCHARD_WEB), "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Web 2026/Orchard Lane Web 2026 timesheet.md");
    assert.equal(tr.sheetNote("1", "[[A|⭕.A]]", "B"), '---\nid: 1\ntags:\n  - timesheet\nparent: "[[A|⭕.A]]"\n---\n\nB\n', "no heading: the whole note is the report (OBS-167)");
    assert.match(tr.render(SMALL, { kind: "timesheet", path: "20 Projects/Freelance/Nobody/Nobody.md" }, "s"), /No time entries\.\n%% time:end %%$/);
});

test("OBS-167: a timesheet's report has no heading; the one above an existing timesheet's block goes", () => {
    const sheet = (body) => `---\ntags:\n  - timesheet\n---\n\n${body}\n`;
    const write = (content) => { const edits = tr.blockEdits(content, BLOCK, { heading: false }); return edits.error ? edits : edits.reduce(apply, content); };
    // The heading above the block goes, with the blank line under it, even when the block is unchanged
    assert.equal(write(sheet(`## Time Report\n\n${BLOCK}`)), sheet(BLOCK));
    assert.equal(write(sheet("## Time tracking\n\n%% time:start %%\nold\n%% time:end %%")), sheet(BLOCK));
    assert.deepEqual(plain(tr.blockEdits(sheet(BLOCK), BLOCK, { heading: false })), [], "and the next run has nothing to do");
    // A heading that isn't right above the block, or a hidden line between them, stays
    assert.equal(write(sheet(`## Time Report\n\nMine\n\n${BLOCK}`)), sheet(`## Time Report\n\nMine\n\n${BLOCK}`));
    assert.equal(write(sheet(`## Time Report\n%% kept %%\n${BLOCK}`)), sheet(`## Time Report\n%% kept %%\n${BLOCK}`));
    // A timesheet whose block was deleted gets it back at the end, with no heading
    assert.equal(write(sheet("Notes")), sheet(`Notes\n\n${BLOCK}`));
    // Project notes keep theirs
    assert.equal(write(sheet(BLOCK)).includes("## Time Report"), false);
    assert.equal(tr.blockEdits(sheet("Notes"), BLOCK).reduce(apply, sheet("Notes")), sheet(`Notes\n\n## Time Report\n\n${BLOCK}`));
});

test("OBS-215, reversing a final review: a billed entry moved to another day isn't guessed at; its row is missing, and the entry isn't marked", () => {
    const idx = orcIndex();
    const inv = orcInvoice("1001-ORC", "sent", [["2026-09-02", "3:00pm", "3:30pm"]], { invoice_date: "2026-09-04" });
    const moved = [ORC_NOTES[0], note("2026-09-02", "- [x] Other [[Orchard Lane Web 2026|⭕]]\n\t- 9:00am - 9:15am"), note("2026-09-03", "- [x] Charts [[Orchard Lane Web 2026|⭕]]\n\t- 3:00pm - 3:30pm")];
    const m = tr.attachBilling(tr.build(moved, idx), [inv], idx, billing);
    const row = section(tr.render(m, { kind: "timesheet", path: ORCHARD_WEB }, "s"), "### Billable time").find((l) => l.includes("3:00pm - 3:30pm"));
    assert.match(row, /^\|  \|  \| 3:00pm - 3:30pm \| /, "not ⚠️: nothing ties it to the billed row");
    assert.ok(tr.render(m, { kind: "project", path: ORCHARD_WEB }, "s").includes("- [[1001-ORC]] (sent 9/4): 9/2/26 3:00pm - 3:30pm `Charts` was billed, but now it's missing from [[2026-09-02|the daily note]]; put it back there to settle it"));
});

// writeTimesheet against a stub of the little of `app` it uses
const sheetHarness = ({ files = {}, desktop = true, remembered = [], createFails = false } = {}) => {
    const created = [], writes = [];
    const file = (path) => ({ path, basename: path.split("/").pop().replace(/\.md$/, "") });
    const context = {
        customJS: { obsidian: { Platform: { isDesktop: desktop } } },
        window: { moment: () => ({ format: () => "2026092812000000" }) },
        console: { ...console, warn: () => {}, error: () => {} },
        app: {
            vault: {
                getFileByPath: (p) => (files[p] || created.includes(p) || p === ORCHARD_WEB ? file(p) : null),
                create: async (p) => { if (createFails) throw new Error("clash"); created.push(p); return file(p); },
            },
            metadataCache: { getFileCache: () => ({ frontmatter: { aliases: ["⭕.Freelance.Orchard Lane 2026.Orchard Lane Web 2026"] } }), fileToLinktext: (f) => f.basename },
            loadLocalStorage: () => remembered, saveLocalStorage: () => {},
        },
    };
    const Loaded = vm.runInContext(fs.readFileSync(new URL("../CustomJS/timeReport.js", here), "utf8") + "\n;TimeReport", vm.createContext(context));
    const report = new Loaded();
    report.writeBlock = async (f) => { writes.push(f.path); return { wrote: true }; };
    return { report, created, writes };
};
const SHEET = "20 Projects/Freelance/Orchard Lane 2026/Orchard Lane Web 2026/Orchard Lane Web 2026 timesheet.md";

test("final review: writeTimesheet makes, refreshes, or leaves a timesheet alone", async () => {
    const run = async (opts, sheets = new Map()) => {
        const h = sheetHarness(opts);
        const broken = [], made = [];
        const link = await h.report.writeTimesheet(SMALL, ORCHARD_WEB, sheets, new Set(opts.remembered ?? []), "s", (p) => p, broken, made);
        return { link, broken, made, created: h.created, writes: h.writes };
    };
    // None yet, on the desktop: made, announced, linked
    assert.deepEqual(plain(await run({})), { link: "Orchard Lane Web 2026 timesheet", broken: [], made: ["Orchard Lane Web 2026 timesheet"], created: [SHEET], writes: [] });
    // Its own, tagged: refreshed
    assert.deepEqual(plain(await run({ files: { [SHEET]: true } }, new Map([[ORCHARD_WEB, SHEET]]))), { link: "Orchard Lane Web 2026 timesheet", broken: [], made: [], created: [], writes: [SHEET] });
    // A note of yours with its name, not tagged: left alone, and not linked
    assert.deepEqual(plain(await run({ files: { [SHEET]: true } })), { link: null, broken: [], made: [], created: [], writes: [] });
    // Deleted after this device made it, or on a phone: not made again
    assert.equal((await run({ remembered: [SHEET] })).link, null);
    assert.equal((await run({ desktop: false })).link, null);
    // Making it fails: said, by its own name, and the project's report still goes ahead
    assert.deepEqual(plain(await run({ createFails: true })), { link: null, broken: ["Orchard Lane Web 2026 timesheet"], made: [], created: [], writes: [] });
});

// ------------------------------------------------------------------ parent, once area (OBS-175)

test("parentValue: a note's `parent`, else the older `area`, in any spelling; empty is none", () => {
    assert.equal(tr.parentValue({ parent: "[[A]]" }), "[[A]]");
    assert.equal(tr.parentValue({ area: "[[A]]" }), "[[A]]");
    assert.equal(tr.parentValue({ Parent: ["[[A]]", "[[B]]"] }), "[[A]]");
    assert.equal(tr.parentValue({ parent: "[[A]]", area: "[[B]]" }), "[[A]]", "parent wins");
    assert.equal(tr.parentValue({ parent: "", area: "[[B]]" }), "[[B]]", "an empty parent, as a new note has, falls back");
    assert.equal(tr.parentValue({ parent: null }), null);
    assert.equal(tr.parentValue({}), null);
    assert.equal(tr.parentValue(null), null);
});

test("makeIndex: a note that still has `area` belongs where it did, and `parent` wins over it", () => {
    const idx = tr.makeIndex([
        { path: "P/Orchard/Orchard.md", tags: ["project"] },
        { path: "P/Other/Other.md", tags: ["project"] },
        { path: "Notes/Old.md", tags: ["task"], area: "[[Orchard]]" },
        { path: "Notes/New.md", tags: ["task"], parent: "[[Orchard]]" },
        { path: "Notes/Both.md", tags: ["task"], parent: "[[Other]]", area: "[[Orchard]]" },
    ]);
    assert.equal(idx.parentLink("Notes/Old.md"), "[[Orchard]]");
    assert.equal(tr.projectOfNote("Notes/Old.md", idx), "P/Orchard/Orchard.md");
    assert.equal(tr.projectOfNote("Notes/New.md", idx), "P/Orchard/Orchard.md");
    assert.equal(tr.projectOfNote("Notes/Both.md", idx), "P/Other/Other.md");
});

test("taskText and itemLabel leave out a task's ID and its forward date (OBS-185)", () => {
    const body = "[x] Draft homepage wireframes [[2026-09-18|🚩 9/18]] [[Kestrel Outfitters 2026|⭕]] [[Draft homepage wireframes|⋯]] ^w2h5nf";
    assert.equal(tr.taskText(body), "Draft homepage wireframes");
    assert.equal(tr.taskText("[>] Book it [[2026-10-08#^k3x9m2|10/8]] ^k3x9m2"), "Book it");
    assert.equal(tr.itemLabel("- [ ] Book the photographer [[Kestrel|⭕]] ^k3x9m2"), "Book the photographer ⭕");
    assert.equal(tr.taskText("[>] Book it [[2026w41#^k3x9m2|Wk of 10/4]] [[Kestrel|⭕]] ^k3x9m2"), "Book it");
    assert.equal(tr.taskText("[>] Book it [[2026-10-08#^k3x9m2|➡️ 10/8]] ^k3x9m2"), "Book it", "one written with a ➡️");
    assert.equal(tr.itemLabel("- [>] Book it [[2026-10-08#^k3x9m2|10/8]] [[Kestrel|⭕]] ^k3x9m2"), "Book it ⭕");
    assert.equal(tr.itemLabel("- [>] Book it [[2026-10-08#^k3x9m2|➡️ 10/8]] ^k3x9m2"), "Book it");
    // A block link of your own to a day's line is text, read as its alias
    assert.equal(tr.taskText("[/] Prep for [[2026-09-15#^abc123|Monday's call]] agenda [[Kestrel|⭕]] ^q1w2e3"), "Prep for Monday's call agenda");
    assert.equal(tr.itemLabel("- [/] Prep for [[2026-09-15#^abc123|Monday's call]] agenda [[Kestrel|⭕]] ^q1w2e3"), "Prep for Monday's call agenda ⭕");
});

test("lineLinks: a forward date after the ⭕ doesn't end the run (OBS-185)", () => {
    for (const f of ["[[2026-09-20#^k3x9m2|9/20]]", "[[2026w38#^k3x9m2|Wk of 9/13]]", "[[2026-09-20|➡️ 9/20]]"]) {
        const l = tr.lineLinks(`[>] Book it [[Kestrel|⭕]] ${f} ^k3x9m2`);
        assert.deepEqual(plain(l.marks.map((m) => m.target)), ["Kestrel"], f);
    }
});

test("lineProject: its own ⭕, a line it's nested under, its note's, or the note it's in (OBS-185)", () => {
    const KES = "Projects/Freelance/Kestrel/Kestrel.md";
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book it ^k3x9m2\n" } });
    const t = v.customJS.TimeReport, index = t.appIndex();
    const day = ["- [ ] Kestrel errands [[Kestrel|⭕]]", "\t- [/] Call the printer", "- [ ] Mow the lawn"];
    assert.equal(t.lineProject({ path: `${PLANNER}/days/2026-09-17.md`, kind: "day" }, 1, day, index), KES, "from the line it's nested under");
    assert.equal(t.lineProject({ path: `${PLANNER}/days/2026-09-17.md`, kind: "day" }, 2, day, index), null);
    assert.equal(t.lineProject({ path: KES, kind: "other" }, 5, v.notes()[KES].split("\n"), index), KES, "a sent line counts as the project its note is");
});

test("addTaskProblems: a task's lines that disagree are Problems on their day and on the task's project (OBS-185)", () => {
    const KES = "Projects/Freelance/Kestrel/Kestrel.md";
    const notes = {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-16#^k3x9m2|9/16]] ^k3x9m2\n",
        [`${PLANNER}/days/2026-09-16.md`]: "- [x] Something else\n",
        [`${PLANNER}/days/2026-09-17.md`]: "- [ ] Book the photographer [[Kestrel|⭕]] ^k3x9m2\n- [ ] Book the photographer [[Kestrel|⭕]] ^k3x9m2\n",
    };
    const tr = standIn({ notes }).customJS.TimeReport;
    const model = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(model, tr.appIndex(), Object.entries(notes).map(([path, text]) => ({ path, kind: path === KES ? "other" : "day", text })));
    // Sorted by date and line, as build sorts the rest
    assert.deepEqual(plain(model.problems.map((p) => [p.rule, p.line])), [["open", 1], ["forward", 1], ["twice", 1], ["open", 2], ["twice", 2]]);
    assert.deepEqual(plain(model.projectProblems.map((p) => [p.rule, p.project])), [["forward", KES]]);
    assert.ok(model.projectProblems[0].message.includes("has its forward date on 9/16/26"), model.projectProblems[0].message);
});

test("OBS-185: a task Problem marks a timesheet and an invoice only when the lines disagree about the project", () => {
    const tr = standIn({ notes: {} }).customJS.TimeReport;
    const task = (rule) => ({ kind: "task", rule });
    assert.equal(tr.changesBilling(task("project")), true);
    for (const rule of ["open", "finished", "forward", "twice", "trailing"]) assert.equal(tr.changesBilling(task(rule)), false, rule);
    assert.equal(tr.changesBilling({ kind: "overlap" }), true, "every other Problem still counts");
    const model = { problems: [{ path: "d.md", line: 1, projects: ["P.md"], kind: "task", rule: "open", date: "2026-09-17", text: "x", message: "m" }], projectProblems: [{ project: "P.md", kind: "task", rule: "forward", message: "m" }] };
    const sheet = tr.sheetEntryProblems(model, new Set(["P.md"]), "P.md", [], (p) => p);
    assert.deepEqual(plain(sheet.lines), []);
});

test("OBS-185: the demo's report render runs the task checks too", async () => {
    const { planReports, frontmatter, loadTimeReport } = await import("./demo/renderReports.mjs");
    const vaultOf = (files) => ({ notes: new Map(Object.entries(files).map(([p, text]) => [p, { text, fm: frontmatter(text) }])) });
    const day = "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2\n- [ ] Book it [[Kestrel|⭕]] ^k3x9m2\n- [x] Draft [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n";
    const plan = planReports(loadTimeReport(), vaultOf({
        "Reference/Planner/days/2026-09-17.md": day,
        "Projects/Kestrel/Kestrel.md": "---\ntags: project\n---\n- [>] Book it [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2\n",
    }));
    assert.deepEqual(plain(plan.model.problems.map((p) => [p.date, p.line, p.rule])), [["2026-09-17", 1, "open"], ["2026-09-17", 1, "twice"], ["2026-09-17", 2, "open"], ["2026-09-17", 2, "twice"]]);
});

// A task sent from Kestrel's note whose day line names Household: two projects (OBS-185)
const DISAGREE = (extra = {}) => {
    const KES = "Projects/Freelance/Kestrel/Kestrel.md", HOME = "Projects/Personal/Household/Household.md", DAY = `${PLANNER}/days/2026-09-17.md`;
    const notes = {
        [KES]: "---\ntags: [project]\n---\n- [>] Book it [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2\n",
        [HOME]: `---\ntags: [project]\n${extra.homeStatus ? `status: ${extra.homeStatus}\n` : ""}---\nHome.\n`,
        [DAY]: "- [ ] Book it [[Household|⭕]] ^k3x9m2\n",
    };
    const tr = standIn({ notes }).customJS.TimeReport;
    const list = Object.entries(notes).map(([path, text]) => ({ path, kind: path === DAY ? "day" : "other", text }));
    return { KES, HOME, DAY, tr, list };
};

test("OBS-185: a project disagreement shows on every project the task names, and counts for billing there", () => {
    const { KES, HOME, tr, list } = DISAGREE();
    const model = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(model, tr.appIndex(), list);
    assert.deepEqual(plain(model.problems.map((p) => [p.rule, p.projects.slice().sort()])), [["project", [HOME, KES].sort()]]);
    assert.deepEqual(plain(model.projectProblems.map((p) => [p.rule, p.project]).sort()), [["project", KES], ["project", HOME]]);
    for (const project of [KES, HOME]) {
        const sheet = tr.sheetEntryProblems(model, new Set([project]), project, [], (p) => p);
        assert.ok(sheet.lines.some((l) => /don't name the same project|task line/.test(l)), `${project}: ${sheet.lines}`);
    }
});

test("OBS-185: a line whose time is on a sent or paid invoice may keep its project; so may one in a finished project", () => {
    for (const status of ["sent", "paid"]) {
        const { DAY, tr, list } = DISAGREE();
        const entries = [{ path: DAY, context: [{ line: 1 }] }];
        const billing = { billing: { standing: () => ({ invoice: { status } }) }, ledger: {} };
        const model = { problems: [], projectProblems: [], entries, billing };
        tr.addTaskProblems(model, tr.appIndex(), list);
        assert.deepEqual(plain(model.problems.filter((p) => p.rule === "project")), [], `invoiced (${status})`);
        const draft = { problems: [], projectProblems: [], entries, billing: { billing: { standing: () => ({ invoice: { status: "draft" } }) }, ledger: {} } };
        tr.addTaskProblems(draft, tr.appIndex(), list);
        assert.equal(draft.problems.filter((p) => p.rule === "project").length, 1, "a draft invoice is no exemption");
    }
    // Household is Done: the stand-in's own AddTaskNote.isLiveHome says it's finished
    const { tr, list } = DISAGREE({ homeStatus: "Done" });
    const model = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(model, tr.appIndex(), list);
    assert.deepEqual(plain(model.problems.filter((p) => p.rule === "project")), [], "finished");
});

test("OBS-213: a task moved off an archived project reads it as the report does, and keeps it like a finished one", () => {
    const OLD = "Archive/Freelance/Kestrel/Kestrel.md", HOME = "Projects/Personal/Household/Household.md";
    const D16 = `${PLANNER}/days/2026-09-16.md`, D17 = `${PLANNER}/days/2026-09-17.md`;
    const notes = {
        [OLD]: "---\ntags: [project]\n---\nOld.\n",
        [HOME]: "---\ntags: [project]\n---\nHome.\n",
        [D16]: "- [>] Book it [[Kestrel|⭕]] [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2\n",
        [D17]: "- [ ] Book it [[Household|⭕]] ^k3x9m2\n",
    };
    const tr = standIn({ notes }).customJS.TimeReport;
    const list = Object.entries(notes).map(([path, text]) => ({ path, kind: path.includes("/days/") ? "day" : "other", text }));
    const index = tr.appIndex();
    assert.equal(tr.lineProject(list[2], 0, notes[D16].split("\n"), index, false), OLD, "the check reads the archived ⭕");
    assert.equal(tr.lineProject(list[2], 0, notes[D16].split("\n"), index), null, "a command passes over it");
    const model = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(model, index, list);
    assert.deepEqual(plain(model.problems.filter((p) => p.rule === "project")), [], "the archived line keeps its project, as a finished one does");
});

test("OBS-185: a task Problem on no day and no project is listed too, dated by its note's period or its forward date, and linked to its note", () => {
    const IN = "Inbox/Errands.md", CH = "Inbox/Chores.md", W = `${PLANNER}/weeks/2026w38.md`;
    const notes = {
        // Its day line deleted by hand
        [IN]: "- [>] Return the library books [[2026-09-17#^abc123|9/17]] ^abc123\n",
        [`${PLANNER}/days/2026-09-17.md`]: "- [ ] Something else\n",
        // Copied by hand in a week note
        [W]: "- [ ] Water the plants [[Errands|⋯]] ^def456\n- [ ] Water the plants [[Errands|⋯]] ^def456\n",
        [CH]: "- [>] Water the plants [[2026w38#^def456|Wk of 9/13]] ^def456\n",
    };
    const v = standIn({ notes });
    const tr = v.customJS.TimeReport;
    const list = Object.keys(notes).map((path) => ({ path, kind: v.customJS.TaskIds.kindOf(v.app.vault.getFileByPath(path)), text: notes[path] }));
    const model = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(model, tr.appIndex(), list);
    assert.deepEqual(plain(model.projectProblems), []);
    assert.deepEqual(plain(model.problems.map((p) => [p.date, p.note, p.line, p.rule])), [
        ["2026-09-13", W, 1, "open"], ["2026-09-13", W, 1, "twice"], ["2026-09-13", W, 2, "open"], ["2026-09-13", W, 2, "twice"], ["2026-09-17", IN, 1, "forward"],
    ]);
    // The whole report lists them, each with a link to the note it's in
    const { problems } = tr.inScope({ ...model, parent: new Map() }, { kind: "all" });
    const lines = tr.problemLines(model, problems, [], [], (p) => p);
    assert.equal(lines.length, 5);
    assert.ok(lines[0].startsWith(`- [[${W.replace(/\.md$/, "")}|2026w38]] line 1: \``), lines[0]);
    assert.ok(lines[4].startsWith("- [[Inbox/Errands|Errands]] line 1: `- [>] Return the library books"), lines[4]);
});

test("OBS-185: the open-twice Problem for a sent line a click turned into [ ] says to set it back, on both lines; a copy keeps the copy advice", async () => {
    const KES = "Projects/Freelance/Kestrel/Kestrel.md", DAY = `${PLANNER}/days/2026-09-17.md`;
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Book the photographer\n" }, open: KES, at: 5 });
    await v.schedule("2026-09-17");
    // One click on the project note's [>] box
    v.app.workspace.activeLeaf.view.editor.replaceRange(" ", { line: 5, ch: 3 }, { line: 5, ch: 4 });
    const tr = v.customJS.TimeReport;
    const said = (c) => Object.fromEntries(c.lines.map((l) => [l.path, tr.taskProblemText(c, l)]));
    const [open] = v.check();
    assert.equal(open.rule, "open");
    const fix = "set it back to `[>]`, or Schedule it, which moves the task and puts the `[>]` back";
    assert.deepEqual(said(open), {
        [KES]: `is a sent line a click turned from \`[>]\` into \`[ ]\`, so its task is open here and at [[2026-09-17|9/17/26]] line 2; ${fix}`,
        [DAY]: `is open, and so is the same task at [[Kestrel|Kestrel]] line 6; [[Kestrel|Kestrel]] line 6 is a sent line a click turned from \`[>]\` into \`[ ]\`: ${fix}`,
    });
    // A line copied by hand to another day: the copy advice, as before
    const w = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n- [>] Book it [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2\n", [DAY]: "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2\n", [`${PLANNER}/days/2026-09-18.md`]: "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2\n" } });
    const copy = w.check().find((c) => c.rule === "open");
    for (const text of Object.values(said(copy))) assert.match(text, /a line copied by hand keeps its ID \(\^k3x9m2\): take it off the copy$/);
});

// ------------------------------------------------------------------ the top of a line's nest (OBS-193)

test("nestTop: the outermost checklist line a line sits under, plain bullets and indented text skipped; a top-level line is its own (OBS-193)", () => {
    const lines = [
        "- [ ] Task [[K|⭕]]",            // 0
        "\t- 9:00am - 9:30am",            // 1: a time entry
        "\t- [ ] Sub",                    // 2
        "\t\t- [x] Deep",                 // 3
        "\t\t\t- 10:00am - 10:30am",      // 4
        "\t- note",                       // 5: a plain bullet
        "\t\t- [ ] Under a note",         // 6
        "",                               // 7
        "\t- [ ] After a blank",          // 8
        "- Plain",                        // 9
        "\t- [ ] Under plain only",       // 10: top-level, since plain bullets above are skipped
        "Paragraph",                      // 11
        "\t- [ ] Under text",             // 12
        "- [<] 9:00am\tStandup",          // 13
        "\t- 9:30am",                     // 14
        "\t- [ ] Bring the sitemap",      // 15
        "## Heading",                     // 16
        "\t- [ ] Under a heading",        // 17
        "11:00am [[Team Meeting]]",       // 18: a meeting line in the form used before August 2025
        "\t- 11:00am - 11:45am",          // 19
        "\t- [ ] Action item",            // 20
        "- [ ] Top",                      // 21
        "%% hidden %%",                   // 22: a comment-only line is skipped
        "\t- [ ] Under a comment",        // 23
        "\t\t<!-- note -->",              // 24
        "\t\t\tcontinuation text",        // 25
        "\t\t\t\t- [ ] Deeper",           // 26
        "\t- 11:00am - 11:30am",          // 27
        "\t\t- [ ] Under an entry",       // 28
    ];
    const top = (i) => tr.nestTop((n) => lines[n], i);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 8].map(top), [0, 0, 0, 0, 0, 0, 0, 0], "everything nested under Task, a time entry and a plain bullet's children included");
    assert.equal(top(9), 9);
    assert.equal(top(10), 10, "a checklist line under nothing but plain bullets is top-level");
    assert.equal(top(12), 12, "a paragraph at the left edge ends the nest");
    assert.deepEqual([13, 14, 15].map(top), [13, 13, 13], "an event is a top too");
    assert.equal(top(17), 17, "and so does a heading");
    assert.deepEqual([18, 19, 20].map(top), [18, 18, 18], "an older meeting line is an event, and the top of its nest");
    assert.deepEqual([21, 23, 26, 28].map(top), [21, 21, 21, 21], "comment-only lines and indented text are skipped");
    assert.equal(tr.nestTop((n) => ["\t- [ ] Nested first line"][n], 0), 0, "nothing above: its own top");
});

test("topOf: the top of a line's nest, with its box and whether it's an event, told by its form (OBS-193, rule 1)", () => {
    const lines = [
        "- [ ] Task", "\t- [ ] Sub",
        "- [<] 9:00am\tStandup", "\t- [ ] Bring the sitemap",
        "- [>] [[2026-09-18|9/18]] 10:00am\tMoved event", "\t- note",
        "- [-] 1:00pm\tCanceled event", "\t- [ ] x",
        "11:00am [[Team Meeting]]", "\t- [ ] Action item",
        "- [>] Forwarded task ^abc123", "\t- [ ] y",
        "- [-] Canceled task", "- [x] Done task",
        "Text", "- plain", "11:00am - 12:00pm a stray range",
    ];
    const top = (i) => plain(tr.topOf(lines, i));
    assert.deepEqual(top(1), { at: 0, line: "- [ ] Task", box: " ", event: null });
    assert.deepEqual(top(3), { at: 2, line: "- [<] 9:00am\tStandup", box: "<", event: "event" });
    assert.deepEqual(top(5), { at: 4, line: "- [>] [[2026-09-18|9/18]] 10:00am\tMoved event", box: ">", event: "forwarded" });
    assert.deepEqual(top(7), { at: 6, line: "- [-] 1:00pm\tCanceled event", box: "-", event: "canceled" });
    assert.deepEqual(top(9), { at: 8, line: "11:00am [[Team Meeting]]", box: null, event: "meeting" });
    assert.deepEqual(top(11), { at: 10, line: "- [>] Forwarded task ^abc123", box: ">", event: null }, "a forwarded task isn't an event");
    assert.deepEqual([top(12).event, top(13).event], [null, null], "nor a canceled or done task");
    assert.deepEqual(top(14), { at: 14, line: "Text", box: null, event: null });
    assert.deepEqual(top(15), { at: 15, line: "- plain", box: null, event: null });
    assert.deepEqual(top(16).event, null, "a stray range at the left edge isn't a meeting line");
    assert.equal(tr.topOf((n) => lines[n], 1).at, 0, "an editor's lines, read one at a time");
});

test("subtreeEnd: a comment-only line inside a task's sub-bullets is skipped like a blank one (OBS-193)", () => {
    const lines = ["- [ ] T", "\t- a", "%% c %%", "\t- b", "", "\t- d", "<!-- x -->", "- [ ] N"];
    assert.equal(tr.subtreeEnd(lines, 0), 5);
    assert.equal(tr.subtreeEnd(lines, 7), 7);
});

test("review (OBS-193): subtreeEnd keeps a comment indented under the task; taskChoices still leaves out a checkbox under a loose entry", () => {
    assert.equal(tr.subtreeEnd(["- [ ] T", "\t- a", "\t%% c %%", "- [ ] N"], 0), 2);
    assert.deepEqual(plain(tr.taskChoices(["- 9:00am - 10:00am: loose entry", "\t- [ ] follow up on it", "- [ ] Real task"])).map((c) => c.label), ["Real task"]);
});
