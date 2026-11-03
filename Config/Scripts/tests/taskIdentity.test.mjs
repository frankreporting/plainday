// Scenario tests for task identity (OBS-181): the real commands on a stand-in vault, with the checks
// after every step. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { standIn, PLANNER } from "./standInVault.mjs";

const day = (d) => `${PLANNER}/days/${d}.md`;
const KES = "Projects/Freelance/Kestrel/Kestrel.md";
const KES_TEXT = "---\ntags: [project]\n---\n## To Do\n\n- [ ] Book the photographer\n";
const OTHER = "Projects/Freelance/Other/Other.md";
// The task ID on a note's first line that has one
const idIn = (text) => text.match(/\^([a-z0-9]{6})$/m)[1];
// Objects made inside the vm context have that context's prototypes; compare as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));
// A scenario, run as written and again with the cache a command behind (`lag`; Review Focus 1: in
// Obsidian a lookup made right after a write can miss the new line)
const scenario = (name, fn) => {
    for (const lag of [false, true]) test(`${name}${lag ? " (the cache a command behind)" : ""}`, () => fn({ lag }));
};

scenario("a block ID of your own that another note's line also has gets a fresh one when the line is sent", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Weekly review ^review\n", [OTHER]: "---\ntags: [project]\n---\n- [ ] Weekly review ^review\n" }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    assert.doesNotMatch(v.notes()[KES].split("\n")[5], /\^review/);
    assert.match(v.notices.join("\n"), /\^review is also on a line in another note/);
    assert.ok(v.notes()[OTHER].includes("- [ ] Weekly review ^review"), "the other note is left alone");
});

scenario("a block ID of your own that a line on a day also has: the first send gets a fresh one, and the other task stays where it is", async ({ lag }) => {
    // Onto another day, and onto the day with the other line
    for (const to of ["2026-09-18", "2026-09-16"]) {
        const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Draft the agenda ^agenda\n", [day("2026-09-16")]: "- [ ] Water the plants ^agenda\n" }, open: KES, at: 5, lag });
        assert.equal(await v.schedule(to), "Schedule for", to);
        assert.deepEqual(v.check(), [], to);
        const id = idIn(v.notes()[KES]);
        assert.notEqual(id, "agenda");
        assert.equal(v.notes()[KES].split("\n")[5], `- [>] Draft the agenda [[${to}#^${id}|${Number(to.slice(5, 7))}/${Number(to.slice(8))}]] ^${id}`);
        assert.ok(v.notes()[day(to)].includes(`- [ ] Draft the agenda [[Kestrel|⭕]] ^${id}`), to);
        assert.ok(v.notes()[day("2026-09-16")].startsWith("- [ ] Water the plants ^agenda\n"), "the other task stays");
        assert.match(v.notices.join("\n"), /\^agenda is also on a line in another note/);
    }
});

scenario("a worked-on day line whose block ID of your own an open line on another day has is forwarded with a fresh one; an untouched one isn't moved onto that day", async ({ lag }) => {
    const other = "- [ ] Water the plants ^agenda\n";
    // Forwarded to another day, and onto the day with the other line
    for (const to of ["2026-09-17", "2026-09-16"]) {
        const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-15")]: "- [/] Draft the agenda [[Kestrel|⭕]] ^agenda\n\t- 9:00am - 9:30am\n", [day("2026-09-16")]: other }, open: day("2026-09-15"), at: 0, lag });
        await v.schedule(to);
        assert.deepEqual(v.check(), [], to);
        const id = idIn(v.notes()[day("2026-09-15")]);
        assert.notEqual(id, "agenda");
        assert.equal(v.notes()[day("2026-09-15")], `- [>] Draft the agenda [[Kestrel|⭕]] ^${id}\n\t- 9:00am - 9:30am\n`, to);
        assert.ok(v.notes()[day(to)].includes(`- [/] Draft the agenda [[Kestrel|⭕]] ^${id}`), to);
        assert.ok(v.notes()[day("2026-09-16")].startsWith(other), "the other task stays");
        assert.match(v.notices.join("\n"), /\^agenda is also on a line in another note/);
    }
    // Untouched, it moves with its ID, so onto that day nothing moves; the notice doesn't call it this task
    const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-15")]: "- [ ] Draft the agenda [[Kestrel|⭕]] ^agenda\n", [day("2026-09-16")]: other }, open: day("2026-09-15"), at: 0, lag });
    const before = v.notes();
    await v.schedule("2026-09-16");
    assert.deepEqual(v.notes(), before);
    assert.equal(v.notices.at(-1), "A line on 9/16 already ends in this line's block ID ^agenda (a copy of it, or another task's), so nothing was moved; take the ID off one of them first");
});

// Every block ID that ends a line in the stand-in's notes
const idsIn = (v) => new Set(Object.values(v.notes()).flatMap((t) => [...t.matchAll(/\^([A-Za-z0-9-]+)$/gm)].map((m) => m[1])));

scenario("a day's [>] line clicked back to [ ] and scheduled is forwarded with its task's ID: one ID, and the checks say the task is open twice", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-16");
    v.open(day("2026-09-16"), 1);
    const editor = v.app.workspace.activeLeaf.view.editor;
    editor.replaceRange("\n\t- 9:00am - 9:30am", { line: 1, ch: editor.getLine(1).length });
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[KES]);
    // One click on 9/16's [>] box, then Schedule on it
    v.open(day("2026-09-16"), 1);
    editor.replaceRange(" ", { line: 1, ch: 3 }, { line: 1, ch: 4 });
    await v.schedule("2026-09-21");
    assert.deepEqual([...idsIn(v)], [id], "one ID: 9/16's time stays with its task");
    assert.equal(v.notes()[day("2026-09-16")].trim(), `- [>] Book the photographer [[Kestrel|⭕]] ^${id}\n\t- 9:00am - 9:30am`);
    assert.deepEqual(v.check().map((x) => x.rule), ["open"], "open on 9/18 and 9/21, listed; Kestrel's forward date names 9/21, one of them");
    assert.doesNotMatch(v.notices.join("\n"), /got a new ID/);
});

scenario("a worked-on day line whose open line was copied by hand to another day is forwarded with its task's ID, and the checks say it's open twice", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123\n",
        [day("2026-09-16")]: "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n",
        [day("2026-09-17")]: "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n",
    }, open: day("2026-09-16"), at: 0, lag });
    assert.deepEqual(v.check().map((x) => x.rule), ["open"]);
    await v.schedule("2026-09-18");
    assert.deepEqual([...idsIn(v)], ["abc123"], "one ID");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "- [/] Book the photographer [[Kestrel|⭕]] ^abc123");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123");
    // Open on 9/17 (the copy) and 9/18: listed; Kestrel's forward date names 9/18, one of them
    assert.deepEqual(v.check().map((x) => [x.rule, x.lines.length]), [["open", 2]], "the copy on 9/17 and the line on 9/18");
});

scenario("a worked-on task is forwarded with its ID on both lines, and no task note is made", async ({ lag }) => {
    const text = "- [/] Call the printer [[Kestrel|⭕]]\n\t- 9:00am - 9:30am\n";
    const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-16")]: text }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[day("2026-09-16")]);
    assert.equal(v.notes()[day("2026-09-16")], `- [>] Call the printer [[Kestrel|⭕]] ^${id}\n\t- 9:00am - 9:30am\n`);
    assert.equal(v.notes()[day("2026-09-18")].trim() + "\n", `- [/] Call the printer [[Kestrel|⭕]] ^${id}\n`);
    assert.deepEqual(Object.keys(v.notes()).sort(), [KES, day("2026-09-16"), day("2026-09-18")].sort(), "no note made");
    assert.deepEqual(v.notices, ["Forwarded to 9/18"]);
});

scenario("Schedule on a sub-task schedules its task: with time logged under it, it stays [>] with what has time, and a [/] copy goes with its open sub-tasks; the notice names the task (OBS-193, rule 5, OBS-210)", async ({ lag }) => {
    const text = "- [ ] Kestrel errands [[Kestrel|⭕]]\n\t- [/] Call the printer\n\t\t- 9:00am - 9:30am\n\t- [ ] Order toner\n";
    for (const at of [3, 1, 2]) {
        const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-16")]: text }, open: day("2026-09-16"), at, lag });
        await v.schedule("2026-09-18");
        assert.deepEqual(v.check(), [], `from line ${at}`);
        const id = idIn(v.notes()[day("2026-09-16")]);
        assert.equal(v.notes()[day("2026-09-16")], `- [>] Kestrel errands [[Kestrel|⭕]] ^${id}\n\t- [/] Call the printer\n\t\t- 9:00am - 9:30am\n`, `from line ${at}`);
        assert.equal(v.notes()[day("2026-09-18")].trim(), `- [/] Kestrel errands [[Kestrel|⭕]] ^${id}\n\t- [ ] Order toner`, `from line ${at}`);
        assert.equal(v.notices.at(-1), 'Forwarded "Kestrel errands" to 9/18', `from line ${at}`);
    }
    // From the task's own line the notice is as before
    const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-16")]: text }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.equal(v.notices.at(-1), "Forwarded to 9/18");
});

scenario("Schedule on a line nested under a task in a note sends that task, with its open sub-task (OBS-193, rule 5; Brian, 2026-10-26)", async ({ lag }) => {
    const INBOX = "Inbox/Inbox.md", SUB = "Projects/Freelance/Kestrel/Catalog/Catalog.md";
    // From a note in the Inbox folder, which is in no project: the line's ⭕ gives way (rule 13; Brian, 2026-10-31,
    // a note there gets its project by being filed), with a ↗ back to its note. The [>] line isn't touched
    let v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n", [INBOX]: "- [ ] Website [[Kestrel|⭕]]\n\t- [ ] Fix the header\n" }, open: INBOX, at: 1, lag });
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    let id = idIn(v.notes()[INBOX]);
    assert.equal(v.notes()[INBOX], `- [>] Website [[2026-09-18#^${id}|9/18]] [[Kestrel|⭕]] ^${id}\n`);
    assert.equal(v.notes()[day("2026-09-18")].trim(), `- [ ] Website [[Inbox#^${id}|↗]] ^${id}\n\t- [ ] Fix the header`);
    assert.equal(v.notices.at(-1), 'Forwarded "Website" to 9/18');
    // From a project note, under a line naming a project inside it: the note's own project, Kestrel, since a
    // line outside a periodic note has no project of its own (rules 4 and 13, OBS-208); its ⭕ Catalog stays on
    // the [>] line, counting for nothing, so both lines read Kestrel
    v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Catalog work [[Catalog|⭕]]\n\t- [ ] Book the photographer\n", [SUB]: "---\ntags: [project]\n---\n" }, open: KES, at: 6, lag });
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    id = idIn(v.notes()[KES]);
    assert.equal(v.notes()[KES].split("\n").slice(5).join("\n"), `- [>] Catalog work [[2026-09-18#^${id}|9/18]] [[Catalog|⭕]] ^${id}\n`);
    assert.equal(v.notes()[day("2026-09-18")].trim(), `- [ ] Catalog work [[Kestrel|⭕]] ^${id}\n\t- [ ] Book the photographer`);
    // Under a step in a task note, the step is sent
    const NOTE = "Projects/Freelance/Kestrel/Draft wireframes.md";
    v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n", [NOTE]: "---\ntags: [task]\n---\n- [ ] Mobile layout\n\t- [ ] Nav first\n" }, open: NOTE, at: 4, lag });
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    id = idIn(v.notes()[NOTE]);
    assert.equal(v.notes()[NOTE].split("\n").slice(3).join("\n"), `- [>] Mobile layout [[2026-09-18#^${id}|9/18]] ^${id}\n`);
    assert.equal(v.notes()[day("2026-09-18")].trim(), `- [ ] Mobile layout [[Kestrel|⭕]] [[Draft wireframes#^${id}|↗]] ^${id}\n\t- [ ] Nav first`);
});

