// Tests for plugin/src/shared/datePrompt.js and jumpToDate.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The reader's answers come from datePrompt.revived.json, recorded from Natural Language Dates
// (Revived) itself with a fixed clock (recordedReader.mjs). Plainday's own reader gives the same
// answers but for the phrases plugin/test/dateWords.test.mjs names, which reads with the real one, so
// these check the date box against what a reader really says.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { classScript } from "../../../plugin/classShape.mjs";
import { RECORD as FIX, recordedReader } from "./recordedReader.mjs";

const SUN = "2026-09-27", MON = "2026-09-21", SAT = "2026-09-26";

// Enough of moment for DatePrompt: moment() is `today`, and moment("YYYY-MM-DD", "YYYY-MM-DD", true)
const momentOn = (today) => (date = today) => ({ date, isValid: () => true, format: (f) => { assert.equal(f, "YYYY-MM-DD"); return date; } });

const load = (ctx = {}, today = SUN) => {
    const context = vm.createContext({ moment: momentOn(today), Notice: class { constructor(m) { (ctx.notices ??= []).push(m); } }, console: { error() {} }, ...ctx });
    const DatePrompt = vm.runInContext(classScript("datePrompt.js") + "\n;DatePrompt", context);
    return { DatePrompt, dp: new DatePrompt(), context };
};
const { dp } = load();
const TimeReport = vm.runInContext(classScript("timeReport.js") + "\n;TimeReport", vm.createContext({}));
const tr = new TimeReport();

// A reader with Revived's recorded answers on `day`; a phrase the record doesn't have fails the test
const missing = [];
const revived = (day) => recordedReader(day, missing);
const got = (r) => r && `${r.unit} ${r.date}${r.readAs ? ` (read as "${r.readAs}")` : ""}`;
const at = (day, text, opts = {}) => got(dp.readWith(revived(day), text, { today: day, ...opts }));
const jump = (day, text, opts = {}) => at(day, text, { periods: true, nearest: true, ...opts });

test("a bare weekday is the coming one, today included (OBS-58)", () => {
    assert.equal(at(SUN, "friday"), "day 2026-10-02");
    assert.equal(at(SUN, "monday"), "day 2026-09-28");
    assert.equal(at(SUN, "sunday"), "day 2026-09-27", "today's own weekday is today");
    assert.equal(at(MON, "monday"), "day 2026-09-21");
    assert.equal(at(MON, "friday"), "day 2026-09-25");
    assert.equal(at(SAT, "friday"), "day 2026-10-02");
    assert.equal(at(SUN, "today"), "day 2026-09-27");
    assert.equal(at(SUN, "today at 5pm"), "day 2026-09-27");
    assert.equal(at(SUN, "tomorrow"), "day 2026-09-28");
    assert.equal(at(SUN, "in 3 days"), "day 2026-09-30");
    assert.equal(at(SUN, "in 2 weeks and 3 days"), "day 2026-10-14", "Revived reads it all itself");
    assert.equal(at(SUN, "10/2"), "day 2026-10-02");
    assert.equal(at(SUN, "next friday"), "day 2026-10-09", "Revived's weeks start Sunday: next week's Friday");
});

test("words a reader doesn't know aren't read as today (it answers with right now)", () => {
    for (const day of [SUN, MON, SAT]) {
        for (const typo of ["fridya", "tomorow", "asdf", "tomorow at 5pm"]) {
            assert.equal(FIX.days[day][typo].parseDate, day, `the fixture shows Revived answering today for ${typo}`);
            assert.equal(at(day, typo), null, `${day} ${typo}`);
            assert.equal(jump(day, typo), null, `${day} ${typo}, jumping`);
        }
    }
});

test("when only some of the words were read, the result says which", () => {
    assert.equal(at(SUN, "mid october"), `day 2026-10-01 (read as "october")`);
    assert.equal(dp.describe(dp.readWith(revived(SUN), "mid october", { today: SUN }), SUN), `Thu 10/1 · in 4 days · read as "october"`);
    assert.equal(at(SUN, "tomorow at 5pm"), null, "read as \"at 5pm\", which is today: refused");
});

