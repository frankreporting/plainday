// Schedule on a nested task sends just that line, by way of its parent's note (OBS-254): the real scripts on a
// stand-in vault, in the shapes of the sample notes, with the task checks after each step. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { standIn, PLANNER } from "./standInVault.mjs";

const day = (d) => `${PLANNER}/days/${d}.md`;
const KO = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Outfitters 2026.md";
const CAT = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Fall Catalog/Kestrel Fall Catalog.md";
const PIN = "Projects/Freelance/Pinecrest Library Brochure/Pinecrest Library Brochure.md";
const HOUSE = "Projects/Household/Household.md";
const RENEW = "Projects/Household/Renew car registration.md";
const WIRES = "Projects/Freelance/Kestrel Outfitters 2026/Draft homepage wireframes.md";
const W38 = `${PLANNER}/weeks/2026w38.md`;
const HOMEPAGE = "Projects/Freelance/Kestrel Outfitters 2026/Homepage build - category pages.md";
const D17 = [
    "- [<] 1:00pm\tCall with Rafe Oakes [[Pinecrest Library Brochure|⭕]] ^e-ygtclj",
    "\t- 1:30pm: 🆓 quick check-in, not billing it",
    "\t- [ ] Confirm the print run with Rafe",
    "- [ ] Homepage build: category pages [[Kestrel Outfitters 2026|⭕]]",
    "\t- [ ] Pick a hero image for each category",
    "\t- [ ] Write the category blurbs",
    "\t\t- Imogen sent the tone guide",
    "- [ ] Renew car registration [[2026-09-30|🚩 9/30]] [[Household|🗃️]] [[Renew car registration|⋯]]",
    "\t- [ ] Find the insurance card",
    "",
].join("\n");
const NOTES = {
    [KO]: "---\ntags: [project]\n---\n",
    [CAT]: "---\ntags: [project]\n---\n## To Do\n\n- [x] Book the studio space\n- [ ] Shoot day on the 24th\n\t- [ ] Book two store staff to model the jackets\n- [ ] Deliver edited selects\n",
    [PIN]: "---\ntags: [project]\n---\n",
    [HOUSE]: "---\ntags: [area]\n---\n",
    [RENEW]: "---\ntags: [task]\nparent: \"[[Household]]\"\ndue: 2026-09-30\n---\nRegistration runs out at the end of the month.\n\n- [ ] Find the emissions test receipt\n- [ ] Put the new sticker on\n",
    [WIRES]: "---\ntags: [task]\nparent: \"[[Kestrel Outfitters 2026]]\"\n---\nWireframes for the sign-off call.\n\n- [x] Desktop layout\n- [ ] Export PDFs for the sign-off call\n\t- [ ] Check the mobile PDF on a phone\n\n## Notes\n\n- Two-column hero on desktop.\n",
    [W38]: "- [x] Wireframes to Imogen before Friday's sign-off\n- [ ] Product list for the catalog shoot\n\t- [ ] Ask Imogen which jackets are in\n- [ ] September invoices\n\n## Time Report\n\n%% time:start %%\n%% time:end %%\n",
    [day("2026-09-17")]: D17,
};
const lines = (v, path) => (v.notes()[path] ?? "").split("\n");
const idOf = (line) => line.match(/\^([a-z0-9]+)$/)[1];
// The marks on nested lines the report lists (TimeReport.subTaskProblems), as `path:line`
const nestedMarks = (v) => {
    const tr = v.plainday.TimeReport, tasks = v.plainday.TaskIds;
    const notes = Object.entries(v.notes()).filter(([p]) => tasks.inSystem(v.app.vault.getFileByPath(p))).map(([path, text]) => ({ path, text, kind: tasks.kindOf(v.app.vault.getFileByPath(path)) }));
    return JSON.parse(JSON.stringify(tr.subTaskProblems(notes, tasks.constructor).map((l) => `${l.path}:${l.line}`)));
};
const scenario = (name, fn) => {
    for (const lag of [false, true]) test(`${name}${lag ? " (the cache a command behind)" : ""}`, () => fn({ lag }));
};