scenario("a task's open line nested by hand under another task is that task's sub-task: Schedule on the task's [>] line writes a fresh copy, and the ID on the sub-task counts for nothing (OBS-193, OBS-196, rule 5)", async ({ lag }) => {
    for (const time of ["", "\n\t\t- 10:00am - 10:30am"]) {
        const v = standIn({ notes: {
            [KES]: "---\ntags: [project]\n---\n",
            [day("2026-09-16")]: "- [>] Call the printer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n",
            [day("2026-09-18")]: `- [ ] Kestrel errands [[Kestrel|⭕]]\n\t- [ ] Call the printer ^abc123${time}\n`,
        }, open: day("2026-09-16"), at: 0, lag });
        const before = v.notes()[day("2026-09-18")];
        assert.equal(await v.schedule("2026-09-21"), "Schedule for", "no open line of the task: the nested one is Kestrel errands' sub-task");
        assert.equal(v.notes()[day("2026-09-18")], before, "left as it is");
        assert.equal(v.notes()[day("2026-09-21")].trim(), "- [ ] Call the printer [[Kestrel|⭕]] ^abc123", "a fresh copy is open, as before");
        assert.deepEqual(v.check(), [], "the sub-task's ID isn't the task's: the report lists it as a mark on a sub-task");
    }
});

scenario("Schedule on a sent line nested under a task in a note sends the task at the top, and the nested line stays under it as it is (OBS-193, rule 5)", async ({ lag }) => {
    const INBOX = "Inbox/Inbox.md";
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n", [INBOX]: "- [ ] Website [[Kestrel|⭕]]\n\t- [>] Fix the header [[2026-09-18#^abc123|9/18]] ^abc123\n", [day("2026-09-18")]: "- [ ] Something else\n" }, open: INBOX, at: 1, lag });
    assert.equal(await v.schedule("2026-09-21"), "Schedule for");
    const id = idIn(v.notes()[INBOX].split("\n")[0]);
    assert.notEqual(id, "abc123");
    assert.equal(v.notes()[INBOX], `- [>] Website [[2026-09-21#^${id}|9/21]] [[Kestrel|⭕]] ^${id}\n\t- [>] Fix the header [[2026-09-18#^abc123|9/18]] ^abc123\n`);
    // From a note in Inbox, in no project: no ⭕, and a ↗ back to Inbox (rule 13, OBS-208)
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Website [[Inbox#^${id}|↗]] ^${id}`);
});

for (const lag of [false, true]) {
    test(`moved untouched twice, the project note's forward date follows${lag ? " (the cache a command behind)" : ""}`, async () => {
        const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
        await v.schedule("2026-09-17");
        assert.deepEqual(v.check(), []);
        v.open(day("2026-09-17"), v.lineOf(day("2026-09-17"), "Book the photographer"));
        await v.schedule("2026-09-18");
        assert.deepEqual(v.check(), []);
        v.open(day("2026-09-18"), v.lineOf(day("2026-09-18"), "Book the photographer"));
        await v.schedule("2026-09-21");
        assert.deepEqual(v.check(), []);
        const id = idIn(v.notes()[KES]);
        assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-21#^${id}|9/21]] ^${id}`);
        assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Book the photographer [[Kestrel|⭕]] ^${id}`);
        assert.equal(v.notes()[day("2026-09-18")].trim(), "", "moved out");
    });
}

scenario("a sent line reworded by hand still gets its forward date, found by its ID (Review Focus 3)", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[KES]);
    // Reworded in the editor, where the note is open (under lag, a write to the file would throw away the
    // send the editor hasn't saved yet)
    const editor = v.app.workspace.activeLeaf.view.editor;
    editor.replaceRange("Book the photographer for the catalog, call first", { line: 5, ch: 6 }, { line: 5, ch: 6 + "Book the photographer".length });
    v.open(day("2026-09-17"), v.lineOf(day("2026-09-17"), "Book the photographer"));
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    assert.ok(v.notes()[KES].includes(`call first [[2026-09-18#^${id}|9/18]] ^${id}`));
});

scenario("a task moved with a sub-task under it: the sub-task's own forward date, from before it was nested, isn't followed, and the checks list it (OBS-193, rule 5)", async ({ lag }) => {
    const LOG = "Projects/Freelance/Kestrel/›logs/2026-09-14 Review.md";
    const v = standIn({ notes: { [KES]: KES_TEXT, [LOG]: "---\ntags: [log]\n---\n- [ ] Send the notes\n" }, open: LOG, at: 3, lag });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    const sub = idIn(v.notes()[LOG]);
    await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-17")), (t) => t.replace("- [ ] Send the notes", "- [ ] Kestrel errands [[Kestrel|⭕]]\n\t- [ ] Send the notes"));
    v.open(day("2026-09-17"), v.lineOf(day("2026-09-17"), "Kestrel errands"));
    await v.schedule("2026-09-18");
    assert.match(v.notes()[day("2026-09-18")], new RegExp(`^- \\[ \\] Kestrel errands \\[\\[Kestrel\\|⭕\\]\\]\n\t- \\[ \\] Send the notes .*\\^${sub}$`, "m"), "the sub-task went along, its ID as text");
    assert.ok(v.notes()[LOG].includes(`[[2026-09-17#^${sub}|9/17]]`), "still names 9/17");
    assert.deepEqual(v.check().map((x) => x.rule), ["forward"]);
});

// Kestrel's task and a log's task, both sent to `to`; the log's then nested by hand under Kestrel's there
// (Outliner, say)
const LOG = "Projects/Freelance/Kestrel/›logs/2026-09-14 Review.md";
const nestedOn = async (v, to) => {
    v.open(LOG, 3);
    await v.schedule(to);
    await v.app.vault.process(v.app.vault.getFileByPath(day(to)), (t) => {
        const ls = t.split("\n");
        const sub = ls.findIndex((l) => l.includes("Send the notes"));
        const [line] = ls.splice(sub, 1);
        ls.splice(ls.findIndex((l) => l.includes("Book the photographer")) + 1, 0, `\t${line}`);
        return ls.join("\n");
    });
};

scenario("Schedule on a sent line whose open line has a line nested under it: the nested line goes along as a sub-task, and its own forward date isn't followed (OBS-193, rule 5)", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT, [LOG]: "---\ntags: [log]\n---\n- [ ] Send the notes\n" }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    await nestedOn(v, "2026-09-17");
    v.open(KES, 5);
    assert.equal(await v.schedule("2026-09-21"), "Scheduled for Thu 9/17. Move it to");
    const id = idIn(v.notes()[KES]), sub = idIn(v.notes()[LOG]);
    assert.equal(v.notes()[day("2026-09-17")].trim(), "", "moved, with the line under it");
    assert.match(v.notes()[day("2026-09-21")], new RegExp(`^- \\[ \\] Book the photographer .*\\^${id}\n\t- \\[ \\] Send the notes .*\\^${sub}$`, "m"));
    assert.ok(v.notes()[LOG].includes(`[[2026-09-17#^${sub}|9/17]] ^${sub}`), "the log's forward date is left as it was");
    assert.deepEqual(v.check().map((x) => x.rule), ["forward"]);
});

scenario("back onto a day where it was worked on, with a line nested under it: that line reopens, the nested line goes under it, and its own forward date isn't followed (OBS-193)", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT, [LOG]: "---\ntags: [log]\n---\n- [ ] Send the notes\n" }, open: KES, at: 5, lag });
    await v.schedule("2026-09-16");
    await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-16")), (s) => s.replace(/(Book the photographer.*)$/m, "$1\n\t- 9:00am - 9:30am"));
    v.open(day("2026-09-16"), v.lineOf(day("2026-09-16"), "Book the photographer"));
    await v.schedule("2026-09-18");
    await nestedOn(v, "2026-09-18");
    v.open(KES, 5);
    assert.equal(await v.schedule("2026-09-16"), "Scheduled for Fri 9/18. Move it to");
    const id = idIn(v.notes()[KES]), sub = idIn(v.notes()[LOG]);
    assert.match(v.notes()[day("2026-09-16")], new RegExp(`^- \\[/\\] Book the photographer .*\\^${id}\n\t- 9:00am - 9:30am\n\t- \\[ \\] Send the notes .*\\^${sub}$`, "m"));
    assert.equal(v.notes()[day("2026-09-18")].trim(), "");
    assert.ok(v.notes()[LOG].includes(`[[2026-09-18#^${sub}|9/18]] ^${sub}`), "the log's forward date is left as it was");
    assert.equal(v.notices.at(-1), "Reopened on 9/16");
    assert.deepEqual(v.check().map((x) => x.rule), ["forward"]);
});

scenario("a sub-task with an ID of its own goes with its task, even onto a day that has a line with that ID: its ID travels as text and counts for nothing (OBS-193, OBS-196, rule 5)", async ({ lag }) => {
    const notes = {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123\n",
        [LOG]: "---\ntags: [log]\n---\n- [>] Send the notes [[2026-09-18#^def456|9/18]] ^def456\n",
        [day("2026-09-16")]: "- [>] Send the notes [[Kestrel|⭕]] [[2026-09-14 Review|⋯]] ^def456\n\t- 9:00am - 9:30am\n",
        [day("2026-09-18")]: "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Review|⋯]] ^def456\n",
    };
    // Moved from its day (from the sub-task's line too), and rescheduled from the project note
    for (const [open, at] of [[day("2026-09-18"), 0], [day("2026-09-18"), 1], [KES, 5]]) {
        const v = standIn({ notes, open, at, lag });
        // The checks read top-level lines: the sub-task isn't the task's line, so its forward date points where the task isn't
        assert.deepEqual(v.check().map((x) => x.rule), ["forward"]);
        await v.schedule("2026-09-16");
        assert.equal(v.notes()[day("2026-09-18")].trim(), "", `${open} ${at}`);
        assert.equal(v.notes()[day("2026-09-16")], "- [>] Send the notes [[Kestrel|⭕]] [[2026-09-14 Review|⋯]] ^def456\n\t- 9:00am - 9:30am\n- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Review|⋯]] ^def456\n", `${open} ${at}`);
        assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123", `${open} ${at}`);
        assert.equal(v.notes()[LOG].split("\n")[3], "- [>] Send the notes [[2026-09-18#^def456|9/18]] ^def456", "the sub-task's own forward date isn't followed");
        assert.deepEqual(v.check().map((x) => x.rule), ["forward"], `${open} ${at}`);
    }
});

test("a day's line that lost its links still has its source's forward date followed: the note sent from was just written (the cache a command behind)", async () => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag: true });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[KES]);
    await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-17")), (t) => t.replace(" [[Kestrel|⭕]]", ""));
    v.open(day("2026-09-17"), v.lineOf(day("2026-09-17"), "Book the photographer"));
    await v.schedule("2026-09-18");
    // The line lost its ⭕ by hand on purpose: the checks say its project disagrees
    assert.deepEqual(v.check().map((x) => x.rule), ["project"]);
    assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-18#^${id}|9/18]] ^${id}`);
});

