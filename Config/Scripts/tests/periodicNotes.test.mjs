// Tests for plugin/src/shared/periodicNotes.js and plugin/src/startup/finishPeriodicNotes.js (OBS-120): every
// daily, weekly, monthly and yearly note made in one place, and one made any other way finished. Run from the
// vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { standIn, src, PLANNER, NN, YAML } from "./standInVault.mjs";

const DAYS = `${PLANNER}/days`, WEEKS = `${PLANNER}/weeks`, MONTHS = `${PLANNER}/months`, YEARS = `${PLANNER}/years`;
const TPL = "Config/Templates";
// Notebook Navigator as the dev vault and the maintainer's vault have it: its calendar makes the notes, from
// its own templates, here the four periodic templates
const NAVIGATOR = {
    ...NN, calendarIntegrationMode: "notebook-navigator", calendarCustomFilePattern: "[days]/YYYY-MM-DD",
    calendarCustomFileTemplate: `${TPL}/Daily Note.md`, calendarCustomWeekTemplate: `${TPL}/Weekly Note.md`,
    calendarCustomMonthTemplate: `${TPL}/Monthly Note.md`, calendarCustomYearTemplate: `${TPL}/Yearly Note.md`,
};
const EMPTY_TEMPLATES = Object.fromEntries(["Daily Note", "Weekly Note", "Monthly Note", "Yearly Note"].map((n) => [`${TPL}/${n}.md`, ""]));

