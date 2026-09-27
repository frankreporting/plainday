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

test("taskLink: the selection, then a 🗒️ link to the note, ending the line with no trailing space", () => {
    assert.equal(add.taskLink("Call the printer", "Call the printer"), "Call the printer [[Call the printer|🗒️]]");
    assert.equal(add.taskLink("Call the printer", "Call the printer", ""), "Call the printer [[Call the printer|🗒️]]");
    // The link follows the note's final name, which can differ (the Task template drops dates)
    assert.equal(add.taskLink("2026-10-01 Call the printer", "Call the printer"), "2026-10-01 Call the printer [[Call the printer|🗒️]]");
    // or be a path when the name alone is ambiguous
    assert.equal(add.taskLink("Budget", "Projects/Home/Budget"), "Budget [[Projects/Home/Budget|🗒️]]");
    // A name selected mid-line: one space keeps the link off the text after it, but not doubled
    assert.equal(add.taskLink("Budget", "Budget", "for Q4"), "Budget [[Budget|🗒️]] ");
    assert.equal(add.taskLink("Budget", "Budget", " for Q4"), "Budget [[Budget|🗒️]]");
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
    for (const mark of ["🗒️", "🗒", "🔗", "🔗\uFE0F"]) assert.ok(t(`- [ ] Call the bank [[Call the bank|${mark}]]`, 8).error, `already linked (${mark})`);
    // With the cursor at the end, too: no second, blank link (fix round 6)
    for (const line of ["- [>] Order paper samples [[Order paper samples|🗒️]]", "- [ ] Order paper samples [[Order paper samples|🗒️]]   ", "- [x] A [[2026-09-30|🚩 9/30]] [[A|🔗]]"]) {
        assert.deepEqual(t(line, line.length), { error: "This task already links a note" }, line);
    }
    assert.ok(t("- [ ] [[Hawk Ledger|⭕]]", 7).error, "no task text before the link");
});

test("target: on an event line the time is skipped and the title is used", () => {
    const t = (line, ch) => JSON.parse(JSON.stringify(add.target(line, ch)));
    const ev = "- [<] 2:00pm\tDesign review [[Hawk Ledger|⭕]]";
    assert.deepEqual(t(ev, 8), { kind: "event", mode: "text", from: "- [<] 2:00pm\t".length, to: "- [<] 2:00pm\tDesign review".length, name: "Design review" }, "cursor in the time");
    // Your 🆓 isn't part of the name either, before or after the mark
    assert.equal(t("- [<] 2:00pm\tDesign review ℹ️ 🆓 [[Hawk Ledger|⭕]]", 8).name, "Design review");
    assert.equal(t("- [<] 2:00pm\tDesign review 🆓 ℹ", 8).name, "Design review");
    assert.equal(t(ev, 16).name, "Design review", "cursor in the title");
    assert.equal(t("- [<] all day\tConference", 7).name, "Conference");
    assert.equal(t("- [<] 11:30 AM Budget call", 8).name, "Budget call", "spaced, uppercase time");
    // A free event's mark (OBS-47) stays outside the link, so the sync still reads the line
    assert.deepEqual(t("- [<] 2:00pm\tDelivery window ℹ️ [[Hawk Ledger|⭕]]", 8), { kind: "event", mode: "text", from: "- [<] 2:00pm\t".length, to: "- [<] 2:00pm\tDelivery window".length, name: "Delivery window" });
    assert.equal(t("- [<] 2:00pm\tDelivery window ℹ", 16).name, "Delivery window", "without U+FE0F");
    assert.equal(t("- [<] 2:00pm\tℹ️", 8).name, "ℹ️", "a title that is only the mark");
    // On an event line the cursor's place doesn't matter: at the end, it's still the title (fix round 2)
    assert.equal(t("- [<] all day\tConference", "- [<] all day\tConference".length).name, "Conference");
    assert.equal(t("- [<] 2:00pm\tDesign review ℹ️ [[Hawk Ledger|⭕]]  ", 40).name, "Design review");
    // An event never gets a blank link (it would point at the daily note): with no title, it says so
    assert.deepEqual(t("- [<] 3:00pm\t", "- [<] 3:00pm\t".length), { error: "This event has no title to name its log" });
    assert.ok(t("- [<] 1:00pm\t[[2026-09-14 Standup|Standup]]", 8).error, "title already a log link");
    for (const mark of ["🗒️", "🗒", "🔗"]) {
        assert.equal(t(`- [<] 1:00pm\tStandup [[2026-09-14 Standup|${mark}]] [[Hawk Ledger|⭕]]`, 8).error, "This event already links a log", mark);
    }
});