scenario("a worked-on line whose block ID of your own an open line in another note also has is forwarded with a fresh one, with a notice", async ({ lag }) => {
    const v = standIn({ notes: { [OTHER]: "---\ntags: [project]\n---\n- [ ] Weekly review ^review\n", [day("2026-09-16")]: "- [/] Weekly review [[Kestrel|⭕]] ^review\n\t- 9:00am - 9:30am\n", [KES]: KES_TEXT }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[day("2026-09-16")]);
    assert.notEqual(id, "review");
    assert.equal(v.notes()[day("2026-09-16")], `- [>] Weekly review [[Kestrel|⭕]] ^${id}\n\t- 9:00am - 9:30am\n`);
    assert.equal(v.notes()[day("2026-09-18")].trim(), `- [/] Weekly review [[Kestrel|⭕]] ^${id}`);
    assert.match(v.notices.join("\n"), /\^review is also on a line in another note/);
    assert.ok(v.notes()[OTHER].includes("- [ ] Weekly review ^review"), "the other note is left alone");
});

test("rewrite changes a note open in an editor through the editor: an edit not yet saved is kept, and an emoji is never split", async () => {
    const v = standIn({ notes: { [KES]: KES_TEXT.replace("photographer", "photographer 🚩") }, open: KES, at: 5, lag: true });
    v.tick();
    const editor = v.app.workspace.activeLeaf.view.editor;
    editor.replaceRange(" today", { line: 5, ch: editor.getLine(5).length });
    const spans = [];
    const replace = editor.replaceRange;
    editor.replaceRange = (text, from, to) => { spans.push(text); return replace(text, from, to); };
    await v.customJS.Schedule.rewrite(v.app.vault.getFileByPath(KES), (t) => t.replace("🚩", "🚀"));
    assert.equal(v.notes()[KES], "---\ntags: [project]\n---\n## To Do\n\n- [ ] Book the photographer 🚀 today\n");
    assert.deepEqual(spans, ["🚀"]);
});

test("the note a moving line links is read for its source lines, even with the cache a command behind and nothing marked as just written", async () => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag: true });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[KES]);
    v.customJS.TaskIds.recent?.clear();   // as after CustomJS reloads its scripts
    v.open(day("2026-09-17"), v.lineOf(day("2026-09-17"), "Book the photographer"));
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-18#^${id}|9/18]] ^${id}`);
});

scenario("a block link of your own to a day's line, ending a task, stays on every line of it as the task is sent and moved", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Follow up on [[2026-09-15#^abc123|the call]]\n",
        [day("2026-09-15")]: "- [x] Call with the printer [[Kestrel|⭕]] ^abc123\n",
    }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    const id = idIn(v.notes()[KES].replace("^abc123|", ""));
    assert.equal(v.notes()[KES].split("\n")[5], `- [>] Follow up on [[2026-09-15#^abc123|the call]] [[2026-09-17#^${id}|9/17]] ^${id}`);
    assert.equal(v.notes()[day("2026-09-17")].trim(), `- [ ] Follow up on [[2026-09-15#^abc123|the call]] [[Kestrel|⭕]] ^${id}`);
    assert.deepEqual(v.check(), []);
    v.open(day("2026-09-17"), v.lineOf(day("2026-09-17"), "Follow up"));
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[KES].split("\n")[5], `- [>] Follow up on [[2026-09-15#^abc123|the call]] [[2026-09-18#^${id}|9/18]] ^${id}`);
    assert.equal(v.notes()[day("2026-09-18")].trim(), `- [ ] Follow up on [[2026-09-15#^abc123|the call]] [[Kestrel|⭕]] ^${id}`);
    assert.deepEqual(v.check(), []);
});

scenario("a sent line whose forward date was written with a ➡️ is read, and the next move writes just the date", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-17#^abc123|➡️ 9/17]] ^abc123\n",
        [day("2026-09-17")]: "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n",
    }, open: KES, at: 5, lag });
    assert.deepEqual(v.check(), []);
    assert.equal(await v.schedule("2026-09-21"), "Scheduled for Thu 9/17. Move it to");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-21#^abc123|9/21]] ^abc123");
    assert.deepEqual(v.check(), []);
});

scenario("Schedule run again on the project note's line moves the open line, and says where it is", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    v.open(KES, 5);
    assert.equal(await v.schedule("2026-09-21"), "Scheduled for Thu 9/17. Move it to");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[KES]);
    assert.equal(v.notes()[day("2026-09-17")].trim(), "", "moved, not copied");
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Book the photographer [[Kestrel|⭕]] ^${id}`);
    assert.ok(v.notes()[KES].includes(`[[2026-09-21#^${id}|9/21]] ^${id}`));
});

scenario("run again on a line worked on: the open line is forwarded, its time left on its day", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-17")), (s) => s.replace(/\n$/, "\n\t- 9:00am - 9:30am\n"));
    v.open(KES, 5);
    await v.schedule("2026-09-21");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[KES]);
    assert.equal(v.notes()[day("2026-09-17")].trim(), `- [>] Book the photographer [[Kestrel|⭕]] ^${id}\n\t- 9:00am - 9:30am`);
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [/] Book the photographer [[Kestrel|⭕]] ^${id}`, "started: time was logged");
    assert.ok(v.left.includes(day("2026-09-17")), "the daily note it changed gets its fold snapshot again");
});

scenario("run again when the open line was deleted by hand: a fresh copy goes", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-17")), () => "");
    v.open(KES, 5);
    assert.equal(await v.schedule("2026-09-21"), "Schedule for");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[KES]);
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Book the photographer [[Kestrel|⭕]] ^${id}`);
});

scenario("Schedule on the project note's line of a task that's done on its day reopens it: the done line moves as [ ], since no time was logged, and the forward date follows (OBS-193, rule 13)", async ({ lag }) => {
    for (const box of ["x", "-"]) {
        const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
        await v.schedule("2026-09-17");
        assert.deepEqual(v.check(), []);
        await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-17")), (s) => s.replace("- [ ]", `- [${box}]`));
        v.open(KES, 5);
        assert.equal(await v.schedule("2026-09-21"), `${box === "x" ? "Done" : "Canceled"} on Thu 9/17. Reopen it on`, box);
        assert.deepEqual(v.check(), [], box);
        const id = idIn(v.notes()[KES]);
        assert.equal(v.notes()[day("2026-09-17")].trim(), "", "moved off its day: nothing had to stay");
        assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Book the photographer [[Kestrel|⭕]] ^${id}`, box);
        assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-21#^${id}|9/21]] ^${id}`, box);
        assert.equal(v.notices.at(-1), "Reopened on 9/21", box);
    }
});

scenario("back onto a day where it was worked on: that line reopens, rather than a second line with the ID", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-16")]: "- [/] Call the printer [[Kestrel|⭕]]\n\t- 9:00am - 9:30am\n" }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[day("2026-09-16")]);
    v.open(day("2026-09-18"), v.lineOf(day("2026-09-18"), "Call the printer"));
    await v.schedule("2026-09-16");
    assert.deepEqual(v.check(), []);
    assert.equal(v.notes()[day("2026-09-16")], `- [/] Call the printer [[Kestrel|⭕]] ^${id}\n\t- 9:00am - 9:30am\n`);
    assert.equal(v.notes()[day("2026-09-18")].trim(), "");
    assert.ok(v.notices.at(-1).includes("Reopened on 9/16"));
});

scenario("an older sent line, its date in front, is matched to its open line and moved, not copied", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] [[2026-09-17|9/17]] Book the photographer\n",
        [day("2026-09-17")]: "- [ ] Book the photographer [[Kestrel|⭕]]\n",
    }, open: KES, at: 5, lag });
    assert.equal(await v.schedule("2026-09-21"), "Scheduled for Thu 9/17. Move it to");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[KES]);
    assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-21#^${id}|9/21]] ^${id}`);
    assert.equal(v.notes()[day("2026-09-17")].trim(), "");
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Book the photographer [[Kestrel|⭕]] ^${id}`);
});

scenario("an older sent line whose day line was worked on and forwarded since takes that line's ID, and its task's open line moves", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] [[2026-09-17|9/17]] Book the photographer\n",
        [day("2026-09-17")]: "- [ ] Book the photographer [[Kestrel|⭕]]\n\t- 9:00am - 9:30am\n",
    }, open: day("2026-09-17"), at: 0, lag });
    // Forwarded from its day: both day lines get an ID, which Kestrel's older line doesn't have
    await v.schedule("2026-09-18");
    const id = idIn(v.notes()[day("2026-09-17")]);
    v.open(KES, 5);
    assert.equal(await v.schedule("2026-09-21"), "Scheduled for Fri 9/18. Move it to");
    assert.deepEqual(v.check(), []);
    assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-21#^${id}|9/21]] ^${id}`);
    assert.equal(v.notes()[day("2026-09-17")], `- [>] Book the photographer [[Kestrel|⭕]] ^${id}\n\t- 9:00am - 9:30am\n`);
    assert.equal(v.notes()[day("2026-09-18")].trim(), "", "moved, not copied");
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [/] Book the photographer [[Kestrel|⭕]] ^${id}`);
});

scenario("an older line that takes its forwarded day line's ID points its forward date where the task is, even when nothing then moves", async ({ lag }) => {
    for (const how of ["prompt dismissed", "done since"]) {
        const v = standIn({ notes: {
            [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] [[2026-09-17|9/17]] Book the photographer\n",
            [day("2026-09-17")]: "- [ ] Book the photographer [[Kestrel|⭕]]\n\t- 9:00am - 9:30am\n",
        }, open: day("2026-09-17"), at: 0, lag });
        await v.schedule("2026-09-18");
        const id = idIn(v.notes()[day("2026-09-17")]);
        if (how === "done since") await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-18")), (t) => t.replace(/- \[[ /]\]/, "- [x]"));
        v.open(KES, 5);
        if (how === "done since") {
            // Scheduling a done task reopens it (OBS-193): the upgrade points at 9/18 first, and then the move at 9/21
            assert.equal(await v.schedule("2026-09-21"), "Done on Fri 9/18. Reopen it on");
            assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-21#^${id}|9/21]] ^${id}`, how);
            assert.equal(v.notes()[day("2026-09-18")].trim(), "", how);
            assert.equal(v.notes()[day("2026-09-21")].trim(), `- [/] Book the photographer [[Kestrel|⭕]] ^${id}`, "reopened as started: time was logged on 9/17");
        } else {
            v.tick();
            v.customJS.DatePrompt.open = () => ({});
            await v.customJS.Schedule.invoke();
            assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-18#^${id}|9/18]] ^${id}`, how);
        }
        assert.deepEqual(v.check(), [], how);
    }
});

scenario("run again on a day's [>] line whose open line is gone: a fresh copy, with no link to that day", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-16")]: "- [>] Call the printer [[Kestrel|⭕]] ^q1w2e3\n\t- 9:00am - 9:30am\n" }, open: day("2026-09-16"), at: 0, lag });
    assert.equal(await v.schedule("2026-09-21"), "Schedule for");
    assert.deepEqual(v.check(), []);
    assert.equal(v.notes()[day("2026-09-21")].trim(), "- [ ] Call the printer [[Kestrel|⭕]] ^q1w2e3");
});