test("for Schedule and Due, a period is a day: the first of next or last week, today for this week", () => {
    assert.equal(at(SUN, "next week"), "day 2026-10-04", "Sunday-start weeks: next Sunday, not Revived's Monday (tomorrow)");
    assert.equal(at(SUN, "next week", { weekStart: 1 }), "day 2026-09-28", "Monday-start weeks: tomorrow is next week");
    assert.equal(at(MON, "next week"), "day 2026-09-27");
    assert.equal(at(SUN, "last week"), "day 2026-09-20");
    assert.equal(at(SUN, "this week"), "day 2026-09-27");
    assert.equal(at(SUN, "next month"), "day 2026-10-01");
    assert.equal(at(SUN, "this month"), "day 2026-09-01");
    assert.equal(at(SUN, "next year"), "day 2027-01-01");
    assert.equal(at(SUN, "Q3"), "day 2026-07-01");
    assert.equal(at(SUN, "next quarter"), "day 2026-10-01");
    assert.equal(at(SUN, "2026-W40"), "day 2026-09-27", "a week named with its year: the first day of the vault week holding its Monday");
});

test("jumping: weeks, months and years are themselves, and a week is the one 7 days on, however weeks start", () => {
    // On a Sunday, Revived's "next week" starts tomorrow: inside this week's note when weeks start on
    // Sunday. A day 7 days on is in next week whichever day weeks start on.
    assert.equal(jump(SUN, "next week"), "week 2026-10-04");
    assert.equal(jump(SUN, "last week"), "week 2026-09-20");
    assert.equal(jump(SUN, "this week"), "week 2026-09-27");
    assert.equal(jump(MON, "next week"), "week 2026-09-28");
    assert.equal(jump(MON, "last week"), "week 2026-09-14");
    assert.equal(jump(SAT, "next week"), "week 2026-10-03");
    assert.equal(tr.weekKey("2026-10-04"), "2026w41");
    assert.equal(tr.weekKey("2026-09-27"), "2026w40");
    assert.equal(tr.weekKey("2026-10-03"), "2026w40", "from Saturday 9/26, next week is the one starting 9/27");
    assert.equal(dp.describe(dp.result("2026-10-04", "week"), SUN, 0), "Week starting 10/4");
    assert.equal(dp.describe(dp.result("2026-10-04", "week"), SUN, 1), "Week starting 9/28", "Monday-start weeks: 9/28 to 10/4");
    assert.equal(jump(SUN, "2026-W40"), "week 2026-09-28", "a week named with its year is taken as written, on any day");
    assert.equal(tr.weekKey("2026-09-28"), "2026w40");
    assert.equal(jump(SUN, "next month"), "month 2026-10-01");
    assert.equal(jump(SUN, "last month"), "month 2026-08-01");
    assert.equal(jump(SUN, "this month"), "month 2026-09-01");
    assert.equal(jump(SUN, "next year"), "year 2027-01-01");
    assert.equal(jump(SUN, "Q3"), "day 2026-07-01", "no quarterly notes: its first day");
    assert.equal(jump(SUN, "friday"), "day 2026-10-02");
});

test("jumping: a periodic note's own name is read first, and never reaches the plugin", () => {
    const names = { "2026w41": { date: "2026-10-04", unit: "week" }, "2026-10": { date: "2026-10-01", unit: "month" } };
    const name = (t) => names[t] ?? null;
    const before = missing.length;
    assert.equal(jump(SUN, "2026w41", { name }), "week 2026-10-04");
    assert.equal(jump(SUN, "2026-10", { name }), "month 2026-10-01");
    assert.equal(missing.length, before);
    assert.equal(jump(SUN, "next month", { name }), "month 2026-10-01", "anything else still goes to the plugin");
    assert.deepEqual(missing, [], "every phrase is in the fixture");
});

test("nothing typed, or no reader, reads as nothing", () => {
    assert.equal(dp.readWith(revived(SUN), "", { today: SUN }), null);
    assert.equal(dp.readWith(revived(SUN), "   ", { today: SUN }), null);
    assert.equal(dp.readWith(null, "friday", { today: SUN }), null);
});

test("Revived is asked only when it's on; the original Natural Language Dates never is", () => {
    const withPlugins = (on) => load({ app: { plugins: { getPlugin: (id) => on[id] ?? null } } }).dp;
    const rev = { parseDate() {} }, orig = { parseDate() {} };
    assert.equal(withPlugins({ "nldates-revived": rev, "nldates-obsidian": orig }).revived(), rev);
    assert.equal(withPlugins({ "nldates-obsidian": orig }).revived(), null, "the original reads a bare weekday as last week's");
    assert.equal(withPlugins({ "nldates-revived": {} }).revived(), null, "no parseDate, no use");
    assert.equal(withPlugins({}).revived(), null);
});