test("eventLine: the log link goes after the title and its marks, before the ⭕ or 🗃️ links that end the line (OBS-57)", () => {
    assert.equal(add.eventLine("- [<] 9:00am\tStandup", "Standup", "2026-09-14"), "- [<] 9:00am\tStandup [[2026-09-14 Standup|🗒️]]");
    assert.equal(add.eventLine("- [<] 9:00am\tStandup   ", "Standup", "2026-09-14"), "- [<] 9:00am\tStandup [[2026-09-14 Standup|🗒️]]");
    assert.equal(add.eventLine("- [<] 2:00pm\tDelivery window ℹ️ 🆓 [[Hawk Ledger|⭕]] [[Home|🗃️]]", "Delivery window", "2026-09-14"),
        "- [<] 2:00pm\tDelivery window ℹ️ 🆓 [[2026-09-14 Delivery window|🗒️]] [[Hawk Ledger|⭕]] [[Home|🗃️]]");
    assert.equal(add.eventLine("\t- [<] All day\tOffsite [[Hawk Ledger|⭕]]", "Offsite", "2026-09-14"),
        "\t- [<] All day\tOffsite [[2026-09-14 Offsite|🗒️]] [[Hawk Ledger|⭕]]");
    // A selected name names the log; the link still goes at the end
    assert.equal(add.eventLine("- [<] 1:00pm\tWeekly sync with the studio [[Hawk Ledger|⭕]]", "Weekly sync", "2026-09-14"),
        "- [<] 1:00pm\tWeekly sync with the studio [[2026-09-14 Weekly sync|🗒️]] [[Hawk Ledger|⭕]]");
    // A person linked in the title stays in the title
    assert.equal(add.eventLine("- [<] 1:00pm\tLunch with [[Rafe Oakes]]", "Lunch with", "2026-09-14"), "- [<] 1:00pm\tLunch with [[Rafe Oakes]] [[2026-09-14 Lunch with|🗒️]]");
    // Already linked, either way: nothing to add
    assert.deepEqual({ ...add.eventLine("- [<] 1:00pm\tStandup [[2026-09-14 Standup|🔗]]", "Standup", "2026-09-14") }, { error: "This event already links a log" });
    assert.deepEqual({ ...add.eventLine("- [<] 1:00pm\t[[2026-09-14 Standup|Standup]]", "Standup", "2026-09-14") }, { error: "This event already links a log" });
});

test("lineWithLink: task text without its dates, existing links kept, the 🗒️ link last", () => {
    const line = "- [ ] 2026-11-01 Plan the offsite [[Hawk Ledger|⭕]]  ";
    const target = add.target(line, 8);
    assert.equal(add.lineWithLink(line, target, { name: "Plan the offsite", linktext: "Plan the offsite" }),
        "- [ ] Plan the offsite [[Hawk Ledger|⭕]] [[Plan the offsite|🗒️]]");
    const plain = "\t- [/] Order new toner";
    assert.equal(add.lineWithLink(plain, add.target(plain, 9), { name: "Order new toner", linktext: "Order new toner" }),
        "\t- [/] Order new toner [[Order new toner|🗒️]]");
});