for (const lag of [false, true]) {
    test(`a sent line clicked back to [ ] and scheduled again goes back to [>], and its task's open line moves${lag ? " (the cache a command behind)" : ""}`, async () => {
        const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
        await v.schedule("2026-09-17");
        assert.deepEqual(v.check(), []);
        const id = idIn(v.notes()[KES]);
        // One click on [>] turns it into [ ], in the editor
        const editor = v.app.workspace.activeLeaf.view.editor;
        editor.replaceRange(" ", { line: 5, ch: 3 }, { line: 5, ch: 4 });
        assert.match(v.notes()[KES].split("\n")[5], /^- \[ \] Book the photographer/);
        assert.equal(await v.schedule("2026-09-21"), "Scheduled for Thu 9/17. Move it to");
        assert.deepEqual(v.check(), []);
        assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-21#^${id}|9/21]] ^${id}`);
        assert.equal(v.notes()[day("2026-09-17")].trim(), "", "moved off 9/17");
        assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Book the photographer [[Kestrel|⭕]] ^${id}`);
        const ids = new Set(Object.values(v.notes()).flatMap((t) => [...t.matchAll(/\^([A-Za-z0-9-]+)$/gm)].map((m) => m[1])));
        assert.deepEqual([...ids], [id], "one ID");
        assert.deepEqual(v.check(), []);
    });
}

scenario("a sent line clicked back to [ ] and scheduled onto the day its task is on: it says so, and the line is [>] again", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    const sent = v.notes()[KES].split("\n")[5];
    const editor = v.app.workspace.activeLeaf.view.editor;
    editor.replaceRange(" ", { line: 5, ch: 3 }, { line: 5, ch: 4 });
    assert.equal(await v.schedule("2026-09-17"), "Scheduled for Thu 9/17. Move it to");
    assert.equal(v.notices.at(-1), "Already on 9/17");
    assert.equal(v.notes()[KES].split("\n")[5], sent);
    assert.deepEqual(v.check(), []);
});

scenario("a sent line clicked back to [ ] and scheduled back onto a worked-on day: that day's line reopens with the moving line's project and 🆓 state, a sub-task goes along, and the source is [>] again (OBS-193, rule 13)", async ({ lag }) => {
    const sent = "- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123";
    const sixteen = (links) => `- [>] Book the photographer ${links} ^abc123\n\t- 9:00am - 9:30am\n`;
    const cases = [
        ["🆓", { [day("2026-09-16")]: sixteen("[[Kestrel|⭕]] 🆓") }, "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n", []],
        ["another project", { [OTHER]: "---\ntags: [project]\n---\n", [day("2026-09-16")]: sixteen("[[Other|⭕]]") }, "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n", []],
        ["a sub-task with a line there", {
            [LOG]: "---\ntags: [log]\n---\n- [>] Send the notes [[2026-09-18#^def456|9/18]] ^def456\n",
            [day("2026-09-16")]: "- [>] Send the notes [[Kestrel|⭕]] [[2026-09-14 Review|⋯]] ^def456\n\t- 9:00am - 9:30am\n",
            [day("2026-09-18")]: "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Review|⋯]] ^def456\n",
        }, "- [>] Send the notes [[Kestrel|⭕]] [[2026-09-14 Review|⋯]] ^def456\n\t- 9:00am - 9:30am\n- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Review|⋯]] ^def456\n", ["forward"]],
    ];
    for (const [said, extra, after, rules] of cases) {
        const v = standIn({ notes: { [KES]: `---\ntags: [project]\n---\n## To Do\n\n${sent}\n`, [day("2026-09-18")]: "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n", ...extra }, open: KES, at: 5, lag });
        v.app.workspace.activeLeaf.view.editor.replaceRange(" ", { line: 5, ch: 3 }, { line: 5, ch: 4 });
        await v.schedule("2026-09-16");
        assert.equal(v.notes()[day("2026-09-16")], after, said);
        assert.equal(v.notes()[day("2026-09-18")].trim(), "", said);
        assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123", said);
        assert.deepEqual(v.check().map((x) => x.rule), rules, said);
    }
});

scenario("onto the day its task is on, after its open line was moved there by hand: it says so, and the forward date points there now", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    // Cut from 9/17 and pasted into 9/18 by hand, a moment later
    const line = v.notes()[day("2026-09-17")].trim();
    await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-17")), () => "");
    await v.app.vault.create(day("2026-09-18"), `${line}\n`);
    v.tick();
    assert.deepEqual(v.check().map((x) => x.rule), ["forward"]);
    v.open(KES, 5);
    assert.equal(await v.schedule("2026-09-18"), "Scheduled for Fri 9/18. Move it to");
    assert.equal(v.notices.at(-1), "Already on 9/18");
    const id = idIn(v.notes()[KES]);
    assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-18#^${id}|9/18]] ^${id}`);
    assert.deepEqual(v.check(), []);
});

for (const lag of [false, true]) {
    test(`from the project note, back onto the day it was worked on: that line reopens and the open line moves off its day${lag ? " (the cache a command behind)" : ""}`, async () => {
        const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
        await v.schedule("2026-09-16");
        assert.deepEqual(v.check(), []);
        const id = idIn(v.notes()[KES]);
        v.open(day("2026-09-16"), 1);
        const editor = v.app.workspace.activeLeaf.view.editor;
        editor.replaceRange("\n\t- 9:00am - 9:30am", { line: 1, ch: editor.getLine(1).length });
        await v.schedule("2026-09-18");
        assert.deepEqual(v.check(), []);
        v.open(KES, 5);
        assert.equal(await v.schedule("2026-09-16"), "Scheduled for Fri 9/18. Move it to");
        assert.deepEqual(v.check(), []);
        assert.equal(v.notes()[day("2026-09-16")].trim(), `- [/] Book the photographer [[Kestrel|⭕]] ^${id}\n\t- 9:00am - 9:30am`);
        assert.equal(v.notes()[day("2026-09-18")].trim(), "");
        assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-16#^${id}|9/16]] ^${id}`);
        assert.equal(v.notices.at(-1), "Reopened on 9/16");
    });
}

scenario("back onto a day whose [>] line names another project: that line reopens with the moving line's project, and the notice says where that day's time counts now (Brian, 2026-10-26)", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT, [OTHER]: "---\ntags: [project]\n---\n", [day("2026-09-16")]: "- [/] Call the printer [[Kestrel|⭕]]\n\t- 9:00am - 9:30am\n" }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[day("2026-09-16")]);
    // Edited by hand once 9/16 is closed (and so saved)
    v.open(day("2026-09-18"), v.lineOf(day("2026-09-18"), "Call the printer"));
    await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-16")), (t) => t.replace("[[Kestrel|⭕]]", "[[Other|⭕]]"));
    assert.deepEqual(v.check().map((x) => x.rule), ["project"]);
    await v.schedule("2026-09-16");
    assert.equal(v.notes()[day("2026-09-16")], `- [/] Call the printer [[Kestrel|⭕]] ^${id}\n\t- 9:00am - 9:30am\n`);
    assert.equal(v.notes()[day("2026-09-18")].trim(), "");
    assert.equal(v.notices.at(-1), "Reopened on 9/16; that day's time now counts toward Kestrel");
    assert.deepEqual(v.check(), [], "one line of the task is left");
});

scenario("back onto a day whose [>] line differs in 🆓 from the moving line: that line reopens with the moving line's 🆓 state, the newer intent (Brian, 2026-10-26)", async ({ lag }) => {
    for (const [sixteen, eighteen, after] of [["🆓 ", "", "- [/] Call the printer [[Kestrel|⭕]] ^abc123"], ["", "🆓 ", "- [/] Call the printer [[Kestrel|⭕]] 🆓 ^abc123"]]) {
        const notes = {
            [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Call the printer [[2026-09-18#^abc123|9/18]] ^abc123\n",
            [day("2026-09-16")]: `- [>] Call the printer [[Kestrel|⭕]] ${sixteen}^abc123\n\t- 9:00am - 10:00am\n`,
            [day("2026-09-18")]: `- [ ] Call the printer [[Kestrel|⭕]] ${eighteen}^abc123\n`,
        };
        // Moved from its day, and rescheduled from the project note
        for (const [open, at] of [[day("2026-09-18"), 0], [KES, 5]]) {
            const v = standIn({ notes, open, at, lag });
            await v.schedule("2026-09-16");
            assert.equal(v.notes()[day("2026-09-16")], `${after}\n\t- 9:00am - 10:00am\n`, `${open}, 9/16 ${sixteen || "not "}🆓`);
            assert.equal(v.notes()[day("2026-09-18")].trim(), "", open);
            assert.equal(v.notes()[KES].split("\n")[5], "- [>] Call the printer [[2026-09-16#^abc123|9/16]] ^abc123", open);
            assert.equal(v.notices.at(-1), "Reopened on 9/16", open);
            assert.deepEqual(v.check(), [], open);
        }
    }
});

scenario("a reopened line keeps the day's [>] line's ⋯, and a 🚩 taken off the moving line doesn't come back", async ({ lag }) => {
    const NOTE = "Projects/Freelance/Kestrel/Book the photographer.md";
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123\n",
        [NOTE]: "Notes on the shoot.\n",
        [day("2026-09-16")]: "- [>] Book the photographer [[2026-09-20|🚩 9/20]] [[Kestrel|⭕]] [[Book the photographer|⋯]] ^abc123\n\t- 9:00am - 9:30am\n",
        // Reworded, and its deadline taken off, since 9/16
        [day("2026-09-18")]: "- [ ] Book the photographer, call first [[Kestrel|⭕]] ^abc123\n",
    }, open: KES, at: 5, lag });
    await v.schedule("2026-09-16");
    assert.deepEqual(v.check(), []);
    assert.equal(v.notes()[day("2026-09-16")], "- [/] Book the photographer, call first [[Kestrel|⭕]] [[Book the photographer|⋯]] ^abc123\n\t- 9:00am - 9:30am\n");
    assert.equal(v.notices.at(-1), "Reopened on 9/16");
});

scenario("a day's [>] line nested by hand under another task is that task's sub-task: moving back onto that day adds the task's line, and its ID there counts for nothing (OBS-193, OBS-196, rule 5)", async ({ lag }) => {
    const NOTE = "Projects/Freelance/Kestrel/Call the printer.md";
    const notes = {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Call the printer [[2026-09-18#^abc123|9/18]] ^abc123\n",
        [OTHER]: "---\ntags: [project]\n---\n",
        [NOTE]: "---\ntags: [task]\n---\n",
        [day("2026-09-16")]: "- [ ] Other errands [[Other|⭕]]\n\t- [>] Call the printer [[Kestrel|⭕]] ^abc123\n\t\t- 9:00am - 9:30am\n",
        [day("2026-09-18")]: "- [ ] Call the printer [[Kestrel|⭕]] [[Call the printer|⋯]] ^abc123\n",
    };
    // Moved from its day, and rescheduled from the project note
    for (const [open, at] of [[day("2026-09-18"), 0], [KES, 5]]) {
        const v = standIn({ notes, open, at, lag });
        await v.schedule("2026-09-16");
        assert.equal(v.notes()[day("2026-09-16")], "- [ ] Other errands [[Other|⭕]]\n\t- [>] Call the printer [[Kestrel|⭕]] ^abc123\n\t\t- 9:00am - 9:30am\n- [ ] Call the printer [[Kestrel|⭕]] [[Call the printer|⋯]] ^abc123\n", open);
        assert.equal(v.notes()[day("2026-09-18")].trim(), "", open);
        assert.deepEqual(v.check(), [], open);
    }
});

scenario("a reopen takes the moving line's links over an archived project's ⭕ on the day's line (Brian, 2026-10-26)", async ({ lag }) => {
    const NOTE = "Projects/Freelance/Kestrel/Call the printer.md";
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n", "Archive/Old/Old.md": "---\ntags: [project]\n---\n", [NOTE]: "---\ntags: [task]\n---\n",
        [day("2026-09-16")]: "- [>] Call the printer [[Old|⭕]] [[Call the printer|⋯]] ^abc123\n\t- 9:00am - 9:30am\n",
        [day("2026-09-18")]: "- [ ] Call the printer [[Kestrel|⭕]] [[Call the printer|⋯]] ^abc123\n",
    }, open: day("2026-09-18"), at: 0, lag });
    await v.schedule("2026-09-16");
    assert.equal(v.notices.at(-1), "Reopened on 9/16", "a command passes over the archived ⭕: the note's Kestrel is the live project that line named, and the line says Kestrel now");
    assert.equal(v.notes()[day("2026-09-16")], "- [/] Call the printer [[Kestrel|⭕]] [[Call the printer|⋯]] ^abc123\n\t- 9:00am - 9:30am\n");
});