// Plainday's own reader, and Revived when it's on, each with the recorded answers, saying which
// phrases reached it. `own` (a set) is what Plainday's reader knows; every other phrase reads as
// nothing there, the way a word in another language does.
const twoReaders = ({ own, revivedOn = true, day = SUN }) => {
    const asked = { own: [], revived: [] };
    const reader = (who, knows) => {
        const r = revived(day);
        const only = (t) => (knows(t) ? t : "asdf");
        return {
            settings: r.settings,
            parseDate: (t) => { asked[who].push(t); return r.parseDate(only(t)); },
            parser: {
                getParsedPeriod: (t) => r.parser.getParsedPeriod(only(t)),
                getParsedDateResult: (t, now, opts) => r.parser.getParsedDateResult(only(t), now, opts),
                getParsedResult: (t) => r.parser.getParsedResult(only(t)),
            },
        };
    };
    const plainday = { DateWords: { at: () => reader("own", (t) => own.has(t)) } };
    const rev = reader("revived", () => true);
    const { dp: box } = load({ plainday, app: { plugins: { getPlugin: (id) => (revivedOn && id === "nldates-revived" ? rev : null) } } });
    return { asked, read: (t, opts = {}) => got(box.read(t, { today: day, ...opts })) };
};

test("the date box reads with Plainday's reader first, and Revived reads only what it can't (OBS-139)", () => {
    // Revived's record stands in for a French word Plainday's reader can't read: "friday" for it
    const english = new Set(["next week", "tomorrow", "10/2"]);
    const r = twoReaders({ own: english });
    assert.equal(r.read("tomorrow"), "day 2026-09-28");
    assert.equal(r.read("next week", { periods: true }), "week 2026-10-04");
    assert.deepEqual(r.asked.revived, [], "an English word never reaches Revived");
    assert.equal(r.read("friday"), "day 2026-10-02", "a word Plainday can't read goes to Revived when it's on");
    assert.deepEqual(r.asked.revived, ["friday"]);
    assert.equal(r.read("fridya"), null, "with Revived on, a typo is still not a date");
    assert.equal(r.read("week of friday", { periods: true }), "week 2026-10-02", "\"week of\" a word only Revived reads");

    const off = twoReaders({ own: english, revivedOn: false });
    assert.equal(off.read("friday"), null, "Revived off: not a date");
    assert.equal(off.read("tomorrow"), "day 2026-09-28", "and English reads the same without it");
});

test("a reading Plainday's reader makes in part stays its own, not Revived's", () => {
    const r = twoReaders({ own: new Set(["mid october"]) });
    assert.equal(r.read("mid october"), `day 2026-10-01 (read as "october")`);
    assert.deepEqual(r.asked.revived, []);
});

test("the preview line, and the same date spelled out", () => {
    const r = (date, unit) => ({ date, unit });
    assert.equal(dp.describe(r("2026-09-27", "day"), SUN), "Sun 9/27 · today");
    assert.equal(dp.describe(r("2026-09-28", "day"), SUN), "Mon 9/28 · tomorrow");
    assert.equal(dp.describe(r("2026-09-26", "day"), SUN), "Sat 9/26 · yesterday");
    assert.equal(dp.describe(r("2026-10-09", "day"), SUN), "Fri 10/9 · in 12 days");
    assert.equal(dp.describe(r("2026-09-18", "day"), SUN), "Fri 9/18 · 9 days ago");
    assert.equal(dp.describe(r("2027-01-01", "day"), SUN), "Fri 1/1/27 · in 96 days");
    assert.equal(dp.describe(r("2026-10-04", "week"), SUN), "Week starting 10/4");
    assert.equal(dp.describe(r("2026-10-07", "week"), SUN), "Week starting 10/4");
    assert.equal(dp.describe(r("2027-01-02", "week"), SUN), "Week starting 12/27", "the year goes by the week's first day");
    assert.equal(dp.describe(r("2027-01-03", "week"), SUN), "Week starting 1/3/27");
    assert.equal(dp.describe(r("2026-10-01", "month"), SUN), "October 2026");
    assert.equal(dp.describe(r("2027-01-01", "year"), SUN), "2027");
    assert.equal(dp.describe(null, SUN), "");
    assert.equal(dp.spell(r("2026-10-02", "day")), "Friday, October 2, 2026");
    assert.equal(dp.spell(r("2026-10-07", "week")), "the week starting 10/4/26");
    assert.equal(dp.spell(r("2026-10-07", "week"), 1), "the week starting 10/5/26");
    assert.equal(dp.spell(r("2026-10-01", "month")), "October 2026");
    assert.equal(dp.spell(r("2027-01-01", "year")), "2027");
});

