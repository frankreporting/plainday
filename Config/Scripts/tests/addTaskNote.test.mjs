// Tests for plugin/src/commands/addTaskNote.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm; only the methods that don't touch
// `app` are tested. Creating the note through Templater is checked in a dev vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { standIn, PLANNER, withFolders, momentOn, YAML as STAND_IN_YAML } from "./standInVault.mjs";
import { classFiles, classScript, classSource } from "../../../plugin/classShape.mjs";
import { periodicNames, plainName } from "./dayNames.mjs";

const here = new URL(".", import.meta.url);
// `plainday` defined and empty, as in the Raycast timer's sandbox: the class reads it bare
const AddTaskNote = vm.runInContext(
    classScript("addTaskNote.js") + "\n;AddTaskNote",
    vm.createContext({ plainday: { PeriodicNotes: periodicNames() } }),
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

test("the Task template holds only its `id`: Plainday writes the rest itself, and files the note (OBS-121)", () => {
    const template = fs.readFileSync(new URL("../../Templates/Task.md", here), "utf8");
    assert.equal(template, '---\nid: <% tp.date.now("YYYYMMDDHHmmssSS") %>\n---\n');
    assert.doesNotMatch(template, /takePresetParent|showNewNote|tp\.file\.move|parent|due/, "no code that files the note or writes Plainday's properties");
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
    // A ⋯ already there, wherever the cursor is: that note goes on the task's other lines, and no second link
    for (const line of ["- [>] Order paper samples [[Order paper samples|⋯]]", "- [ ] Order paper samples [[Order paper samples|⋯]]   ", "- [x] A [[2026-09-30|🚩 9/30]] [[A|⋯]]"]) {
        assert.deepEqual(t(line, line.length), { kind: "task", mode: "own" }, line);
        assert.deepEqual(t(line, 8), { kind: "task", mode: "own" }, line);
    }
    // A ↗ is where the line was sent from, no note of its own
    for (const mark of ["↗", "↗\uFE0F"]) {
        assert.equal(name(`- [ ] Call the bank [[Brochure|${mark}]]`, 8), "Call the bank", mark);
        assert.deepEqual(t(`- [ ] Call the bank [[Brochure|${mark}]]`, `- [ ] Call the bank [[Brochure|${mark}]]`.length), { kind: "task", mode: "blank" }, mark);
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
    for (const mark of ["⋯", "↗", "↗\uFE0F"]) {
        assert.equal(t(`- [<] 1:00pm\tStandup [[2026-09-14 Standup|${mark}]] [[Hawk Ledger|⭕]]`, 8).error, "This event already links a log", mark);
    }
});

test("eventLine: the log link ends the line, after the title, its marks and any ⭕ or 🗃️ links (OBS-57, OBS-90)", () => {
    assert.equal(add.eventLine("- [<] 9:00am\tStandup", "2026-09-14 Standup"), "- [<] 9:00am\tStandup [[2026-09-14 Standup|⋯]]");
    assert.equal(add.eventLine("- [<] 9:00am\tStandup   ", "2026-09-14 Standup"), "- [<] 9:00am\tStandup [[2026-09-14 Standup|⋯]]");
    assert.equal(add.eventLine("- [<] 2:00pm\tDelivery window ℹ️ 🆓 [[Hawk Ledger|⭕]] [[Home|🗃️]]", "2026-09-14 Delivery window"),
        "- [<] 2:00pm\tDelivery window ℹ️ 🆓 [[Hawk Ledger|⭕]] [[Home|🗃️]] [[2026-09-14 Delivery window|⋯]]");
    assert.equal(add.eventLine("\t- [<] All day\tOffsite [[Hawk Ledger|⭕]]", "2026-09-14 Offsite"),
        "\t- [<] All day\tOffsite [[Hawk Ledger|⭕]] [[2026-09-14 Offsite|⋯]]");
    // A selected name names the log; the link still goes at the end
    assert.equal(add.eventLine("- [<] 1:00pm\tWeekly sync with the studio [[Hawk Ledger|⭕]]", "2026-09-14 Weekly sync"),
        "- [<] 1:00pm\tWeekly sync with the studio [[Hawk Ledger|⭕]] [[2026-09-14 Weekly sync|⋯]]");
    // A person linked in the title stays in the title
    assert.equal(add.eventLine("- [<] 1:00pm\tLunch with [[Rafe Oakes]]", "2026-09-14 Lunch with"), "- [<] 1:00pm\tLunch with [[Rafe Oakes]] [[2026-09-14 Lunch with|⋯]]");
    // An existing log's link text (a path, when its name isn't unique)
    assert.equal(add.eventLine("- [<] 1:00pm\tStandup [[Hawk Ledger|⭕]]", "Projects/Hawk/logs/2026-09-14 Standup"),
        "- [<] 1:00pm\tStandup [[Hawk Ledger|⭕]] [[Projects/Hawk/logs/2026-09-14 Standup|⋯]]");
    // Already linked, either way: nothing to add
    assert.deepEqual({ ...add.eventLine("- [<] 1:00pm\tStandup [[2026-09-14 Standup|⋯]]", "2026-09-14 Standup") }, { error: "This event already links a log" });
    assert.deepEqual({ ...add.eventLine("- [<] 1:00pm\t[[2026-09-14 Standup|Standup]]", "2026-09-14 Standup") }, { error: "This event already links a log" });
});

test("withHome: the project or area link goes before the note links that end the line, replacing the ones given (OBS-90)", () => {
    const H = "[[Hawk Ledger|⭕]]";
    assert.equal(add.withHome("- [ ] Order toner", H), "- [ ] Order toner [[Hawk Ledger|⭕]]", "no note link: at the end");
    assert.equal(add.withHome("- [ ] Order toner [[Order toner|⋯]]", H), "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|⋯]]");
    assert.equal(add.withHome("- [ ] Order toner [[2026-09-30|🚩 9/30]] [[Order toner|⋯]]", H), "- [ ] Order toner [[2026-09-30|🚩 9/30]] [[Hawk Ledger|⭕]] [[Order toner|⋯]]", "after a due date");
    assert.equal(add.withHome("- [ ] Order toner [[Tin|⭕]] [[Order toner|⋯]]", H, ["[[Tin|⭕]]"]), "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|⋯]]", "replacing another");
    assert.equal(add.withHome("- [ ] Order toner [[Order toner|⋯]] [[Tin|⭕]]  ", H, ["[[Tin|⭕]]"]), "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|⋯]]", "the older order comes out in the new one");
    assert.equal(add.withHome("- [ ] Sub [[Sub|⋯]] [[Parent note|⋯]]", H), "- [ ] Sub [[Hawk Ledger|⭕]] [[Sub|⋯]] [[Parent note|⋯]]", "before every note link at the end");
    assert.equal(add.withHome("- [ ] Read [[Notes|⋯]] then call", H), "- [ ] Read [[Notes|⋯]] then call [[Hawk Ledger|⭕]]", "a note link in the text isn't the end");
    assert.equal(add.withHome("\t- [<] 2:00pm\tReview ℹ️ [[2026-09-14 Review|⋯]]", "[[Home|🗃️]]"), "\t- [<] 2:00pm\tReview ℹ️ [[Home|🗃️]] [[2026-09-14 Review|⋯]]", "an event, an area");
    assert.equal(add.withHome("- [ ] [[Order toner|⋯]]", H), "- [ ] [[Hawk Ledger|⭕]] [[Order toner|⋯]]");
    // No link: only what's given comes off
    assert.equal(add.withHome("- [ ] Order toner [[Tin|⭕]] [[Order toner|⋯]] ", null), "- [ ] Order toner [[Tin|⭕]] [[Order toner|⋯]]");
    assert.equal(add.withHome("- [ ] Order toner [[Tin|⭕]] [[Order toner|⋯]]", null, ["[[Tin|⭕]]"]), "- [ ] Order toner [[Order toner|⋯]]");
    // A 🚩 after the ⋯ stays where it is; the ⭕ goes before the ⋯ (OBS-90 review)
    assert.equal(add.withHome("- [x] Pay it [[Pay it|⋯]] [[2026-09-14|🚩 9/14]]", H), "- [x] Pay it [[Hawk Ledger|⭕]] [[Pay it|⋯]] [[2026-09-14|🚩 9/14]]");
    assert.equal(add.withHome("- [x] Pay it 🆓 [[Pay it|⋯]]", H), "- [x] Pay it 🆓 [[Hawk Ledger|⭕]] [[Pay it|⋯]]");
    // A block ID stays last, where Obsidian reads it
    assert.equal(add.withHome("- [x] Task [[Task|⋯]] ^abc123", H), "- [x] Task [[Hawk Ledger|⭕]] [[Task|⋯]] ^abc123");
    assert.equal(add.withHome("- [x] Task ^abc123", H), "- [x] Task [[Hawk Ledger|⭕]] ^abc123");
    // An event's tab after its time isn't eaten, even with no title before the note link
    assert.equal(add.withHome("- [<] 9:00am\t[[Task A|⋯]]", H), "- [<] 9:00am\t [[Hawk Ledger|⭕]] [[Task A|⋯]]");
});

test("trailingNote and endWith: the note link in the run that ends a line; a link added at the end goes before a block ID", () => {
    assert.equal(add.trailingNote("- [ ] A [[P|⭕]] [[Note A|⋯]]"), "Note A");
    assert.equal(add.trailingNote("- [ ] A [[Note A#Notes|⋯]] [[2026-09-30|🚩 9/30]] ^x1"), "Note A");
    assert.equal(add.trailingNote("- [ ] Sub [[Sub|⋯]] [[Parent|⋯]]"), "Sub", "the first of several");
    assert.equal(add.trailingNote("- [ ] Read [[Note A|⋯]] then call"), null, "not at the end");
    assert.equal(add.trailingNote("- [ ] A [[P|⭕]]"), null);
    // Only the ⭕ links that end a line are its own (OBS-90): one in the text is part of the title
    const own = (line) => JSON.parse(JSON.stringify(add.trailingProjectLinks(line))).map((l) => l.linkpath);
    assert.deepEqual(own("- [ ] Ask [[Tin|⭕]] about [[Hawk|⭕]] [[Note|⋯]] ^x1"), ["Hawk"]);
    assert.deepEqual(own("- [ ] A [[2026-09-30|🚩 9/30]] [[Tin|⭕]] [[Home|🗃️]] [[Note|⋯]]"), ["Tin", "Home"]);
    assert.deepEqual(own("- [ ] A [[Tin|⭕ Tin]] [[Note|⋯]]"), [], "a ⭕ with a name after it isn't one, as the report reads it");
    assert.equal(add.endWith("- [ ] A [[P|⭕]]  ", "[[A|⋯]]"), "- [ ] A [[P|⭕]] [[A|⋯]]");
    assert.equal(add.endWith("- [ ] A ^x1", "[[A|⋯]]"), "- [ ] A [[A|⋯]] ^x1");
});

test("withOwn: the ⋯ goes ahead of a ↗ and an ID, after the ⭕; a line with a ⋯ is left alone", () => {
    const N = "[[Plan the offsite|⋯]]";
    assert.equal(add.withOwn("- [ ] Plan the offsite", N), `- [ ] Plan the offsite ${N}`);
    assert.equal(add.withOwn("- [ ] Plan it [[Hawk Ledger|⭕]]  ", N), `- [ ] Plan it [[Hawk Ledger|⭕]] ${N}`);
    assert.equal(add.withOwn("- [ ] Plan it [[Hawk Ledger|⭕]] [[Brief#^k3x9m2|↗]] ^k3x9m2", N), `- [ ] Plan it [[Hawk Ledger|⭕]] ${N} [[Brief#^k3x9m2|↗]] ^k3x9m2`);
    assert.equal(add.withOwn("- [>] Plan it [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2", N), `- [>] Plan it [[2026-09-17#^k3x9m2|9/17]] ${N} ^k3x9m2`);
    assert.equal(add.withOwn("- [ ] Pay rent [[2026-10-01|🚩 10/1]] [[Household|🗃️]]", N), `- [ ] Pay rent [[2026-10-01|🚩 10/1]] [[Household|🗃️]] ${N}`);
    assert.equal(add.withOwn("- [<] 1:30pm\tKickoff ℹ️ [[Hawk Ledger|⭕]]", N), `- [<] 1:30pm\tKickoff ℹ️ [[Hawk Ledger|⭕]] ${N}`);
    const has = "- [ ] Plan it [[Other|⋯]] ^k3x9m2";
    assert.equal(add.withOwn(has, N), has);
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

test("new notes are staged in the Inbox as it's set, outside Projects, so a note left there is unfiled (OBS-283)", () => {
    const staged = (folders) => new (vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", vm.createContext({ plainday: withFolders({}, folders) })))().stagingFolder();
    assert.equal(staged({}), "Inbox");
    assert.equal(staged({ projects: "Work", inbox: "Waiting" }), "Waiting");
    // The Task and Log templates are settings now (OBS-283), with the paths the command used to hold
    // written in as their defaults, and a blank setting meaning that default
    const withTemplates = (templates) => {
        const plainday = withFolders({});
        Object.assign(plainday.Settings.get().templates, templates);
        return new (vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", vm.createContext({ plainday })))();
    };
    assert.equal(withTemplates({}).templatePath("task"), "Config/Templates/Task.md");
    assert.equal(withTemplates({}).templatePath("log"), "Config/Templates/Log.md");
    assert.equal(withTemplates({ task: "Templates/My task.md" }).templatePath("task"), "Templates/My task.md");
    assert.ok(fs.existsSync(new URL("../../Templates/Task.md", here)), "the Task template is where the command looks");
    assert.ok(fs.existsSync(new URL("../../Templates/Log.md", here)), "and the Log template");
});

test("projectLinks: the ⭕ links on a line, with their link paths", () => {
    const links = (line) => JSON.parse(JSON.stringify(add.projectLinks(line)));
    assert.deepEqual(links("- [ ] Order toner [[Hawk Ledger|⭕]]"), [{ raw: "[[Hawk Ledger|⭕]]", linkpath: "Hawk Ledger" }]);
    assert.deepEqual(links("- [ ] A [[Projects/Freelance/Hawk Ledger/Hawk Ledger|⭕]] [[B|⋯]]").map((l) => l.linkpath), ["Projects/Freelance/Hawk Ledger/Hawk Ledger"]);
    assert.deepEqual(links("- [ ] A [[Hawk Ledger#Notes|⭕]]").map((l) => l.linkpath), ["Hawk Ledger"], "a heading link still names the project");
    assert.equal(links("- [ ] A [[One|⭕]] [[Two|⭕]]").length, 2);
    assert.deepEqual(links("- [ ] A [[Note|⋯]] [[2026-10-25|🚩 10/25]]"), [], "other suffixes aren't project links");
    assert.deepEqual(links("- [ ] A [[Hawk Ledger|⭕️]] [[Tin| ⭕ ]]").map((l) => l.linkpath), ["Hawk Ledger", "Tin"], "U+FE0F and spaces, as the sync allows");
    assert.deepEqual(links("- [ ] A [[Household|🗃️]] [[Garden|🗃]]").map((l) => l.linkpath), ["Household", "Garden"], "an area's 🗃️ link counts too (OBS-36)");
    assert.equal(AddTaskNote.AREA_MARK, "🗃️");
    assert.equal(AddTaskNote.PROJECT_MARK, "⭕");
    // Repeated calls don't carry regex state (the pattern is global)
    assert.equal(links("- [ ] A [[P|⭕]]").length, 1);
    assert.equal(links("- [ ] A [[P|⭕]]").length, 1);
});

test("withoutLinks: takes the project link out and closes the gap, keeping indent, checkbox and other links", () => {
    assert.equal(add.withoutLinks("- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|⋯]]", ["[[Hawk Ledger|⭕]]"]),
        "- [ ] Order toner [[Order toner|⋯]]");
    assert.equal(add.withoutLinks("\t\t- [/] Plan it [[Order|⋯]] [[P|⭕]]", ["[[P|⭕]]"]), "\t\t- [/] Plan it [[Order|⋯]]", "at the end: no trailing space");
    assert.equal(add.withoutLinks("- [ ] [[P|⭕]] Plan it [[Plan it|⋯]]", ["[[P|⭕]]"]), "- [ ] Plan it [[Plan it|⋯]]", "right after the checkbox");
    assert.equal(add.withoutLinks("- [ ] A [[P|⭕]] [[P|⭕]] [[A|⋯]]", ["[[P|⭕]]", "[[P|⭕]]"]), "- [ ] A [[A|⋯]]", "the same link twice");
    assert.equal(add.withoutLinks("- [ ] A [[Due|🚩 9/30]] [[P|⭕]] [[A|⋯]]", ["[[P|⭕]]"]), "- [ ] A [[Due|🚩 9/30]] [[A|⋯]]");
    assert.equal(add.withoutLinks("- [<] 9:00am\tQ3  review [[P|⭕]]", ["[[P|⭕]]"]), "- [<] 9:00am\tQ3  review", "spacing elsewhere on the line is kept");
    const untouched = "- [ ] A  [[P|⭕]] [[A|⋯]]";
    assert.equal(add.withoutLinks(untouched, []), untouched, "nothing to remove: the line isn't touched at all");
    // Text that touched the link keeps a space from its other side, so a 🆓 stays a word of its own
    assert.equal(add.withoutLinks("- [x] Do it [[P|⭕]]🆓 [[A|⋯]]", ["[[P|⭕]]"]), "- [x] Do it 🆓 [[A|⋯]]");
    assert.equal(add.withoutLinks("- [x] Do[[P|⭕]]it", ["[[P|⭕]]"]), "- [x] Do it");
    // but none before punctuation or after an opening bracket
    assert.equal(add.withoutLinks("- [ ] Call [[P|⭕]], then", ["[[P|⭕]]"]), "- [ ] Call, then");
    assert.equal(add.withoutLinks("- [ ] Call ([[P|⭕]]) now", ["[[P|⭕]]"]), "- [ ] Call () now");
});

test("Get Template has no !task route: task notes come from a task line, with Add note (OBS-121)", () => {
    const route = fs.readFileSync(new URL("../../Templates/Get Template.md", here), "utf8");
    assert.doesNotMatch(route, /\/!task\/|\[\[Task\]\]/, "no route by title, and the Task template isn't included");
    assert.match(route, /tp\.file\.include\("\[\[Empty Note\]\]"\)/, "a title starting !task gets the Empty Note template, like any other");
});

test("OBS-55: no template asks for a project", () => {
    const read = (name) => fs.readFileSync(new URL(`../../Templates/${name}.md`, here), "utf8");
    for (const name of ["Task", "Log", "Project", "Area"]) {
        const template = read(name);
        assert.doesNotMatch(template, /tp\.system\.suggester|tp\.user\.pickParent|FuzzySuggestModal/, `${name} shows no menu`);
    }
    assert.ok(!fs.existsSync(new URL("../Templater/pickParent.js", here)), "the picker script is gone");
    // The Log template is content only: Plainday makes the log (EventLog, OBS-122)
    assert.equal(read("Log"), "", "the repository's Log template is empty");
    // The Project and Area templates are content only: Plainday makes the project or area (ProjectNotes, OBS-123)
    for (const name of ["Project", "Area"]) {
        assert.equal(read(name), '---\nid: <% tp.date.now("YYYYMMDDHHmmssSS") %>\n---\n', `the repository's ${name} template holds only its id`);
    }
    assert.ok(!fs.existsSync(new URL("../Templater/folderLook.js", here)), "the folder look moved into ProjectNotes");
    assert.ok(!fs.existsSync(new URL("../Templater/showNewNote.js", here)), "no template calls showNewNote any more");
});

test("Get Template has no !project, !area or 🗃️ route: New project, New area and Convert to project make them (OBS-123)", () => {
    const route = fs.readFileSync(new URL("../../Templates/Get Template.md", here), "utf8");
    const code = route.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.doesNotMatch(code, /!project|!area|🗃|\[\[Project\]\]|\[\[Area\]\]/, "no route by title, and neither template is included");
    assert.match(code, /tp\.file\.include\("\[\[Empty Note\]\]"\)/, "such a title gets the Empty Note template, like any other");
});

test("linktextFor: the note's name, or its path only when another note really shares the name", () => {
    const note = { path: "Projects/Freelance/Hawk/Check the numbers.md", basename: "Check the numbers" };
    assert.equal(add.linktextFor(note, [note.path, "Projects/Freelance/Hawk/Hawk.md"]), "Check the numbers");
    assert.equal(add.linktextFor(note, [note.path, "Inbox/Check the Numbers.md"]), "Projects/Freelance/Hawk/Check the numbers", "same name, any case");
    assert.equal(add.linktextFor(note, [note.path, "Projects/Other/Check the numbers 1.md"]), "Check the numbers", "a numbered copy isn't a clash");
    assert.equal(add.linktextFor(note, [note.path]), "Check the numbers");
});

test("confirmMove: the note to decide about, highlighted with what it is, then what follows, and Enter moves", async () => {
    // A Modal and elements just real enough to lay the prompt out and press its buttons
    const el = () => {
        const e = { children: [], text: undefined };
        e.createEl = (tag, o = {}) => { const c = el(); c.tag = tag; c.text = o.text; e.children.push(c); return c; };
        e.createDiv = () => e.createEl("div");
        e.appendText = (t) => { e.children.push({ tag: "#text", text: t }); };
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
        classScript("addTaskNote.js") + "\n;AddTaskNote",
        vm.createContext({ app: { metadataCache: { getFileCache: (f) => f.cache ?? null } }, Modal, ButtonComponent, requestAnimationFrame: () => {}, setTimeout }),
    );
    const helper = new Cls();
    helper.isArea = (f) => f.basename === "Household";
    // The highlighted line, as its element and text, and the paragraphs after it
    const shown = () => { const mark = opened.contentEl.children[0].children[0]; return [mark.tag, mark.children.map((c) => c.text).join("")]; };
    const said = () => opened.contentEl.children.filter((c) => c.tag === "p").slice(1).map((c) => c.text);
    const TASK = { cache: { frontmatter: { tags: ["task"] } } };

    const task = helper.confirmMove({ basename: "Renew online", parent: { name: "Household" }, ...TASK }, { basename: "Household" }, { basename: "Garden Club Newsletter" });
    assert.equal(opened.title, "Move task?");
    assert.deepEqual(shown(), ["mark", "Task: Renew online"]);
    assert.deepEqual(said(), ["Time entries will be reallocated accordingly."]);
    keys.Enter();
    assert.equal(await task, "move");

    const log = helper.confirmMove({ basename: "2026-09-18 Printer call", parent: { name: "›logs" } }, { basename: "Garden Club Newsletter" }, { basename: "Household" });
    assert.equal(opened.title, "Move log?");
    assert.deepEqual(shown(), ["mark", "Log: 2026-09-18 Printer call"]);
    opened.close();
    assert.equal(await log, null, "Esc (a close with no choice) leaves it");

    // A log waiting in the Inbox is still a log; a note that's neither is a note (MoveToProject)
    const inbox = helper.confirmMove({ basename: "2026-09-18 Printer call", parent: { name: "Inbox" }, cache: { frontmatter: { tags: "log" } } }, { basename: "Household" }, { basename: "Garden Club Newsletter" });
    assert.equal(opened.title, "Move log?");
    opened.close();
    await inbox;
    const note = helper.confirmMove({ basename: "Seed catalog", parent: { name: "Household" }, cache: { frontmatter: { tags: [] } } }, { basename: "Household" }, { basename: "Garden Club Newsletter" });
    assert.equal(opened.title, "Move note?");
    assert.deepEqual(shown(), ["mark", "Note: Seed catalog"]);
    opened.close();
    await note;

    // TaskChange's question: its own title, the label and name it highlights, and a paragraph for each sentence
    const asked = helper.confirmMove({ basename: "Write copy", parent: { name: "Old" }, ...TASK }, null, { basename: "New" },
        { title: "A note with this name already exists", label: "Task note", name: "Write copy, in ⭕ Old", words: ["First.", "Second."], cancel: "Cancel" });
    assert.equal(opened.title, "A note with this name already exists");
    assert.deepEqual(shown(), ["mark", "Task note: Write copy, in ⭕ Old"]);
    assert.deepEqual(said(), ["First.", "Second."]);
    opened.close();
    assert.equal(await asked, null);

    // A project or area moving (MoveToProject): its own time stays with it
    const project = helper.confirmMove({ basename: "Garden Club Newsletter", parent: { name: "Garden Club Newsletter" }, cache: { frontmatter: { tags: ["project"] } } }, { basename: "Household" }, { basename: "Freelance" });
    assert.equal(opened.title, "Move project?");
    assert.deepEqual(shown(), ["mark", "Project: Garden Club Newsletter"]);
    assert.match(said()[0], /^Its time stays its own/);
    opened.close();
    await project;
    const area = helper.confirmMove({ basename: "Household", parent: { name: "Household" }, cache: { frontmatter: { tags: ["area"] } } }, null, { basename: "Freelance" });
    assert.equal(opened.title, "Move area?");
    assert.deepEqual(shown(), ["mark", "Area: Household"]);
    assert.deepEqual(said(), ["Its time, and its projects', stays their own."], "an area has no parent to count toward");
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
    const Cls = vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", vm.createContext({ app }));
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
    const Cls = vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", vm.createContext({ app, console }));
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
    const quiet = new (vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote",
        vm.createContext({ app, console: { error: (...a) => errors.push(a.join(" ")) } })))();
    await quiet.makeFolder("Projects/E/›logs");
    assert.equal(made.at(-1), "Projects/E/›logs", "an icon that can't be set doesn't stop the folder");
    assert.equal(errors.length, 1);
});

test("isSameNote: the note itself, or its current path; nothing else", () => {
    const note = { path: "Projects/A/2026-09-14 Review.md" };
    assert.ok(add.isSameNote(note, note));
    assert.ok(add.isSameNote({ path: note.path }, note), "another object for the same path");
    assert.ok(!add.isSameNote({ path: "Inbox/2026-09-14 Review.md" }, note));
    assert.ok(!add.isSameNote(null, note));
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
    const Cls = vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote",
        vm.createContext({ app, FuzzySuggestModal, setTimeout, plainday: withFolders({}) }));
    const helper = new Cls();
    await helper.pickHome("Order toner");
    assert.deepEqual(Array.from(shown.items), ["A", "B", "C"], "in order of their names");
    assert.equal(shown.placeholder, 'Which project or area is "Order toner" for? (Esc: cancel)');
    await helper.pickHome("B", { exclude: (f) => f.path.startsWith("Projects/A/B/"), placeholder: 'Move "B" to which project or area? (Esc: cancel)' });
    assert.deepEqual(Array.from(shown.items), ["A", "C"]);
    assert.equal(shown.placeholder, 'Move "B" to which project or area? (Esc: cancel)');
});

// A stand-in for invoke: one editor line, notes at `paths` ([path, tags]), and a EventLog that records what
// it's asked to make and names a log as it does in a vault whose days are named YYYY-MM-DD (the real one, in
// other formats too, is in eventLog.test.mjs)
const invokeOn = async (line, { ch = line.length, paths = [], sel = null } = {}) => {
    const calls = [];
    let text = line, cursor = null;
    const { files, app } = withApp(paths);
    const editor = {
        getSelection: () => (sel ? line.slice(sel[0], sel[1]) : ""),
        getCursor: (which) => ({ line: 0, ch: sel ? (which === "to" ? sel[1] : sel[0]) : ch }),
        getLine: () => text,
        replaceRange: (s, from, to) => { calls.push("write line"); text = text.slice(0, from.ch) + s + text.slice(to.ch); },
        setCursor: (c) => { cursor = c; },
        transaction: ({ replaceSelection, changes, selection }) => {
            calls.push("write line");
            if (changes) for (const c of changes) text = text.slice(0, c.from.ch) + c.text + text.slice(c.to?.ch ?? c.from.ch);
            else text = text.slice(0, ch) + replaceSelection + text.slice(ch);
            cursor = selection.from;
        },
    };
    const view = { editor, save: async () => { calls.push("save"); } };
    Object.assign(app, {
        workspace: { activeLeaf: { view }, getActiveFile: () => ({ basename: "2026-09-14", path: "days/2026-09-14.md" }) },
    });
    app.vault.createFolder = async (p) => { calls.push(`folder ${p}`); };
    app.fileManager = { renameFile: async (f, to) => {
        calls.push(`move ${f.path} to ${to}`);
        f.path = to;
        f.parent = files.find((g) => g.path.startsWith(to.slice(0, to.lastIndexOf("/")).replace(/\/›?logs$/, "")))?.parent ?? f.parent;
    } };
    app.metadataCache.getFirstLinkpathDest = (name) => files.find((f) => f.basename.toLowerCase() === name.toLowerCase() || f.path === `${name}.md`) ?? null;
    const DueDate = vm.runInContext(classScript("setDueDate.js") + "\n;DueDate", vm.createContext({}));
    const Cls = vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", vm.createContext({
        app, plainday: withFolders({
            DueDate: new DueDate(), PeriodicNotes: { periodOfName: plainName },
            EventLog: { make: async ({ date, title }) => { calls.push(`log ${date}: ${title}`); }, nameFor: (date, title) => `${date} ${add.fileName(title)}` },
        }), Notice: class { constructor(message) { calls.push(`notice: ${message}`); } },
    }));
    await new Cls().invoke();
    return { text, cursor: cursor && { ...cursor }, calls, notices: calls.filter((c) => c.startsWith("notice: ")).map((c) => c.slice(8)) };
};
const HAWK = [["Projects/Freelance/Hawk Ledger/Hawk Ledger.md", ["project"]], ["Projects/Freelance/Freelance.md", ["area"]]];

test("invoke on an event line: wherever the cursor is, the log is named from the title and linked at the end, after the ⭕; a line already linked is refused", async () => {
    const ev = "- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]]";
    for (const ch of [ev.length, 8, 0]) {
        const named = await invokeOn(ev, { ch, paths: HAWK });
        assert.equal(named.text, "- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]] [[2026-09-14 Kickoff call|⋯]]", `cursor at ${ch}`);
        assert.deepEqual(named.notices, [], `cursor at ${ch}`);
    }
    // An event with no title has nothing to name its log after, and the line is left alone
    const untitled = await invokeOn("- [<] 1:30pm\t");
    assert.equal(untitled.text, "- [<] 1:30pm\t");
    assert.deepEqual(untitled.notices, ["This event has no title to name its log"]);
    for (const linked of ["- [<] 1:30pm\tKickoff call [[2026-09-14 Kickoff call|⋯]]", "- [<] 1:30pm\t[[2026-09-14 Kickoff call|Kickoff call]]  ", "- [<] Printer call [[2026-09-18 Printer call|⋯]] [[Hawk Ledger|⭕]]"]) {
        const refused = await invokeOn(linked);
        assert.equal(refused.text, linked, linked);
        assert.deepEqual(refused.notices, ["This event already links a log"], linked);
    }
    // The cursor in the title: the log is named from it, and the cursor stays there (OBS-224)
    const named = await invokeOn(ev, { ch: 16, paths: HAWK });
    assert.equal(named.text, "- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]] [[2026-09-14 Kickoff call|⋯]]");
    assert.deepEqual(named.cursor, { line: 0, ch: 16 });
});

test("invoke on an event line makes the log right away, without Templater, after saving the line (OBS-57, OBS-122)", async () => {
    const ev = "- [<] 1:30pm\tKickoff call [[Hawk Ledger|⭕]]";
    const made = await invokeOn(ev, { ch: 16, paths: HAWK });
    assert.equal(made.text, "- [<] 1:30pm\tKickoff call [[Hawk Ledger|⭕]] [[2026-09-14 Kickoff call|⋯]]", "the ⭕ stays, and EventLog files the log there");
    assert.deepEqual(made.calls, ["write line", "save", "log 2026-09-14: Kickoff call"]);
    // The cursor at the end of the line makes it just the same (fix round 2); a line with no title,
    // or one that's refused, makes nothing
    assert.deepEqual((await invokeOn(ev, { paths: HAWK })).calls, made.calls);
    assert.ok(!(await invokeOn("- [<] 1:30pm\t")).calls.some((c) => c.startsWith("log ")));
    assert.deepEqual((await invokeOn("- [<] 1:30pm\tKickoff call [[2026-09-14 Kickoff call|⋯]]")).calls, ["notice: This event already links a log"]);
});

test("an event time with nothing after it is a line with no title; a title a file can't be named after makes a log name that works (fix round 4)", async () => {
    const t = (line, ch) => JSON.parse(JSON.stringify(add.target(line, ch)));
    for (const line of ["- [<] 4:00pm", "- [<] 4:00pm ", "- [<] 4:00pm\t", "- [<] All day"]) {
        for (const ch of [line.length, 7]) assert.deepEqual(t(line, ch), { error: "This event has no title to name its log" }, `${line} at ${ch}`);
    }
    // The log's name, like CalNav's: ": " becomes " - ", and characters a file name can't hold go
    assert.equal(add.fileName("Sync: Q3 plan"), "Sync - Q3 plan");
    assert.equal(add.fileName("Re:call / follow-up | notes"), "Re - call - follow-up - notes");
    assert.equal(add.fileName('Review "final" #2 [draft]?'), "Review final 2 draft");
    assert.equal(add.fileName("Plain title"), "Plain title");
    // The title on the line stays as the calendar wrote it; only the log's name changes
    assert.equal((await invokeOn("- [<] 1:30pm\tSync: Q3 plan [[Hawk Ledger|⭕]]", { paths: HAWK })).text,
        "- [<] 1:30pm\tSync: Q3 plan [[Hawk Ledger|⭕]] [[2026-09-14 Sync - Q3 plan|⋯]]");
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

test("one place for the logs folder's name: EventLog and every other script ask AddTaskNote (OBS-164)", () => {
    const made = classSource("eventLog.js");
    assert.match(made, /tasks\.logsFolderIn\(home\.parent\.path\)/, "EventLog files a log where AddTaskNote says");
    assert.match(made, /await tasks\.makeFolder\(folder\);/, "and makes the folder through it, icon and all");
    // No other class file spells a logs folder in its code (comments aside)
    for (const name of classFiles().map((f) => f.split("/")[1]).filter((n) => n !== "addTaskNote.js")) {
        const code = classSource(name).split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/ .*$/, "")).join("\n");
        assert.doesNotMatch(code, /["'`/]›?logs\b/i, `${name} spells the logs folder itself`);
    }
});

// A fake app for createTaskNote (OBS-121): the vault's notes by path, the writes it gets in order, and Templater,
// on or off, which merges a template's properties into the note's as Templater 2 does (merge_template_output)
const taskNoteApp = ({ notes = {}, templates = {}, templater = false, aliases = {} } = {}) => {
    const files = new Map(), calls = [], notices = [], folders = new Set(["Projects/Home"]);
    const fileOf = (path) => {
        if (!files.has(path)) {
            const at = path.lastIndexOf("/");
            files.set(path, { path, basename: path.slice(at + 1).replace(/\.md$/, ""), parent: { path: at < 0 ? "/" : path.slice(0, at) } });
        }
        return files.get(path);
    };
    const text = new Map(Object.entries({ ...notes, ...templates }));
    for (const p of text.keys()) fileOf(p);
    // Properties written back as Obsidian's stringifyYaml writes them: a link quoted, an empty value bare
    const dump = (props) => Object.entries(props).map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${x}`).join("\n")}`
        : v === null || v === undefined || v === "" ? `${k}:` : /^[[{"'!&*#?|>@%-]|: /.test(String(v)) ? `${k}: ${JSON.stringify(v)}` : `${k}: ${v}`)).join("\n") + "\n";
    const YAML = { ...STAND_IN_YAML, stringifyYaml: dump };
    const app = {
        vault: {
            getMarkdownFiles: () => [...text.keys()].map(fileOf),
            getFileByPath: (p) => (text.has(p) ? fileOf(p) : null),
            getFolderByPath: (p) => (folders.has(p) || [...text.keys()].some((k) => k.startsWith(`${p}/`)) ? { path: p } : null),
            createFolder: async (p) => { calls.push(`folder ${p}`); folders.add(p); },
            create: async (p, t) => { if (text.has(p)) throw new Error("File already exists."); calls.push(`create ${p}`); text.set(p, t); return fileOf(p); },
            read: async (f) => text.get(f.path),
        },
        metadataCache: {
            fileToLinktext: (f) => f.basename,
            getFileCache: (f) => ({ frontmatter: aliases[f.path] ? { aliases: aliases[f.path] } : {} }),
        },
        fileManager: {
            processFrontMatter: async (f, fn) => {
                calls.push(`properties ${f.path}`);
                const info = YAML.getFrontMatterInfo(text.get(f.path));
                const props = YAML.parseYaml(info.frontmatter) ?? {};
                fn(props);
                text.set(f.path, `---\n${YAML.stringifyYaml(props)}---\n${text.get(f.path).slice(info.contentStart)}`);
            },
        },
        plugins: { getPlugin: (id) => (id === "templater-obsidian" && templater ? { templater: {
            write_template_to_file: async (tpl, f) => {
                calls.push(`template ${tpl.path} on ${f.path}`);
                const parse = (t) => { const i = YAML.getFrontMatterInfo(t); return { props: i.exists ? YAML.parseYaml(i.frontmatter) ?? {} : {}, body: t.slice(i.contentStart) }; };
                const note = parse(text.get(f.path)), tpl2 = parse(templater(text.get(tpl.path)));
                for (const [k, v] of Object.entries(tpl2.props)) {
                    if (!(k in note.props)) note.props[k] = v;
                    else if (Array.isArray(note.props[k]) || Array.isArray(v)) note.props[k] = [...new Set([...[].concat(note.props[k]), ...[].concat(v)])];
                    else if (v !== null && v !== "") note.props[k] = v;
                }
                text.set(f.path, `---\n${YAML.stringifyYaml(note.props)}---\n${note.body}${tpl2.body}`);
            },
        } } : null) },
    };
    const ctx = vm.createContext({ app, normalizePath: (p) => p, moment: momentOn("2026-09-16"), stringifyYaml: YAML.stringifyYaml, console: { error: () => {} }, Notice: class { constructor(m) { notices.push(m); } }, plainday: withFolders({}) });
    const PeriodicNotes = vm.runInContext(classScript("periodicNotes.js") + "\n;PeriodicNotes", vm.createContext({ app, plainday: {}, moment: momentOn("2026-09-16"), Notice: class { constructor(m) { notices.push(m); } }, setTimeout: () => 0, clearTimeout: () => {}, ...YAML }));
    ctx.plainday.PeriodicNotes = new PeriodicNotes();
    const Fresh = vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", ctx);
    return { add: new Fresh(), text: (p) => text.get(p), calls, notices, home: fileOf("Projects/Home/Home.md") };
};

test("createTaskNote makes the note straight where it goes, with tags, parent and due in one write, and no Task template needed (OBS-121)", async () => {
    // A project's note: in its folder, its parent linked by name and first alias; the title's last date is `due`
    let f = taskNoteApp({ notes: { "Projects/Home/Home.md": "" }, aliases: { "Projects/Home/Home.md": ["🗃️.Home"] } });
    const note = await f.add.createTaskNote("Order toner 2026-09-25 2026-09-30", f.home);
    assert.equal(note.path, "Projects/Home/Order toner.md");
    assert.deepEqual(f.calls, ["create Projects/Home/Order toner.md"], "made once, where it goes: no move, no second write");
    assert.equal(f.text(note.path), '---\ntags:\n  - task\nparent: "[[Home|🗃️.Home]]"\ndue: 2026-09-30\n---\n');
    assert.deepEqual(f.notices, [], "no notice: the ⋯ on the line shows it's there");
    // No project: the Inbox, made if it isn't there, with an empty parent and due to fill in
    f = taskNoteApp();
    assert.equal((await f.add.createTaskNote("Order toner")).path, "Inbox/Order toner.md");
    assert.deepEqual(f.calls, ["folder Inbox", "create Inbox/Order toner.md"]);
    assert.equal(f.text("Inbox/Order toner.md"), "---\ntags:\n  - task\nparent:\ndue:\n---\n");
    // The line's 🚩 is the `due`, over a date in the name (OBS-66)
    f = taskNoteApp();
    await f.add.createTaskNote("Order toner 2026-09-25", null, "2026-10-02");
    assert.match(f.text("Inbox/Order toner.md"), /\ndue: 2026-10-02\n/);
    // A project note with no alias: its name alone, as SyncArea writes it
    f = taskNoteApp({ notes: { "Projects/Home/Home.md": "" } });
    await f.add.createTaskNote("Order toner", f.home);
    assert.match(f.text("Projects/Home/Order toner.md"), /\nparent: "\[\[Home\]\]"\n/);
});

test("createTaskNote cleans the name for any caller and leaves its dates off; a name with nothing left, or one another note has, makes nothing (OBS-111, OBS-121)", async () => {
    let f = taskNoteApp();
    const note = await f.add.createTaskNote("Fix #12: order form 2026-09-25");
    assert.equal(note.basename, "Fix 12 - order form");
    assert.match(f.text(note.path), /\ndue: 2026-09-25\n/, "the date is its `due`, not part of its name");
    f = taskNoteApp();
    assert.equal(await f.add.createTaskNote("???"), null);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.notices, ["No task text to name the note"]);
    // A note of that name anywhere, in any case: Obsidian would resolve the shared name to the shorter path
    f = taskNoteApp({ notes: { "Reference/order TONER.md": "" } });
    assert.equal(await f.add.createTaskNote("Order toner"), null);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.notices, ['A note named "Order toner" already exists, so no task note was made: open that one, or give this one another name']);
});

test("the Task template, when there is one: through Templater it adds its properties, and Plainday's parent and due stay; without Templater a plain one is filled in, one with Templater code is skipped (OBS-121)", async () => {
    const TPL = "Config/Templates/Task.md", home = { "Projects/Home/Home.md": "" };
    // Templater on: the repository's template adds its `id`; Plainday's properties are as it wrote them
    const repo = fs.readFileSync(new URL("../../Templates/Task.md", here), "utf8");
    const run = (t) => t.replace(/<% tp\.date\.now\("YYYYMMDDHHmmssSS"\) %>/, "2026091612000000");
    let f = taskNoteApp({ notes: home, templates: { [TPL]: repo }, templater: run });
    await f.add.createTaskNote("Order toner 2026-09-30", f.home);
    assert.deepEqual(f.calls, ["create Projects/Home/Order toner.md", `template ${TPL} on Projects/Home/Order toner.md`], "nothing put back: the template sets none of Plainday's");
    assert.equal(f.text("Projects/Home/Order toner.md"), '---\ntags:\n  - task\nparent: "[[Home]]"\ndue: 2026-09-30\nid: 2026091612000000\n---\n');
    // A template that sets parent and due, and a tag: Plainday's parent and due are put back, the tags combined
    const theirs = '---\ntags: [work]\nparent: "[[Somewhere]]"\ndue: 2027-01-01\nstatus: To Do\n---\nNotes\n';
    f = taskNoteApp({ notes: home, templates: { [TPL]: theirs }, templater: (t) => t });
    await f.add.createTaskNote("Order toner", f.home);
    const made = f.text("Projects/Home/Order toner.md");
    assert.match(made, /\nparent: "?\[\[Home\]\]"?\n/);
    assert.match(made, /\ndue:\s*\n/, "Plainday's empty due, not the template's");
    assert.match(made, /tags:\n  - task\n  - work\n/);
    assert.match(made, /\nstatus: To Do\n/);
    assert.ok(made.endsWith("---\nNotes\n"));
    assert.deepEqual(f.notices, []);
    // Templater off, a plain template: its properties and text go in with Plainday's, in the one write
    const plain = "---\nstatus: To Do\ntags: [work]\nparent: \"[[Somewhere]]\"\n---\nMade {{date}} for {{title}}\n";
    f = taskNoteApp({ notes: home, templates: { [TPL]: plain } });
    await f.add.createTaskNote("Order toner", f.home);
    assert.deepEqual(f.calls, ["create Projects/Home/Order toner.md"]);
    assert.equal(f.text("Projects/Home/Order toner.md"), '---\ntags:\n  - task\n  - work\nparent: "[[Home]]"\ndue:\nstatus: To Do\n---\nMade 2026-09-16 for Order toner\n');
    assert.deepEqual(f.notices, []);
    // Templater off, a template with Templater code: skipped, with a notice; the note has Plainday's properties
    f = taskNoteApp({ notes: home, templates: { [TPL]: repo } });
    await f.add.createTaskNote("Order toner", f.home);
    assert.equal(f.text("Projects/Home/Order toner.md"), '---\ntags:\n  - task\nparent: "[[Home]]"\ndue:\n---\n');
    assert.deepEqual(f.notices, ["Task holds Templater code and Templater is off, so the new task note was made without it."]);
    // No template, or an empty one: Plainday's properties only, and no notice, Templater on or off
    for (const templates of [{}, { [TPL]: "" }]) {
        for (const templater of [false, (t) => t]) {
            f = taskNoteApp({ notes: home, templates, templater });
            await f.add.createTaskNote("Order toner", f.home);
            assert.deepEqual(f.calls, ["create Projects/Home/Order toner.md"]);
            assert.deepEqual(f.notices, []);
        }
    }
});

test("flagDay: the day a line's first 🚩 links, by its note's name, or null (OBS-66)", () => {
    const tr = vm.runInContext(classScript("timeReport.js") + "\n;TimeReport", vm.createContext({ plainday: { PeriodicNotes: periodicNames() } }));
    const helper = new (vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", vm.createContext({ plainday: { PeriodicNotes: periodicNames(), TimeReport: new tr() } })))();
    assert.equal(helper.flagDay("- [ ] Update the invoice [[2026-09-30|🚩 9/30]]"), "2026-09-30");
    assert.equal(helper.flagDay("- [ ] Update it [[Days/2026-09-30|🚩 9/30]] [[Home|⭕]] [[Update it|⋯]] ^k3x9m2"), "2026-09-30", "among the other links, by its path's name");
    assert.equal(helper.flagDay("- [ ] A [[2026-09-30|🚩 9/30]] [[2026-10-02|🚩 10/2]]"), "2026-09-30", "the first");
    assert.equal(helper.flagDay("- [ ] Update it 2026-09-30"), null, "a date in the text is the name's");
    assert.equal(helper.flagDay("- [ ] Update it [[Launch plan|🚩 9/30]]"), null, "a 🚩 on a note that isn't a day's");
    assert.equal(helper.flagDay("- [ ] Update it"), null);
});

test("trailingProjectLinks: a forward date after the ⭕ is part of the run, so the ⭕ is still found (OBS-185)", () => {
    const helper = new (vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", vm.createContext({ plainday: { PeriodicNotes: periodicNames() } })))();
    const plain = (v) => JSON.parse(JSON.stringify(v));
    assert.deepEqual(plain(helper.trailingProjectLinks("- [>] Book it [[Kestrel|⭕]] [[2026-10-08#^k3x9m2|10/8]] ^k3x9m2")), [{ raw: "[[Kestrel|⭕]]", linkpath: "Kestrel" }]);
    assert.equal(helper.trailingNote("- [>] Book it [[Book it|⋯]] [[2026-10-08#^k3x9m2|10/8]] ^k3x9m2"), "Book it");
});

test("invoke on a task with an ID and nothing after the cursor: the empty ⋯ link goes in before the ID (OBS-185)", async () => {
    const out = await invokeOn("- [ ] Book it ^k3x9m2");
    assert.equal(out.text, "- [ ] Book it [[|⋯]] ^k3x9m2");
    assert.deepEqual(out.cursor, { line: 0, ch: "- [ ] Book it [[".length });
});

test("invoke at the visible end of a line with an ID, where a click puts the cursor: the empty ⋯ link, before the ID (OBS-185)", async () => {
    const line = "- [ ] Book it ^k3x9m2";
    for (const ch of ["- [ ] Book it".length, "- [ ] Book it ".length]) {
        assert.deepEqual(JSON.parse(JSON.stringify(add.target(line, ch))), { kind: "task", mode: "blank" }, `at ${ch}`);
        const out = await invokeOn(line, { ch });
        assert.equal(out.text, "- [ ] Book it [[|⋯]] ^k3x9m2", `at ${ch}`);
        assert.deepEqual(out.cursor, { line: 0, ch: "- [ ] Book it [[".length }, `at ${ch}`);
    }
    // Text after the cursor still names the note
    assert.equal(add.target(line, "- [ ] Book".length).name, "Book it");
});

test("fileName: one cleanup for a task note's name and a log's; a time keeps the log rule; cleaning twice changes nothing (OBS-111)", () => {
    for (const [title, want] of [
        ["Draft: homepage copy", "Draft - homepage copy"],
        ["Draft:homepage copy", "Draft - homepage copy"],
        ["Print / fold", "Print - fold"],
        ["Fix #12 bug?", "Fix 12 bug"],
        ["Fix #12: order form", "Fix 12 - order form"],
        ["Call back...", "Call back"],
        ["Call Ana at 3:30", "Call Ana at 3 - 30"],
        ["Ask *why* <first> ^now", "Ask why first now"],
        ["Renew the domain 2026-09-30", "Renew the domain 2026-09-30"],
        ["???", ""],
    ]) {
        assert.equal(add.fileName(title), want, title);
        assert.equal(add.fileName(want), want, `${title}, cleaned twice`);
    }
});

// A colon and the other characters a file name can't hold, through Add note on the stand-in vault (OBS-111)
const PROJECT = "---\ntags: [project]\n---\n", NEW = "Projects/New/New.md";
const day = (d) => `${PLANNER}/days/${d}.md`;
const lineIn = (v, path, text) => v.notes()[path].split("\n").find((l) => l.includes(text));
const notesIn = (v, folder) => Object.keys(v.notes()).filter((p) => p.startsWith(folder)).sort();

for (const lag of [false, true]) {
    const also = lag ? " (the cache a command behind)" : "";

    test(`Add note on a task with a colon makes the note with the name cleaned, and the line keeps its colon (OBS-111)${also}`, async () => {
        const v = standIn({ notes: { [NEW]: PROJECT, [day("2026-09-17")]: "- [ ] Draft: homepage copy [[New|⭕]]\n- [ ] Print / fold\n" }, open: day("2026-09-17"), at: 0, lag });
        await v.addTaskNote();
        assert.equal(lineIn(v, day("2026-09-17"), "Draft"), "- [ ] Draft: homepage copy [[New|⭕]] [[Draft - homepage copy|⋯]]");
        assert.deepEqual(notesIn(v, "Projects/New/"), ["Projects/New/Draft - homepage copy.md", NEW]);
        assert.deepEqual(v.notices, [], "no notice: the ⋯ shows the note is there");
        // A slash, on a line with no project: the note waits in the Inbox
        v.open(day("2026-09-17"), 1);
        await v.addTaskNote();
        assert.equal(lineIn(v, day("2026-09-17"), "Print"), "- [ ] Print / fold [[Print - fold|⋯]]");
        assert.ok(v.notes()["Inbox/Print - fold.md"]);
        assert.ok(!v.notices.some((n) => n.startsWith("Couldn't create")), v.notices.join(" | "));
        assert.deepEqual(v.problems(), []);
    });

    test(`a second line of that name links the note instead of making another, and so does a note made with a dash by hand (OBS-111)${also}`, async () => {
        const notes = { [NEW]: PROJECT, [day("2026-09-17")]: "- [ ] Draft: homepage copy [[New|⭕]]\n", [day("2026-09-18")]: "- [ ] Draft: homepage copy\n" };
        let v = standIn({ notes, open: day("2026-09-17"), at: 0, lag });
        await v.addTaskNote();
        const made = v.notices.length;
        v.open(day("2026-09-18"), 0);
        await v.addTaskNote();
        assert.equal(lineIn(v, day("2026-09-18"), "Draft"), "- [ ] Draft: homepage copy [[New|⭕]] [[Draft - homepage copy|⋯]]", "it takes the note's project");
        assert.deepEqual(notesIn(v, "Projects/New/"), ["Projects/New/Draft - homepage copy.md", NEW]);
        assert.ok(!v.notices.slice(made).some((n) => n.startsWith("Created")), v.notices.join(" | "));
        // The note made with today's workaround, a dash typed for the colon, is the task's note
        v = standIn({ notes: { [NEW]: PROJECT, "Projects/New/Draft - homepage copy.md": "---\ntags: [task]\nparent: \"[[New]]\"\n---\n", [day("2026-09-17")]: "- [ ] Draft: homepage copy [[New|⭕]]\n" }, open: day("2026-09-17"), at: 0, lag });
        await v.addTaskNote();
        assert.equal(lineIn(v, day("2026-09-17"), "Draft"), "- [ ] Draft: homepage copy [[New|⭕]] [[Draft - homepage copy|⋯]]");
        assert.deepEqual(notesIn(v, "Projects/New/"), ["Projects/New/Draft - homepage copy.md", NEW]);
        assert.deepEqual(v.problems(), []);
    });

    test(`a # and a date: the # and the colon stay on the line, the date comes off it, and becomes the note's \`due\` (OBS-111)${also}`, async () => {
        const v = standIn({ notes: { [NEW]: PROJECT, [day("2026-09-18")]: "- [ ] Fix #12: order form 2026-09-25 [[New|⭕]]\n" }, open: day("2026-09-18"), at: 0, lag });
        const helper = v.plainday.AddTaskNote, make = helper.createTaskNote.bind(helper), titles = [];
        helper.createTaskNote = async (title, parent, due) => { titles.push(title); return make(title, parent, due); };
        await v.addTaskNote();
        assert.deepEqual(titles, ["Fix 12 - order form 2026-09-25"]);
        assert.match(v.notes()["Projects/New/Fix 12 - order form.md"], /\ndue: 2026-09-25\n/);
        assert.equal(lineIn(v, day("2026-09-18"), "Fix"), "- [ ] Fix #12: order form [[New|⭕]] [[Fix 12 - order form|⋯]]");
    });

    test(`a 🚩 on the line is the new note's \`due\`, over a date in the name; with neither, \`due\` is empty (OBS-66, OBS-121)${also}`, async () => {
        const notes = { [NEW]: PROJECT, [day("2026-09-16")]: "- [ ] Update the invoice [[2026-09-30|🚩 9/30]]\n- [ ] Order banner stand 2026-10-02 [[2026-09-30|🚩 9/30]] [[New|⭕]]\n- [ ] Book the venue\n" };
        const v = standIn({ notes, open: day("2026-09-16"), at: 0, lag });
        await v.addTaskNote();
        assert.equal(lineIn(v, day("2026-09-16"), "invoice"), "- [ ] Update the invoice [[2026-09-30|🚩 9/30]] [[Update the invoice|⋯]]");
        assert.equal(v.notes()["Inbox/Update the invoice.md"], "---\ntags:\n  - task\nparent:\ndue: 2026-09-30\n---\n");
        v.open(day("2026-09-16"), 1);
        await v.addTaskNote();
        assert.equal(lineIn(v, day("2026-09-16"), "banner"), "- [ ] Order banner stand [[2026-09-30|🚩 9/30]] [[New|⭕]] [[Order banner stand|⋯]]");
        assert.equal(v.notes()["Projects/New/Order banner stand.md"], '---\ntags:\n  - task\nparent: "[[New]]"\ndue: 2026-09-30\n---\n', "the 🚩 wins over the date in the name");
        v.open(day("2026-09-16"), 2);
        await v.addTaskNote();
        assert.equal(v.notes()["Inbox/Book the venue.md"], "---\ntags:\n  - task\nparent:\ndue:\n---\n");
        assert.deepEqual(v.notices, []);
    });

    test(`a date in the name, with no 🚩: it comes off the line and the note's name, and is the note's \`due\` (OBS-121)${also}`, async () => {
        const v = standIn({ notes: { [NEW]: PROJECT, [day("2026-09-18")]: "- [ ] Order banner stand 2026-09-30 [[New|⭕]]\n" }, open: day("2026-09-18"), at: 0, lag });
        await v.addTaskNote();
        assert.equal(lineIn(v, day("2026-09-18"), "banner"), "- [ ] Order banner stand [[New|⭕]] [[Order banner stand|⋯]]");
        assert.equal(v.notes()["Projects/New/Order banner stand.md"], '---\ntags:\n  - task\nparent: "[[New]]"\ndue: 2026-09-30\n---\n');
        assert.deepEqual(notesIn(v, "Inbox/"), [], "made straight in the project, never in the Inbox");
    });

    test(`a selection with a colon names the note cleaned and stays as typed; the cursor goes to its end (OBS-111)${also}`, async () => {
        const text = "- [ ] Draft: homepage copy, then send it [[New|⭕]]";
        const v = standIn({ notes: { [NEW]: PROJECT, [day("2026-09-17")]: `${text}\n` }, open: day("2026-09-17"), at: 0, lag });
        v.select("- [ ] ".length, "- [ ] Draft: homepage copy".length);
        await v.addTaskNote();
        assert.equal(lineIn(v, day("2026-09-17"), "Draft"), `${text} [[Draft - homepage copy|⋯]]`);
        assert.ok(v.notes()["Projects/New/Draft - homepage copy.md"]);
        assert.deepEqual(v.placed(), { line: 0, ch: "- [ ] Draft: homepage copy".length });
    });

    test(`a note of the cleaned name in Archive: the fresh note's name starts from the cleaned name (OBS-111)${also}`, async () => {
        const ARCHIVED = "Archive/Gone/Draft - homepage copy.md";
        const v = standIn({ notes: { [NEW]: PROJECT, "Archive/Gone/Gone.md": PROJECT, [ARCHIVED]: "---\ntags: [task]\nparent: \"[[Gone]]\"\n---\n", [day("2026-09-17")]: "- [ ] Draft: homepage copy [[New|⭕]]\n" }, open: day("2026-09-17"), at: 0, lag });
        await v.addTaskNote();
        assert.equal(lineIn(v, day("2026-09-17"), "Draft"), "- [ ] Draft: homepage copy [[New|⭕]] [[Draft - homepage copy (New)|⋯]]");
        assert.ok(v.notes()["Projects/New/Draft - homepage copy (New).md"] && v.notes()[ARCHIVED]);
    });

    test(`a task with nothing left once its name is cleaned says so and changes nothing (OBS-111)${also}`, async () => {
        const notes = { [NEW]: PROJECT, [day("2026-09-17")]: "- [ ] ??? [[New|⭕]]\n" };
        const v = standIn({ notes, open: day("2026-09-17"), at: 0, lag });
        await v.addTaskNote();
        assert.deepEqual(v.notices, ["No task text to name the note"]);
        assert.deepEqual(v.notes(), notes);
    });
}