scenario("a day's [>] line under a plain bullet that names an archived ⭕ isn't defined in the system: a reopen moves no time, so no notice says it did (OBS-196)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n", "Archive/Old/Old.md": "---\ntags: [project]\n---\n",
        [day("2026-09-16")]: "- Old work [[Old|⭕]]\n\t- [>] Call the printer ^abc123\n\t\t- 9:00am - 9:30am\n",
        [day("2026-09-18")]: "- [ ] Call the printer [[Kestrel|⭕]] ^abc123\n",
    }, open: day("2026-09-18"), at: 0, lag });
    const tr = v.customJS.TimeReport;
    const counted = () => {
        const notes = Object.entries(v.notes()).filter(([p]) => p.includes("/days/")).map(([path, text]) => ({ path, text, date: path.slice(-13, -3) }));
        return tr.build(notes, tr.appIndex(), {}).entries.length;
    };
    assert.equal(counted(), 0, "time under a task under a plain bullet counts nowhere");
    await v.schedule("2026-09-16");
    assert.ok(!v.notices.at(-1).includes("counts toward"), v.notices.at(-1));
    assert.equal(counted(), 0, "and still does, at the left edge or not: the line stays where it is");
});

test("a reopen whose [>] line is gone by the time it's written says so, so the line goes in as usual", async () => {
    const v = standIn({ notes: { [day("2026-09-16")]: "- [ ] Call the printer [[Kestrel|⭕]] ^q1w2e3\n" } });
    const file = v.app.vault.getFileByPath(day("2026-09-16"));
    assert.equal(await v.customJS.Schedule.reopen(file, "q1w2e3", ["- [ ] Call the printer [[Kestrel|⭕]] ^q1w2e3"]), false);
    assert.equal(v.notes()[day("2026-09-16")], "- [ ] Call the printer [[Kestrel|⭕]] ^q1w2e3\n");
    assert.deepEqual(v.left, [], "no fold snapshot for a note left alone");
});

scenario("a source clicked back to [ ] whose line moves while the date prompt is open: nothing moves, and no other line gets its [>]", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    const editor = v.app.workspace.activeLeaf.view.editor;
    editor.replaceRange(" ", { line: 5, ch: 3 }, { line: 5, ch: 4 });
    let pick = null;
    v.customJS.DatePrompt.open = (title, onPick) => { pick = onPick; return {}; };
    await v.customJS.Schedule.invoke();
    editor.replaceRange("- [ ] Order prints\n", { line: 5, ch: 0 });   // a sync, say, while the prompt is open
    const before = v.notes();
    await pick(v.customJS.DatePrompt.result("2026-09-21", "day"), { close() {} });
    assert.deepEqual(v.notes(), before);
    assert.equal(v.notices.at(-1), "The line changed before it could be scheduled, so it wasn't");
});

for (const lag of [false, true]) {
    test(`an older sent line with a block ID of its own is matched to its open line, keeps its ID and is moved; no breadcrumb reaches any line${lag ? " (the cache a command behind)" : ""}`, async () => {
        const v = standIn({ notes: {
            [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] [[2026-09-17|9/17]] Book the photographer ^Ab3-x9\n",
            [day("2026-09-17")]: "- [ ] Book the photographer [[Kestrel|⭕]]\n",
        }, open: KES, at: 5, lag });
        assert.equal(await v.schedule("2026-09-21"), "Scheduled for Thu 9/17. Move it to");
        assert.deepEqual(v.check(), []);
        assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-21#^Ab3-x9|9/21]] ^Ab3-x9");
        assert.equal(v.notes()[day("2026-09-17")].trim(), "", "moved off 9/17");
        assert.equal(v.notes()[day("2026-09-21")].trim(), "- [ ] Book the photographer [[Kestrel|⭕]] ^Ab3-x9");
        for (const [path, text] of Object.entries(v.notes())) assert.doesNotMatch(text, /\[\[2026-09-17\|9\/17\]\]/, path);
    });
}

scenario("an older sent line whose block ID of its own another note's open line also has is matched with a fresh ID, with a notice", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] [[2026-09-17|9/17]] Book the photographer ^review\n",
        [OTHER]: "---\ntags: [project]\n---\n- [ ] Weekly review ^review\n",
        [day("2026-09-17")]: "- [ ] Book the photographer [[Kestrel|⭕]]\n",
    }, open: KES, at: 5, lag });
    assert.equal(await v.schedule("2026-09-21"), "Scheduled for Thu 9/17. Move it to");
    assert.deepEqual(v.check(), []);
    const id = idIn(v.notes()[KES]);
    assert.notEqual(id, "review");
    assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-21#^${id}|9/21]] ^${id}`);
    assert.equal(v.notes()[day("2026-09-17")].trim(), "");
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Book the photographer [[Kestrel|⭕]] ^${id}`);
    assert.match(v.notices.join("\n"), /\^review is also on a line in another note/);
    assert.ok(v.notes()[OTHER].includes("- [ ] Weekly review ^review"), "the other note is left alone");
});

scenario("an older sent line with its own ID whose task is on a day already: the fresh copy has no breadcrumb", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] [[2026-09-16|9/16]] Book the photographer ^Ab3-x9\n",
        [day("2026-09-16")]: "- [>] Book the photographer [[Kestrel|⭕]] ^Ab3-x9\n\t- 9:00am - 9:30am\n",
    }, open: KES, at: 5, lag });
    assert.equal(await v.schedule("2026-09-21"), "Schedule for");
    assert.deepEqual(v.check(), []);
    assert.equal(v.notes()[day("2026-09-21")].trim(), "- [ ] Book the photographer [[Kestrel|⭕]] ^Ab3-x9");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-21#^Ab3-x9|9/21]] ^Ab3-x9");
});

// The task sent from Kestrel, worked on 9/16 and forwarded to 9/18; Schedule on Kestrel's line, with the
// date prompt left open while `meanwhile` changes 9/16 (a sync, say), then 9/16 picked
const backOnto916 = async (sixteen, meanwhile, lag) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123\n",
        [OTHER]: "---\ntags: [project]\n---\n",
        [day("2026-09-16")]: sixteen,
        [day("2026-09-18")]: "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n",
    }, open: KES, at: 5, lag });
    let pick = null;
    v.customJS.DatePrompt.open = (title, onPick) => { pick = onPick; return {}; };
    await v.customJS.Schedule.invoke();
    await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-16")), meanwhile);
    await pick(v.customJS.DatePrompt.result("2026-09-16", "day"), { close() {} });
    return v;
};

scenario("a line put above the day's [>] line while the prompt is open: that line is still found by its ID and reopened, with the moving line's project (OBS-193)", async ({ lag }) => {
    const v = await backOnto916("- [>] Book the photographer [[Other|⭕]] ^abc123\n\t- 9:00am - 9:30am\n", (t) => "- [ ] Call the framer [[Kestrel|⭕]]\n" + t, lag);
    assert.equal(v.notes()[day("2026-09-16")], "- [ ] Call the framer [[Kestrel|⭕]]\n- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n", "the moving line's project");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123");
    assert.equal(v.notices.at(-1), "Reopened on 9/16; that day's time now counts toward Kestrel");
    assert.deepEqual(v.check(), []);
});

scenario("the day's [>] line gone while the prompt is open: the line goes in there as usual, with no false notice", async ({ lag }) => {
    const v = await backOnto916("- [>] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n", () => "- [ ] Something else\n", lag);
    assert.equal(v.notes()[day("2026-09-16")], "- [ ] Something else\n- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123");
    assert.equal(v.notices.at(-1), "Moved to 9/16");
    assert.deepEqual(v.check(), []);
});

scenario("Schedule on a day's [>] line nested under a task schedules the task at the top, and the [>] line stays under it with its time (OBS-193, rule 5)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n",
        [day("2026-09-16")]: "- [ ] Kestrel errands [[Kestrel|⭕]]\n\t- [>] Call the printer ^abc123\n\t\t- 9:00am - 9:30am\n",
    }, open: day("2026-09-16"), at: 1, lag });
    assert.equal(await v.schedule("2026-09-21"), "Schedule for");
    const id = idIn(v.notes()[day("2026-09-16")]);
    assert.notEqual(id, "abc123");
    assert.equal(v.notes()[day("2026-09-16")], `- [>] Kestrel errands [[Kestrel|⭕]] ^${id}\n\t- [>] Call the printer ^abc123\n\t\t- 9:00am - 9:30am\n`);
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [/] Kestrel errands [[Kestrel|⭕]] ^${id}`);
    assert.equal(v.notices.at(-1), 'Forwarded "Kestrel errands" to 9/21');
});

// ------------------------------------------------------------------ rule 13 from a day, and finished tasks (OBS-193)

scenario("Schedule under a finished task reopens it: the done line stays [>] with its time and done sub-tasks, and the new day gets it as [/] with its open sub-task, since time was logged (OBS-193, rule 13, OBS-210)", async ({ lag }) => {
    const CAT = "Projects/Freelance/Kestrel/Catalog/Catalog.md";
    const text = "- [x] Plan the catalog shoot [[Catalog|⭕]]\n\t- 1:00pm - 1:50pm: call sheet\n\t- [x] Shot list\n\t\t- 2:00pm - 3:05pm\n\t- [ ] Return the light stands\n";
    for (const at of [4, 0, 2]) {
        const v = standIn({ notes: { [CAT]: "---\ntags: [project]\n---\n", [day("2026-09-15")]: text }, open: day("2026-09-15"), at, lag });
        await v.schedule("2026-09-19");
        const id = idIn(v.notes()[day("2026-09-15")]);
        assert.equal(v.notes()[day("2026-09-15")], `- [>] Plan the catalog shoot [[Catalog|⭕]] ^${id}\n\t- 1:00pm - 1:50pm: call sheet\n\t- [x] Shot list\n\t\t- 2:00pm - 3:05pm\n`, `from line ${at}`);
        assert.equal(v.notes()[day("2026-09-19")].trim(), `- [/] Plan the catalog shoot [[Catalog|⭕]] ^${id}\n\t- [ ] Return the light stands`, `from line ${at}`);
        assert.equal(v.notices.at(-1), at === 0 ? "Forwarded to 9/19" : 'Forwarded "Plan the catalog shoot" to 9/19', `from line ${at}`);
        assert.deepEqual(v.check(), [], `from line ${at}`);
    }
});