scenario("a nested task is sent through its task's new note, and its day [>] line follows it, asks when clicked, and stays [>] when it's done (test plan 1 to 5)", async ({ lag }) => {
    const v = standIn({ notes: NOTES, open: day("2026-09-17"), at: 4, lag });
    assert.equal(await v.schedule("2026-09-19"), "Schedule for");
    assert.deepEqual(v.notices, ["Forwarded to 9/19, by way of Homepage build - category pages"]);
    let d17 = lines(v, day("2026-09-17"));
    assert.equal(d17[3], "- [ ] Homepage build: category pages [[Kestrel Outfitters 2026|⭕]] [[Homepage build - category pages|⋯]]", "the task keeps its colon and gets its note's ⋯");
    const id = idOf(d17[4]);
    assert.equal(d17[4], `\t- [>] Pick a hero image for each category [[2026-09-19#^${id}|9/19]] ^${id}`);
    assert.deepEqual(d17.slice(5, 7), ["\t- [ ] Write the category blurbs", "\t\t- Imogen sent the tone guide"]);
    assert.ok(v.notes()[HOMEPAGE].endsWith(`---\n- [>] Pick a hero image for each category [[2026-09-19#^${id}|9/19]] ^${id}\n`), v.notes()[HOMEPAGE]);
    assert.match(v.notes()[HOMEPAGE], /parent: "\[\[Kestrel Outfitters 2026\]\]"/);
    assert.equal(v.notes()[day("2026-09-19")].trim(), `- [ ] Pick a hero image for each category [[Kestrel Outfitters 2026|⭕]] [[Homepage build - category pages#^${id}|↗]] ^${id}`);
    assert.deepEqual(v.check(), []);
    assert.deepEqual(nestedMarks(v), [], "the day's [>] line's ID isn't a mark on a nested task");

    // Schedule on the day's [>] line moves the subtask's open line, and both its sent lines follow
    v.open(day("2026-09-17"), 4);
    assert.equal(await v.schedule("2026-09-22"), "Scheduled for Sat 9/19. Move it to");
    assert.equal(v.notices.at(-1), "Moved to 9/22");
    assert.equal(v.notes()[day("2026-09-19")].trim(), "");
    assert.equal(v.notes()[day("2026-09-22")].trim(), `- [ ] Pick a hero image for each category [[Kestrel Outfitters 2026|⭕]] [[Homepage build - category pages#^${id}|↗]] ^${id}`);
    assert.equal(lines(v, day("2026-09-17"))[4], `\t- [>] Pick a hero image for each category [[2026-09-22#^${id}|9/22]] ^${id}`);
    assert.ok(v.notes()[HOMEPAGE].includes(`- [>] Pick a hero image for each category [[2026-09-22#^${id}|9/22]] ^${id}`));
    assert.deepEqual(v.check(), []);

    // A click on its box asks, as on any [>] line of a task
    v.open(day("2026-09-17"), 4);
    const asked = await v.click({ answer: "Do nothing" });
    assert.equal(asked?.title, "This task is scheduled for Tue 9/22. What would you like to do?");
    assert.equal(lines(v, day("2026-09-17"))[4], `\t- [>] Pick a hero image for each category [[2026-09-22#^${id}|9/22]] ^${id}`);

    // Ticked on its open line: the note's line is done too, and the day's [>] line stays [>]
    v.open(day("2026-09-22"), 0);
    await v.box("x");
    assert.ok(v.notes()[HOMEPAGE].includes(`- [x] Pick a hero image for each category [[2026-09-22#^${id}|9/22]] ^${id}`));
    assert.equal(lines(v, day("2026-09-17"))[4], `\t- [>] Pick a hero image for each category [[2026-09-22#^${id}|9/22]] ^${id}`);
    assert.deepEqual(v.check(), []);
});