// The stand-in vault with aliases, and YAML read as Obsidian reads it, keys in order and lists of any key
const vault = (opts = {}) => {
    const v = standIn({ aliases: true, ...opts });
    v.globals.parseYaml = readYaml;
    return v;
};
const unquote = (x) => x.trim().replace(/^(["'])(.*)\1$/, "$2");
const readYaml = (yaml) => {
    const out = {};
    let key = null;
    for (const l of String(yaml).replace(/\r/g, "").split("\n")) {
        if (!l.trim()) continue;
        const item = l.match(/^\s*-\s+(.*)$/);
        if (item && key) { out[key] = [].concat(out[key] ?? [], unquote(item[1])); continue; }
        const kv = l.match(/^([^:\s][^:]*):\s*(.*)$/);
        if (!kv) throw new Error(`YAML: ${l}`);
        key = kv[1].trim();
        const val = kv[2].trim();
        out[key] = val === "" ? null : val.startsWith("[") ? val.slice(1, -1).split(",").map(unquote).filter(Boolean) : unquote(val);
    }
    return out;
};

// Templater on, as far as PeriodicNotes uses it: write_template_to_file runs `run(templateText, file)` for the
// template's output and combines it with the note as Templater 2.26 does (a list keeps both, each value once; a
// single value from the template replaces the note's), then lets the note go from its set of notes in progress
function templaterOn(v, run = (text) => text) {
    const pending = new Set(), written = [];
    const templater = {
        files_with_pending_templates: pending,
        async write_template_to_file(tpl, file) {
            pending.add(file.path);
            written.push(file.path);
            const out = run(await v.app.vault.read(tpl), file);
            await v.app.vault.process(file, (now) => {
                const a = parts(now), b = parts(out);
                const props = { ...(a.props ?? {}) };
                for (const [k, val] of Object.entries(b.props ?? {})) {
                    if (k in props && (Array.isArray(props[k]) || Array.isArray(val))) props[k] = [...new Set([].concat(props[k], val))];
                    else if (val !== "" && val !== null) props[k] = val;
                }
                const keys = Object.keys(props).filter((k) => !(k === "tags" && !props.tags.length));
                return `${keys.length ? `---\n${YAML.stringifyYaml(Object.fromEntries(keys.map((k) => [k, props[k]])))}---\n` : ""}${a.body}${b.body}`;
            });
            pending.delete(file.path);
        },
    };
    const plugin = { settings: { templates_folder: TPL }, templater };
    v.app.plugins.plugins["templater-obsidian"] = plugin;
    v.app.plugins.getPlugin = (id) => (id === "templater-obsidian" ? plugin : null);
    return { pending, written };
}
const parts = (text) => {
    const info = YAML.getFrontMatterInfo(text);
    return info.exists ? { props: readYaml(info.frontmatter), body: text.slice(info.contentStart) } : { props: null, body: text };
};

// ------------------------------------------------------------------ where, names and aliases

test("each kind of note: its folder, its name and its alias, from the settings", () => {
    const n = vault({ nn: NAVIGATOR }).plainday.PeriodicNotes;
    const at = (unit, date) => { const w = n.where(unit, date); return `${w.path} | ${n.alias(unit, date) ?? "none"}`; };
    assert.equal(at("day", "2026-09-20"), `${DAYS}/2026-09-20.md | 9/20/26 Sunday`);
    assert.equal(at("week", "2026-09-23"), `${WEEKS}/2026w39.md | Week of 9/20/26`, "the week a day is in, from its first day");
    assert.equal(at("month", "2026-10-17"), `${MONTHS}/2026-10.md | October 2026`);
    assert.equal(at("year", "2027-03-01"), `${YEARS}/2027.md | none`);
});

test("a vault whose daily notes are named DD-MM-YYYY, and ISO weeks starting on Monday", () => {
    const v = vault({ nn: { ...NAVIGATOR, calendarCustomFilePattern: "[days]/DD-MM-YYYY", calendarCustomWeekPattern: "[weeks]/GGGG-[W]WW" } });
    const n = v.plainday.PeriodicNotes;
    assert.equal(n.where("day", "2026-09-21").path, `${DAYS}/21-09-2026.md`);
    assert.equal(n.alias("day", "2026-09-21"), "9/21/26 Monday", "from the date, not read back from the name");
    assert.equal(n.where("week", "2026-09-20").path, `${WEEKS}/2026-W38.md`, "Sunday 9/20 ends ISO week 38");
    assert.equal(n.alias("week", "2026-09-20"), "Week of 9/14/26");
    assert.deepEqual({ ...n.periodOfName("21-09-2026") }, { unit: "day", date: "2026-09-21" });
    assert.deepEqual({ ...n.periodOfName("2026-W38") }, { unit: "week", date: "2026-09-14" });
    assert.equal(n.periodOfName("2026-09-21"), null, "a name in another format isn't one");
    assert.equal(n.periodOfName("2026-09-23 Kickoff call"), null, "a dated log isn't one");
});

// ------------------------------------------------------------------ the one function

test("ensure: a new note has its alias and nothing else; one there already comes back as it is", async () => {
    const v = vault({ nn: NAVIGATOR, notes: { ...EMPTY_TEMPLATES, [`${DAYS}/2026-09-16.md`]: "---\naliases: 9/16/26 Wednesday\n---\n- [ ] Call the printer\n" } });
    const n = v.plainday.PeriodicNotes;
    await n.ensure("day", "2026-09-21");
    await n.ensure("week", "2026-09-21");
    await n.ensure("month", "2026-10-01");
    await n.ensure("year", "2027-01-01");
    const notes = v.notes();
    assert.equal(notes[`${DAYS}/2026-09-21.md`], "---\naliases: 9/21/26 Monday\n---\n");
    assert.equal(notes[`${WEEKS}/2026w39.md`], "---\naliases: Week of 9/20/26\n---\n");
    assert.equal(notes[`${MONTHS}/2026-10.md`], "---\naliases: October 2026\n---\n");
    assert.equal(notes[`${YEARS}/2027.md`], "", "a yearly note has no alias");
    const before = notes[`${DAYS}/2026-09-16.md`];
    assert.equal((await n.ensure("day", "2026-09-16")).path, `${DAYS}/2026-09-16.md`);
    assert.equal(v.notes()[`${DAYS}/2026-09-16.md`], before);
    assert.deepEqual(v.notices, []);
});

test("ensure: two callers making the same day at once get one note", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const n = v.plainday.PeriodicNotes;
    const [a, b] = await Promise.all([n.ensure("day", "2026-09-22"), n.ensure("day", "2026-09-22")]);
    assert.equal(a, b);
    assert.equal(v.notes()[`${DAYS}/2026-09-22.md`], "---\naliases: 9/22/26 Tuesday\n---\n");
});

test("ensure, Templater on: the template's properties are combined with the alias, its text below them", async () => {
    const tpl = "---\ntags: [weekly]\naliases: [This week]\n---\n## Goals\n";
    const v = vault({ nn: NAVIGATOR, notes: { ...EMPTY_TEMPLATES, [`${TPL}/Weekly Note.md`]: tpl } });
    const { written, pending } = templaterOn(v);
    await v.plainday.PeriodicNotes.ensure("week", "2026-10-11");
    assert.deepEqual(written, [`${WEEKS}/2026w42.md`]);
    assert.equal(v.notes()[`${WEEKS}/2026w42.md`], "---\naliases:\n  - Week of 10/11/26\n  - This week\ntags:\n  - weekly\n---\n## Goals\n");
    assert.ok(pending.has(`${WEEKS}/2026w42.md`), "held from Templater's trigger after the template ran");
});

test("ensure, Templater on: a template whose alias is a single value replaces Plainday's, and Plainday's comes back", async () => {
    const v = vault({ nn: NAVIGATOR, notes: { ...EMPTY_TEMPLATES, [`${TPL}/Monthly Note.md`]: "---\naliases: The month\n---\n" } });
    templaterOn(v);
    await v.plainday.PeriodicNotes.ensure("month", "2026-11-01");
    assert.deepEqual(parts(v.notes()[`${MONTHS}/2026-11.md`]).props.aliases, ["The month", "November 2026"]);
});

test("ensure, Templater on: an empty template isn't run", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const { written } = templaterOn(v);
    await v.plainday.PeriodicNotes.ensure("day", "2026-09-24");
    assert.deepEqual(written, []);
    assert.equal(v.notes()[`${DAYS}/2026-09-24.md`], "---\naliases: 9/24/26 Thursday\n---\n");
});

test("ensure, Templater off: {{title}} and {{date}} filled in, properties combined, in one write", async () => {
    const tpl = "---\ntags: [weekly]\n---\n# {{title}}\nYear {{date:YYYY}}, from {{date}}\n";
    const v = vault({ nn: NAVIGATOR, notes: { ...EMPTY_TEMPLATES, [`${TPL}/Weekly Note.md`]: tpl } });
    await v.plainday.PeriodicNotes.ensure("week", "2026-10-18");
    assert.equal(v.notes()[`${WEEKS}/2026w43.md`], "---\naliases: Week of 10/18/26\ntags:\n  - weekly\n---\n# 2026w43\nYear 2026, from 2026-10-18\n");
});

test("ensure, Templater off: a template holding Templater code isn't used, and a notice says so", async () => {
    const v = vault({ nn: NAVIGATOR, notes: { ...EMPTY_TEMPLATES, [`${TPL}/Weekly Note.md`]: "<% tp.date.now() %>\n" } });
    await v.plainday.PeriodicNotes.ensure("week", "2026-10-25");
    assert.equal(v.notes()[`${WEEKS}/2026w44.md`], "---\naliases: Week of 10/25/26\n---\n");
    assert.deepEqual(v.notices, ["Weekly Note holds Templater code and Templater is off, so the new weekly note was made without it."]);
});

test("ensure: a template that moves its note leaves it there, and a notice says the setting and the template disagree", async () => {
    const v = vault({ nn: NAVIGATOR, notes: { ...EMPTY_TEMPLATES, [`${TPL}/Weekly Note.md`]: "<%* await tp.file.move('/Elsewhere/' + tp.file.title) %>" } });
    templaterOn(v, () => "");
    const write = v.app.plugins.plugins["templater-obsidian"].templater.write_template_to_file;
    v.app.plugins.plugins["templater-obsidian"].templater.write_template_to_file = async (tpl, file) => {
        await write(tpl, file);
        await v.app.fileManager.renameFile(file, `Elsewhere/${file.name}`);
    };
    const file = await v.plainday.PeriodicNotes.ensure("week", "2026-11-01");
    assert.equal(file.path, "Elsewhere/2026w45.md");
    assert.deepEqual(v.notices, ["The weekly note's template moved it to Elsewhere, but Notebook Navigator's pattern puts it in Reference/Planner/weeks. Make them agree, or Plainday won't find it next time."]);
});

test("ensure: Templater's trigger is kept off a note from before it's made", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const { pending } = templaterOn(v);
    const seen = [];
    const create = v.app.vault.create;
    v.app.vault.create = async (p, text) => { seen.push(pending.has(p)); return create(p, text); };
    await v.plainday.PeriodicNotes.ensure("year", "2028-01-01");
    assert.deepEqual(seen, [true]);
});