scenario("a finished task with nothing to stay, scheduled from its own line, moves as [ ], done or canceled; with time logged on another of its lines it moves as [/] (OBS-193, rule 13)", async ({ lag }) => {
    for (const box of ["x", "-"]) {
        const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-16")]: `- [${box}] Call the printer [[Kestrel|⭕]]\n` }, open: day("2026-09-16"), at: 0, lag });
        await v.schedule("2026-09-18");
        assert.equal(v.notes()[day("2026-09-16")].trim(), "", box);
        assert.equal(v.notes()[day("2026-09-18")].trim(), "- [ ] Call the printer [[Kestrel|⭕]]", box);
        assert.deepEqual(v.notices, ["Moved to 9/18"], box);
    }
    // Done on 9/17 after work on 9/16: it reopens as started, and 9/16's line is left as it is
    const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-16")]: "- [>] Call the printer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n", [day("2026-09-17")]: "- [x] Call the printer [[Kestrel|⭕]] ^abc123\n" }, open: day("2026-09-17"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-17")].trim(), "");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "- [/] Call the printer [[Kestrel|⭕]] ^abc123");
    assert.equal(v.notes()[day("2026-09-16")], "- [>] Call the printer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n");
    assert.deepEqual(v.check(), []);
});

scenario("a task done on two days (a Problem), scheduled from one: the other done line becomes [>], so the task is open once (OBS-193, rule 13)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [x] Book the photographer [[2026-09-17#^abc123|9/17]] ^abc123\n",
        [day("2026-09-16")]: "- [x] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n",
        [day("2026-09-17")]: "- [x] Book the photographer [[Kestrel|⭕]] ^abc123\n",
    }, open: day("2026-09-17"), at: 0, lag });
    assert.deepEqual(v.check().map((x) => x.rule), ["finished", "forward"]);
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-17")].trim(), "");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "- [/] Book the photographer [[Kestrel|⭕]] ^abc123");
    assert.equal(v.notes()[day("2026-09-16")], "- [>] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n", "its other done line is forwarded");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123", "and so is the project note's, with the forward date");
    assert.deepEqual(v.check(), []);
});

scenario("a done or canceled line on the destination reopens, keeping its entries: as [/] with time logged, as [ ] without (OBS-193, rule 13)", async ({ lag }) => {
    for (const [box, time, after] of [["x", "\n\t- 9:00am - 9:30am", "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n"], ["-", "", "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n"]]) {
        const notes = {
            [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123\n",
            [day("2026-09-16")]: `- [${box}] Book the photographer [[Kestrel|⭕]] ^abc123${time}\n`,
            [day("2026-09-18")]: "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n",
        };
        for (const [open, at] of [[day("2026-09-18"), 0], [KES, 5]]) {
            const v = standIn({ notes, open, at, lag });
            await v.schedule("2026-09-16");
            assert.equal(v.notes()[day("2026-09-16")], after, `${open} ${box}`);
            assert.equal(v.notes()[day("2026-09-18")].trim(), "", `${open} ${box}`);
            assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123", `${open} ${box}`);
            assert.equal(v.notices.at(-1), "Reopened on 9/16", `${open} ${box}`);
            assert.deepEqual(v.check(), [], `${open} ${box}`);
        }
    }
});

scenario("Schedule under a task forwarded from its day moves the task's open line, as Schedule on the [>] line does (OBS-193, rule 5)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123\n",
        [day("2026-09-16")]: "- [>] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n\t- [x] Call first\n",
        [day("2026-09-18")]: "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n",
    }, open: day("2026-09-16"), at: 2, lag });
    assert.equal(await v.schedule("2026-09-21"), "Scheduled for Fri 9/18. Move it to");
    assert.equal(v.notes()[day("2026-09-16")], "- [>] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n\t- [x] Call first\n", "left as it is");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "");
    assert.equal(v.notes()[day("2026-09-21")].trim(), "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-21#^abc123|9/21]] ^abc123");
    assert.deepEqual(v.check(), []);
});

scenario("a blank line inside a task's nest: the lines below it are still the task's, and the blank line doesn't travel (OBS-193)", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n", [day("2026-09-16")]: "- [ ] Errands [[Kestrel|⭕]]\n\t- [ ] a\n\n\t- [ ] b\n- [ ] Next\n" }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-16")], "- [ ] Next\n");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "- [ ] Errands [[Kestrel|⭕]]\n\t- [ ] a\n\t- [ ] b");
});

scenario("from a weekly note a task moves whole, done sub-tasks included, from any line under it (OBS-193, rule 13)", async ({ lag }) => {
    const W38 = `${PLANNER}/weeks/2026w38.md`, W39 = `${PLANNER}/weeks/2026w39.md`;
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n", [W38]: "## This week\n\n- [ ] Plan the October issue\n\t- [x] Pick a theme\n\t- [ ] Draft the outline\n\n## Time Report\n\n%% time:start %%\n%% time:end %%\n" }, open: W38, at: 4, lag });
    await v.schedule("2026-09-20", "week");
    assert.equal(v.notes()[W38], "## This week\n\n\n## Time Report\n\n%% time:start %%\n%% time:end %%\n");
    assert.equal(v.notes()[W39].trim(), "- [ ] Plan the October issue\n\t- [x] Pick a theme\n\t- [ ] Draft the outline");
    assert.equal(v.notices.at(-1), 'Moved "Plan the October issue" to Wk of 9/20');
});

scenario("an event can't be scheduled, from its line or from under it: a [<] line, and a meeting line in the form used before August 2025 (OBS-193, rules 1 and 5)", async ({ lag }) => {
    const notes = {
        [KES]: "---\ntags: [project]\n---\n",
        [day("2026-09-17")]: "- [<] 9:00am\tKestrel standup [[Kestrel|⭕]]\n\t- 9:20am\n\t- [ ] Bring the sitemap\n- [-] 1:00pm\tCanceled call\n\t- [ ] x\n",
        [day("2025-03-04")]: "## Meetings\n\n11:00am [[2025-03-04 Team meeting|Team meeting]]\n\t- 11:00am - 11:45am\n\t- [ ] Action item\n",
    };
    for (const [open, at, said] of [[day("2026-09-17"), 2, "Events must be moved in your calendar app"], [day("2026-09-17"), 0, "Events must be moved in your calendar app"], [day("2026-09-17"), 4, "This event was canceled in your calendar"], [day("2025-03-04"), 4, "Events must be moved in your calendar app"], [day("2025-03-04"), 2, "Events must be moved in your calendar app"]]) {
        const v = standIn({ notes, open, at, lag });
        assert.equal(await v.schedule("2026-09-21"), null, `${open} ${at}: no prompt`);
        assert.equal(v.notices.at(-1), said, `${open} ${at}`);
        assert.deepEqual(v.notes(), notes, `${open} ${at}`);
    }
});

scenario("a line nested by hand on the destination day with the task's ID is a sub-task there: the task's line goes in as usual, and the ID on the sub-task counts for nothing (OBS-193, OBS-196, rule 5)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123\n",
        [day("2026-09-16")]: "- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n",
        [day("2026-09-18")]: "- [ ] Errands\n\t- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n",
    }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-16")].trim(), "");
    assert.equal(v.notes()[day("2026-09-18")], "- [ ] Errands\n\t- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n- [ ] Book the photographer [[Kestrel|⭕]] ^abc123\n");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123");
    assert.equal(v.notices.at(-1), "Moved to 9/18");
    assert.deepEqual(v.check(), []);
});

scenario("the time report reads the notes as they are now: run right after a reschedule from the open project note, it finds no Problem", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    // The project note saved and read again, as after a while
    v.open(day("2026-09-17"), 1);
    v.open(KES, 5);
    v.tick();
    v.tick();
    // Its forward date is written through its editor, and 9/21 through the vault: the cache has seen neither
    await v.schedule("2026-09-21");
    assert.deepEqual(v.check(), []);
    const tr = v.customJS.TimeReport;
    const model = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(model, tr.appIndex(), await tr.taskNotes([]));
    assert.deepEqual(JSON.parse(JSON.stringify([model.problems, model.projectProblems])), [[], []]);
});

test("the stand-in's check() sees a disagreement in the notes (it isn't vacuous)", () => {
    const v = standIn({ notes: { [KES]: KES_TEXT, [day("2026-09-16")]: "- [ ] Call [[Kestrel|⭕]] ^k3x9m2\n", [day("2026-09-17")]: "- [ ] Call [[Kestrel|⭕]] ^k3x9m2\n", [day("2026-09-15")]: "- [>] Call [[Kestrel|⭕]] ^k3x9m2\n" }, open: day("2026-09-16"), at: 0 });
    assert.deepEqual(v.check().map((x) => x.rule), ["open"]);
});

scenario("a line copied by hand: the checks say the task is open twice", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    const line = v.notes()[day("2026-09-17")].trim().split("\n")[0];
    await v.app.vault.create(day("2026-09-18"), `${line}\n`);
    assert.deepEqual(v.check().map((x) => x.rule), ["open"]);
});

scenario("an undone Schedule (the line put back by hand): the checks say so (OBS-180)", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-17");
    assert.deepEqual(v.check(), []);
    const line = v.notes()[day("2026-09-17")].trim().split("\n")[0];
    v.open(day("2026-09-17"), v.lineOf(day("2026-09-17"), "Book the photographer"));
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-17")), () => `${line}\n`);
    // Open on 9/17 and 9/18; Kestrel's forward date names 9/18, one of them, so only the open twice is said
    assert.deepEqual(v.check().map((x) => x.rule), ["open"]);
});

scenario("worked on and forwarded twice: one ID on all three days, the source's forward date on the last", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    await v.schedule("2026-09-16");
    assert.deepEqual(v.check(), []);
    for (const [from, to] of [["2026-09-16", "2026-09-17"], ["2026-09-17", "2026-09-18"]]) {
        await v.app.vault.process(v.app.vault.getFileByPath(day(from)), (s) => s.replace(/(Book the photographer.*)$/m, "$1\n\t- 9:00am - 9:30am"));
        v.open(day(from), v.lineOf(day(from), "Book the photographer"));
        await v.schedule(to);
        assert.deepEqual(v.check(), []);
    }
    const id = idIn(v.notes()[KES]);
    for (const d of ["2026-09-16", "2026-09-17"]) assert.ok(v.notes()[day(d)].includes(`- [>] Book the photographer [[Kestrel|⭕]] ^${id}`));
    assert.ok(v.notes()[day("2026-09-18")].includes(`- [/] Book the photographer [[Kestrel|⭕]] ^${id}`));
    assert.ok(v.notes()[KES].includes(`[[2026-09-18#^${id}|9/18]]`));
});

