// Tests for CustomJS/addTaskNote.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
// The class is loaded with vm, the way CustomJS evaluates it; only the methods that don't touch
// `app` are tested. Creating the note through Templater is checked in a dev vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const AddTaskNote = vm.runInContext(
    fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote",
    vm.createContext({}),
);
const add = new AddTaskNote();

test("afterCheckbox: the column right after the checkbox and its space, for any status and indent", () => {
    assert.equal(add.afterCheckbox("- [ ] Call the printer"), "- [ ] ".length);
    assert.equal(add.afterCheckbox("- [x] Done"), "- [x] ".length);
    assert.equal(add.afterCheckbox("- [/] Started"), "- [/] ".length);
    assert.equal(add.afterCheckbox("\t\t* [>] Nested"), "\t\t* [>] ".length);
    assert.equal(add.afterCheckbox("+ [ ]No space"), "+ [ ]".length, "no space after the box: right after it");
    assert.equal(add.afterCheckbox("- [ ]"), "- [ ]".length);
    assert.equal(add.afterCheckbox("Just text"), 0);
});

test("taskLink: the selection, then a 🔗 link to the note, ending the line with no trailing space", () => {
    assert.equal(add.taskLink("Call the printer", "Call the printer"), "Call the printer [[Call the printer|🔗]]");
    assert.equal(add.taskLink("Call the printer", "Call the printer", ""), "Call the printer [[Call the printer|🔗]]");
    // The link follows the note's final name, which can differ (the Task template drops dates)
    assert.equal(add.taskLink("2026-10-01 Call the printer", "Call the printer"), "2026-10-01 Call the printer [[Call the printer|🔗]]");
    // or be a path when the name alone is ambiguous
    assert.equal(add.taskLink("Budget", "Projects/Home/Budget"), "Budget [[Projects/Home/Budget|🔗]]");
    // A name selected mid-line: one space keeps the link off the text after it, but not doubled
    assert.equal(add.taskLink("Budget", "Budget", "for Q4"), "Budget [[Budget|🔗]] ");
    assert.equal(add.taskLink("Budget", "Budget", " for Q4"), "Budget [[Budget|🔗]]");
    assert.equal(add.spacer(""), "");
    assert.equal(add.spacer("\t…"), "");
});

test("withoutDates: a date in the task text is its due date, not part of the name", () => {
    assert.equal(add.withoutDates("2026-09-30 Renew the domain"), "Renew the domain");
    assert.equal(add.withoutDates("Renew the domain 2026-09-30"), "Renew the domain");
    assert.equal(add.withoutDates("Pay 2026-10-15 the estimate"), "Pay the estimate");
    assert.equal(add.withoutDates("2026-10-01 2026-10-15 File the return"), "File the return");
    assert.equal(add.withoutDates("Call the printer"), "Call the printer");
    assert.equal(add.withoutDates("  Call the printer "), "Call the printer");
    assert.equal(add.withoutDates("2026-09-30"), "2026-09-30", "text that's only a date is left alone");
    // Repeated calls don't carry regex state (the pattern is global)
    assert.equal(add.withoutDates("2026-09-30 A"), "A");
    assert.equal(add.withoutDates("2026-09-30 A"), "A");
});

test("the Task template keeps the name's last date as due, and still drops dates from the name", () => {
    const template = fs.readFileSync(new URL("../../01 Templates/Task.md", here), "utf8");
    const rxDates = /[0-9]{4}-[0-9]{2}-[0-9]{2}/g;
    // The template's own date lines, run against sample titles
    const line = (re) => template.split("\n").find((l) => re.test(l));
    const dueLine = line(/^const due = /);
    assert.ok(dueLine, "template computes due");
    const dueFor = (title) => { const dates = title.match(rxDates); return eval(dueLine.replace(/^const due = /, "")); };
    assert.equal(dueFor("2026-09-30 Renew the domain"), "2026-09-30");
    assert.equal(dueFor("2026-10-01 File it 2026-10-15"), "2026-10-15");
    assert.equal(dueFor("Call the printer"), null);
    assert.ok(template.includes('tR += "due: " + (due ? due : "") + "\\n";'), "template writes due into the frontmatter");
    assert.ok(/replaceAll\(rxDates, ""\)/.test(template), "template still strips dates from the note's name");
    // It writes the picked project or area as `area`, before moving the note, in the Log template's format
    assert.ok(template.includes('tR += "area: " + area + "\\n";'), "template writes area");
    assert.ok(template.indexOf('tR += "area: "') < template.indexOf("await tp.file.move("), "area is written before the move");
    assert.ok(template.includes('"\\"[[" + pickedFile.basename + "|" + parentAlias + "]]\\""'), "same [[Project|alias]] form as the Log template");
    // Esc files the note in 10 Inbox, as the Log template does (OBS-36), never at the vault root
    assert.match(template, /Esc: Inbox/, "the prompt says where Esc puts it");
    assert.match(template, /const inbox = "10 Inbox";/);
    assert.ok(template.indexOf("const inbox") > template.indexOf("} else {"), "only when nothing was picked");
    assert.ok(template.includes('tp.file.path(true) != target + ".md"'), "a note already in the Inbox isn't moved onto itself");
});

