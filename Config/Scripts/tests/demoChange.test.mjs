// OBS-225's QA steps on the demo's own notes, in the test plan's order, on the stand-in vault: what each
// command writes and asks, before anyone opens the app. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { standIn, PLANNER } from "./standInVault.mjs";

const root = new URL("../../../", import.meta.url).pathname;
const read = (dir, out = {}) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) read(rel, out);
        else if (e.name.endsWith(".md")) out[rel] = fs.readFileSync(path.join(root, rel), "utf8");
    }
    return out;
};
const notes = () => ({ ...read("Projects"), ...read("Inbox"), ...read("Reference") });
const day = (d) => `${PLANNER}/days/${d}.md`;
const plain = (x) => JSON.parse(JSON.stringify(x));
const KESTREL = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Outfitters 2026.md";
const PINECREST = "Projects/Freelance/Pinecrest Library Brochure/Pinecrest Library Brochure.md";
const GARDEN = "Projects/Personal/Garden Club Newsletter/Garden Club Newsletter.md";
const POSTER = "Projects/Personal/Block Party Poster/Block Party Poster.md";
const CATALOG = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Fall Catalog/Kestrel Fall Catalog.md";
const BROCHURE = "Projects/Freelance/Pinecrest Library Brochure/Write brochure copy.md";
const LOG = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Fall Catalog/›logs/2026-09-16 Catalog shoot planning.md";
const SHOT = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Fall Catalog/Shot list for catalog.md";
const CAR = "Projects/Household/Renew car registration.md";