scenario("week to day: the ID goes along, and the forward date follows", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: KES_TEXT }, open: KES, at: 5, lag });
    const W = `${PLANNER}/weeks/2026w39.md`;
    await v.schedule("2026-09-20", "week");
    assert.deepEqual(v.check(), []);
    v.open(W, v.lineOf(W, "Book the photographer"));
    await v.schedule("2026-09-22");
    assert.deepEqual(v.check(), []);
    assert.match(v.notes()[KES], /\[\[2026-09-22#\^[a-z0-9]{6}\|9\/22\]\]/);
});

// Random sequence seed 7 (the cache a command behind), as a person does it: time typed under one line of
// the note a move just left, before its editor saved, then that line forwarded. (The sequence first wrote
// that time to the file, which threw away the editor's unsaved move and so made the task open twice.)
test("time typed in the note a move just left, then that line forwarded: the move stays and the lines agree (the cache a command behind)", async () => {
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Book the photographer\n- [ ] Send the proofs\n" }, open: KES, at: 5, lag: true });
    await v.schedule("2026-09-16");
    v.open(KES, 6);
    await v.schedule("2026-09-16");
    v.open(day("2026-09-16"), v.lineOf(day("2026-09-16"), "Send the proofs"));
    await v.schedule("2026-09-21");
    assert.deepEqual(v.check(), []);
    const editor = v.app.workspace.activeLeaf.view.editor;
    const at = v.lineOf(day("2026-09-16"), "Book the photographer");
    editor.replaceRange("\n\t- 9:00am - 9:30am", { line: at, ch: editor.getLine(at).length });
    assert.deepEqual(v.check(), []);
    v.open(day("2026-09-16"), at);
    await v.schedule("2026-09-18");
    assert.deepEqual(v.check(), []);
    const book = idIn(v.notes()[KES]), proofs = v.notes()[KES].match(/Send the proofs.*\^([a-z0-9]{6})$/m)[1];
    assert.equal(v.notes()[day("2026-09-16")].trim(), `- [>] Book the photographer [[Kestrel|⭕]] ^${book}\n\t- 9:00am - 9:30am`);
    assert.equal(v.notes()[day("2026-09-18")].trim(), `- [/] Book the photographer [[Kestrel|⭕]] ^${book}`);
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Send the proofs [[Kestrel|⭕]] ^${proofs}`);
    assert.ok(v.notes()[KES].includes(`[[2026-09-18#^${book}|9/18]] ^${book}`));
    assert.ok(v.notes()[KES].includes(`[[2026-09-21#^${proofs}|9/21]] ^${proofs}`));
});

// A small, seeded random generator, so a failure names a seed that repeats it
const mulberry = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const DAYS = ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22"];
// Tasks typed into the project note during a sequence and sent from there
const NEW = ["Call the framer", "Print the contact sheet", "Reserve the studio", "Email the venue"];

// Random sequences of what a person does with tasks sent from a project note, each step on the notes as
// they are then, with the checks after every step. With the cache a command behind, they catch these
// changes to the code (run against a scratch copy, Task 11's review):
//   M1, Schedule.rewrite writing through the vault a note open in an editor: the [>] a clicked-back line
//     gets again, or an older line's upgrade, is lost;
//   M2b, TaskIds.gather reading neither open editors nor the notes a command just wrote: a source's forward date
//     isn't followed;
//   M3, TaskIds.readNow reading the saved file rather than the editor: an older line's upgrade is unseen.
// (In the stand-in, a command's start saves the open note, as open() does, so M1 and M3 show where a
// command edits the open note through its editor and then reads or rewrites it.) Fixed scenarios above
// catch them too, each run with the cache a command behind: M1 "rewrite changes a note open in an
// editor…", "an older sent line…" and "a sent line clicked back to [ ]…"; M2b "a day's line that lost its
// links…", "Schedule run again…" and "run again…"; M3 "an older sent line…". M2, gather skipping open
// editors alone, is taskIds.test.mjs's.
for (const lag of [false, true]) {
    test(`random sequences of Schedule, logging time, rescheduling and moving back keep every task's lines in agreement${lag ? " (the cache a command behind)" : ""}`, async () => {
        for (let seed = 1; seed <= 60; seed++) {
            const r = mulberry(seed);
            const pick = (a) => a[Math.floor(r() * a.length)];
            // Two tasks to send, and one sent before task IDs (its date in front), open on 9/16
            const v = standIn({ notes: {
                [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Book the photographer\n- [ ] Send the proofs\n- [>] [[2026-09-16|9/16]] Order the frames\n",
                [day("2026-09-16")]: "- [ ] Order the frames [[Kestrel|⭕]]\n",
            }, open: KES, at: 5, lag });
            const editor = v.app.workspace.activeLeaf.view.editor;
            await v.schedule(pick(DAYS));
            v.open(KES, 6);
            await v.schedule(pick(DAYS));
            let typed = 0;
            for (let step = 0; step < 16; step++) {
                const all = Object.entries(v.notes()).flatMap(([p, t]) => t.split("\n").map((l, i) => ({ p, i, l })));
                const onDays = (boxes) => all.filter((x) => x.p.includes("/days/") && new RegExp(`^- \\[[${boxes}]\\] .*\\^\\w{6}$`).test(x.l));
                const open = onDays(" /");
                if (!open.length) break;
                const target = pick(open);
                const id = target.l.match(/\^(\w{6})$/)[1];
                const sent = onDays(">");
                const older = v.lineOf(KES, "[>] [[");
                const move = r();
                if (move < 0.2) {
                    // Time logged under it, as ToggleTimeEntry writes it: through the editor when its note
                    // is the one open there (a write to the file would overwrite the editor's unsaved
                    // edits, under lag the last command's), else to the file
                    if (v.app.workspace.getActiveFile()?.path === target.p) editor.replaceRange("\n\t- 9:00am - 9:30am", { line: target.i, ch: editor.getLine(target.i).length });
                    else await v.app.vault.process(v.app.vault.getFileByPath(target.p), (t) => { const ls = t.split("\n"); ls.splice(target.i + 1, 0, "\t- 9:00am - 9:30am"); return ls.join("\n"); });
                } else if (move < 0.35) {
                    // Rescheduled from the project note's line
                    v.open(KES, v.lineOf(KES, `^${id}`));
                    await v.schedule(pick(DAYS));
                } else if (move < 0.45) {
                    // Its project note line clicked back to [ ] (one click on [>]) and scheduled again, onto
                    // another day (onto its own, "Already on" puts the [>] back: a fixed scenario tests it)
                    const at = v.lineOf(KES, `^${id}`);
                    v.open(KES, at);
                    editor.replaceRange(" ", { line: at, ch: 3 }, { line: at, ch: 4 });
                    await v.schedule(pick(DAYS.filter((d) => day(d) !== target.p)));
                } else if (move < 0.55 && sent.length) {
                    // Schedule on a day's [>] line: the task's open line moves, or that line reopens
                    const s = pick(sent);
                    v.open(s.p, s.i);
                    await v.schedule(pick([...DAYS, "2026-09-20"]), r() < 0.85 ? "day" : "week");
                } else if (move < 0.62 && typed < NEW.length) {
                    // A new task typed in the project note, under its others, and sent
                    const last = v.notes()[KES].split("\n").findLastIndex((l) => /^- \[/.test(l));
                    v.open(KES, last);
                    editor.replaceRange(`\n- [ ] ${NEW[typed++]}`, { line: last, ch: editor.getLine(last).length });
                    v.open(KES, last + 1);
                    await v.schedule(pick(DAYS));
                } else if (move < 0.7 && older !== -1) {
                    // The older line scheduled: it's matched to its open line on 9/16 first
                    v.open(KES, older);
                    await v.schedule(pick(DAYS));
                } else {
                    // Moved on, or back to an earlier day (where a [>] line of it reopens)
                    v.open(target.p, target.i);
                    await v.schedule(pick([...DAYS, "2026-09-20"]), r() < 0.85 ? "day" : "week");
                }
                assert.deepEqual(v.check(), [], `seed ${seed}, step ${step}`);
                // Every task here was sent from the project note, so its ID ends a line there too (to the
                // checks, an open line alone with a block ID isn't a task)
                for (const [, each] of Object.values(v.notes()).join("\n").matchAll(/\^(\w{6})$/gm)) assert.ok(v.notes()[KES].includes(`^${each}\n`), `seed ${seed}, step ${step}: ^${each} ends no line of the project note`);
            }
        }
    });
}

// ------------------------------------------------------------------ review fixes (OBS-193)

scenario("review: a done line scheduled onto its own day reopens there, as [/] with time logged, and its sources' forward dates follow (OBS-193, rule 13)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [x] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123\n",
        [day("2026-09-16")]: "- [x] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n",
    }, open: day("2026-09-16"), at: 1, lag });
    await v.schedule("2026-09-16");
    assert.equal(v.notes()[day("2026-09-16")], "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123");
    assert.equal(v.notices.at(-1), 'Reopened "Book the photographer" on 9/16');
    assert.deepEqual(v.check(), []);
    // An open line scheduled onto its own note still changes nothing
    const o = standIn({ notes: { [day("2026-09-16")]: "- [ ] Call\n" }, open: day("2026-09-16"), at: 0, lag });
    await o.schedule("2026-09-16");
    assert.deepEqual([o.notes()[day("2026-09-16")], o.notices.at(-1)], ["- [ ] Call\n", "Already in this note"]);
});

scenario("review: the task's line on a CRLF day not open in an editor: its time stays there, and the new line is started (OBS-193)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123\n",
        [day("2026-09-16")]: "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\r\n\t- 9:00am - 9:30am\r\n\t- [ ] open step\r\n",
    }, open: KES, at: 5, lag });
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-16")], "- [>] Book the photographer [[Kestrel|⭕]] ^abc123\r\n\t- 9:00am - 9:30am\r\n");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- [ ] open step");
    assert.equal(v.notices.at(-1), "Forwarded to 9/18");
});

scenario("review: the task's day changes while its destination is written: its line there is left as it is, and the notice says so (OBS-193)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123\n",
        [day("2026-09-16")]: "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n\t- [ ] open step\n",
    }, open: KES, at: 5, lag });
    const S = v.customJS.Schedule, append = S.appendToTopChecklist.bind(S);
    S.appendToTopChecklist = async (file, lines) => {
        const out = await append(file, lines);
        await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-16")), (t) => t.replace("\t- [ ] open step\n", "\t- [ ] open step\n\t- [ ] call the printer\n"));
        return out;
    };
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-16")], "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n\t- [ ] open step\n\t- [ ] call the printer\n");
    assert.match(v.notices.at(-1), /^The task changed while it was scheduled/);
});

scenario("review round 2: a done line reopening on its own day that moves while the task's lines are read is left alone, and nothing else is changed (OBS-193)", async ({ lag }) => {
    const v = standIn({ notes: { [day("2026-09-16")]: "- [x] Task ^abc123\n" }, open: day("2026-09-16"), at: 0, lag });
    const T = v.customJS.TaskIds, gather = T.gather.bind(T);
    T.gather = async (...a) => { v.app.workspace.activeLeaf.view.editor.replaceRange("- [<] 8:00am\tStandup\n", { line: 0, ch: 0 }); return gather(...a); };
    await v.schedule("2026-09-16");
    assert.equal(v.notes()[day("2026-09-16")], "- [<] 8:00am\tStandup\n- [x] Task ^abc123\n");
    assert.equal(v.notices.at(-1), "The line changed before it could be scheduled, so it wasn't");
});

scenario("review round 2: a source clicked back to [ ] is [>] again even when its old day changed while the destination was written (OBS-193)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-09-16#^abc123|9/16]] ^abc123\n",
        [day("2026-09-16")]: "- [/] Book the photographer [[Kestrel|⭕]] ^abc123\n\t- 9:00am - 9:30am\n\t- [ ] open step\n",
    }, open: KES, at: 5, lag });
    v.app.workspace.activeLeaf.view.editor.replaceRange(" ", { line: 5, ch: 3 }, { line: 5, ch: 4 });
    const S = v.customJS.Schedule, append = S.appendToTopChecklist.bind(S);
    S.appendToTopChecklist = async (file, lines) => {
        const out = await append(file, lines);
        await v.app.vault.process(v.app.vault.getFileByPath(day("2026-09-16")), (t) => t.replace("\t- [ ] open step\n", "\t- [ ] open step\n\t- [ ] call the printer\n"));
        return out;
    };
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[KES].split("\n")[5], "- [>] Book the photographer [[2026-09-18#^abc123|9/18]] ^abc123");
    assert.match(v.notices.at(-1), /^The task changed while it was scheduled/);
});