scenario("from a bullet under a nested task, that task is sent through its task's note; scheduling the task afterwards forwards it, a project change and a deadline reach the day [>] lines (test plan 6 to 10)", async ({ lag }) => {
    const v = standIn({ notes: NOTES, open: day("2026-09-17"), at: 4, lag });
    await v.schedule("2026-09-19");
    const first = idOf(lines(v, day("2026-09-17"))[4]);
    v.open(day("2026-09-17"), 6);
    await v.schedule("2026-09-18");
    assert.equal(v.notices.at(-1), 'Forwarded "Write the category blurbs" to 9/18, by way of Homepage build - category pages');
    let d17 = lines(v, day("2026-09-17"));
    const id = idOf(d17[5]);
    assert.deepEqual(d17.slice(5, 7), [`\t- [>] Write the category blurbs [[2026-09-18#^${id}|9/18]] ^${id}`, "\t\t- Imogen sent the tone guide"], "the bullet stays under it");
    assert.ok(v.notes()[HOMEPAGE].endsWith(`^${first}\n- [>] Write the category blurbs [[2026-09-18#^${id}|9/18]] ^${id}\n`), "after the first, no second note");
    assert.equal(v.notes()[day("2026-09-18")].trim(), `- [ ] Write the category blurbs [[Kestrel Outfitters 2026|⭕]] [[Homepage build - category pages#^${id}|↗]] ^${id}`);

    // The task itself: forwarded, not moved, since its day [>] lines keep it on its day
    v.open(day("2026-09-17"), 3);
    await v.schedule("2026-09-18");
    assert.equal(v.notices.at(-1), "Forwarded to 9/18");
    d17 = lines(v, day("2026-09-17"));
    const task = idOf(d17[3]);
    assert.equal(d17[3], `- [>] Homepage build: category pages [[Kestrel Outfitters 2026|⭕]] [[Homepage build - category pages|⋯]] ^${task}`);
    assert.ok(d17[4].startsWith("\t- [>] Pick a hero image") && d17[5].startsWith("\t- [>] Write the category blurbs"));
    assert.deepEqual(lines(v, day("2026-09-18")).filter(Boolean), [
        `- [ ] Write the category blurbs [[Kestrel Outfitters 2026|⭕]] [[Homepage build - category pages#^${id}|↗]] ^${id}`,
        `- [ ] Homepage build: category pages [[Kestrel Outfitters 2026|⭕]] [[Homepage build - category pages|⋯]] ^${task}`,
    ]);
    assert.deepEqual(v.check(), []);

    // A project change on the task: its note moves, its lines and its subtasks' day lines take the ⭕; the day [>] lines carry none
    v.open(day("2026-09-18"), 1);
    await v.addProjectLink(CAT);
    const moved = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Fall Catalog/Homepage build - category pages.md";
    assert.ok(v.notes()[moved], "the note moved into Kestrel Fall Catalog");
    assert.ok(lines(v, day("2026-09-18")).filter(Boolean).every((l) => l.includes("[[Kestrel Fall Catalog|⭕]]")));
    assert.ok(lines(v, day("2026-09-19")).filter(Boolean).every((l) => l.includes("[[Kestrel Fall Catalog|⭕]]")));
    d17 = lines(v, day("2026-09-17"));
    assert.ok(d17[3].includes("[[Kestrel Fall Catalog|⭕]]"));
    assert.ok(!d17[4].includes("⭕") && !d17[5].includes("⭕"), "the day [>] lines carry no ⭕");
    assert.deepEqual(v.check(), []);

    // A deadline on the subtask: its three lines, not the task, and not the note's due
    v.open(day("2026-09-18"), 0);
    await v.dueDate("2026-09-25");
    assert.ok(lines(v, day("2026-09-18"))[0].includes("[[2026-09-25|🚩 9/25]]"));
    assert.ok(lines(v, day("2026-09-17"))[5].includes("[[2026-09-25|🚩 9/25]]"));
    assert.ok(v.notes()[moved].includes(`- [>] Write the category blurbs [[2026-09-25|🚩 9/25]]`));
    assert.ok(!lines(v, day("2026-09-17"))[3].includes("🚩"));
    assert.match(v.notes()[moved], /\ndue:\n/);
    assert.deepEqual(v.check(), []);
    assert.deepEqual(nestedMarks(v), [], "nothing listed for the day [>] lines: their IDs and 🚩 are their subtasks'");
});