test("target: with nothing selected, text after the cursor means use the line's text; only whitespace means a blank link", () => {
    const t = (line, ch) => JSON.parse(JSON.stringify(add.target(line, ch)));
    const task = "- [ ] Order new toner [[Hawk Ledger|⭕]]";
    const name = (line, ch) => { const r = t(line, ch); return r.mode === "text" ? line.slice(r.from, r.to) : r; };
    // Cursor anywhere text still follows: the task text, up to its first link
    assert.equal(name(task, "- [ ] Order ".length), "Order new toner");
    assert.equal(name(task, 0), "Order new toner", "even before the checkbox");
    assert.equal(name(task, "- [ ] Order new toner ".length), "Order new toner", "just before a link, which is text after the cursor");
    assert.deepEqual(t(task, "- [ ] Order ".length), { kind: "task", mode: "text", from: 6, to: 21, name: "Order new toner" });
    // Only whitespace after the cursor, or nothing: a blank link
    assert.deepEqual(t(task, task.length), { kind: "task", mode: "blank" });
    assert.deepEqual(t("- [ ] Pick up the proofs   ", "- [ ] Pick up the proofs".length), { kind: "task", mode: "blank" });
    assert.deepEqual(t("- [ ] ", 6), { kind: "task", mode: "blank" }, "an empty task at its end");
    // Dates stay in the name here; noteFor turns them into the due date
    assert.equal(name("\t- [ ] 2026-11-01 Plan the offsite", 10), "2026-11-01 Plan the offsite");
    // Nothing to use
    assert.ok(t("- [ ] Call the bank [[Call the bank|🔗]]", 8).error, "already linked");
    assert.ok(t("- [ ] [[Hawk Ledger|⭕]]", 7).error, "no task text before the link");
});

test("target: on an event line the time is skipped and the title is used", () => {
    const t = (line, ch) => JSON.parse(JSON.stringify(add.target(line, ch)));
    const ev = "- [<] 2:00pm\tDesign review [[Hawk Ledger|⭕]]";
    assert.deepEqual(t(ev, 8), { kind: "event", mode: "text", from: "- [<] 2:00pm\t".length, to: "- [<] 2:00pm\tDesign review".length, name: "Design review" }, "cursor in the time");
    assert.equal(t(ev, 16).name, "Design review", "cursor in the title");
    assert.equal(t("- [<] all day\tConference", 7).name, "Conference");
    assert.equal(t("- [<] 11:30 AM Budget call", 8).name, "Budget call", "spaced, uppercase time");
    // A free event's mark (OBS-47) stays outside the link, so the sync still reads the line
    assert.deepEqual(t("- [<] 2:00pm\tDelivery window ℹ️ [[Hawk Ledger|⭕]]", 8), { kind: "event", mode: "text", from: "- [<] 2:00pm\t".length, to: "- [<] 2:00pm\tDelivery window".length, name: "Delivery window" });
    assert.equal(t("- [<] 2:00pm\tDelivery window ℹ", 16).name, "Delivery window", "without U+FE0F");
    assert.equal(t("- [<] 2:00pm\tℹ️", 8).name, "ℹ️", "a title that is only the mark");
    assert.deepEqual(t("- [<] all day\tConference", "- [<] all day\tConference".length), { kind: "event", mode: "blank" });
    assert.ok(t("- [<] 1:00pm\t[[2026-09-14 Standup|Standup]]", 8).error, "title already a log link");
});