for (const lag of [false, true]) {
    test(`OBS-225's QA steps on the demo, in order${lag ? " (the cache a command behind)" : ""}`, async () => {
        const v = standIn({ notes: notes(), today: "2026-09-20", lag });
        const at = (p, text) => v.lineOf(p, text);
        const line = (p, text) => v.notes()[p].split("\n").find((l) => l.includes(text));
        const go = (p, text) => { assert.notEqual(at(p, text), -1, `${p}: ${text}`); v.open(p, at(p, text)); };
        const add = (p, text) => { v.open(p, 0); const e = v.app.workspace.activeLeaf.view.editor; const last = e.lineCount() - 1; e.replaceRange(`\n${text}`, { line: last, ch: e.getLine(last).length }); v.open(p, at(p, text)); };
        const questions = () => plain(v.asked).map((q) => q.title);

        // A subtask's day changes its whole task: it asks as the task's own line would, and Cancel changes nothing
        const untouched = v.notes();
        go(day("2026-09-17"), "Send final copy to Rafe");
        await v.addProjectLink(KESTREL, null);
        // The one decision, and which parent moves; the days and lines go without saying (Brian, 2026-11-03)
        const shown = (q) => [q.title, `${q.label}: ${q.name}`, ...q.words];
        const KES = "⭕ Kestrel Outfitters 2026";
        assert.deepEqual(plain(v.asked).map(shown), [["Moving a subtask requires moving its parent", "Parent: Write brochure copy", `Move this task? Any other subtasks and task notes will also move, and time entries will now count toward ${KES}.`]]);
        assert.deepEqual(plain(v.asked).map((q) => [q.lines, q.time]), [["9/11, 9/15, 9/17", "9/11, 9/15"]]);
        assert.deepEqual(v.notes(), untouched);

        // A task with a note moves with its note, its days and its subtasks
        v.asked.length = 0;
        go(day("2026-09-11"), "Brochure copy: first draft");
        await v.addProjectLink(KESTREL);
        assert.deepEqual(plain(v.asked).map(shown), [["Move task?", "Task: Write brochure copy", `Any subtasks and task notes will also move, and time entries will now count toward ${KES}.`]]);
        assert.deepEqual(plain(v.asked).map((q) => [q.lines, q.time]), [["9/11, 9/15, 9/17", "9/11, 9/15"]]);
        const moved = "Projects/Freelance/Kestrel Outfitters 2026/Write brochure copy.md";
        assert.ok(v.notes()[moved] && !v.notes()[BROCHURE]);
        assert.match(line(day("2026-09-11"), "first draft"), /\[\[Kestrel Outfitters 2026\|⭕\]\] \[\[Write brochure copy\|⋯\]\]$/);
        assert.match(line(day("2026-09-15"), "revisions"), /\[\[Kestrel Outfitters 2026\|⭕\]\] \[\[Write brochure copy\|⋯\]\]$/);
        assert.equal(line(day("2026-09-17"), "Send final copy"), "- [ ] Send final copy to Rafe [[Kestrel Outfitters 2026|⭕]] [[Write brochure copy#^p7d2qe|↗]] ^p7d2qe");
        assert.ok(v.notes()["Projects/Freelance/Pinecrest Library Brochure/›logs/2026-09-02 Brochure kickoff.md"], "a log that names the note only in its text stays");
        assert.equal(line(PINECREST, "Write brochure copy"), undefined);
        assert.equal(line(KESTREL, "Write brochure copy"), "- [x] Write brochure copy [[Write brochure copy|⋯]]");
        assert.ok(at(KESTREL, "Write brochure copy") > at(KESTREL, "Category page templates"), "at the end of its To Do");
        assert.deepEqual(v.problems(), []);

        // It refuses to move billed time
        v.asked.length = 0;
        go(day("2026-09-11"), "Sitemap and content inventory");
        const sitemap = line(day("2026-09-11"), "Sitemap");
        await v.addProjectLink(PINECREST);
        assert.deepEqual(plain(v.asked).map(shown), [["Change project?", "Task: Sitemap and content inventory", "Its time entries will now count toward ⭕ Pinecrest Library Brochure."]]);
        assert.equal(line(day("2026-09-11"), "Sitemap"), sitemap);
        assert.equal(v.notices.at(-1), "Nothing changed: this task's time on 9/11 is on 1001-KES (paid 9/15).");

        // A log moves its days, and a follow-up's day takes its log with it
        v.asked.length = 0;
        const follow = "Confirm the product list against";
        go(LOG, follow);
        await v.addProjectLink(GARDEN);
        assert.equal(v.notices.at(-1), "Run MoveToProject on this note: the note says the project, and its lines follow");
        go(LOG, follow);
        await v.schedule("2026-09-19");
        assert.match(line(day("2026-09-19"), follow), /\[\[Kestrel Fall Catalog\|⭕\]\] \[\[2026-09-16 Catalog shoot planning#\^[a-z0-9]{6}\|↗\]\] \^[a-z0-9]{6}$/);
        v.open(LOG, 0);
        await v.moveToProject(GARDEN);
        const [log] = plain(v.asked);
        assert.deepEqual(shown(log), ["Move log?", "Log: 2026-09-16 Catalog shoot planning", "Its follow-up tasks, along with any task notes, will also move, and its time entries will now count toward ⭕ Garden Club Newsletter."]);
        assert.deepEqual([log.lines, log.time], ["9/16, 9/19", "9/16"]);
        const filed = "Projects/Personal/Garden Club Newsletter/›logs/2026-09-16 Catalog shoot planning.md";
        assert.ok(v.notes()[filed] && !v.notes()[LOG]);
        assert.match(line(day("2026-09-16"), "Catalog shoot planning"), /\[\[Garden Club Newsletter\|⭕\]\]/);
        assert.match(line(day("2026-09-19"), follow), /\[\[Garden Club Newsletter\|⭕\]\]/);
        assert.ok(v.notes()[SHOT], "linked only in the text: it stays");
        v.asked.length = 0;
        go(day("2026-09-19"), follow);
        await v.addProjectLink(CATALOG);
        const [back] = plain(v.asked);
        assert.deepEqual(shown(back), ["Moving a subtask requires moving its parent", "Parent: 2026-09-16 Catalog shoot planning", "Move this log? Its other follow-up tasks, along with any task notes, will also move, and its time entries will now count toward ⭕ Kestrel Fall Catalog."]);
        assert.deepEqual([back.lines, back.time], ["9/16, 9/19", "9/16"]);
        assert.ok(v.notes()[LOG] && !v.notes()[filed], "back in Kestrel Fall Catalog's ›logs");
        assert.match(line(day("2026-09-16"), "Catalog shoot planning"), /\[\[Kestrel Fall Catalog\|⭕\]\]/);
        assert.match(line(day("2026-09-19"), follow), /\[\[Kestrel Fall Catalog\|⭕\]\]/);
        assert.deepEqual(v.problems(), []);

        // A task in a project note gets a note, then changes project from its day
        v.asked.length = 0;
        go(KESTREL, "- [ ] Homepage build");
        await v.addProjectLink(PINECREST);
        assert.match(v.notices.at(-1), /^A task moves from one of its days/);
        go(KESTREL, "- [ ] Homepage build");
        await v.addTaskNote();
        const home = "Projects/Freelance/Kestrel Outfitters 2026/Homepage build.md";
        assert.ok(v.notes()[home]);
        assert.equal(line(KESTREL, "- [ ] Homepage build"), "- [ ] Homepage build [[Homepage build|⋯]]");
        go(KESTREL, "- [ ] Homepage build");
        await v.schedule("2026-09-19");
        assert.match(line(day("2026-09-19"), "Homepage build"), /^- \[ \] Homepage build \[\[Kestrel Outfitters 2026\|⭕\]\] \[\[Homepage build\|⋯\]\] \^[a-z0-9]{6}$/);
        assert.match(line(KESTREL, "Homepage build"), /^- \[>\] Homepage build \[\[2026-09-19#\^/);
        go(day("2026-09-19"), "Homepage build");
        await v.addProjectLink(PINECREST);
        const [build] = plain(v.asked);
        assert.deepEqual(shown(build), ["Move task?", "Task: Homepage build", "Any subtasks and task notes will also move to ⭕ Pinecrest Library Brochure."]);
        assert.deepEqual([build.lines, build.time], ["9/19", ""]);
        assert.ok(v.notes()["Projects/Freelance/Pinecrest Library Brochure/Homepage build.md"]);
        assert.equal(line(KESTREL, "Homepage build"), undefined);
        assert.match(line(PINECREST, "Homepage build"), /^- \[>\] Homepage build \[\[2026-09-19#\^/);
        assert.match(line(day("2026-09-19"), "Homepage build"), /\[\[Pinecrest Library Brochure\|⭕\]\]/);
        assert.ok(v.notes()[KESTREL], "Kestrel's folder hasn't moved");

        // Filing from the Inbox doesn't ask
        v.asked.length = 0;
        add(day("2026-09-18"), "- [ ] Call the printer");
        await v.addTaskNote();
        assert.ok(v.notes()["Inbox/Call the printer.md"]);
        assert.equal(line(day("2026-09-18"), "Call the printer"), "- [ ] Call the printer [[Call the printer|⋯]]");
        go(day("2026-09-18"), "Call the printer");
        await v.addProjectLink(PINECREST);
        assert.deepEqual(questions(), []);
        assert.ok(v.notes()["Projects/Freelance/Pinecrest Library Brochure/Call the printer.md"]);
        assert.equal(line(day("2026-09-18"), "Call the printer"), "- [ ] Call the printer [[Pinecrest Library Brochure|⭕]] [[Call the printer|⋯]]");

        // AddTaskNote files an Inbox note in the line's project
        add(day("2026-09-18"), "- [ ] Desk lamp for the studio");
        await v.addProjectLink(POSTER);
        go(day("2026-09-18"), "Desk lamp");
        await v.addTaskNote();
        assert.deepEqual(questions(), []);
        assert.ok(v.notes()["Projects/Personal/Block Party Poster/Desk lamp for the studio.md"]);
        assert.equal(line(day("2026-09-18"), "Desk lamp"), "- [ ] Desk lamp for the studio [[Block Party Poster|⭕]] [[Desk lamp for the studio|⋯]]");

        // AddTaskNote asks Move or Leave it
        add(day("2026-09-18"), "- [ ] Shot list for catalog");
        await v.addProjectLink(GARDEN);
        go(day("2026-09-18"), "Shot list for catalog");
        await v.addTaskNote("leave");
        const [shot] = plain(v.asked);
        assert.deepEqual([...shown(shot), shot.cancel], ["A note with this name already exists", "Task note: Shot list for catalog, in ⭕ Kestrel Fall Catalog",
            "This task will link to that note. Move the note to ⭕ Garden Club Newsletter with this task, or leave it where it is and give this task ⭕ Kestrel Fall Catalog?",
            "For a separate note, press Esc and give this task a different name.", "Leave it"]);
        assert.ok(v.notes()[SHOT]);
        assert.equal(line(day("2026-09-18"), "Shot list for catalog"), "- [ ] Shot list for catalog [[Kestrel Fall Catalog|⭕]] [[Shot list for catalog|⋯]]");

        // A subtask gets a note of its own
        go(SHOT, "Confirm the product list with Imogen");
        await v.addTaskNote();
        assert.ok(v.notes()["Projects/Freelance/Kestrel Outfitters 2026/Kestrel Fall Catalog/Confirm the product list with Imogen.md"]);
        assert.equal(line(SHOT, "Confirm the product list"), "- [ ] Confirm the product list with Imogen [[Confirm the product list with Imogen|⋯]]");

        // AddTaskNote puts the ⋯ on every line of the task
        go(day("2026-09-17"), "Send final copy to Rafe");
        await v.addTaskNote();
        assert.ok(v.notes()["Projects/Freelance/Kestrel Outfitters 2026/Send final copy to Rafe.md"]);
        assert.equal(line(day("2026-09-17"), "Send final copy"), "- [ ] Send final copy to Rafe [[Kestrel Outfitters 2026|⭕]] [[Send final copy to Rafe|⋯]] [[Write brochure copy#^p7d2qe|↗]] ^p7d2qe");
        assert.equal(line(moved, "Send final copy"), "- [>] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] [[Send final copy to Rafe|⋯]] ^p7d2qe");
        go(moved, "Send final copy");
        await v.addTaskNote();
        assert.equal(v.notices.at(-1), "Every line of this task already links Send final copy to Rafe");

        // The cursor stays where it was
        const words = "- [ ] Send September".length;
        v.open(day("2026-09-18"), at(day("2026-09-18"), "Send September invoices"), words);
        await v.addProjectLink(KESTREL);
        assert.deepEqual(v.placed(), { line: at(day("2026-09-18"), "Send September invoices"), ch: words });
        v.open(day("2026-09-18"), at(day("2026-09-18"), "Send September invoices"), words);
        await v.addTaskNote();
        assert.deepEqual(v.placed(), { line: at(day("2026-09-18"), "Send September invoices"), ch: words });
        assert.ok(v.notes()["Projects/Freelance/Kestrel Outfitters 2026/Send September invoices.md"]);

        // A dragged note is put right
        v.asked.length = 0;
        await v.app.fileManager.renameFile(v.file(CAR), "Projects/Freelance/Kestrel Outfitters 2026/Renew car registration.md");
        assert.ok(v.problems().some((p) => p === `own note ${day("2026-09-17")}:${at(day("2026-09-17"), "Renew car registration") + 1}`));
        v.open("Projects/Freelance/Kestrel Outfitters 2026/Renew car registration.md", 0);
        await v.moveToProject(KESTREL);
        assert.deepEqual(questions(), []);
        assert.match(line(day("2026-09-17"), "Renew car registration"), /\[\[Kestrel Outfitters 2026\|⭕\]\] \[\[Renew car registration\|⋯\]\]$/);
        assert.match(v.notices.at(-1), /^Renew car registration was already in Kestrel Outfitters 2026/);

        // Outside the system, and the notes MoveToProject leaves where they are
        const RAFE = "Reference/People/Rafe Oakes.md";
        const before = v.notes()[RAFE];
        add(RAFE, "- [ ] Ask for the photo release list");
        v.menus.length = 0;
        await v.addProjectLink(KESTREL);
        assert.match(v.notices.at(-1), /^Rafe Oakes isn't in the Planner, Projects or the Inbox/);
        await v.addTaskNote();
        assert.match(v.notices.at(-1), /^Rafe Oakes isn't in the Planner, Projects or the Inbox/);
        await v.moveToProject(KESTREL);
        assert.match(v.notices.at(-1), /^Rafe Oakes isn't in the Planner, Projects or the Inbox/);
        v.open(day("2026-09-18"), 0);
        await v.moveToProject(KESTREL);
        assert.equal(v.notices.at(-1), "2026-09-18 stays where it is: run AddProjectLink on a line in it");
        const SHEET = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Outfitters 2026 timesheet.md";
        v.open(SHEET, 0);
        await v.moveToProject(KESTREL);
        assert.equal(v.notices.at(-1), "Kestrel Outfitters 2026 timesheet stays where it is: a timesheet belongs to the time report");
        assert.deepEqual(plain(v.menus), [], "no menu opened");
        assert.notEqual(before, undefined);
    });
}