// ---------------------------------------------------------------- the prompt itself

// The prompt, reading with the recorded answers as Plainday's own reader, and `plugin` as Revived
const harness = (plugin = null) => {
    const frames = [], picks = [], notices = [];
    const el = () => {
        const e = { style: {}, text: "", listeners: {}, children: [] };
        e.setText = (t) => { e.text = t; };
        e.createDiv = () => { const c = el(); e.children.push(c); return c; };
        e.addEventListener = (type, fn) => { e.listeners[type] = fn; };
        e.focus = () => {};
        e.select = () => {};
        return e;
    };
    let input;
    class Modal {
        constructor() { this.titleEl = el(); this.contentEl = el(); this.closed = false; }
        open() { this.onOpen?.(); }
        close() { this.closed = true; }
    }
    class TextComponent {
        constructor() { this.inputEl = el(); this.value = ""; input = this; }
        getValue() { return this.value; }
        onChange(fn) { this.change = fn; }
    }
    const moment = momentOn(SUN);
    moment.locale = () => "en";
    moment.locales = () => ["en"];
    moment.localeData = () => ({ firstDayOfWeek: () => 0 });
    const { dp } = load({
        notices,
        moment,
        plainday: { DateWords: { at: () => revived(SUN) } },
        app: { plugins: { getPlugin: (id) => (id === "nldates-revived" ? plugin : null), plugins: {} } },
        requestAnimationFrame: (fn) => frames.push(fn),
        Modal, TextComponent,
    });
    const type = (text) => { input.value = text; input.change(); };
    const enter = (extra = {}) => input.inputEl.listeners.keydown({ key: "Enter", preventDefault() {}, ...extra });
    return { dp, frames, picks, notices, type, enter, onPick: (r, modal) => { picks.push(r.date); modal.close(); } };
};

test("prompt: the preview follows the typing, and Enter on a word it can't read picks nothing", () => {
    const h = harness();
    const modal = h.dp.open("Due date", h.onPick);
    const preview = modal.contentEl.children[0];
    h.type("fridya");
    assert.equal(preview.text, "Not a date I can read");
    h.enter();
    assert.deepEqual(h.picks, []);
    assert.deepEqual(h.notices, ["Couldn't read that date"]);
    h.type("");
    assert.equal(preview.text, "");
    h.type("next week");
    assert.equal(preview.text, "Sun 10/4 · in 7 days", "the week's first day, by the vault's weeks");
    h.type("friday");
    assert.equal(preview.text, "Fri 10/2 · in 5 days");
    h.enter();
    h.enter({ metaKey: true });
    assert.deepEqual(h.picks, ["2026-10-02"], "one pick, however many Enters");
    assert.equal(modal.closed, true);
});

test("prompt: a pick that fails can be tried again", async () => {
    const h = harness();
    let tries = 0;
    h.dp.open("Schedule for", () => { tries++; if (tries === 1) throw new Error("boom"); });
    h.type("friday");
    h.enter();
    h.enter();
    assert.equal(tries, 2);
    assert.deepEqual(h.notices, ["Schedule for failed — check console"]);
    let later = 0;
    const h2 = harness();
    h2.dp.open("Schedule for", async () => { later++; if (later === 1) throw new Error("async boom"); });
    h2.type("friday");
    h2.enter();
    await new Promise((r) => setTimeout(r, 0));
    h2.enter();
    assert.equal(later, 2);
});

test("prompt: without Natural Language Dates, it opens and reads all the same, and asks for nothing (OBS-139)", () => {
    const h = harness(null);
    const modal = h.dp.open("Schedule for", h.onPick);
    assert.ok(modal);
    h.type("friday");
    assert.equal(modal.contentEl.children[0].text, "Fri 10/2 · in 5 days");
    h.enter();
    assert.deepEqual(h.picks, ["2026-10-02"]);
    assert.deepEqual(h.notices, []);
});

// ---------------------------------------------------------------- week rules and JumpToDate