scenario("review round 2: an older sent line whose open line was nested by hand under another task isn't matched to it: it's sent as a first send (OBS-193, rule 5)", async ({ lag }) => {
    const nine17 = "- [ ] Plan the shoot\n\t- [ ] Book the photographer [[Kestrel|⭕]]\n";
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] [[2026-09-17|9/17]] Book the photographer\n", [day("2026-09-17")]: nine17 }, open: KES, at: 5, lag });
    assert.equal(await v.schedule("2026-09-21"), "Schedule for");
    assert.equal(v.notes()[day("2026-09-17")], nine17, "the nested line isn't given the task's ID");
    assert.deepEqual(v.check(), []);
});

scenario("a day's [>] line with no ID (a hand edit) is never taken off its day: it gets an ID and the forward date, and an open copy goes, from it or from under it (OBS-193)", async ({ lag }) => {
    for (const at of [0, 1]) {
        const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n", [day("2026-09-16")]: "- [>] Call the printer [[Kestrel|⭕]]\n\t- asked about paper\n", [day("2026-09-17")]: "- [ ] Call the printer [[Kestrel|⭕]]\n" }, open: day("2026-09-16"), at, lag });
        assert.equal(await v.schedule("2026-09-18"), "Schedule for");
        const id = idIn(v.notes()[day("2026-09-16")]);
        assert.equal(v.notes()[day("2026-09-16")], `- [>] Call the printer [[2026-09-18#^${id}|9/18]] [[Kestrel|⭕]] ^${id}\n\t- asked about paper\n`, `from line ${at}`);
        assert.equal(v.notes()[day("2026-09-18")].trim(), `- [ ] Call the printer [[Kestrel|⭕]] ^${id}`, `from line ${at}`);
        assert.equal(v.notes()[day("2026-09-17")], "- [ ] Call the printer [[Kestrel|⭕]]\n", "the orphaned open line is left as it is");
        assert.deepEqual(v.check(), [], `from line ${at}`);
    }
});

scenario("an event nested under a task (against the rules) is that task's note: it moves with the task (OBS-193)", async ({ lag }) => {
    const v = standIn({ notes: { [day("2026-09-16")]: "- [ ] Prep the pitch\n\t- [<] 2:00pm\tPitch review\n\t- [ ] open\n" }, open: day("2026-09-16"), at: 2, lag });
    await v.schedule("2026-09-17");
    assert.equal(v.notes()[day("2026-09-16")].trim(), "");
    assert.equal(v.notes()[day("2026-09-17")].trim(), "- [ ] Prep the pitch\n\t- [<] 2:00pm\tPitch review\n\t- [ ] open");
});

// ------------------------------------------------------------------ PR 54 review (OBS-193)

scenario("PR 54 review: a reopened day line that counted as Unassigned through an unfiled note takes the moving line's ⭕ (rule 10)", async ({ lag }) => {
    const v = standIn({ notes: {
        [KES]: "---\ntags: [project]\n---\n", "Inbox/Draft the deck.md": "---\ntags: [task]\n---\n",
        [day("2026-09-15")]: "- [>] Draft the deck [[Draft the deck|⋯]] ^abc123\n\t- 9:00am - 9:30am\n",
        [day("2026-09-16")]: "- [ ] Draft the deck [[Kestrel|⭕]] ^abc123\n",
    }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-15");
    assert.equal(v.notes()[day("2026-09-15")], "- [/] Draft the deck [[Kestrel|⭕]] [[Draft the deck|⋯]] ^abc123\n\t- 9:00am - 9:30am\n");
    assert.equal(v.notices.at(-1), "Reopened on 9/15; that day's time now counts toward Kestrel");
});

scenario("PR 54 review: a done line moved from a sent line says it was reopened", async ({ lag }) => {
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book it [[2026-09-17#^abc123|9/17]] ^abc123\n", [day("2026-09-17")]: "- [x] Book it [[Kestrel|⭕]] ^abc123\n" }, open: KES, at: 5, lag });
    await v.schedule("2026-09-21");
    assert.equal(v.notices.at(-1), "Reopened on 9/21");
});

scenario("PR 54 review: a line typed just below the task while its destination is written stops the move from the day, so it isn't left under another line", async ({ lag }) => {
    const v = standIn({ notes: { [day("2026-09-16")]: "- [ ] Task\n\t- [ ] sub\n- [ ] Other\n" }, open: day("2026-09-16"), at: 0, lag });
    const S = v.customJS.Schedule, append = S.appendToTopChecklist.bind(S);
    S.appendToTopChecklist = async (file, lines) => { const out = await append(file, lines); v.app.workspace.activeLeaf.view.editor.replaceRange("\n\t- [ ] typed meanwhile", { line: 1, ch: "\t- [ ] sub".length }); return out; };
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-16")], "- [ ] Task\n\t- [ ] sub\n\t- [ ] typed meanwhile\n- [ ] Other\n");
    assert.match(v.notices.at(-1), /^The task changed while it was scheduled/);
});

scenario("PR 54 review: Schedule does nothing on or under a forwarded or canceled calendar event, or a meeting line (rule 1)", async ({ lag }) => {
    const D = day("2026-09-19");
    const notes = { [D]: "- [>] [[2026-09-20|9/20]] 2:00pm\tMoved call\n\t- [ ] a\n- [-] 3:00pm\tCanceled call\n\t- [ ] b\n4:00pm [[2026-09-19 Old meeting|Old meeting]]\n\t- [ ] c\n" };
    for (const [at, said] of [[0, "Events must be moved in your calendar app"], [1, "Events must be moved in your calendar app"], [3, "This event was canceled in your calendar"], [5, "Events must be moved in your calendar app"]]) {
        const v = standIn({ notes, open: D, at, lag });
        assert.equal(await v.schedule("2026-09-21"), null, `line ${at}`);
        assert.equal(v.notices.at(-1), said, `line ${at}`);
        assert.deepEqual(v.notes(), notes, `line ${at}`);
    }
});

// ------------------------------------------------------------------ PR 54 confirmation pass (OBS-193)

scenario("PR 54 confirmation: a task scheduled onto a CRLF day with no checklist yet gets its line ending", async ({ lag }) => {
    const v = standIn({ notes: { [day("2026-09-16")]: "- [ ] Draft\n", [day("2026-09-18")]: "## Notes\r\nSome text\r\n" }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-18")], "## Notes\r\nSome text\r\n- [ ] Draft\r\n");
});

scenario("PR 54 confirmation: a note added under a worked-on task while its destination is written stays under the [>] line, and the forward goes through", async ({ lag }) => {
    const v = standIn({ notes: { [day("2026-09-16")]: "- [/] Task ^abc123\n\t- 9:00am - 9:30am\n- [ ] Other\n" }, open: day("2026-09-16"), at: 0, lag });
    const S = v.customJS.Schedule, append = S.appendToTopChecklist.bind(S);
    S.appendToTopChecklist = async (file, lines) => { const out = await append(file, lines); v.app.workspace.activeLeaf.view.editor.replaceRange("\n\t- added", { line: 1, ch: "\t- 9:00am - 9:30am".length }); return out; };
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-16")], "- [>] Task ^abc123\n\t- 9:00am - 9:30am\n\t- added\n- [ ] Other\n");
    assert.equal(v.notices.at(-1), "Forwarded to 9/18");
});

scenario("OBS-210: a worked-on task forwarded from its day takes its open sub-tasks along, as [/]; its time, finished sub-tasks and notes stay with the [>] line", async ({ lag }) => {
    const v = standIn({ notes: { [day("2026-09-18")]: "- [ ] Garden club: print and fold the newsletter\n\t- 9:00am - 9:30am\n\t- [x] Fold the first batch\n\t- [ ] Fold the second batch\n\t- printer is on Elm St\n- [ ] Send September invoices\n" }, open: day("2026-09-18"), at: 3, lag });
    await v.schedule("2026-09-19");
    const id = idIn(v.notes()[day("2026-09-18")]);
    assert.equal(v.notes()[day("2026-09-18")], `- [>] Garden club: print and fold the newsletter ^${id}\n\t- 9:00am - 9:30am\n\t- [x] Fold the first batch\n\t- printer is on Elm St\n- [ ] Send September invoices\n`);
    assert.equal(v.notes()[day("2026-09-19")].trim(), `- [/] Garden club: print and fold the newsletter ^${id}\n\t- [ ] Fold the second batch`);
    // Back onto 9/18: the second batch comes back under the reopened line
    v.open(day("2026-09-19"), v.lineOf(day("2026-09-19"), "Garden club"));
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-18")], `- [/] Garden club: print and fold the newsletter ^${id}\n\t- 9:00am - 9:30am\n\t- [x] Fold the first batch\n\t- printer is on Elm St\n\t- [ ] Fold the second batch\n- [ ] Send September invoices\n`);
    assert.deepEqual(v.check(), []);
});

// ------------------------------------------------------------------ Brian's second test round (OBS-193)

scenario("back onto the day it came from: the reopened line takes the moving line's project and 🆓, and the notice says where that day's time counts now (Brian, 2026-10-26)", async ({ lag }) => {
    const BPP = "Projects/Personal/Block Party Poster/Block Party Poster.md", GCN = "Projects/Personal/Garden Club Newsletter/Garden Club Newsletter.md";
    const v = standIn({ notes: {
        [BPP]: "---\ntags: [project]\n---\n", [GCN]: "---\ntags: [project]\n---\n",
        [day("2026-09-18")]: "- [>] Garden club [[Garden Club Newsletter|⭕]] ^g7k2wm\n\t- 9:00am - 9:30am\n",
        [day("2026-09-19")]: "- [ ] Garden club 🆓 [[Block Party Poster|⭕]] ^g7k2wm\n",
    }, open: day("2026-09-19"), at: 0, lag });
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[day("2026-09-18")], "- [/] Garden club 🆓 [[Block Party Poster|⭕]] ^g7k2wm\n\t- 9:00am - 9:30am\n");
    assert.equal(v.notices.at(-1), "Reopened on 9/18; that day's time now counts toward Block Party Poster");
});

scenario("from a project note, a task's open sub-tasks go with it to the day; finished ones and notes stay under the [>] line (Brian, 2026-10-26)", async ({ lag }) => {
    for (const at of [5, 6]) {
        const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Shoot day\n\t- [ ] Confirm the forms\n\t\t- ask Imogen\n\t- [x] Book the studio\n\t- the van is booked\n- [ ] Next\n" }, open: KES, at, lag });
        await v.schedule("2026-09-19");
        const id = idIn(v.notes()[KES]);
        assert.equal(v.notes()[KES], `---\ntags: [project]\n---\n## To Do\n\n- [>] Shoot day [[2026-09-19#^${id}|9/19]] ^${id}\n\t- [x] Book the studio\n\t- the van is booked\n- [ ] Next\n`, `from line ${at}`);
        assert.equal(v.notes()[day("2026-09-19")].trim(), `- [ ] Shoot day [[Kestrel|⭕]] ^${id}\n\t- [ ] Confirm the forms\n\t\t- ask Imogen`, `from line ${at}`);
        assert.deepEqual(v.check(), [], `from line ${at}`);
    }
});

scenario("a reopen onto a day line with no time says nothing about time, even when the project changes", async ({ lag }) => {
    const NEW = "Projects/Newco/Newco.md";
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n", [NEW]: "---\ntags: [project]\n---\n", [day("2026-09-15")]: "- [x] Draft [[Kestrel|⭕]] ^abc123\n", [day("2026-09-16")]: "- [ ] Draft [[Newco|⭕]] ^abc123\n" }, open: day("2026-09-16"), at: 0, lag });
    await v.schedule("2026-09-15");
    assert.equal(v.notes()[day("2026-09-15")], "- [ ] Draft [[Newco|⭕]] ^abc123\n");
    assert.equal(v.notices.at(-1), "Reopened on 9/15");
});