// ------------------------------------------------------------------ every creator through it

test("every creator makes its note through the one function: Plan, Jump to date, Schedule, the sync and the time report", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const p = v.plainday;
    const calls = [];
    const ensure = p.PeriodicNotes.ensure.bind(p.PeriodicNotes);
    p.PeriodicNotes.ensure = (unit, date, o) => { calls.push(`${unit} ${date}`); return ensure(unit, date, o); };
    const m = v.globals.moment("2026-09-25", "YYYY-MM-DD", true);
    await p.Plan.ensureDailyNote(m);
    const rules = p.DatePrompt.weekRules();
    await p.JumpToDate.create(p.JumpToDate.target(p.DatePrompt.result("2026-10-01", "month"), rules));
    await p.Schedule.ensureDailyNote(`${DAYS}/2026-09-26.md`);
    await p.CalendarSync.createDaily("2026-09-27");
    const made = await p.TimeReport.createPeriodNote(`${WEEKS}/2026w37.md`, "week", "2026w37", "%% time:start %%\nblock\n%% time:end %%");
    assert.deepEqual(calls, ["day 2026-09-25", "month 2026-10-01", "day 2026-09-26", "day 2026-09-27", "week 2026-09-06"]);
    assert.equal(v.notes()[`${DAYS}/2026-09-26.md`], "---\naliases: 9/26/26 Saturday\n---\n", "Schedule's day holds no template code");
    assert.equal(made.file.path, `${WEEKS}/2026w37.md`);
    assert.equal(v.notes()[`${WEEKS}/2026w37.md`], "---\naliases: Week of 9/6/26\n---\n\n## Time Report\n\n%% time:start %%\nblock\n%% time:end %%\n", "the report below the alias, as before");
});