test("lineWithLink: task text without its dates, existing links kept, the 🔗 link last", () => {
    const line = "- [ ] 2026-11-01 Plan the offsite [[Hawk Ledger|⭕]]  ";
    const target = add.target(line, 8);
    assert.equal(add.lineWithLink(line, target, { name: "Plan the offsite", linktext: "Plan the offsite" }),
        "- [ ] Plan the offsite [[Hawk Ledger|⭕]] [[Plan the offsite|🔗]]");
    const plain = "\t- [/] Order new toner";
    assert.equal(add.lineWithLink(plain, add.target(plain, 9), { name: "Order new toner", linktext: "Order new toner" }),
        "\t- [/] Order new toner [[Order new toner|🔗]]");
});

test("eventLink: a meeting log named with the day's date, aliased to the event", () => {
    assert.equal(add.eventLink("2026-09-16", "Weekly sync"), "[[2026-09-16 Weekly sync|Weekly sync]] ");
    assert.equal(add.eventLink("2026-09-16", ""), "[[2026-09-16 |]] ");
});

test("isEvent: only `[<]` lines, and the checkbox pattern matches every status", () => {
    assert.equal(add.isEvent("- [<] 1:00pm\tWeekly sync"), true);
    assert.equal(add.isEvent("\t- [<] all day\tOffsite"), true);
    assert.equal(add.isEvent("- [ ] A task"), false);
    assert.equal(add.isEvent("- [>] Forwarded"), false);
    for (const status of [" ", "x", "/", ">", "<", "-"]) {
        assert.ok(AddTaskNote.CHECKBOX.test(`- [${status}] text`), status);
    }
    assert.ok(!AddTaskNote.CHECKBOX.test("- plain bullet"));
});

test("new notes are staged outside Projects/, so a note left there means the picker was dismissed", () => {
    assert.ok(!AddTaskNote.STAGING_FOLDER.startsWith("Projects/"));
    assert.equal(AddTaskNote.TASK_TEMPLATE, "00 Meta/01 Templates/Task.md");
    assert.ok(fs.existsSync(new URL("../../01 Templates/Task.md", here)), "the Task template is where the command looks");
});

test("projectLinks: the ⭕ links on a line, with their link paths", () => {
    const links = (line) => JSON.parse(JSON.stringify(add.projectLinks(line)));
    assert.deepEqual(links("- [ ] Order toner [[Hawk Ledger|⭕]]"), [{ raw: "[[Hawk Ledger|⭕]]", linkpath: "Hawk Ledger" }]);
    assert.deepEqual(links("- [ ] A [[Projects/Freelance/Hawk Ledger/Hawk Ledger|⭕]] [[B|🔗]]").map((l) => l.linkpath), ["Projects/Freelance/Hawk Ledger/Hawk Ledger"]);
    assert.deepEqual(links("- [ ] A [[Hawk Ledger#Notes|⭕]]").map((l) => l.linkpath), ["Hawk Ledger"], "a heading link still names the project");
    assert.equal(links("- [ ] A [[One|⭕]] [[Two|⭕]]").length, 2);
    assert.deepEqual(links("- [ ] A [[Note|🔗]] [[2026-10-25|🚩 10/25]]"), [], "other suffixes aren't project links");
    assert.deepEqual(links("- [ ] A [[Hawk Ledger|⭕️]] [[Tin| ⭕ ]]").map((l) => l.linkpath), ["Hawk Ledger", "Tin"], "U+FE0F and spaces, as the sync allows");
    assert.deepEqual(links("- [ ] A [[Household|🗃️]] [[Garden|🗃]]").map((l) => l.linkpath), ["Household", "Garden"], "an area's 🗃️ link counts too (OBS-36)");
    assert.equal(AddTaskNote.AREA_MARK, "🗃️");
    assert.equal(AddTaskNote.PROJECT_MARK, "⭕");
    // Repeated calls don't carry regex state (the pattern is global)
    assert.equal(links("- [ ] A [[P|⭕]]").length, 1);
    assert.equal(links("- [ ] A [[P|⭕]]").length, 1);
});