// moment for the week rules and JumpToDate: locales, their first day of the week, and formatting
// that shows what it was asked for ("2026-10-04|en|gggg[w]ww")
const jumpMoment = (current, locales) => {
    const make = (date, locale = current) => ({
        locale: (l) => make(date, l),
        format: (f) => (f === "YYYY-MM-DD" ? date : `${date}|${locale}|${f}`),
        isValid: () => true,
    });
    const m = (date = SUN) => make(date);
    m.locale = () => current;
    m.locales = () => Object.keys(locales);
    m.localeData = (l) => ({ firstDayOfWeek: () => locales[l] });
    return m;
};
const PLANNER = "Reference/Planner";
const loadJump = ({ nn, language = "en", current = "en" } = {}) => {
    const moment = jumpMoment(current, { en: 0, "en-gb": 1, "en-au": 1, de: 1, fr: 1 });
    const plainday = {
        Schedule: { dailyNotePath: (m) => `${PLANNER}/days/${m.format("YYYY-MM-DD")}.md` },
        TimeReport: { periodFolders: () => ({ week: `${PLANNER}/weeks`, month: `${PLANNER}/months`, year: `${PLANNER}/years` }) },
    };
    const ctx = vm.createContext({ moment, getLanguage: () => language, app: { plugins: { plugins: nn ? { "notebook-navigator": { settings: nn } } : {} } }, plainday });
    plainday.DatePrompt = new (vm.runInContext(classScript("datePrompt.js") + "\n;DatePrompt", ctx))();
    const JumpToDate = vm.runInContext(classScript("jumpToDate.js") + "\n;JumpToDate", ctx);
    plainday.JumpToDate = new JumpToDate();
    plainday.PeriodicNotes = new (vm.runInContext(classScript("periodicNotes.js") + "\n;PeriodicNotes", ctx))();
    return { j: plainday.JumpToDate, dp: plainday.DatePrompt };
};
const NN_PATTERNS = { calendarCustomWeekPattern: "[weeks]/gggg[w]ww", calendarCustomMonthPattern: "[months]/YYYY-MM", calendarCustomYearPattern: "[years]/YYYY" };

test("week rules follow the user's settings, as Notebook Navigator reads them", () => {
    const rules = (opts) => { const r = loadJump(opts).dp.weekRules(); return `${r.locale} ${r.weekStart} ${r.format.week} ${r.format.month} ${r.format.year}`; };
    // This vault: calendar Locale "System default", which is Obsidian's language, English
    assert.equal(rules({ nn: { ...NN_PATTERNS, calendarLocale: "system-default", calendarPeriodicNotesLocaleSource: "calendar" } }), "en 0 gggg[w]ww YYYY-MM YYYY");
    assert.equal(rules({ nn: { ...NN_PATTERNS, calendarLocale: "system-default" }, language: "de" }), "de 1 gggg[w]ww YYYY-MM YYYY", "System default is Obsidian's language");
    assert.equal(rules({ nn: { calendarLocale: "en-GB" } }), "en-gb 1 gggg[w]ww YYYY-MM YYYY", "a chosen Locale, matched like Notebook Navigator does");
    assert.equal(rules({ nn: { calendarLocale: "en_AU" } }), "en-au 1 gggg[w]ww YYYY-MM YYYY");
    assert.equal(rules({ nn: { calendarLocale: "fr-CA" } }), "fr 1 gggg[w]ww YYYY-MM YYYY", "falls back to the language");
    assert.equal(rules({ nn: { calendarLocale: "en-gb", calendarPeriodicNotesLocaleSource: "obsidian" }, current: "en" }), "en 0 gggg[w]ww YYYY-MM YYYY", "periodic notes locale set to follow Obsidian");
    assert.equal(rules({ nn: { calendarLocale: "xx" } }), "en 0 gggg[w]ww YYYY-MM YYYY", "an unknown locale: Obsidian's");
    assert.equal(rules({}), "en 0 gggg[w]ww YYYY-MM YYYY", "no Notebook Navigator: Obsidian's language and this vault's names");
    assert.equal(rules({ nn: { calendarCustomWeekPattern: "gggg-[W]ww", calendarCustomMonthPattern: "[m]/YYYY/MM" } }), "en 0 gggg-[W]ww MM YYYY", "a pattern's file part");
});