test("eventLink: a meeting log named with the day's date, as a 🗒️ note link; blank, it waits for the name", () => {
    assert.equal(add.eventLink("2026-09-16", "Weekly sync"), "[[2026-09-16 Weekly sync|🗒️]]");
    assert.equal(add.eventLink("2026-09-16", ""), "[[2026-09-16 |🗒️]]");
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
    const inboxPreset = load({ AddTaskNote: { takePresetParent: (p) => (p === "10 Inbox/Log.md" ? "inbox" : null) } });
    assert.equal(await inboxPreset(tp("10 Inbox/Log.md"), () => true, "?"), null, "the Inbox preset selects the template's fallback");
    assert.equal(menus, 0, "no menu for an Inbox preset");
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

test("confirmMove: rows read Task (or Log, or Note), From and To, and Enter moves", async () => {
    // A Modal and elements just real enough to lay the prompt out and press its buttons
    const el = () => {
        const e = { children: [], text: undefined };
        e.createEl = (tag, o = {}) => { const c = el(); c.tag = tag; c.text = o.text; e.children.push(c); return c; };
        e.createDiv = () => e.createEl("div");
        return e;
    };
    let keys;
    class Modal {
        constructor() { this.titleEl = { setText: (t) => { this.title = t; } }; this.contentEl = el(); keys = {}; this.scope = { register: (m, k, fn) => { keys[k] = fn; } }; }
        onOpen() {}
        open() { opened = this; this.onOpen(); }
        close() { this.onClose(); }
    }
    class ButtonComponent {
        constructor() { this.buttonEl = { focus() {} }; }
        setButtonText() { return this; }
        setCta() { return this; }
        onClick() { return this; }
    }
    let opened;
    const Cls = vm.runInContext(
        fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote",
        vm.createContext({ app: { metadataCache: { getFileCache: (f) => f.cache ?? null } }, customJS: { obsidian: { Modal, ButtonComponent } }, requestAnimationFrame: () => {}, setTimeout }),
    );
    const helper = new Cls();
    helper.isArea = (f) => f.basename === "Household";
    const rowsOf = () => opened.contentEl.children[0].children.map((tr) => tr.children.map((td) => td.text));

    const task = helper.confirmMove({ basename: "Renew online", parent: { name: "Household" }, cache: { frontmatter: { tags: ["task"] } } }, { basename: "Household" }, { basename: "Garden Club Newsletter" });
    assert.equal(opened.title, "Move task note?");
    assert.deepEqual(rowsOf(), [["Task", "Renew online"], ["From", "🗃️ Household"], ["To", "⭕ Garden Club Newsletter"]]);
    keys.Enter();
    assert.equal(await task, "move");

    const log = helper.confirmMove({ basename: "2026-09-18 Printer call", parent: { name: "logs" } }, { basename: "Garden Club Newsletter" }, { basename: "Household" });
    assert.equal(opened.title, "Move log?");
    assert.deepEqual(rowsOf(), [["Log", "2026-09-18 Printer call"], ["From", "⭕ Garden Club Newsletter"], ["To", "🗃️ Household"]]);
    opened.close();
    assert.equal(await log, null, "Esc (a close with no choice) leaves it");

    // A log waiting in the Inbox is still a log; a note that's neither is a note (MoveToProject)
    const inbox = helper.confirmMove({ basename: "2026-09-18 Printer call", parent: { name: "10 Inbox" }, cache: { frontmatter: { tags: "log" } } }, { basename: "Household" }, { basename: "Garden Club Newsletter" });
    assert.equal(opened.title, "Move log?");
    opened.close();
    await inbox;
    const note = helper.confirmMove({ basename: "Seed catalog", parent: { name: "Household" }, cache: { frontmatter: { tags: [] } } }, { basename: "Household" }, { basename: "Garden Club Newsletter" });
    assert.equal(opened.title, "Move note?");
    assert.deepEqual(rowsOf()[0], ["Note", "Seed catalog"]);
    assert.equal(opened.contentEl.children[1].text, "Time entries will be reallocated accordingly.");
    opened.close();
    await note;

    // A project or area moving (MoveToProject): its own time stays with it; one at the top has no From
    const project = helper.confirmMove({ basename: "Garden Club Newsletter", parent: { name: "Garden Club Newsletter" }, cache: { frontmatter: { tags: ["project"] } } }, { basename: "Household" }, { basename: "Freelance" });
    assert.equal(opened.title, "Move project?");
    assert.deepEqual(rowsOf(), [["Project", "Garden Club Newsletter"], ["From", "🗃️ Household"], ["To", "⭕ Freelance"]]);
    assert.match(opened.contentEl.children[1].text, /^Its time stays its own/);
    opened.close();
    await project;
    const area = helper.confirmMove({ basename: "Household", parent: { name: "Household" }, cache: { frontmatter: { tags: ["area"] } } }, null, { basename: "Freelance" });
    assert.equal(opened.title, "Move area?");
    assert.deepEqual(rowsOf()[1], ["From", "No project or area"]);
    assert.equal(opened.contentEl.children[1].text, "Its time, and its projects', stays their own.", "an area has no parent to count toward");
    opened.close();
    await area;
});

// A stand-in `app` with notes at `paths`, each file carrying its own metadata cache
const withApp = (paths, extra = {}) => {
    const files = paths.map(([path, tags]) => {
        const name = path.split("/").pop();
        const parentPath = path.slice(0, path.lastIndexOf("/"));
        return { path, name, basename: name.replace(/\.md$/, ""), extension: "md", parent: { path: parentPath, name: parentPath.split("/").pop() }, cache: { frontmatter: { tags } } };
    });
    const app = {
        vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p) => files.find((f) => f.path === p) ?? null, getAbstractFileByPathInsensitive: (p) => files.find((f) => f.path.toLowerCase() === p.toLowerCase()) ?? null },
        metadataCache: { getFileCache: (f) => f.cache ?? null },
        ...extra,
    };
    return { files, app };
};