test("withoutLinks: takes the project link out and closes the gap, keeping indent, checkbox and other links", () => {
    assert.equal(add.withoutLinks("- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|🔗]]", ["[[Hawk Ledger|⭕]]"]),
        "- [ ] Order toner [[Order toner|🔗]]");
    assert.equal(add.withoutLinks("\t\t- [/] Plan it [[Order|🔗]] [[P|⭕]]", ["[[P|⭕]]"]), "\t\t- [/] Plan it [[Order|🔗]]", "at the end: no trailing space");
    assert.equal(add.withoutLinks("- [ ] [[P|⭕]] Plan it [[Plan it|🔗]]", ["[[P|⭕]]"]), "- [ ] Plan it [[Plan it|🔗]]", "right after the checkbox");
    assert.equal(add.withoutLinks("- [ ] A [[P|⭕]] [[P|⭕]] [[A|🔗]]", ["[[P|⭕]]", "[[P|⭕]]"]), "- [ ] A [[A|🔗]]", "the same link twice");
    assert.equal(add.withoutLinks("- [ ] A [[Due|🚩 9/30]] [[P|⭕]] [[A|🔗]]", ["[[P|⭕]]"]), "- [ ] A [[Due|🚩 9/30]] [[A|🔗]]");
    assert.equal(add.withoutLinks("- [<] 9:00am\tQ3  review [[P|⭕]]", ["[[P|⭕]]"]), "- [<] 9:00am\tQ3  review", "spacing elsewhere on the line is kept");
    const untouched = "- [ ] A  [[P|⭕]] [[A|🔗]]";
    assert.equal(add.withoutLinks(untouched, []), untouched, "nothing to remove: the line isn't touched at all");
});

test("takePresetParent: the parent goes only to the note it was picked for, and only once", () => {
    AddTaskNote.preset = { path: "10 Inbox/Order toner.md", parent: "PROJECT" };
    assert.equal(add.takePresetParent("10 Inbox/Something else.md"), null, "another note gets the menu");
    assert.equal(add.takePresetParent(undefined), null);
    assert.equal(add.takePresetParent("10 Inbox/Order toner.md"), "PROJECT");
    assert.equal(add.takePresetParent("10 Inbox/Order toner.md"), null, "used up");
    AddTaskNote.preset = null;
    assert.equal(add.takePresetParent("10 Inbox/Order toner.md"), null);
});

test("pickParent: skips the menu for the preset note only, and shows it for everyone else", async () => {
    const source = fs.readFileSync(new URL("../Templater/pickParent.js", here), "utf8");
    const load = (customJS) => {
        const sandbox = { module: {}, customJS, app: { vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => null } } };
        sandbox.globalThis = sandbox;
        vm.runInContext(source, vm.createContext(sandbox));
        return sandbox.module.exports;
    };
    let menus = 0;
    const tp = (path) => ({ config: { target_file: { path } }, system: { suggester: async () => { menus++; return "FROM MENU"; } } });
    const withPreset = load({ AddTaskNote: { takePresetParent: (p) => (p === "10 Inbox/Order toner.md" ? "PROJECT" : null) } });
    assert.equal(await withPreset(tp("10 Inbox/Order toner.md"), () => true, "?"), "PROJECT");
    assert.equal(menus, 0, "no menu for the preset note");
    assert.equal(await withPreset(tp("Projects/Other.md"), () => true, "?"), "FROM MENU");
    assert.equal(menus, 1);
    // Without CustomJS (or without AddTaskNote), templates work as before
    assert.equal(await load(undefined)(tp("10 Inbox/X.md"), () => true, "?"), "FROM MENU");
    assert.equal(await load({})(tp("10 Inbox/X.md"), () => true, "?"), "FROM MENU");
});

test("noteFor: one link per line: every ⭕ comes off once the note is linked, and a project or area note is never moved", () => {
    const source = fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8");
    assert.match(source, /projectLinks: line\.links,/, "all of the line's ⭕ links are handed back to be removed");
    assert.ok(!/reconcile\(/.test(source), "no partial rule remains");
    assert.match(source, /!this\.isHome\(existing\) && !line\.projects\.includes\(noteHome\)/, "a folder note stays put; a note already in the line's project stays put");
    assert.match(source, /choice = await this\.confirmMove\(existing, noteHome, home\)/, "leaving a project or area asks first");
});

test("linktextFor: the note's name, or its path only when another note really shares the name", () => {
    const note = { path: "Projects/Freelance/Hawk/Check the numbers.md", basename: "Check the numbers" };
    assert.equal(add.linktextFor(note, [note.path, "Projects/Freelance/Hawk/Hawk.md"]), "Check the numbers");
    assert.equal(add.linktextFor(note, [note.path, "10 Inbox/Check the Numbers.md"]), "Projects/Freelance/Hawk/Check the numbers", "same name, any case");
    assert.equal(add.linktextFor(note, [note.path, "Projects/Other/Check the numbers 1.md"]), "Check the numbers", "a numbered copy isn't a clash");
    assert.equal(add.linktextFor(note, [note.path]), "Check the numbers");
});
