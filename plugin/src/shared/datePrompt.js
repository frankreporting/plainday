import { getLanguage, Modal, moment, Notice, TextComponent } from "obsidian";
import { app } from "../host.js";

export default class DatePrompt {
    // The date prompt behind Schedule, Due and JumpToDate: type a date in words, see the date it
    // means while you type, and Enter hands it on. Natural Language Dates reads the words. Revived
    // comes first: it reads a bare weekday as the coming one, where the original plugin gives last
    // week's (OBS-58). Only one of the two can be on at a time; either works here.
    static PLUGINS = ["nldates-revived", "nldates-obsidian"];

    // Revived's first parse after it loads takes about 150ms (its date parser warming up); every one
    // after that well under 1ms. It's paid once, just after the first prompt opens, so the first key
    // typed doesn't wait for it.
    static warmed = false;

    static DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    static MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    // The date plugin that's on, or null
    plugin() {
        for (const id of DatePrompt.PLUGINS) {
            const p = app.plugins?.getPlugin?.(id);
            if (typeof p?.parseDate === "function") return p;
        }
        return null;
    }

    // What `text` names: { date: "YYYY-MM-DD", unit, m, readAs } with unit "day", "week", "month" or
    // "year" and `m` the date as a moment, or null when it isn't a date. `readAs` is set when only
    // some of the words were read ("end of october" is read as "october").
    // - `periods` (JumpToDate): a week, month or year counts as itself, and `date` is a day in it.
    //   Without it, a period is a day: its first, or today for "this week".
    // - `weekStart` (0 is Sunday): the day weeks start on, from weekRules().
    // - `name(text)`: reads a periodic note's own name first, as { date, unit }.
    // - `nearest` (JumpToDate): a month and day without a year ("9/16", "sep 16") is whichever is
    //   closer, this year's or the next, where Revived always takes the next one.
    // "week of <a date>" is the week that date is in.
    // - `today` and `now` are for tests.
    read(nld, text, { periods = false, weekStart = 0, name = null, nearest = false, today = moment().format("YYYY-MM-DD"), now = new Date() } = {}) {
        const t = String(text ?? "").trim();
        if (!t || !nld) return null;

        const named = name?.(t);
        if (named) return this.result(named.date, named.unit);

        // "week of oct 5", "the week of friday", "week starting oct 4": the week that day is in (its
        // note, or its first day)
        const weekOf = t.match(/^(?:the\s+)?(?:week|wk)\s+(?:of|starting)\s+(.+)$/i);
        if (weekOf) {
            const day = this.read(nld, weekOf[1], { weekStart, nearest, today, now });
            if (!day) return null;
            return periods ? this.result(day.date, "week") : this.result(DatePrompt.weekFirst(day.date, weekStart), "day");
        }

        let parsed;
        try { parsed = nld.parseDate(t); } catch (e) { return null; }
        const m = parsed?.moment;
        if (!m?.isValid?.()) return null;
        const date = m.format("YYYY-MM-DD");

        // Revived says when the words name a whole period ("next week", "this month"); the original
        // plugin doesn't, and everything is a day
        let period;
        try { period = nld.parser?.getParsedPeriod?.(t, nld.settings?.weekStart) ?? null; } catch (e) { period = null; }
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

        // Revived reads words it doesn't know as right now ("fridya" is today), and when its date parser
        // (chrono) reads only some of them, drops the rest ("tomorow at 5pm" is today at 5pm, "end of
        // october" is 10/1). Say what was read, and don't take today unless all of it was.
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

    // What Revived's date parser makes of the words: { date, words, yearless } (the day, or null; the
    // longest stretch of the words it read; and whether all of them name a month and a day but no
    // year), or null with the original plugin, which has no such parser
    chronoRead(nld, text, now) {
        const parser = nld.parser;
        if (typeof parser?.getParsedDateResult !== "function") return null;
        let date, words, yearless;
        try {
            const d = parser.getParsedDateResult(text, now, { forwardDate: true });
            date = d ? DatePrompt.localDate(d) : null;
        } catch (e) { date = null; }
        try {
            const best = [...(parser.getParsedResult?.(text) ?? [])].sort((a, b) => String(b.text ?? "").length - String(a.text ?? "").length)[0];
            words = String(best?.text ?? "");
            const said = (part) => !!best?.start?.isCertain?.(part);
            yearless = !!best && said("month") && said("day") && !said("year") && DatePrompt.squash(words) === DatePrompt.squash(text);
        } catch (e) { words = ""; yearless = false; }
        return { date, words, yearless };
    }

    // How weeks are counted and periodic notes named, from the user's own settings, the way Notebook
    // Navigator names its periodic notes: its periodic notes locale, which is its calendar Locale
    // ("System default" is Obsidian's language) unless set to follow Obsidian's. Without Notebook
    // Navigator, Obsidian's language, which is moment's. "en" weeks start on Sunday.
    // Returns { locale, weekStart (0 is Sunday), format: { week, month, year } } (the file part of
    // Notebook Navigator's patterns, else this vault's names).
    weekRules() {
        const nn = app.plugins?.plugins?.["notebook-navigator"]?.settings;
        const current = moment.locale();
        let locale = current;
        if (nn && nn.calendarPeriodicNotesLocaleSource !== "obsidian") {
            const chosen = !nn.calendarLocale || nn.calendarLocale === "system-default"
                ? (getLanguage?.() || current)
                : nn.calendarLocale;
            locale = this.knownLocale(chosen) ?? current;
        }
        const format = {};
        for (const [unit, key, fallback] of [["week", "calendarCustomWeekPattern", "gggg[w]ww"], ["month", "calendarCustomMonthPattern", "YYYY-MM"], ["year", "calendarCustomYearPattern", "YYYY"]]) {
            const pattern = String(nn?.[key] ?? "").trim();
            format[unit] = pattern ? pattern.slice(pattern.lastIndexOf("/") + 1) : fallback;
        }
        return { locale, weekStart: moment.localeData(locale).firstDayOfWeek(), format };
    }

    // The moment locale a language or locale code names ("en_US" → "en-us" or "en"), matched the way
    // Notebook Navigator matches them, or null
    knownLocale(code) {
        const all = moment.locales();
        const exact = String(code ?? "").replace(/_/g, "-");
        const lower = exact.toLowerCase();
        const base = lower.split("-")[0];
        return all.find((l) => l === exact) ?? all.find((l) => l === lower) ?? all.find((l) => l === base)
            ?? all.filter((l) => l.toLowerCase().startsWith(`${base}-`)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
            ?? null;
    }

    result(date, unit) {
        return { date, unit, m: moment(date, "YYYY-MM-DD", true) };
    }

    // The line under the input: what Enter would pick. `weekStart` as in read(). A week says the day
    // it starts, so "week of oct 5" reads "Week starting 10/4" rather than seeming to disagree.
    describe(result, today = moment().format("YYYY-MM-DD"), weekStart = 0) {
        if (!result) return "";
        const { date, unit } = result;
        const [y, mo] = date.split("-").map(Number);
        // M/D, with the year when it isn't this year's
        const md = (day) => {
            const [yy, mm, dd] = DatePrompt.fromDay(day).split("-");
            return `${Number(mm)}/${Number(dd)}${yy === today.slice(0, 4) ? "" : `/${yy.slice(2)}`}`;
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

    // The same, spelled out for a sentence: "Friday, October 2, 2026", "the week starting 10/4/26",
    // "October 2026", "2027"
    spell({ date, unit }, weekStart = 0) {
        const [y, mo, d] = date.split("-").map(Number);
        const day = DatePrompt.toDay(date);
        const dow = new Date(day * 864e5).getUTCDay();
        if (unit === "year") return String(y);
        if (unit === "month") return `${DatePrompt.MONTHS[mo - 1]} ${y}`;
        if (unit === "week") {
            const [sy, sm, sd] = DatePrompt.weekFirst(date, weekStart).split("-");
            return `the week starting ${Number(sm)}/${Number(sd)}/${sy.slice(2)}`;
        }
        return `${DatePrompt.DAYS[dow]}, ${DatePrompt.MONTHS[mo - 1]} ${d}, ${y}`;
    }

    // Read a few words of each kind once, so neither Revived's first-parse cost nor the first run of
    // each path is paid on a keystroke. A word it doesn't know goes through every step, down to its
    // date parser.
    warmUp(nld) {
        if (DatePrompt.warmed) return;
        DatePrompt.warmed = true;
        for (const text of ["warm up", "f", "friday", "next week", "in 2 days", "oct 2"]) {
            try { this.read(nld, text); this.describe(this.read(nld, text)); } catch (e) { /* only a warm-up */ }
        }
    }

    // Opens the prompt. `onPick(result, modal, event)` runs on Enter and closes the modal itself; if it
    // fails, Enter can be tried again. `periods`, `name` and `nearest` as in read(); `label(result)` adds a word
    // to the preview. `extra(contentEl, { focus })` adds anything under the preview, and `focus()`
    // puts the cursor back in the box. Returns the modal, or null when no date plugin is on.
    open(title, onPick, { periods = false, name = null, nearest = false, label = null, extra } = {}) {
        const nld = this.plugin();
        if (!nld) { new Notice("Turn on Natural Language Dates (Revived) in Community plugins"); return null; }
        let weekStart = 0;
        try { weekStart = this.weekRules().weekStart; } catch (e) { weekStart = 0; }

        const modal = new Modal(app);
        modal.titleEl.setText(title);
        const input = new TextComponent(modal.contentEl);
        input.inputEl.style.width = "100%";
        const preview = modal.contentEl.createDiv({ cls: "setting-item-description" });
        preview.style.marginTop = "0.5em";
        preview.style.minHeight = "1.5em";
        extra?.(modal.contentEl, { focus: () => input.inputEl.focus() });

        let result = null;
        let picked = false;
        const update = () => {
            const text = input.getValue();
            result = this.read(nld, text, { periods, weekStart, name, nearest });
            const more = result ? label?.(result) : null;
            preview.setText(!text.trim() ? "" : result ? `${this.describe(result, undefined, weekStart)}${more ? ` · ${more}` : ""}` : "Not a date I can read");
        };
        const failed = (err) => {
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
        modal.onOpen = () => requestAnimationFrame(() => { input.inputEl.focus(); input.inputEl.select(); setTimeout(() => this.warmUp(nld), 0); });
        modal.open();
        return modal;
    }

    // ---------------------------------------------------------------- dates as "YYYY-MM-DD"

    static toDay(date) {
        const [y, m, d] = date.split("-").map(Number);
        return Date.UTC(y, m - 1, d) / 864e5;
    }

    static fromDay(n) {
        return new Date(n * 864e5).toISOString().slice(0, 10);
    }

    static addDays(date, n) {
        return DatePrompt.fromDay(DatePrompt.toDay(date) + n);
    }

    // The first day of the week a date is in, for weeks starting on `weekStart` (0 is Sunday)
    static weekFirst(date, weekStart = 0) {
        const day = DatePrompt.toDay(date);
        return DatePrompt.fromDay(day - (new Date(day * 864e5).getUTCDay() - weekStart + 7) % 7);
    }

    // The same month and day a year earlier, or null for a February 29th
    static yearEarlier(date) {
        const [y, m, d] = date.split("-").map(Number);
        const back = new Date(Date.UTC(y - 1, m - 1, d));
        return back.getUTCMonth() === m - 1 ? back.toISOString().slice(0, 10) : null;
    }

    // Lowercase letters and digits only, to compare words however they're spaced or punctuated
    static squash(text) {
        return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    }

    // The Monday of a date's ISO week, as a day number
    static isoMonday(date) {
        const day = DatePrompt.toDay(date);
        return day - (new Date(day * 864e5).getUTCDay() + 6) % 7;
    }

    // A Date's calendar day where Obsidian runs
    static localDate(d) {
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
}