test("isLog: a note in a logs folder (any case), or one tagged #log wherever it waits; logsFolder: the one there, as it's spelled", () => {
    const { files, app } = withApp([
        ["Projects/A/logs/2026-09-02 Kickoff.md", []],
        ["Projects/B/Logs/2026-09-03 Standup.md", []],
        ["10 Inbox/2026-09-18 Printer call.md", "log"],
        ["10 Inbox/Order toner.md", ["task"]],
        ["Projects/A/A.md", ["project"]],
        ["Projects/B/B.md", ["project"]],
    ]);
    app.vault.getAbstractFileByPathInsensitive = (p) => (p.toLowerCase() === "projects/b/logs" ? { path: "Projects/B/Logs" } : null);
    const Cls = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote", vm.createContext({ app }));
    const helper = new Cls();
    assert.deepEqual(files.slice(0, 4).map((f) => helper.isLog(f)), [true, true, true, false]);
    assert.equal(helper.logsFolder(files[4]), "Projects/A/logs", "none yet: where a new one goes");
    assert.equal(helper.logsFolder(files[5]), "Projects/B/Logs");
});

test("isSameNote: the note itself, its current path, or the path it was just moved from; nothing else", () => {
    const helper = new (vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote", vm.createContext({})))();
    const note = { path: "Projects/A/logs/2026-09-14 Review.md" };
    assert.ok(helper.isSameNote(note, note));
    assert.ok(helper.isSameNote({ path: note.path }, note), "another object for the same path");
    assert.ok(helper.isSameNote({ path: "10 Inbox/2026-09-14 Review.md" }, note, "10 Inbox/2026-09-14 Review.md"), "a stale entry where it was");
    assert.ok(!helper.isSameNote({ path: "10 Inbox/2026-09-14 Review.md" }, note), "without the old path, that's another note");
    assert.ok(!helper.isSameNote({ path: "Projects/B/2026-09-14 Review.md" }, note, "10 Inbox/2026-09-14 Review.md"));
    assert.ok(!helper.isSameNote(null, note, "10 Inbox/2026-09-14 Review.md"));
});

test("a note just moved isn't mistaken for a clash or another note (AddTaskNote's link text, AddProjectLink's check)", () => {
    const addTaskNote = fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8");
    assert.match(addTaskNote, /movedFrom = existing\.path;\n\s*if \(choice === "move" && !\(await this\.moveInto\(existing, home\)\)\)/);
    assert.match(addTaskNote, /\.filter\(\(p\) => p !== movedFrom\)/, "the old path isn't counted as a second note of that name");
    const addProjectLink = fs.readFileSync(new URL("../CustomJS/addProjectLink.js", here), "utf8");
    assert.match(addProjectLink, /const movedFrom = note\.path;\n\s*if \(!\(await helper\.moveInto\(note, home\)\)\) return;/);
    assert.match(addProjectLink, /helper\.isSameNote\(this\.taskNoteOf\(before, source\.path\), note, movedFrom\)/);
});

test("pickHome: MoveToProject can leave homes out of the menu and ask its own question; otherwise it's unchanged", async () => {
    const { files, app } = withApp([
        ["Projects/A/A.md", ["area"]],
        ["Projects/A/B/B.md", ["project"]],
        ["Projects/A/C/C.md", ["project"]],
        ["10 Inbox/Loose idea.md", []],
    ]);
    let shown;
    class FuzzySuggestModal {
        setPlaceholder(p) { this.placeholder = p; }
        open() { shown = { placeholder: this.placeholder, items: this.getItems().map((f) => this.getItemText(f)) }; this.onClose(); }
    }
    const Cls = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote",
        vm.createContext({ app, customJS: { obsidian: { FuzzySuggestModal } }, setTimeout }));
    const helper = new Cls();
    await helper.pickHome("Order toner", [files[2]]);
    assert.deepEqual(Array.from(shown.items), ["C", "A", "B"], "the line's projects first, then the rest");
    assert.equal(shown.placeholder, 'Which project or area is "Order toner" for? (Esc: cancel)');
    await helper.pickHome("B", [], { exclude: (f) => f.path.startsWith("Projects/A/B/"), placeholder: 'Move "B" to which project or area? (Esc: cancel)' });
    assert.deepEqual(Array.from(shown.items), ["A", "C"]);
    assert.equal(shown.placeholder, 'Move "B" to which project or area? (Esc: cancel)');
});

