import { getLanguage, Modal, moment, Notice, TextComponent } from "obsidian";
import { app, plainday } from "../host.js";

/** @import { Moment } from "moment" */
/** @import { Component } from "chrono-node" */
/** @import { DateReader, MomentFn, ParsedPeriod } from "../host.js" */
/**
 * A periodic note's kind, a period a date names, and what the prompt reads: `date` is a day as
 * YYYY-MM-DD (a period's first day, or a day in it), `m` that day as a moment, and `readAs` the
 * words read when only some of them were.
 * @typedef {"day" | "week" | "month" | "year"} Unit
 * @typedef {{ date: string, unit: Unit }} Period
 * @typedef {Period & { m: Moment, readAs?: string }} DateResult
 *
 * How weeks are counted and periodic notes named (weekRules): the locale, the day weeks start on (0
 * is Sunday), and each period's name format.
 * @typedef {{ locale: string, weekStart: number, format: { week: string, month: string, year: string } }} WeekRules
 *
 * How read() and readWith() read (readWith says what each does):
 * @typedef {{ periods?: boolean, weekStart?: number, name?: ((text: string) => Period | null) | null, nearest?: boolean, today?: string, now?: Date }} ReadOptions
 */

export default class DatePrompt {
    // The date prompt behind Schedule, Due, JumpToDate and Invoice: type a date in words, see the
    // date it means while you type, and Enter hands it on. Plainday reads English words itself
    // (DateWords, OBS-139), as Natural Language Dates (Revived) reads them. Words it can't read go to
    // Revived when it's on, which reads the other languages turned on in its settings. The original
    // Natural Language Dates isn't asked: it reads a bare weekday as last week's (OBS-58).
    /** @type {"nldates-revived"} */
    static REVIVED = "nldates-revived";

    // The first reading after Plainday loads takes about 20ms (chrono-node warming up), and Revived's
    // first about 150ms; every one after that about a millisecond. It's paid once, just after the
    // first prompt opens, so the first key typed doesn't wait for it.
    static warmed = false;

    static DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    static MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    // Natural Language Dates (Revived) when it's on, or null
    /** @returns {Partial<DateReader> | null} */
    revived() {
        const p = app.plugins?.getPlugin?.(DatePrompt.REVIVED);
        return typeof p?.parseDate === "function" ? p : null;
    }

    // What `text` names, as readWith() says: read by Plainday's own reader, and when that can't read
    // the words, by Revived when it's on (another language: "lundi prochain"). Options as in
    // readWith().
    /**
     * @param {string} text
     * @param {ReadOptions} [opts]
     * @returns {DateResult | null}
     */
    read(text, opts = {}) {
        const now = opts.now ?? new Date();
        const own = this.readWith(plainday.DateWords.at(now), text, { ...opts, now });
        if (own) return own;
        const revived = this.revived();
        return revived ? this.readWith(revived, text, { ...opts, now }) : null;
    }