test("Jump to date keeps CalNav's calls: target() and create() take and give what they did (RAY-68)", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const p = v.plainday;
    const t = p.JumpToDate.target(p.DatePrompt.result("2026-09-16", "week"), p.DatePrompt.weekRules());
    assert.deepEqual({ path: t.path, name: t.name, kind: t.kind, when: t.when }, { path: `${WEEKS}/2026w38.md`, name: "2026w38", kind: "weekly", when: "the week starting 9/13/26" });
    assert.equal((await p.JumpToDate.create(t)).path, t.path);
});

// ------------------------------------------------------------------ finishing a note made another way

const finisher = (v) => {
    v.plainday.plugin = {};
    const F = vm.runInContext(`${src("finishPeriodicNotes")}\n;FinishPeriodicNotes`, v.globals);
    F.sleep = async () => {};
    return new F();
};
// A note as another plugin or Obsidian makes it: its text, made `ago` ms before now
const madeBy = (v, path, text, ago = 50) => {
    v.app.vault.create(path, text);
    const file = v.app.vault.getFileByPath(path);
    file.stat = { ctime: Date.now() - ago, size: text.length };
    return file;
};

test("finish: a note Navigator makes in its folder from a template with content gets its alias, and keeps the content", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const file = madeBy(v, `${DAYS}/2026-09-27.md`, "## Notes\n");
    assert.equal(await finisher(v).onCreate(file), "finished");
    assert.equal(v.notes()[`${DAYS}/2026-09-27.md`], "---\naliases: 9/27/26 Sunday\n---\n## Notes\n");
});

test("finish: one with properties of its own gets the alias added to them", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const file = madeBy(v, `${DAYS}/2026-09-28.md`, "---\ntags: [daily]\n---\nMonday\n");
    await finisher(v).onCreate(file);
    assert.equal(v.notes()[`${DAYS}/2026-09-28.md`], "---\naliases: 9/28/26 Monday\ntags: [daily]\n---\nMonday\n");
});

test("finish: an empty note made elsewhere (a click on a link to a missing day) is filed in its folder, with its alias", async () => {
    const v = vault({ nn: NAVIGATOR, notes: { ...EMPTY_TEMPLATES, "Inbox/Note.md": "[[2026-09-13]]\n" } });
    const file = madeBy(v, "2026-09-13.md", "");
    await finisher(v).onCreate(file);
    assert.equal(v.notes()["2026-09-13.md"], undefined);
    assert.equal(v.notes()[`${DAYS}/2026-09-13.md`], "---\naliases: 9/13/26 Sunday\n---\n");
    assert.equal(v.notes()["Inbox/Note.md"], "[[2026-09-13]]\n", "the link still finds it");
});