test("moveInto: a clash is refused before anything is made; a log from the Inbox goes into logs/", async () => {
    const made = [];
    const renamed = [];
    const notices = [];
    const { files, app } = withApp([
        ["Projects/A/A.md", ["project"]],
        ["Projects/A/Order toner.md", ["task"]],
        ["10 Inbox/Order toner.md", ["task"]],
        ["10 Inbox/2026-09-18 Printer call.md", ["log"]],
    ], {
        fileManager: { renameFile: async (f, to) => renamed.push([f.path, to]) },
    });
    app.vault.createFolder = async (p) => made.push(p);
    const Cls = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote",
        vm.createContext({ app, Notice: class { constructor(m) { notices.push(m); } } }));
    const helper = new Cls();
    assert.equal(await helper.moveInto(files[2], files[0]), false);
    assert.deepEqual(notices, ["Projects/A already has a note named Order toner, so nothing changed"]);
    assert.equal(await helper.moveInto(files[3], files[0]), true);
    assert.deepEqual(made, ["Projects/A/logs"]);
    assert.deepEqual(renamed, [["10 Inbox/2026-09-18 Printer call.md", "Projects/A/logs/2026-09-18 Printer call.md"]]);
});

test("invoke on an event line: wherever the cursor is, the log is named from the title and linked before the ⭕; a line already linked is refused", async () => {
    const source = fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8");
    const invoke = async (line, ch = line.length) => {
        const notices = [];
        let text = line, cursor = null;
        const editor = {
            getSelection: () => "",
            getCursor: () => ({ line: 0, ch }),
            getLine: () => text,
            replaceRange: (s, from, to) => { text = text.slice(0, from.ch) + s + text.slice(to.ch); },
            setCursor: (c) => { cursor = c; },
            transaction: ({ replaceSelection, selection }) => { text = text.slice(0, ch) + replaceSelection + text.slice(ch); cursor = selection.from; },
        };
        const Cls = vm.runInContext(source + "\n;AddTaskNote", vm.createContext({
            // The log already exists, so only the line is at stake here (making the log: the next test)
            app: {
                workspace: { activeLeaf: { view: { editor } }, getActiveFile: () => ({ basename: "2026-09-14", path: "days/2026-09-14.md" }) },
                metadataCache: { getFirstLinkpathDest: () => ({ path: "P/logs/2026-09-14 Kickoff call.md" }) },
            },
            Notice: class { constructor(message) { notices.push(message); } },
        }));
        await new Cls().invoke();
        return { text, cursor: cursor && { ...cursor }, notices };
    };
    const ev = "- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]]";
    for (const ch of [ev.length, 8, 0]) {
        const named = await invoke(ev, ch);
        assert.equal(named.text, "- [<] 1:30pm\tKickoff call ℹ️ [[2026-09-14 Kickoff call|🗒️]] [[Hawk Ledger|⭕]]", `cursor at ${ch}`);
        assert.deepEqual(named.notices, [], `cursor at ${ch}`);
    }
    // An event with no title has nothing to name its log after, and the line is left alone
    const untitled = await invoke("- [<] 1:30pm\t");
    assert.equal(untitled.text, "- [<] 1:30pm\t");
    assert.deepEqual(untitled.notices, ["This event has no title to name its log"]);
    for (const linked of ["- [<] 1:30pm\tKickoff call [[2026-09-14 Kickoff call|🗒️]]", "- [<] 1:30pm\t[[2026-09-14 Kickoff call|Kickoff call]]  ", "- [<] Printer call [[2026-09-18 Printer call|🔗]] [[Hawk Ledger|⭕]]"]) {
        const refused = await invoke(linked);
        assert.equal(refused.text, linked, linked);
        assert.deepEqual(refused.notices, ["This event already links a log"], linked);
    }
    // The cursor in the title: the log is named from it, and the cursor goes after the checkbox
    const named = await invoke(ev, 16);
    assert.equal(named.text, "- [<] 1:30pm\tKickoff call ℹ️ [[2026-09-14 Kickoff call|🗒️]] [[Hawk Ledger|⭕]]");
    assert.deepEqual(named.cursor, { line: 0, ch: 6 });
});