test("JumpToDate: where each kind of date's note is, named in the user's locale", () => {
    const { j, dp } = loadJump({ nn: { ...NN_PATTERNS, calendarLocale: "en-gb" } });
    const rules = dp.weekRules();
    const t = (date, unit) => { const x = j.target(dp.result(date, unit), rules); return `${x.path} | ${x.kind} | ${x.when}`; };
    assert.equal(t("2026-10-02", "day"), `${PLANNER}/days/2026-10-02.md | daily | Friday, October 2, 2026`);
    assert.equal(t("2026-10-04", "week"), `${PLANNER}/weeks/2026-10-04|en-gb|gggg[w]ww.md | weekly | the week starting 9/28/26`);
    assert.equal(t("2026-10-01", "month"), `${PLANNER}/months/2026-10-01|en-gb|YYYY-MM.md | monthly | October 2026`);
    assert.equal(t("2027-01-01", "year"), `${PLANNER}/years/2027-01-01|en-gb|YYYY.md | yearly | 2027`);
});

test("the warm-up reads a few words once per session, and a failure in it is harmless", () => {
    const seen = [];
    const nld = { parseDate: (t) => { seen.push(t); if (t === "friday") throw new Error("boom"); return { moment: { isValid: () => false } }; }, parser: {} };
    const { dp: fresh } = load({ plainday: { DateWords: { at: () => nld } }, app: { plugins: { getPlugin: () => null } } });
    fresh.warmUp();
    assert.ok(seen.includes("warm up") && seen.includes("next week"), "reads words of each kind");
    const count = seen.length;
    fresh.warmUp();
    assert.equal(seen.length, count, "only once");
});

test("JumpToDate: a week or a month in words, this year unless a year comes before or after", () => {
    const J = vm.runInContext(classScript("jumpToDate.js") + "\n;JumpToDate", vm.createContext({}));
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const w = (t) => { const r = J.periodWords(t, { months: MONTHS, short: SHORT, year: 2026 }); return r && `${r.unit} ${r.year} ${r.n}`; };
    for (const t of ["w38", "W38", "wk 38", "week 38", "Week 38", "week38", " w38 "]) assert.equal(w(t), "week 2026 38", t);
    assert.equal(w("w1 2027"), "week 2027 1");
    assert.equal(w("2027 w1"), "week 2027 1");
    assert.equal(w("2027w01"), "week 2027 1", "a weekly note's own name reads the same");
    assert.equal(w("week 1 2027"), "week 2027 1");
    assert.equal(w("2026 w1 2027"), null, "one year only");
    for (const t of ["sep", "Sep", "sept", "september", "SEPTEMBER", "sep."]) assert.equal(w(t), "month 2026 9", t);
    assert.equal(w("Sep 2026"), "month 2026 9");
    assert.equal(w("september 2027"), "month 2027 9");
    assert.equal(w("2027 sep"), "month 2027 9");
    assert.equal(w("9/2026"), "month 2026 9");
    assert.equal(w("09/2027"), "month 2027 9");
    assert.equal(w("may"), "month 2026 5");
    for (const t of ["sep 14", "friday", "next week", "w", "week", "sep 26", "9/14", "mon", "2026", "2026-10"]) assert.equal(w(t), null, t);
    // Other languages: the locale's names (moment gives some locales separate forms)
    const j = new J();
    const ctx = { moment: { localeData: () => ({ months: () => ({ format: ["a"], standalone: ["январь"] }), monthsShort: () => ["янв."] }) } };
    const names = vm.runInContext("(" + J.prototype.monthNames.toString().replace(/^monthNames/, "function") + ")", vm.createContext(ctx))({ locale: "ru" });
    assert.deepEqual([...names.months, ...names.short], ["январь", "янв."]);
    assert.equal(J.periodWords("январь 2027", { ...names, year: 2026 })?.n, 1);
    assert.equal(J.periodWords("янв", { ...names, year: 2026 })?.n, 1);
    void j;
});

test("a week or a month in words says whether a year was given, and Schedule moves one that's over to next year (OBS-96)", () => {
    const J = vm.runInContext(classScript("jumpToDate.js") + "\n;JumpToDate", vm.createContext({}));
    const opts = { months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], year: 2026 };
    for (const t of ["w38", "sep", "september"]) assert.equal(J.periodWords(t, opts).withYear, false, t);
    for (const t of ["w38 2026", "2027 w1", "Sep 2026", "2027 sep", "9/2026"]) assert.equal(J.periodWords(t, opts).withYear, true, t);
    // Over once its last day has gone by
    assert.equal(J.over({ date: "2026-08-01", unit: "month" }, "2026-09-16"), true);
    assert.equal(J.over({ date: "2026-09-01", unit: "month" }, "2026-09-16"), false, "this month isn't over");
    assert.equal(J.over({ date: "2026-12-01", unit: "month" }, "2026-09-16"), false);
    assert.equal(J.over({ date: "2026-09-06", unit: "week" }, "2026-09-12"), false, "the week's last day is today");
    assert.equal(J.over({ date: "2026-09-06", unit: "week" }, "2026-09-13"), true);
    assert.equal(J.over({ date: "2025-12-28", unit: "week" }, "2026-01-03"), false, "a week across the new year");
});

