// Tests for CustomJS/addTaskNote.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
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

test("spacer: a space before text that follows a blank link, none before whitespace or the end", () => {
    assert.equal(add.spacer("for Q4"), " ");
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
    const template = fs.readFileSync(new URL("../../Templates/Task.md", here), "utf8");
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
    // It writes the picked project or area as `parent` (`area` before OBS-175), before moving the note,
    // in the Log template's format
    assert.ok(template.includes('tR += "parent: " + parentLink + "\\n";'), "template writes parent");
    assert.ok(template.indexOf('tR += "parent: "') < template.indexOf("await tp.file.move("), "parent is written before the move");
    assert.ok(!/tR \+= "area: /.test(template), "and no area");
    assert.ok(template.includes('"\\"[[" + pickedFile.basename + "|" + parentAlias + "]]\\""'), "same [[Project|alias]] form as the Log template");
    // With no project from the command, the note goes to Inbox, as a log does (OBS-36), never at the vault root
    assert.match(template, /const inbox = "Inbox";/);
    assert.ok(template.indexOf("const inbox") > template.indexOf("} else {"), "only when the command named no project");
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
    // A block ID at the end isn't part of the name
    assert.equal(name("- [ ] Order toner ^abc123", 8), "Order toner");
    assert.equal(t("- [<] 2:00pm\tReview ^mtg1", 8).name, "Review");
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

test("eventLine: the log link ends the line, after the title, its marks and any ⭕ or 🗃️ links (OBS-57, OBS-90)", () => {
    assert.equal(add.eventLine("- [<] 9:00am\tStandup", "Standup", "2026-09-14"), "- [<] 9:00am\tStandup [[2026-09-14 Standup|🗒️]]");
    assert.equal(add.eventLine("- [<] 9:00am\tStandup   ", "Standup", "2026-09-14"), "- [<] 9:00am\tStandup [[2026-09-14 Standup|🗒️]]");
    assert.equal(add.eventLine("- [<] 2:00pm\tDelivery window ℹ️ 🆓 [[Hawk Ledger|⭕]] [[Home|🗃️]]", "Delivery window", "2026-09-14"),
        "- [<] 2:00pm\tDelivery window ℹ️ 🆓 [[Hawk Ledger|⭕]] [[Home|🗃️]] [[2026-09-14 Delivery window|🗒️]]");
    assert.equal(add.eventLine("\t- [<] All day\tOffsite [[Hawk Ledger|⭕]]", "Offsite", "2026-09-14"),
        "\t- [<] All day\tOffsite [[Hawk Ledger|⭕]] [[2026-09-14 Offsite|🗒️]]");
    // A selected name names the log; the link still goes at the end
    assert.equal(add.eventLine("- [<] 1:00pm\tWeekly sync with the studio [[Hawk Ledger|⭕]]", "Weekly sync", "2026-09-14"),
        "- [<] 1:00pm\tWeekly sync with the studio [[Hawk Ledger|⭕]] [[2026-09-14 Weekly sync|🗒️]]");
    // A person linked in the title stays in the title
    assert.equal(add.eventLine("- [<] 1:00pm\tLunch with [[Rafe Oakes]]", "Lunch with", "2026-09-14"), "- [<] 1:00pm\tLunch with [[Rafe Oakes]] [[2026-09-14 Lunch with|🗒️]]");
    // An existing log's link text (a path, when its name isn't unique)
    assert.equal(add.eventLine("- [<] 1:00pm\tStandup [[Hawk Ledger|⭕]]", "Standup", "2026-09-14", "Projects/Hawk/logs/2026-09-14 Standup"),
        "- [<] 1:00pm\tStandup [[Hawk Ledger|⭕]] [[Projects/Hawk/logs/2026-09-14 Standup|🗒️]]");
    // Already linked, either way: nothing to add
    assert.deepEqual({ ...add.eventLine("- [<] 1:00pm\tStandup [[2026-09-14 Standup|🔗]]", "Standup", "2026-09-14") }, { error: "This event already links a log" });
    assert.deepEqual({ ...add.eventLine("- [<] 1:00pm\t[[2026-09-14 Standup|Standup]]", "Standup", "2026-09-14") }, { error: "This event already links a log" });
});

test("withHome: the project or area link goes before the note links that end the line, replacing the ones given (OBS-90)", () => {
    const H = "[[Hawk Ledger|⭕]]";
    assert.equal(add.withHome("- [ ] Order toner", H), "- [ ] Order toner [[Hawk Ledger|⭕]]", "no note link: at the end");
    assert.equal(add.withHome("- [ ] Order toner [[Order toner|🗒️]]", H), "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|🗒️]]");
    assert.equal(add.withHome("- [ ] Order toner [[2026-09-30|🚩 9/30]] [[Order toner|🗒️]]", H), "- [ ] Order toner [[2026-09-30|🚩 9/30]] [[Hawk Ledger|⭕]] [[Order toner|🗒️]]", "after a due date");
    assert.equal(add.withHome("- [ ] Order toner [[Tin|⭕]] [[Order toner|🗒️]]", H, ["[[Tin|⭕]]"]), "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|🗒️]]", "replacing another");
    assert.equal(add.withHome("- [ ] Order toner [[Order toner|🔗]] [[Tin|⭕]]  ", H, ["[[Tin|⭕]]"]), "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|🔗]]", "the older order comes out in the new one");
    assert.equal(add.withHome("- [ ] Sub [[Sub|🗒️]] [[Parent note|🗒️]]", H), "- [ ] Sub [[Hawk Ledger|⭕]] [[Sub|🗒️]] [[Parent note|🗒️]]", "before every note link at the end");
    assert.equal(add.withHome("- [ ] Read [[Notes|🗒️]] then call", H), "- [ ] Read [[Notes|🗒️]] then call [[Hawk Ledger|⭕]]", "a note link in the text isn't the end");
    assert.equal(add.withHome("\t- [<] 2:00pm\tReview ℹ️ [[2026-09-14 Review|🗒️]]", "[[Home|🗃️]]"), "\t- [<] 2:00pm\tReview ℹ️ [[Home|🗃️]] [[2026-09-14 Review|🗒️]]", "an event, an area");
    assert.equal(add.withHome("- [ ] [[Order toner|🗒️]]", H), "- [ ] [[Hawk Ledger|⭕]] [[Order toner|🗒️]]");
    // No link: only what's given comes off
    assert.equal(add.withHome("- [ ] Order toner [[Tin|⭕]] [[Order toner|🗒️]] ", null), "- [ ] Order toner [[Tin|⭕]] [[Order toner|🗒️]]");
    assert.equal(add.withHome("- [ ] Order toner [[Tin|⭕]] [[Order toner|🗒️]]", null, ["[[Tin|⭕]]"]), "- [ ] Order toner [[Order toner|🗒️]]");
    // A 🚩 after the 🗒️ stays where it is; the ⭕ goes before the 🗒️ (OBS-90 review)
    assert.equal(add.withHome("- [x] Pay it [[Pay it|🗒️]] [[2026-09-14|🚩 9/14]]", H), "- [x] Pay it [[Hawk Ledger|⭕]] [[Pay it|🗒️]] [[2026-09-14|🚩 9/14]]");
    assert.equal(add.withHome("- [x] Pay it 🆓 [[Pay it|🗒️]]", H), "- [x] Pay it 🆓 [[Hawk Ledger|⭕]] [[Pay it|🗒️]]");
    // A block ID stays last, where Obsidian reads it
    assert.equal(add.withHome("- [x] Task [[Task|🗒️]] ^abc123", H), "- [x] Task [[Hawk Ledger|⭕]] [[Task|🗒️]] ^abc123");
    assert.equal(add.withHome("- [x] Task ^abc123", H), "- [x] Task [[Hawk Ledger|⭕]] ^abc123");
    // An event's tab after its time isn't eaten, even with no title before the note link
    assert.equal(add.withHome("- [<] 9:00am\t[[Task A|🗒️]]", H), "- [<] 9:00am\t [[Hawk Ledger|⭕]] [[Task A|🗒️]]");
    // homed: what noteFor found decides
    assert.equal(add.homed("- [ ] A [[Tin|⭕]] [[Other|⭕]]", { homeLink: H, projectLinks: ["[[Tin|⭕]]", "[[Other|⭕]]"] }), "- [ ] A [[Hawk Ledger|⭕]]");
    assert.equal(add.homed("- [ ] A [[Tin|⭕]]", { homeLink: null, projectLinks: ["[[Tin|⭕]]"] }), "- [ ] A [[Tin|⭕]]", "no home to name: the line's own links stay");
    assert.equal(add.homed("- [ ] A [[Tin|⭕]]", { homeLink: null, clear: true, projectLinks: ["[[Tin|⭕]]"] }), "- [ ] A", "unless they'd disagree with where the note was left");
});

test("trailingNote and endWith: the note link in the run that ends a line; a link added at the end goes before a block ID", () => {
    assert.equal(add.trailingNote("- [ ] A [[P|⭕]] [[Note A|🗒️]]"), "Note A");
    assert.equal(add.trailingNote("- [ ] A [[Note A#Notes|🔗]] [[2026-09-30|🚩 9/30]] ^x1"), "Note A");
    assert.equal(add.trailingNote("- [ ] Sub [[Sub|🗒️]] [[Parent|🗒️]]"), "Sub", "the first of several");
    assert.equal(add.trailingNote("- [ ] Read [[Note A|🗒️]] then call"), null, "not at the end");
    assert.equal(add.trailingNote("- [ ] A [[P|⭕]]"), null);
    // Only the ⭕ links that end a line are its own (OBS-90): one in the text is part of the title
    const own = (line) => JSON.parse(JSON.stringify(add.trailingProjectLinks(line))).map((l) => l.linkpath);
    assert.deepEqual(own("- [ ] Ask [[Tin|⭕]] about [[Hawk|⭕]] [[Note|🗒️]] ^x1"), ["Hawk"]);
    assert.deepEqual(own("- [ ] A [[2026-09-30|🚩 9/30]] [[Tin|⭕]] [[Home|🗃️]] [[Note|🗒️]]"), ["Tin", "Home"]);
    assert.deepEqual(own("- [ ] A [[Tin|⭕ Tin]] [[Note|🗒️]]"), [], "a ⭕ with a name after it isn't one, as the report reads it");
    assert.equal(add.endWith("- [ ] A [[P|⭕]]  ", "[[A|🗒️]]"), "- [ ] A [[P|⭕]] [[A|🗒️]]");
    assert.equal(add.endWith("- [ ] A ^x1", "[[A|🗒️]]"), "- [ ] A [[A|🗒️]] ^x1");
    // With a selection, the name is the selection, and the note link still ends the line (OBS-90 review)
    const line = "- [ ] Draft wireframes for the homepage [[Tin|⭕]]";
    assert.equal(add.lineWithLink(line, { from: 6, to: 22 }, { name: "Draft wireframes", linktext: "Draft wireframes", homeLink: "[[Hawk Ledger|⭕]]", projectLinks: ["[[Tin|⭕]]"] }),
        "- [ ] Draft wireframes for the homepage [[Hawk Ledger|⭕]] [[Draft wireframes|🗒️]]");
});

test("lineWithLink: task text without its dates, the note's project in place of the line's ⭕, the 🗒️ link last (OBS-90)", () => {
    const line = "- [ ] 2026-11-01 Plan the offsite [[Hawk Ledger|⭕]]  ";
    const target = add.target(line, 8);
    const kept = { name: "Plan the offsite", linktext: "Plan the offsite", homeLink: "[[Hawk Ledger|⭕]]", projectLinks: ["[[Hawk Ledger|⭕]]"] };
    assert.equal(add.lineWithLink(line, target, kept), "- [ ] Plan the offsite [[Hawk Ledger|⭕]] [[Plan the offsite|🗒️]]");
    const left = { ...kept, homeLink: "[[Tin Works|⭕]]" };
    assert.equal(add.lineWithLink(line, target, left), "- [ ] Plan the offsite [[Tin Works|⭕]] [[Plan the offsite|🗒️]]", "the note stayed in Tin Works");
    const plain = "\t- [/] Order new toner";
    assert.equal(add.lineWithLink(plain, add.target(plain, 9), { name: "Order new toner", linktext: "Order new toner", homeLink: "[[Household|🗃️]]", projectLinks: [] }),
        "\t- [/] Order new toner [[Household|🗃️]] [[Order new toner|🗒️]]", "a line with no ⭕ gets the note's");
    assert.equal(add.lineWithLink(plain, add.target(plain, 9), { name: "Order new toner", linktext: "Order new toner", homeLink: null, projectLinks: [] }),
        "\t- [/] Order new toner [[Order new toner|🗒️]]", "a note with no project or area");
    const date = "- [ ] Pay rent [[2026-10-01|🚩 10/1]]";
    assert.equal(add.lineWithLink(date, add.target(date, 7), { name: "Pay rent", linktext: "Pay rent", homeLink: "[[Household|🗃️]]", projectLinks: [] }),
        "- [ ] Pay rent [[2026-10-01|🚩 10/1]] [[Household|🗃️]] [[Pay rent|🗒️]]", "the 🚩, then the ⭕, then the 🗒️");
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

test("new notes are staged outside Projects/, so a note left there is unfiled", () => {
    assert.ok(!AddTaskNote.STAGING_FOLDER.startsWith("Projects/"));
    assert.equal(AddTaskNote.TASK_TEMPLATE, "Config/Templates/Task.md");
    assert.ok(fs.existsSync(new URL("../../Templates/Task.md", here)), "the Task template is where the command looks");
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
    // Text that touched the link keeps a space from its other side, so a 🆓 stays a word of its own
    assert.equal(add.withoutLinks("- [x] Do it [[P|⭕]]🆓 [[A|🗒️]]", ["[[P|⭕]]"]), "- [x] Do it 🆓 [[A|🗒️]]");
    assert.equal(add.withoutLinks("- [x] Do[[P|⭕]]it", ["[[P|⭕]]"]), "- [x] Do it");
    // but none before punctuation or after an opening bracket
    assert.equal(add.withoutLinks("- [ ] Call [[P|⭕]], then", ["[[P|⭕]]"]), "- [ ] Call, then");
    assert.equal(add.withoutLinks("- [ ] Call ([[P|⭕]]) now", ["[[P|⭕]]"]), "- [ ] Call () now");
});

test("takePresetParent: the parent goes only to the note it was picked for, and only once", () => {
    AddTaskNote.preset = { path: "Inbox/Order toner.md", parent: "PROJECT" };
    assert.equal(add.takePresetParent("Inbox/Something else.md"), null, "another note gets the menu");
    assert.equal(add.takePresetParent(undefined), null);
    assert.equal(add.takePresetParent("Inbox/Order toner.md"), "PROJECT");
    assert.equal(add.takePresetParent("Inbox/Order toner.md"), null, "used up");
    AddTaskNote.preset = null;
    assert.equal(add.takePresetParent("Inbox/Order toner.md"), null);
    // Raycast's Open Log Note presets Inbox: the template files the note there, as with no preset
    AddTaskNote.preset = { path: "Inbox/2026-09-18 Printer call.md", parent: "inbox" };
    assert.equal(add.takePresetParent("Inbox/2026-09-18 Printer call.md"), null);
    assert.equal(AddTaskNote.preset, null, "used up");
});

test("OBS-55: no template asks for a project; the Task and Log templates take one only from the command", () => {
    const read = (name) => fs.readFileSync(new URL(`../../Templates/${name}.md`, here), "utf8");
    for (const name of ["Task", "Log", "Project", "Area"]) {
        const template = read(name);
        assert.doesNotMatch(template, /tp\.system\.suggester|tp\.user\.pickParent|FuzzySuggestModal/, `${name} shows no menu`);
    }
    assert.ok(!fs.existsSync(new URL("../Templater/pickParent.js", here)), "the picker script is gone");
    // The Task template's parent is the command's preset, or none (Inbox), with or without CustomJS
    const task = read("Task");
    const line = task.split("\n").find((l) => /^const pickedFile = /.test(l));
    assert.ok(line, "the Task template sets pickedFile in one line");
    const pickedFor = (customJS, path) => vm.runInNewContext(line.replace(/^const pickedFile = /, "") .replace(/;$/, ""),
        { customJS, tp: { config: { target_file: { path } } } });
    const tasks = { takePresetParent: (p) => (p === "Inbox/Order toner.md" ? "PROJECT" : null) };
    assert.equal(pickedFor({ AddTaskNote: tasks }, "Inbox/Order toner.md"), "PROJECT");
    assert.equal(pickedFor({ AddTaskNote: tasks }, "Inbox/Other.md"), null);
    assert.equal(pickedFor({}, "Inbox/Order toner.md"), null, "without AddTaskNote");
    assert.equal(vm.runInNewContext(`typeof customJS !== "undefined" ? 1 : 0`, {}), 0);
    assert.equal(vm.runInNewContext(line.replace(/^const pickedFile = /, "").replace(/;$/, ""), { tp: { config: { target_file: { path: "x" } } } }), null, "without CustomJS");
    // The Log template: the line's one live home first, then the command's preset (Raycast's Inbox is null)
    const log = read("Log");
    const presetLine = log.split("\n").find((l) => /^const preset = /.test(l));
    assert.ok(presetLine, "the Log template takes the command's preset in one line");
    const presetFor = (parent) => vm.runInNewContext(presetLine.replace(/^const preset = /, "").replace(/;$/, ""),
        { tasks: { takePresetParent: () => parent }, tp: { config: { target_file: { path: "Inbox/2026-09-18 Printer call.md" } } } });
    const project = { path: "Projects/Freelance/Kestrel/Kestrel.md" };
    assert.equal(presetFor(project), project);
    assert.equal(presetFor(null), null);
    assert.equal(presetFor("inbox"), null, "an older AddTaskNote's Inbox preset files the log in Inbox");
    assert.equal(vm.runInNewContext(presetLine.replace(/^const preset = /, "").replace(/;$/, ""), { tasks: null, tp: { config: { target_file: { path: "x" } } } }), null, "without CustomJS");
    assert.match(log, /const pickedFile = lineHomes\.allLive && lineHomes\.projects\.length === 1 \? lineHomes\.projects\[0\] : preset;/);
    // A new project or area gets its folder at the top of Projects/, and its note in it
    for (const name of ["Project", "Area"]) {
        const template = read(name);
        assert.match(template, /const path = "Projects\/" \+ cleanTitle;/, `${name}: the top of Projects`);
        assert.match(template, /await tp\.file\.move\(path \+ "\/" \+ cleanTitle\);/, `${name}: the note is the folder's note`);
        assert.doesNotMatch(template, /\d\d Projects\//, `${name}: no numbered folder from before OBS-81`);
    }
    assert.match(read("Project"), /tR \+= "parent: \\n";/, "a new project's parent is empty until it's filed");
});

test("OBS-55: sourceHome: a line with no project files its new note where the line's own note belongs", () => {
    const files = new Map();
    const Cls = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote",
        vm.createContext({ app: { vault: { getFileByPath: (p) => files.get(p) ?? null } } }));
    const h = new Cls();
    // Stand-ins for the tag and folder rules, which other tests cover
    h.isHomeNote = (f) => !!f.home;
    h.isLiveHome = (f) => !!f.home && !f.finished;
    h.lineHome = (f) => f.filedIn ?? null;
    const kestrel = { path: "Projects/Freelance/Kestrel/Kestrel.md", home: true };
    const done = { path: "Archive/Old/Old.md", home: true, finished: true };
    const taskNote = { path: "Projects/Freelance/Kestrel/Draft.md", filedIn: kestrel };
    const daily = { path: "Reference/Planner/days/2026-09-16.md" };
    for (const f of [kestrel, done, taskNote, daily]) files.set(f.path, f);
    assert.equal(h.sourceHome(kestrel.path), kestrel, "a project's own note: that project");
    assert.equal(h.sourceHome(taskNote.path), kestrel, "a task note: the project it's filed in");
    assert.equal(h.sourceHome(daily.path), null, "a daily note: Inbox");
    assert.equal(h.sourceHome(done.path), null, "a finished project: Inbox");
    assert.equal(h.sourceHome("Nowhere.md"), null);
    assert.equal(h.sourceHome(""), null);
    // noteFor asks it only when the line names no project or area at all
    const code = fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8");
    assert.match(code, /} else if \(!line\.links\.length\) \{\n\s+pick = this\.sourceHome\(sourcePath\);/);
});

test("OBS-55: a new project, area or Inbox task note never takes a name another note already has", () => {
    for (const name of ["Project", "Area", "Task"]) {
        const template = fs.readFileSync(new URL(`../../Templates/${name}.md`, here), "utf8");
        const check = template.indexOf("f.basename.toLowerCase() ===");
        assert.ok(check > 0, `${name} checks for a note of that name anywhere`);
        assert.match(template.slice(check - 120, check), /f !== tp\.config\.target_file/, `${name}: not counting itself`);
        assert.match(template.slice(check, check + 400), /new Notice\(why, 10000\);\s*throw new Error\(why\)/, `${name}: says so and stops`);
        const move = name === "Task" ? "await tp.file.move(target)" : "await tp.file.move(";
        assert.ok(check < template.indexOf(move), `${name}: before the move`);
    }
    // The Area template's "🗃️.Name" titles give the plain name, not a URL-encoded one
    const area = fs.readFileSync(new URL("../../Templates/Area.md", here), "utf8");
    const nameLine = area.split("\n").find((l) => /^const cleanTitle = /.test(l));
    const nameOf = (title) => vm.runInNewContext(`const fromAlias = /^🗃\\uFE0F?\\./u.test(tp.file.title); ` + nameLine + " cleanTitle", { tp: { file: { title } } });
    assert.equal(nameOf("🗃️.Home Stuff"), "Home Stuff");
    assert.equal(nameOf("🗃.Garden"), "Garden");
    assert.equal(nameOf("!area Finance"), "Finance");
    assert.doesNotMatch(area, /encodeURIComponent/);
});

test("linktextFor: the note's name, or its path only when another note really shares the name", () => {
    const note = { path: "Projects/Freelance/Hawk/Check the numbers.md", basename: "Check the numbers" };
    assert.equal(add.linktextFor(note, [note.path, "Projects/Freelance/Hawk/Hawk.md"]), "Check the numbers");
    assert.equal(add.linktextFor(note, [note.path, "Inbox/Check the Numbers.md"]), "Projects/Freelance/Hawk/Check the numbers", "same name, any case");
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

    const log = helper.confirmMove({ basename: "2026-09-18 Printer call", parent: { name: "›logs" } }, { basename: "Garden Club Newsletter" }, { basename: "Household" });
    assert.equal(opened.title, "Move log?");
    assert.deepEqual(rowsOf(), [["Log", "2026-09-18 Printer call"], ["From", "⭕ Garden Club Newsletter"], ["To", "🗃️ Household"]]);
    opened.close();
    assert.equal(await log, null, "Esc (a close with no choice) leaves it");

    // A log waiting in the Inbox is still a log; a note that's neither is a note (MoveToProject)
    const inbox = helper.confirmMove({ basename: "2026-09-18 Printer call", parent: { name: "Inbox" }, cache: { frontmatter: { tags: "log" } } }, { basename: "Household" }, { basename: "Garden Club Newsletter" });
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
    // Folders know their parents, so a note's project can be found by climbing them
    const folders = new Map();
    const folder = (path) => {
        if (!path) return { path: "/", name: "", parent: null };
        if (!folders.has(path)) folders.set(path, { path, name: path.split("/").pop(), parent: folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "") });
        return folders.get(path);
    };
    const files = paths.map(([path, tags]) => {
        const name = path.split("/").pop();
        return { path, name, basename: name.replace(/\.md$/, ""), extension: "md", parent: folder(path.slice(0, path.lastIndexOf("/"))), cache: { frontmatter: { tags } } };
    });
    const app = {
        vault: { getMarkdownFiles: () => files, getFileByPath: (p) => files.find((f) => f.path === p) ?? null, getAbstractFileByPath: (p) => files.find((f) => f.path === p) ?? null, getAbstractFileByPathInsensitive: (p) => files.find((f) => f.path.toLowerCase() === p.toLowerCase()) ?? null },
        metadataCache: { getFileCache: (f) => f.cache ?? null },
        ...extra,
    };
    return { files, app };
};

test("isLog: a note in a ›logs folder (any case), or one tagged #log wherever it waits; logsFolder: the one there, as it's spelled, else a new ›logs (OBS-164)", () => {
    const { files, app } = withApp([
        ["Projects/A/›logs/2026-09-02 Kickoff.md", []],
        ["Projects/B/›Logs/2026-09-03 Standup.md", []],
        ["Inbox/2026-09-18 Printer call.md", "log"],
        ["Inbox/Order toner.md", ["task"]],
        ["Projects/A/A.md", ["project"]],
        ["Projects/B/B.md", ["project"]],
        ["Projects/C/logs/2026-09-04 Review.md", []],
        ["Projects/C/C.md", ["project"]],
    ]);
    const folders = { "projects/a/›logs": "Projects/A/›logs", "projects/b/›logs": "Projects/B/›Logs", "projects/c/logs": "Projects/C/logs" };
    app.vault.getAbstractFileByPathInsensitive = (p) => (folders[p.toLowerCase()] ? { path: folders[p.toLowerCase()] } : null);
    const Cls = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote", vm.createContext({ app }));
    const helper = new Cls();
    assert.deepEqual([0, 1, 2, 3, 6].map((i) => helper.isLog(files[i])), [true, true, true, false, false], "a folder still named logs isn't read");
    assert.equal(helper.logsFolder(files[4]), "Projects/A/›logs");
    assert.equal(helper.logsFolder(files[5]), "Projects/B/›Logs", "spelled as it is");
    assert.equal(helper.logsFolder(files[7]), "Projects/C/›logs", "an old logs folder isn't used: rename it");
    assert.deepEqual(["›logs", "›LOGS", "logs", "_logs", "›logs2", "", undefined].map((n) => helper.isLogsFolderName(n)),
        [true, true, false, false, false, false, false]);
});

test("makeFolder: a logs folder it makes gets Navigator's history icon; another folder, one already there, or no Navigator gets none (OBS-164)", async () => {
    const made = [], icons = [];
    const there = new Set(["Projects/A/›logs"]);
    const app = {
        vault: {
            getAbstractFileByPath: (p) => (there.has(p) ? { path: p } : null),
            createFolder: async (p) => { made.push(p); there.add(p); return { path: p }; },
        },
        plugins: { plugins: { "notebook-navigator": { api: { metadata: { setFolderMeta: async (f, meta) => icons.push([f.path, meta]) } } } } },
    };
    const Cls = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote", vm.createContext({ app, console }));
    const helper = new Cls();
    await helper.makeFolder("Projects/B/›logs");
    await helper.makeFolder("Projects/C");
    await helper.makeFolder("Projects/A/›logs");
    assert.deepEqual(made, ["Projects/B/›logs", "Projects/C"]);
    assert.deepEqual(JSON.parse(JSON.stringify(icons)), [["Projects/B/›logs", { icon: "history" }]], "the icon only, from the vm's own objects");
    delete app.plugins.plugins["notebook-navigator"];
    await helper.makeFolder("Projects/D/›logs");
    assert.deepEqual(made.at(-1), "Projects/D/›logs", "made without Navigator, and nothing fails");
    app.plugins.plugins["notebook-navigator"] = { api: { metadata: { setFolderMeta: async () => { throw new Error("no"); } } } };
    const errors = [];
    const quiet = new (vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote",
        vm.createContext({ app, console: { error: (...a) => errors.push(a.join(" ")) } })))();
    await quiet.makeFolder("Projects/E/›logs");
    assert.equal(made.at(-1), "Projects/E/›logs", "an icon that can't be set doesn't stop the folder");
    assert.equal(errors.length, 1);
});

test("isSameNote: the note itself, its current path, or the path it was just moved from; nothing else", () => {
    const helper = new (vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote", vm.createContext({})))();
    const note = { path: "Projects/A/logs/2026-09-14 Review.md" };
    assert.ok(helper.isSameNote(note, note));
    assert.ok(helper.isSameNote({ path: note.path }, note), "another object for the same path");
    assert.ok(helper.isSameNote({ path: "Inbox/2026-09-14 Review.md" }, note, "Inbox/2026-09-14 Review.md"), "a stale entry where it was");
    assert.ok(!helper.isSameNote({ path: "Inbox/2026-09-14 Review.md" }, note), "without the old path, that's another note");
    assert.ok(!helper.isSameNote({ path: "Projects/B/2026-09-14 Review.md" }, note, "Inbox/2026-09-14 Review.md"));
    assert.ok(!helper.isSameNote(null, note, "Inbox/2026-09-14 Review.md"));
});

test("a note just moved isn't mistaken for a clash or another note (AddTaskNote's link text, AddProjectLink's check)", () => {
    const addTaskNote = fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8");
    assert.match(addTaskNote, /const movedFrom = existing\.path;\n\s*if \(!\(await this\.moveInto\(existing, pick\)\)\) return null;/);
    assert.match(addTaskNote, /\.filter\(\(p\) => p !== movedFrom\)/, "the old path isn't counted as a second note of that name");
    const addProjectLink = fs.readFileSync(new URL("../CustomJS/addProjectLink.js", here), "utf8");
    assert.match(addProjectLink, /const movedFrom = note\.path;\n\s*if \(!\(await helper\.moveInto\(note, home, \{ line \}\)\)\) return;/);
    assert.match(addProjectLink, /helper\.isSameNote\(this\.taskNoteOf\(before, source\.path\), note, movedFrom\)/);
});

test("pickHome: MoveToProject can leave homes out of the menu and ask its own question; otherwise it's unchanged", async () => {
    const { files, app } = withApp([
        ["Projects/A/A.md", ["area"]],
        ["Projects/A/B/B.md", ["project"]],
        ["Projects/A/C/C.md", ["project"]],
        ["Inbox/Loose idea.md", []],
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

test("moveInto: a clash is refused before anything is made; a log from the Inbox goes into a new ›logs/", async () => {
    const made = [];
    const renamed = [];
    const notices = [];
    const { files, app } = withApp([
        ["Projects/A/A.md", ["project"]],
        ["Projects/A/Order toner.md", ["task"]],
        ["Inbox/Order toner.md", ["task"]],
        ["Inbox/2026-09-18 Printer call.md", ["log"]],
    ], {
        fileManager: { renameFile: async (f, to) => renamed.push([f.path, to]) },
    });
    app.vault.createFolder = async (p) => made.push(p);
    const Cls = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote",
        vm.createContext({ app, customJS: {}, Notice: class { constructor(m) { notices.push(m); } } }));
    const helper = new Cls();
    assert.equal(await helper.moveInto(files[2], files[0]), false);
    assert.deepEqual(notices, ["Projects/A already has a note named Order toner, so nothing changed"]);
    assert.equal(await helper.moveInto(files[3], files[0]), true);
    assert.deepEqual(made, ["Projects/A/›logs"]);
    assert.deepEqual(renamed, [["Inbox/2026-09-18 Printer call.md", "Projects/A/›logs/2026-09-18 Printer call.md"]]);
});

// A stand-in for invoke: one editor line, notes at `paths` ([path, tags]), and a Log template that
// records what it's asked to make
const invokeOn = async (line, { ch = line.length, paths = [], template = true, sel = null } = {}) => {
    const calls = [];
    let text = line, cursor = null;
    const { files, app } = withApp(paths);
    const editor = {
        getSelection: () => (sel ? line.slice(sel[0], sel[1]) : ""),
        getCursor: (which) => ({ line: 0, ch: sel ? (which === "to" ? sel[1] : sel[0]) : ch }),
        getLine: () => text,
        replaceRange: (s, from, to) => { calls.push("write line"); text = text.slice(0, from.ch) + s + text.slice(to.ch); },
        setCursor: (c) => { cursor = c; },
        transaction: ({ replaceSelection, selection }) => { calls.push("write line"); text = text.slice(0, ch) + replaceSelection + text.slice(ch); cursor = selection.from; },
    };
    const view = { editor, save: async () => { calls.push("save"); } };
    const tpl = { path: "Config/Templates/Log.md" };
    Object.assign(app, {
        workspace: { activeLeaf: { view }, getActiveFile: () => ({ basename: "2026-09-14", path: "days/2026-09-14.md" }) },
        plugins: { plugins: template ? { "templater-obsidian": { templater: {
            create_new_note_from_template: async (t, folder, name, open) => { calls.push(`template ${t.path} in ${folder}: ${name} (open: ${open})`); return { path: `${folder}/${name}.md` }; },
        } } } : {} },
    });
    app.vault.createFolder = async (p) => { calls.push(`folder ${p}`); };
    app.fileManager = { renameFile: async (f, to) => {
        calls.push(`move ${f.path} to ${to}`);
        f.path = to;
        f.parent = files.find((g) => g.path.startsWith(to.slice(0, to.lastIndexOf("/")).replace(/\/›?logs$/, "")))?.parent ?? f.parent;
    } };
    const getFileByPath = app.vault.getFileByPath;
    app.vault.getFileByPath = (p) => (p === tpl.path ? tpl : getFileByPath(p));
    app.metadataCache.getFirstLinkpathDest = (name) => files.find((f) => f.basename.toLowerCase() === name.toLowerCase() || f.path === `${name}.md`) ?? null;
    const Cls = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote", vm.createContext({
        app, customJS: {}, Notice: class { constructor(message) { calls.push(`notice: ${message}`); } },
    }));
    await new Cls().invoke();
    return { text, cursor: cursor && { ...cursor }, calls, notices: calls.filter((c) => c.startsWith("notice: ")).map((c) => c.slice(8)) };
};
const HAWK = [["Projects/Freelance/Hawk Ledger/Hawk Ledger.md", ["project"]], ["Projects/Freelance/Freelance.md", ["area"]]];

test("invoke on an event line: wherever the cursor is, the log is named from the title and linked at the end, after the ⭕; a line already linked is refused", async () => {
    const ev = "- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]]";
    for (const ch of [ev.length, 8, 0]) {
        const named = await invokeOn(ev, { ch, paths: HAWK });
        assert.equal(named.text, "- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]] [[2026-09-14 Kickoff call|🗒️]]", `cursor at ${ch}`);
        assert.deepEqual(named.notices, [], `cursor at ${ch}`);
    }
    // An event with no title has nothing to name its log after, and the line is left alone
    const untitled = await invokeOn("- [<] 1:30pm\t");
    assert.equal(untitled.text, "- [<] 1:30pm\t");
    assert.deepEqual(untitled.notices, ["This event has no title to name its log"]);
    for (const linked of ["- [<] 1:30pm\tKickoff call [[2026-09-14 Kickoff call|🗒️]]", "- [<] 1:30pm\t[[2026-09-14 Kickoff call|Kickoff call]]  ", "- [<] Printer call [[2026-09-18 Printer call|🔗]] [[Hawk Ledger|⭕]]"]) {
        const refused = await invokeOn(linked);
        assert.equal(refused.text, linked, linked);
        assert.deepEqual(refused.notices, ["This event already links a log"], linked);
    }
    // The cursor in the title: the log is named from it, and the cursor goes after the checkbox
    const named = await invokeOn(ev, { ch: 16, paths: HAWK });
    assert.equal(named.text, "- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]] [[2026-09-14 Kickoff call|🗒️]]");
    assert.deepEqual(named.cursor, { line: 0, ch: 6 });
});

test("invoke on an event line makes the log right away through the Log template, after saving the line (OBS-57)", async () => {
    const ev = "- [<] 1:30pm\tKickoff call [[Hawk Ledger|⭕]]";
    const made = await invokeOn(ev, { ch: 16, paths: HAWK });
    assert.equal(made.text, "- [<] 1:30pm\tKickoff call [[Hawk Ledger|⭕]] [[2026-09-14 Kickoff call|🗒️]]", "the ⭕ stays, and the Log template files the log there");
    assert.deepEqual(made.calls, ["write line", "save", "template Config/Templates/Log.md in Inbox: 2026-09-14 Kickoff call (open: false)"]);
    // The cursor at the end of the line makes it just the same (fix round 2); a line with no title,
    // or one that's refused, makes nothing
    assert.deepEqual((await invokeOn(ev, { paths: HAWK })).calls, made.calls);
    assert.ok(!(await invokeOn("- [<] 1:30pm\t")).calls.some((c) => c.startsWith("template")));
    assert.deepEqual((await invokeOn("- [<] 1:30pm\tKickoff call [[2026-09-14 Kickoff call|🗒️]]")).calls, ["notice: This event already links a log"]);
});

test("invoke on an event line whose log exists: nothing is made, and the line and the log agree on its project (OBS-90)", async () => {
    const LOG = "Projects/Freelance/Hawk Ledger/logs/2026-09-14 Kickoff call.md";
    const paths = [...HAWK, [LOG, ["log"]], ["Projects/Freelance/Tin Works/Tin Works.md", ["project"]], ["Inbox/2026-09-14 Printer call.md", ["log"]]];
    // No ⭕ on the line: it gets the log's project, before the 🗒️
    const plain = await invokeOn("- [<] 1:30pm\tKickoff call", { paths });
    assert.equal(plain.text, "- [<] 1:30pm\tKickoff call [[Hawk Ledger|⭕]] [[2026-09-14 Kickoff call|🗒️]]");
    assert.ok(!plain.calls.some((c) => c.startsWith("template") || c === "save"), "the log isn't made again");
    // The line already names the log's project: kept
    assert.equal((await invokeOn("- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]]", { paths })).text, "- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]] [[2026-09-14 Kickoff call|🗒️]]");
    // A log in the Inbox has no project: the line's ⭕ files it there without asking
    const inbox = await invokeOn("- [<] 11:00am\tPrinter call [[Tin Works|⭕]]", { paths });
    assert.equal(inbox.text, "- [<] 11:00am\tPrinter call [[Tin Works|⭕]] [[2026-09-14 Printer call|🗒️]]");
    assert.ok(inbox.calls.includes("move Inbox/2026-09-14 Printer call.md to Projects/Freelance/Tin Works/›logs/2026-09-14 Printer call.md"), inbox.calls.join("\n"));
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
        "- [<] 1:30pm\tSync: Q3 plan [[Hawk Ledger|⭕]] [[2026-09-14 Sync - Q3 plan|🗒️]]");
});

test("invoke with a selection: its spaces stay, so the words around it don't run together; the 🗒️ ends the line (OBS-90 review)", async () => {
    const paths = [...HAWK, ["Projects/Freelance/Hawk Ledger/Call the printer.md", ["task"]]];
    const line = "- [ ] Call the printer tomorrow";
    const out = await invokeOn(line, { sel: [6, "- [ ] Call the printer ".length], paths });
    assert.equal(out.text, "- [ ] Call the printer tomorrow [[Hawk Ledger|⭕]] [[Call the printer|🗒️]]");
});

test("isFinished: a status of Done or Canceled, in any case, finishes a project or area; completed doesn't (OBS-125)", () => {
    const finished = (frontmatter) => add.isFinished({ frontmatter });
    for (const status of ["Done", "done", "DONE", " Done ", "Canceled", "canceled", "Cancelled"]) assert.equal(finished({ status }), true, status);
    for (const status of ["To Do", "Active", "On Hold", "In Progress", "", "Done soon"]) assert.equal(finished({ status }), false, status);
    assert.equal(finished({}), false, "no status");
    assert.equal(finished({ completed: "2026-09-30" }), false, "completed alone no longer finishes a project");
    assert.equal(finished({ status: ["Active", "Done"] }), true, "a list counts when any value does");
    assert.equal(add.isFinished(null), false);
    assert.equal(add.isFinished({}), false, "no frontmatter");
});

test("one place for the logs folder's name: the Log template and every other script ask AddTaskNote (OBS-164)", () => {
    const template = fs.readFileSync(new URL("../../Templates/Log.md", here), "utf8");
    assert.match(template, /folder = tasks \? tasks\.logsFolderIn\(pickedFile\.parent\.path\)/, "the Log template files a log where AddTaskNote says");
    assert.match(template, /if \(tasks\) await tasks\.makeFolder\(folder\);/, "and makes the folder through it, icon and all");
    // No other CustomJS class spells a logs folder in its code (comments aside)
    const dir = new URL("../CustomJS/", here);
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".js") && n !== "addTaskNote.js")) {
        const code = fs.readFileSync(new URL(name, dir), "utf8").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/ .*$/, "")).join("\n");
        assert.doesNotMatch(code, /["'`/]›?logs\b/i, `${name} spells the logs folder itself`);
    }
});

test("OBS-55: a new task note with no project stays in Inbox, for AddTaskNote and Schedule alike", async () => {
    // A fake app: Templater makes the note in Inbox and leaves it there, as it does when the line names no project
    const trashed = [], notices = [];
    const note = { path: "Inbox/Order toner.md", basename: "Order toner", parent: { path: "Inbox" } };
    const ctx = vm.createContext({
        app: {
            plugins: { plugins: { "templater-obsidian": { templater: { create_new_note_from_template: async () => note } } } },
            vault: { getFileByPath: () => ({ path: AddTaskNote.TASK_TEMPLATE }), getAvailablePath: (p, ext) => `${p}.${ext}` },
            fileManager: { trashFile: async (f) => trashed.push(f.path) },
        },
        customJS: { obsidian: { normalizePath: (p) => p } },
        Notice: class { constructor(m) { notices.push(m); } },
    });
    const Fresh = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", here), "utf8") + "\n;AddTaskNote", ctx);
    const fresh = new Fresh();
    assert.equal(await fresh.createTaskNote("Order toner"), note, "kept, unfiled");
    assert.deepEqual(trashed, [], "never trashed");
    assert.deepEqual(notices, []);
    // A note the template filed in the line's project is the result too
    const filed = { ...note, path: "Projects/Home/Order toner.md", parent: { path: "Projects/Home" } };
    ctx.app.plugins.plugins["templater-obsidian"].templater.create_new_note_from_template = async () => filed;
    assert.equal(await fresh.createTaskNote("Order toner"), filed);
});