test("invoke on an event line makes the log right away through the Log template, after saving the line, unless it exists (OBS-57)", async () => {
    const source = fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8");
    const invoke = async (line, { ch = 16, existing = null } = {}) => {
        const calls = [];
        let text = line;
        const editor = {
            getSelection: () => "",
            getCursor: () => ({ line: 0, ch }),
            getLine: () => text,
            replaceRange: (s, from, to) => { calls.push("write line"); text = text.slice(0, from.ch) + s + text.slice(to.ch); },
            setCursor: () => {},
            transaction: ({ replaceSelection }) => { calls.push("write line"); text = text.slice(0, ch) + replaceSelection + text.slice(ch); },
        };
        const view = { editor, save: async () => { calls.push("save"); } };
        const template = { path: "00 Meta/01 Templates/Log.md" };
        const Cls = vm.runInContext(source + "\n;AddTaskNote", vm.createContext({
            app: {
                workspace: { activeLeaf: { view }, getActiveFile: () => ({ basename: "2026-09-14", path: "days/2026-09-14.md" }) },
                vault: { getFileByPath: (p) => (p === template.path ? template : null) },
                metadataCache: { getFirstLinkpathDest: (name) => (name === existing ? { path: `P/logs/${name}.md` } : null) },
                plugins: { plugins: { "templater-obsidian": { templater: {
                    create_new_note_from_template: async (tpl, folder, name, open) => { calls.push(`template ${tpl.path} in ${folder}: ${name} (open: ${open})`); return { path: `${folder}/${name}.md` }; },
                } } } },
            },
            Notice: class { constructor(message) { calls.push(`notice: ${message}`); } },
        }));
        await new Cls().invoke();
        return { text, calls };
    };
    const ev = "- [<] 1:30pm\tKickoff call [[Hawk Ledger|⭕]]";
    const made = await invoke(ev);
    assert.equal(made.text, "- [<] 1:30pm\tKickoff call [[2026-09-14 Kickoff call|🗒️]] [[Hawk Ledger|⭕]]", "the Log template takes the ⭕ off once it has filed the log");
    assert.deepEqual(made.calls, ["write line", "save", "template 00 Meta/01 Templates/Log.md in 10 Inbox: 2026-09-14 Kickoff call (open: false)"]);
    // A log by that name already: the line links it, and nothing is made
    assert.deepEqual((await invoke(ev, { existing: "2026-09-14 Kickoff call" })).calls, ["write line"]);
    // The cursor at the end of the line makes it just the same (fix round 2); a line with no title,
    // or one that's refused, makes nothing
    assert.deepEqual((await invoke(ev, { ch: ev.length })).calls, ["write line", "save", "template 00 Meta/01 Templates/Log.md in 10 Inbox: 2026-09-14 Kickoff call (open: false)"]);
    assert.ok(!(await invoke("- [<] 1:30pm\t", { ch: "- [<] 1:30pm\t".length })).calls.some((c) => c.startsWith("template")));
    assert.deepEqual((await invoke("- [<] 1:30pm\tKickoff call [[2026-09-14 Kickoff call|🗒️]]")).calls, ["notice: This event already links a log"]);
});

test("an event time with nothing after it is a line with no title; a title a file can't be named after makes a log name that works (fix round 4)", () => {
    const t = (line, ch) => JSON.parse(JSON.stringify(add.target(line, ch)));
    for (const line of ["- [<] 4:00pm", "- [<] 4:00pm ", "- [<] 4:00pm\t", "- [<] All day"]) {
        for (const ch of [line.length, 7]) assert.deepEqual(t(line, ch), { error: "This event has no title to name its log" }, `${line} at ${ch}`);
    }
    // The log's name, like CalNav's: ": " becomes " - ", and characters a file name can't hold go
    assert.equal(add.logName("Sync: Q3 plan"), "Sync - Q3 plan");
    assert.equal(add.logName("Re:call / follow-up | notes"), "Re - call - follow-up - notes");
    assert.equal(add.logName('Review "final" #2 [draft]?'), "Review final 2 draft");
    assert.equal(add.logName("Plain title"), "Plain title");
    // The title on the line stays as the calendar wrote it; only the log's name changes
    assert.equal(add.eventLine("- [<] 1:30pm\tSync: Q3 plan [[Hawk Ledger|⭕]]", "Sync: Q3 plan", "2026-09-14"),
        "- [<] 1:30pm\tSync: Q3 plan [[2026-09-14 Sync - Q3 plan|🗒️]] [[Hawk Ledger|⭕]]");
});