    // What `text` names, read by `nld`, a reader with Revived's three answers (Plainday's own,
    // DateWords.at(), or Revived itself): { date: "YYYY-MM-DD", unit, m, readAs } with unit "day",
    // "week", "month" or "year" and `m` the date as a moment, or null when it isn't a date. `readAs`
    // is set when only some of the words were read ("mid october" is read as "october").
    // - `periods` (JumpToDate): a week, month or year counts as itself, and `date` is a day in it.
    //   Without it, a period is a day: its first, or today for "this week".
    // - `weekStart` (0 is Sunday): the day weeks start on, from weekRules().
    // - `name(text)`: reads a periodic note's own name first, as { date, unit }.
    // - `nearest` (JumpToDate): a month and day without a year ("9/16", "sep 16") is whichever is
    //   closer, this year's or the next, where the readers always take the next one.
    // "week of <a date>" is the week that date is in.
    // - `today` and `now` are for tests.
    /**
     * @param {Partial<DateReader> | null} nld
     * @param {string} text
     * @param {ReadOptions} [opts]
     * @returns {DateResult | null}
     */
    readWith(nld, text, { periods = false, weekStart = 0, name = null, nearest = false, today = /** @type {MomentFn} */ (moment)().format("YYYY-MM-DD"), now = new Date() } = {}) {
        // A day and month typed with the date format's own joiner ("5.10." under DD.MM.YYYY, OBS-309) is read as
        // with slashes, which the readers read in the format's order (DateWords.chrono)
        // A note's own name ("26-09-20" for daily notes named YY-MM-DD) is read as typed, first
        const typed = String(text ?? "").trim();
        const t = plainday?.Dates?.slashed?.(typed) ?? typed;
        if (!t || !nld) return null;

        const named = name?.(typed) ?? (t !== typed ? name?.(t) : null);
        if (named) return this.result(named.date, named.unit);

        // "week of oct 5", "the week of friday", "week starting oct 4": the week that day is in (its
        // note, or its first day)
        const weekOf = t.match(/^(?:the\s+)?(?:week|wk)\s+(?:of|starting)\s+(.+)$/i);
        if (weekOf) {
            const day = this.readWith(nld, weekOf[1], { weekStart, nearest, today, now });
            if (!day) return null;
            return periods ? this.result(day.date, "week") : this.result(DatePrompt.weekFirst(day.date, weekStart), "day");
        }

        let parsed;
        try { parsed = nld.parseDate(t); } catch { return null; }
        const m = parsed?.moment;
        if (!m?.isValid?.()) return null;
        const date = m.format("YYYY-MM-DD");

        // The reader says when the words name a whole period ("next week", "this month")
        let period;
        try { period = nld.parser?.getParsedPeriod?.(t, nld.settings?.weekStart) ?? null; } catch { period = null; }
        if (period && period.granularity !== "day" && typeof period.date?.getTime === "function" && !isNaN(period.date.getTime())) {
            const start = DatePrompt.localDate(period.date);
            if (period.granularity === "week") {
                // Revived counts ISO weeks (Monday first), which needn't be the vault's: with weeks
                // starting Sunday, its "next week" on a Sunday starts tomorrow, inside this week. So for
                // "this/next/last week" keep only how many weeks away it is and count that from today (a
                // day 7 days on is in next week however weeks start). A week named with its year
                // ("2026-W41") is taken as written: the vault week holding its Monday.
                const away = (DatePrompt.isoMonday(start) - DatePrompt.isoMonday(today)) / 7;
                const day = /\d{4}/.test(t) ? start : DatePrompt.addDays(today, 7 * away);
                if (periods) return this.result(day, "week");
                return this.result(!/\d{4}/.test(t) && away === 0 ? today : DatePrompt.weekFirst(day, weekStart), "day");
            }
            if (periods && period.granularity === "month") return this.result(`${start.slice(0, 7)}-01`, "month");
            if (periods && period.granularity === "year") return this.result(`${start.slice(0, 4)}-01-01`, "year");
            return this.result(start, "day");
        }

        // Both readers read words they don't know as right now ("fridya" is today), and when their date
        // parser (chrono) reads only some of them, drop the rest ("tomorow at 5pm" is today at 5pm,
        // "mid october" is 10/1). Say what was read, and don't take today unless all of it was.
        const chrono = this.chronoRead(nld, t, now);
        if (chrono) {
            const partial = chrono.date === date && !!chrono.words && DatePrompt.squash(chrono.words) !== DatePrompt.squash(t);
            if (date === today && (!chrono.date || partial)) return null;
            if (partial) return { ...this.result(date, "day"), readAs: chrono.words };
            // A month and day without a year that Revived put a year ahead, when last year's is closer
            if (nearest && chrono.yearless && date > today) {
                const back = DatePrompt.yearEarlier(date);
                const ahead = DatePrompt.toDay(date) - DatePrompt.toDay(today);
                if (back && DatePrompt.toDay(today) - DatePrompt.toDay(back) < ahead) return this.result(back, "day");
            }
        }
        return this.result(date, "day");
    }