test("JumpToDate: weekly notes count ISO weeks when their pattern says GGGG or WW", () => {
    const { j } = loadJump();
    assert.equal(j.isoWeeks({ format: { week: "GGGG-[W]WW" } }), true);
    assert.equal(j.isoWeeks({ format: { week: "GGGG[w]WW" } }), true);
    assert.equal(j.isoWeeks({ format: { week: "gggg[w]ww" } }), false);
    assert.equal(j.isoWeeks({ format: { week: "gggg-[W]ww" } }), false, "a W in brackets is a letter, not ISO");
});

test("prompt: a label follows the preview (a week's note name)", () => {
    const h = harness();
    const modal = h.dp.open("Jump to", h.onPick, { periods: true, name: (t) => (t === "w41" ? { date: "2026-10-04", unit: "week" } : null), label: (r) => (r.unit === "week" ? "2026w41" : null) });
    const preview = modal.contentEl.children[0];
    h.type("w41");
    assert.equal(preview.text, "Week starting 10/4 · 2026w41");
    h.type("friday");
    assert.equal(preview.text, "Fri 10/2 · in 5 days");
});

test("'week of' a date is the week that day is in: its note when jumping, its first day for Schedule and Due", () => {
    assert.equal(jump(SUN, "week of friday"), "week 2026-10-02");
    assert.equal(jump(SUN, "the week of 10/2"), "week 2026-10-02");
    assert.equal(jump(SUN, "Week of tomorrow"), "week 2026-09-28");
    assert.equal(jump(SUN, "wk of friday"), "week 2026-10-02");
    assert.equal(jump(SUN, "week starting friday"), "week 2026-10-02", "the preview's own words work too");
    assert.equal(dp.describe(dp.result("2026-10-02", "week"), SUN), "Week starting 9/27");
    assert.equal(at(SUN, "week of friday"), "day 2026-09-27", "Schedule: the first day of that week");
    assert.equal(at(SUN, "week of friday", { weekStart: 1 }), "day 2026-09-28");
    assert.equal(jump(SUN, "week of fridya"), null, "a day it can't read, no week");
    assert.deepEqual(missing, [], "every phrase is in the fixture");
});

test("jumping: a month and day without a year is the closer one; Schedule and Due keep the next one", () => {
    // Typed on Sunday 9/27/26: Revived reads each as the next one
    assert.equal(FIX.days[SUN]["9/16"].parseDate, "2027-09-16");
    assert.equal(jump(SUN, "9/16"), "day 2026-09-16", "11 days back beats 354 ahead");
    assert.equal(jump(SUN, "sep 16"), "day 2026-09-16");
    assert.equal(jump(SUN, "week of 9/16", { nearest: true }), "week 2026-09-16");
    assert.equal(jump(SUN, "jan 5"), "day 2027-01-05", "100 days ahead beats 265 back");
    assert.equal(jump(SUN, "march 3"), "day 2027-03-03", "157 ahead beats 208 back");
    assert.equal(jump(SUN, "12/25"), "day 2026-12-25");
    assert.equal(jump(SUN, "in 7 months"), "day 2027-04-27", "a year the words imply isn't moved");
    assert.equal(jump(SUN, "9/16/26"), "day 2026-09-16");
    assert.equal(jump(SUN, "friday"), "day 2026-10-02", "a weekday isn't a month and day");
    assert.equal(at(SUN, "9/16"), "day 2027-09-16", "Schedule and Due: the next one");
    assert.equal(at(SUN, "sep 16"), "day 2027-09-16");
    assert.deepEqual(missing, [], "every phrase is in the fixture");
    assert.equal(dp.constructor.yearEarlier("2028-02-29"), null, "no February 29th a year back");
    assert.equal(dp.constructor.yearEarlier("2027-09-16"), "2026-09-16");
});