scenario("into a task note that has one, after its first checklist; and back onto the same day, the ID is there twice (test plan 11, 19)", async ({ lag }) => {
    const v = standIn({ notes: NOTES, open: day("2026-09-17"), at: 8, lag });
    await v.schedule("2026-09-21");
    const id = idOf(lines(v, day("2026-09-17"))[8]);
    assert.ok(v.notes()[RENEW].endsWith(`- [ ] Put the new sticker on\n- [>] Find the insurance card [[2026-09-21#^${id}|9/21]] ^${id}\n`), v.notes()[RENEW]);
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Find the insurance card [[Household|🗃️]] [[Renew car registration#^${id}|↗]] ^${id}`);
    assert.deepEqual(Object.keys(v.notes()).filter((p) => !(p in NOTES)), [day("2026-09-21")], "no note made");
    assert.deepEqual(v.check(), []);
    // Back onto 9/17
    v.open(day("2026-09-21"), 0);
    await v.schedule("2026-09-17");
    const d17 = lines(v, day("2026-09-17"));
    assert.equal(d17[8], `\t- [>] Find the insurance card [[2026-09-17#^${id}|9/17]] ^${id}`);
    assert.equal(d17.filter((l) => l.endsWith(`^${id}`)).length, 2);
    assert.deepEqual(v.check().map((x) => x.rule), ["twice"]);
    // And on again from there: the day [>] line in the same note follows too (review)
    v.open(day("2026-09-17"), v.lineOf(day("2026-09-17"), "- [ ] Find the insurance card"));
    await v.schedule("2026-09-22");
    assert.equal(lines(v, day("2026-09-17"))[8], `\t- [>] Find the insurance card [[2026-09-22#^${id}|9/22]] ^${id}`);
    assert.ok(v.notes()[RENEW].includes(`- [>] Find the insurance card [[2026-09-22#^${id}|9/22]] ^${id}`));
    assert.deepEqual(v.check(), []);
});

scenario("a task nested under a task that isn't at the left edge isn't sent on its own: the task it's under moves, as before (review)", async ({ lag }) => {
    const D = day("2026-09-15");
    const v = standIn({ notes: { ...NOTES, [D]: "- Errands\n\t- [ ] Groceries\n\t\t- [ ] Milk\n" }, open: D, at: 2, lag });
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[D], "- Errands\n");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "- [ ] Groceries\n\t- [ ] Milk");
    assert.deepEqual(Object.keys(v.notes()).filter((p) => !(p in NOTES) && p !== D), [day("2026-09-18")], "no note made");
});

scenario("under an event, through its log, made with a Follow-ups section; a time entry under the event still refuses (test plan 12, 16)", async ({ lag }) => {
    const v = standIn({ notes: NOTES, open: day("2026-09-17"), at: 2, lag });
    await v.schedule("2026-09-21");
    const log = Object.keys(v.notes()).find((p) => p.endsWith("2026-09-17 Call with Rafe Oakes.md"));
    assert.ok(log?.startsWith("Projects/Freelance/Pinecrest Library Brochure/›logs/"), log);
    const d17 = lines(v, day("2026-09-17"));
    assert.equal(d17[0], "- [<] 1:00pm\tCall with Rafe Oakes [[Pinecrest Library Brochure|⭕]] [[2026-09-17 Call with Rafe Oakes|⋯]] ^e-ygtclj");
    const id = idOf(d17[2]);
    assert.equal(d17[2], `\t- [>] Confirm the print run with Rafe [[2026-09-21#^${id}|9/21]] ^${id}`);
    assert.ok(v.notes()[log].endsWith(`## Follow-ups\n\n- [>] Confirm the print run with Rafe [[2026-09-21#^${id}|9/21]] ^${id}\n`), v.notes()[log]);
    assert.equal(v.notes()[day("2026-09-21")].trim(), `- [ ] Confirm the print run with Rafe [[Pinecrest Library Brochure|⭕]] [[2026-09-17 Call with Rafe Oakes#^${id}|↗]] ^${id}`);
    assert.deepEqual(v.check(), []);
    const before = v.notes();
    v.open(day("2026-09-17"), 1);
    assert.equal(await v.schedule("2026-09-22"), null);
    assert.equal(v.notices.at(-1), "Events must be moved in your calendar app");
    assert.deepEqual(v.notes(), before);
});