    // What the reader's date parser makes of the words: { date, words, yearless } (the day, or null;
    // the longest stretch of the words it read; and whether all of them name a month and a day but no
    // year), or null for a reader without one
    /**
     * @param {Partial<DateReader>} nld
     * @param {string} text
     * @param {Date} now
     * @returns {{ date: string | null, words: string, yearless: boolean } | null}
     */
    chronoRead(nld, text, now) {
        const parser = nld.parser;
        if (typeof parser?.getParsedDateResult !== "function") return null;
        let date, words, yearless;
        try {
            const d = parser.getParsedDateResult(text, now, { forwardDate: true });
            date = d ? DatePrompt.localDate(d) : null;
        } catch { date = null; }
        try {
            const best = [...(parser.getParsedResult?.(text) ?? [])].sort((a, b) => String(b.text ?? "").length - String(a.text ?? "").length)[0];
            words = String(best?.text ?? "");
            const said = (/** @type {Component} */ part) => !!best?.start?.isCertain?.(part);
            yearless = !!best && said("month") && said("day") && !said("year") && DatePrompt.squash(words) === DatePrompt.squash(text);
        } catch { words = ""; yearless = false; }
        return { date, words, yearless };
    }

    // How weeks are counted and periodic notes named, from the user's own settings. With Notebook
    // Navigator as the periodic notes' source (Settings → Plainday → Folders, OBS-283), the way it names
    // them: its periodic notes locale, which is its calendar Locale ("System default" is Obsidian's
    // language) unless set to follow Obsidian's, and its patterns. Otherwise Obsidian's language, which is
    // moment's, and the names in Plainday's own patterns (Settings → Plainday → Folders → Periodic notes,
    // OBS-349), which blank leaves as gggg[w]ww, YYYY-MM and YYYY, even with Navigator installed (OBS-120). "en" weeks start on Sunday. Where Settings isn't loaded (tests), Navigator when it's there.
    // Returns { locale, weekStart (0 is Sunday), format: { week, month, year } }.
    /** @returns {WeekRules} */
    weekRules() {
        const source = plainday?.Settings?.periodicSource?.();
        const nn = source === undefined || source === "notebook-navigator" ? app.plugins?.plugins?.["notebook-navigator"]?.settings : null;
        const current = moment.locale();
        let locale = current;
        if (nn && nn.calendarPeriodicNotesLocaleSource !== "obsidian") {
            const chosen = !nn.calendarLocale || nn.calendarLocale === "system-default"
                ? (getLanguage?.() || current)
                : nn.calendarLocale;
            locale = this.knownLocale(chosen) ?? current;
        }
        const own = source !== undefined && source !== "notebook-navigator" ? plainday.Settings.get?.()?.folders : null;
        const format = {};
        for (const [unit, key, fallback] of [["week", "calendarCustomWeekPattern", "gggg[w]ww"], ["month", "calendarCustomMonthPattern", "YYYY-MM"], ["year", "calendarCustomYearPattern", "YYYY"]]) {
            const pattern = String(nn?.[key] ?? own?.[unit] ?? "").trim();
            format[unit] = pattern ? pattern.slice(pattern.lastIndexOf("/") + 1) : fallback;
        }
        return { locale, weekStart: moment.localeData(locale).firstDayOfWeek(), format };
    }