test("finish: a new note titled like a week, in the Inbox, is filed in the weeks folder", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    await finisher(v).onCreate(madeBy(v, "Inbox/2026w41.md", ""));
    assert.equal(v.notes()[`${WEEKS}/2026w41.md`], "---\naliases: Week of 10/4/26\n---\n");
});

test("finish: an empty note made elsewhere gets that kind of note's template too", async () => {
    const v = vault({ nn: NAVIGATOR, notes: { ...EMPTY_TEMPLATES, [`${TPL}/Yearly Note.md`]: "## Goals\n" } });
    await finisher(v).onCreate(madeBy(v, "Projects/2028.md", ""));
    assert.equal(v.notes()[`${YEARS}/2028.md`], "## Goals\n");
});

test("finish: one whose folder has a note of that name already stays where it was made, as it was", async () => {
    const v = vault({ nn: NAVIGATOR, notes: { ...EMPTY_TEMPLATES, [`${YEARS}/2026.md`]: "## The year\n" } });
    assert.equal(await finisher(v).onCreate(madeBy(v, "Projects/2026.md", "")), "left");
    assert.equal(v.notes()["Projects/2026.md"], "");
    assert.equal(v.notes()[`${YEARS}/2026.md`], "## The year\n");
});

test("finish: a note with text made outside its folder isn't moved", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    assert.equal(await finisher(v).onCreate(madeBy(v, "Projects/2026-10.md", "Budget\n")), "left");
    assert.equal(v.notes()["Projects/2026-10.md"], "Budget\n");
});

test("finish: a note that arrives with an old creation time (Sync), and one not named like a periodic note, are left alone", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const f = finisher(v);
    assert.equal(f.onCreate(madeBy(v, `${DAYS}/2026-09-29.md`, "", 3 * 864e5)), null);
    assert.equal(f.onCreate(madeBy(v, "Inbox/2026-09-23 Kickoff call.md", "")), null);
    assert.equal(f.onCreate(madeBy(v, "Inbox/Untitled.md", "")), null);
    assert.equal(v.notes()[`${DAYS}/2026-09-29.md`], "");
});

test("finish: a note Plainday is making is left to it, and one still holding Templater code is left as it is", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const n = v.plainday.PeriodicNotes, f = finisher(v);
    n.making.set(`${DAYS}/2026-09-30.md`, Promise.resolve(null));
    assert.equal(f.onCreate(madeBy(v, `${DAYS}/2026-09-30.md`, "")), null);
    assert.equal(await f.onCreate(madeBy(v, `${DAYS}/2026-10-01.md`, "<% tp.date.now() %>\n")), "left");
    assert.equal(v.notes()[`${DAYS}/2026-10-01.md`], "<% tp.date.now() %>\n");
});

test("finish: a note open in the editor gets its alias through the editor, so what you typed stays below it", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const file = madeBy(v, `${DAYS}/2026-09-24.md`, "");
    v.open(`${DAYS}/2026-09-24.md`, 0, 0);
    const editor = v.app.workspace.activeLeaf.view.editor;
    editor.replaceRange("Typed first", { line: 0, ch: 0 });
    await finisher(v).onCreate(file);
    assert.equal(editor.getValue(), "---\naliases: 9/24/26 Thursday\n---\nTyped first");
});

test("finish: Templater's trigger is kept off an empty note a moment after it appears, unless Templater is writing it itself", async () => {
    const v = vault({ nn: NAVIGATOR, notes: EMPTY_TEMPLATES });
    const { pending } = templaterOn(v);
    const timers = [];
    v.globals.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    const f = finisher(v);
    f.onCreate(madeBy(v, "Inbox/2026-10-02.md", ""));
    const hold = timers.find((t) => t.ms < 300);
    assert.ok(hold, "before the trigger's 300 ms look");
    hold.fn();
    assert.ok(pending.has("Inbox/2026-10-02.md"));
    // A note Templater makes from a template (Navigator's calendar with Templater code) is Templater's own
    const own = madeBy(v, `${DAYS}/2026-10-03.md`, "");
    pending.add(own.path);
    timers.length = 0;
    f.onCreate(own);
    timers.find((t) => t.ms < 300).fn();
    assert.ok(v.plainday.PeriodicNotes.templaterBusy(own.path), "so finishing waits for it");
});