scenario("from a project note, a task note and a weekly note, the line comes out and goes through its task's new note (test plan 13 to 15)", async ({ lag }) => {
    let v = standIn({ notes: NOTES, open: CAT, at: 7, lag });
    await v.schedule("2026-09-23");
    const shoot = "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Fall Catalog/Shoot day on the 24th.md";
    let id = idOf(lines(v, shoot).find((l) => l.includes("Book two store staff")));
    assert.equal(v.notes()[CAT], "---\ntags: [project]\n---\n## To Do\n\n- [x] Book the studio space\n- [ ] Shoot day on the 24th [[Shoot day on the 24th|⋯]]\n- [ ] Deliver edited selects\n");
    assert.ok(v.notes()[shoot].endsWith(`---\n- [>] Book two store staff to model the jackets [[2026-09-23#^${id}|9/23]] ^${id}\n`));
    assert.equal(v.notes()[day("2026-09-23")].trim(), `- [ ] Book two store staff to model the jackets [[Kestrel Fall Catalog|⭕]] [[Shoot day on the 24th#^${id}|↗]] ^${id}`);
    assert.equal(v.notices.at(-1), "Moved to 9/23, by way of Shoot day on the 24th");
    assert.deepEqual(v.check(), []);

    v = standIn({ notes: NOTES, open: WIRES, at: 8, lag });
    await v.schedule("2026-09-22");
    const pdfs = "Projects/Freelance/Kestrel Outfitters 2026/Export PDFs for the sign-off call.md";
    id = idOf(lines(v, pdfs).find((l) => l.includes("Check the mobile PDF")));
    assert.ok(v.notes()[WIRES].includes("- [ ] Export PDFs for the sign-off call [[Export PDFs for the sign-off call|⋯]]\n\n## Notes"), v.notes()[WIRES]);
    assert.equal(v.notes()[day("2026-09-22")].trim(), `- [ ] Check the mobile PDF on a phone [[Kestrel Outfitters 2026|⭕]] [[Export PDFs for the sign-off call#^${id}|↗]] ^${id}`);
    assert.deepEqual(v.check(), []);

    v = standIn({ notes: NOTES, open: W38, at: 2, lag });
    await v.schedule("2026-09-24");
    const list = "Inbox/Product list for the catalog shoot.md";
    id = idOf(lines(v, list).find((l) => l.includes("Ask Imogen")));
    assert.ok(v.notes()[W38].startsWith("- [x] Wireframes to Imogen before Friday's sign-off\n- [ ] Product list for the catalog shoot [[Product list for the catalog shoot|⋯]]\n- [ ] September invoices\n"), v.notes()[W38]);
    assert.equal(v.notes()[day("2026-09-24")].trim(), `- [ ] Ask Imogen which jackets are in [[Product list for the catalog shoot#^${id}|↗]] ^${id}`);
    assert.deepEqual(v.check(), []);
});

scenario("two deep, the whole task moves as before; time under a nested task stays on its day under the day [>] line (test plan 17, 18)", async ({ lag }) => {
    const D = day("2026-09-15");
    let v = standIn({ notes: { ...NOTES, [D]: "- [ ] Shoot prep [[Kestrel Outfitters 2026|⭕]]\n\t- [ ] Lights\n\t\t- [ ] Rent the stands\n" }, open: D, at: 2, lag });
    await v.schedule("2026-09-18");
    assert.equal(v.notes()[D].trim(), "");
    assert.equal(v.notes()[day("2026-09-18")].trim(), "- [ ] Shoot prep [[Kestrel Outfitters 2026|⭕]]\n\t- [ ] Lights\n\t\t- [ ] Rent the stands");
    v = standIn({ notes: { ...NOTES, [D]: "- [ ] Shoot prep [[Kestrel Outfitters 2026|⭕]]\n\t- [ ] Lights\n\t\t- 9:00am - 9:30am\n" }, open: D, at: 1, lag });
    await v.schedule("2026-09-18");
    const d15 = lines(v, D);
    const id = idOf(d15[1]);
    assert.deepEqual(d15.slice(1, 3), [`\t- [>] Lights [[2026-09-18#^${id}|9/18]] ^${id}`, "\t\t- 9:00am - 9:30am"]);
    assert.equal(v.notes()[day("2026-09-18")].trim(), `- [ ] Lights [[Kestrel Outfitters 2026|⭕]] [[Shoot prep#^${id}|↗]] ^${id}`);
    assert.deepEqual(v.check(), []);
});

scenario("a task whose note is one Schedule doesn't write in, and a name another note has, cancelled: nothing changes (test plan 20, 21)", async ({ lag }) => {
    const D = day("2026-09-15"), REF = "Reference/Shoot prep.md";
    let v = standIn({ notes: { ...NOTES, [REF]: "# Shoot prep\n", [D]: "- [ ] Shoot prep [[Kestrel Outfitters 2026|⭕]] [[Shoot prep|⋯]]\n\t- [ ] Lights\n" }, open: D, at: 1, lag });
    let before = v.notes();
    assert.equal(await v.schedule("2026-09-18"), null, "no date box");
    assert.match(v.notices.at(-1), /^This task's note Shoot prep is outside the Projects and Inbox folders/);
    assert.deepEqual(v.notes(), before);

    const OTHER = "Projects/Household/Shoot prep.md";
    v = standIn({ notes: { ...NOTES, [OTHER]: "---\ntags: [task]\n---\n", [D]: "- [ ] Shoot prep [[Kestrel Outfitters 2026|⭕]]\n\t- [ ] Lights\n" }, open: D, at: 1, lag });
    before = v.notes();
    v.answering(null, null);
    await v.schedule("2026-09-18");
    assert.equal(v.asked.length, 1, "Add note's question");
    assert.deepEqual(v.notes(), before);
});