    // The moment locale a language or locale code names ("en_US" → "en-us" or "en"), matched the way
    // Notebook Navigator matches them, or null
    /** @param {unknown} code @returns {string | null} */
    knownLocale(code) {
        const all = moment.locales();
        const exact = String(code ?? "").replace(/_/g, "-");
        const lower = exact.toLowerCase();
        const base = lower.split("-")[0];
        return all.find((l) => l === exact) ?? all.find((l) => l === lower) ?? all.find((l) => l === base)
            ?? all.filter((l) => l.toLowerCase().startsWith(`${base}-`)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
            ?? null;
    }

    /**
     * @param {string} date
     * @param {Unit} unit
     * @returns {DateResult}
     */
    result(date, unit) {
        return { date, unit, m: /** @type {MomentFn} */ (moment)(date, "YYYY-MM-DD", true) };
    }

    // The line under the input: what Enter would pick. `weekStart` as in read(). A week says the day
    // it starts, so "week of oct 5" reads "Week starting 10/4" rather than seeming to disagree.
    /**
     * @param {DateResult | null} result
     * @param {string} [today]
     * @param {number} [weekStart]
     * @returns {string}
     */
    describe(result, today = /** @type {MomentFn} */ (moment)().format("YYYY-MM-DD"), weekStart = 0) {
        if (!result) return "";
        const { date, unit } = result;
        const [y, mo] = date.split("-").map(Number);
        // The day and month as Plainday writes them (Dates, OBS-309), with the year when it isn't this year's
        const md = (/** @type {number} */ day) => {
            const date = DatePrompt.fromDay(day);
            return date.slice(0, 4) === today.slice(0, 4) ? plainday.Dates.day(date) : plainday.Dates.year(date);
        };
        const day = DatePrompt.toDay(date);
        const dow = new Date(day * 864e5).getUTCDay();
        if (unit === "year") return String(y);
        if (unit === "month") return `${DatePrompt.MONTHS[mo - 1]} ${y}`;
        if (unit === "week") return `Week starting ${md(DatePrompt.toDay(DatePrompt.weekFirst(date, weekStart)))}`;
        const n = day - DatePrompt.toDay(today);
        const when = n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`;
        return `${DatePrompt.DAYS[dow].slice(0, 3)} ${md(day)} · ${when}${result.readAs ? ` · read as "${result.readAs}"` : ""}`;
    }

    // The same, spelled out for a sentence: "Friday, October 2, 2026" ("Friday 2 October 2026" when the date
    // format puts the day first, OBS-309), "the week starting 10/4/26", "October 2026", "2027"
    /**
     * @param {Period} period
     * @param {number} [weekStart]
     * @returns {string}
     */
    spell({ date, unit }, weekStart = 0) {
        const [y, mo, d] = date.split("-").map(Number);
        const day = DatePrompt.toDay(date);
        const dow = new Date(day * 864e5).getUTCDay();
        if (unit === "year") return String(y);
        if (unit === "month") return `${DatePrompt.MONTHS[mo - 1]} ${y}`;
        if (unit === "week") {
            return `the week starting ${plainday.Dates.year(DatePrompt.weekFirst(date, weekStart))}`;
        }
        if (plainday.Dates.dayFirst()) return `${DatePrompt.DAYS[dow]} ${d} ${DatePrompt.MONTHS[mo - 1]} ${y}`;
        return `${DatePrompt.DAYS[dow]}, ${DatePrompt.MONTHS[mo - 1]} ${d}, ${y}`;
    }

    // Read a few words of each kind once, so neither chrono-node's first-parse cost nor the first run
    // of each path is paid on a keystroke. A word it doesn't know goes through every step, down to
    // its date parser, and on to Revived when it's on.
    /** @returns {void} */
    warmUp() {
        if (DatePrompt.warmed) return;
        DatePrompt.warmed = true;
        for (const text of ["warm up", "f", "friday", "next week", "in 2 days", "oct 2"]) {
            try { this.describe(this.read(text)); } catch { /* only a warm-up */ }
        }
    }

    // Opens the prompt. `onPick(result, modal, event)` runs on Enter and closes the modal itself; if it
    // fails, Enter can be tried again. `periods`, `name` and `nearest` as in read(); `label(result)` adds a word
    // to the preview. `extra(contentEl, { focus })` adds anything under the preview, and `focus()`
    // puts the cursor back in the box. Returns the modal.
    /**
     * @param {string} title
     * @param {(result: DateResult, modal: Modal, event: KeyboardEvent) => unknown} onPick
     * @param {{
     *   periods?: boolean,
     *   name?: ((text: string) => Period | null) | null,
     *   nearest?: boolean,
     *   label?: ((result: DateResult) => string | null) | null,
     *   extra?: (contentEl: HTMLElement, controls: { focus: () => void }) => void,
     * }} [options]
     * @returns {Modal}
     */
    open(title, onPick, { periods = false, name = null, nearest = false, label = null, extra } = {}) {
        let weekStart = 0;
        try { weekStart = this.weekRules().weekStart; } catch { weekStart = 0; }

        const modal = new Modal(app);
        modal.titleEl.setText(title);
        const input = new TextComponent(modal.contentEl);
        input.inputEl.addClass("plainday-wide-input");
        const preview = modal.contentEl.createDiv({ cls: "setting-item-description plainday-date-preview" });
        extra?.(modal.contentEl, { focus: () => input.inputEl.focus() });

        /** @type {DateResult | null} */
        let result = null;
        let picked = false;
        const update = () => {
            const text = input.getValue();
            result = this.read(text, { periods, weekStart, name, nearest });
            const more = result ? label?.(result) : null;
            preview.setText(!text.trim() ? "" : result ? `${this.describe(result, undefined, weekStart)}${more ? ` · ${more}` : ""}` : "Not a date I can read");
        };
        const failed = (/** @type {unknown} */ err) => {
            picked = false;
            console.error(`${title}:`, err);
            new Notice(`${title} failed — check console`);
        };
        input.onChange(update);
        input.inputEl.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" || e.isComposing) return;
            e.preventDefault();
            if (picked) return;
            update();
            if (!result) { new Notice("Couldn't read that date"); return; }
            picked = true;
            try {
                Promise.resolve(onPick(result, modal, e)).catch(failed);
            } catch (err) {
                failed(err);
            }
        });

        // Focus once the modal is open and the hotkey's keydown is over; focusing straight after
        // open() fights the editor for focus, and the first key typed can land in the note (OBS-50)
        // Then warm the parser up, in the next task, once the box is drawn and focused.
        modal.onOpen = () => window.requestAnimationFrame(() => { input.inputEl.focus(); input.inputEl.select(); window.setTimeout(() => this.warmUp(), 0); });
        modal.open();
        return modal;
    }

    // ---------------------------------------------------------------- dates as "YYYY-MM-DD"

    /** @param {string} date @returns {number} */
    static toDay(date) {
        const [y, m, d] = date.split("-").map(Number);
        return Date.UTC(y, m - 1, d) / 864e5;
    }

    /** @param {number} n @returns {string} */
    static fromDay(n) {
        return new Date(n * 864e5).toISOString().slice(0, 10);
    }

    /** @param {string} date @param {number} n @returns {string} */
    static addDays(date, n) {
        return DatePrompt.fromDay(DatePrompt.toDay(date) + n);
    }

    // The first day of the week a date is in, for weeks starting on `weekStart` (0 is Sunday)
    /**
     * @param {string} date
     * @param {number} [weekStart]
     * @returns {string}
     */
    static weekFirst(date, weekStart = 0) {
        const day = DatePrompt.toDay(date);
        return DatePrompt.fromDay(day - (new Date(day * 864e5).getUTCDay() - weekStart + 7) % 7);
    }

    // The same month and day a year earlier, or null for a February 29th
    /** @param {string} date @returns {string | null} */
    static yearEarlier(date) {
        const [y, m, d] = date.split("-").map(Number);
        const back = new Date(Date.UTC(y - 1, m - 1, d));
        return back.getUTCMonth() === m - 1 ? back.toISOString().slice(0, 10) : null;
    }

    // Lowercase letters and digits only, to compare words however they're spaced or punctuated
    /** @param {string} text @returns {string} */
    static squash(text) {
        return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    }

    // The Monday of a date's ISO week, as a day number
    /** @param {string} date @returns {number} */
    static isoMonday(date) {
        const day = DatePrompt.toDay(date);
        return day - (new Date(day * 864e5).getUTCDay() + 6) % 7;
    }

    // A Date's calendar day where Obsidian runs
    /** @param {Date} d @returns {string} */
    static localDate(d) {
        const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
}
