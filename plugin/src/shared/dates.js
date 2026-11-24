import { moment } from "obsidian";
import { plainday } from "../host.js";

/** @import { Moment } from "moment" */
/** @import { MomentFn } from "../host.js" */
/**
 * A date as the writers hold it: "YYYY-MM-DD", or a moment
 * @typedef {string | Moment} DateLike
 *
 * A date format read into its parts (Dates.parse): whether the day comes before the month, what joins the
 * numbers, whether the year comes first, the format without its year ("M/D", "DD.MM.", "MM-DD"), and the
 * whole format
 * @typedef {{ dayFirst: boolean, sep: string, yearFirst: boolean, short: string, full: string }} FormatParts
 */

export default class Dates {
    // How Plainday writes a date (OBS-309): every 🚩, forward date, report column, timesheet, invoice,
    // Problem, notice, dialog and alias asks here, so they all follow one format:
    //   - with *Use custom display format* on (Settings → Plainday → Dates) and a format in its box, that one;
    //   - otherwise the daily notes' names, as Schedule.dailyOpts reads them from the Daily notes plugin or
    //     Notebook Navigator, when they're a format the box would take; else "YYYY-MM-DD";
    //   - without Plainday's settings or Schedule (the Raycast timer, the demo render, a test that sets
    //     none), "M/D/YY".
    // A format is the day, the month and the year as numbers (D or DD, M or MM, YY or YYYY), each once,
    // joined by the same slash, dot or dash, with the year first or last: "M/D/YY", "DD.MM.YYYY",
    // "YYYY-MM-DD". Numbers only, since Plainday finds its own forward dates at the end of a task line by
    // their shape (and so does the Raycast timer, which can't read these settings).
    //
    // The forms:
    //   - day():   without the year: "9/17", "17.09.", "09-17". Links on task lines, reports, notices.
    //   - year():  the whole format: "9/17/26", "17.09.2026"; `long` for a four-digit year, as the invoice
    //              date prints it ("9/17/2026"). Aliases, dialogs, Problems.
    //   - week():  "Wk of 9/20"
    //   - range(): "9/13-9/19", "13.09.-19.09.", or with an en dash when the format joins with a dash
    // A weekday goes in front, in the words each place already uses ("Fri 9/11").
    //
    // What reads a label back: TimeReport.labelDay, in the format in use; the patterns that find a label by its
    // shape accept any of the three joiners, so labels written in another format still read.
    static FALLBACK = "M/D/YY";
    // The format when the daily notes' names aren't one the box would take (Notebook Navigator's YYYYMMDD)
    static NAMES_FALLBACK = "YYYY-MM-DD";
    // The format's own rule: the year first or last, then the day and month in either order, one joiner. Day
    // and month each once is checked after the match. No lookbehinds (older iPhones can't run them).
    static FORMAT = /^(?:(YYYY|YY)([/.-])(DD?|MM?)\2(DD?|MM?)|(DD?|MM?)([/.-])(DD?|MM?)\6(YYYY|YY))$/;

    // ---------------------------------------------------------------- pure

    /**
     * A format's parts, or null when it isn't one the setting takes
     * @param {unknown} format
     * @returns {FormatParts | null}
     */
    static parse(format) {
        const f = typeof format === "string" ? format.trim() : "";
        const m = f.match(Dates.FORMAT);
        if (!m) return null;
        const yearFirst = m[1] !== undefined;
        const [a, b, sep] = /** @type {[string, string, string]} */ (yearFirst ? [m[3], m[4], m[2]] : [m[5], m[7], m[6]]);
        if (a[0] === b[0]) return null;
        // Without the year: the day and month, and after them the dot a dotted date keeps when its year came last
        const short = `${a}${sep}${b}${!yearFirst && sep === "." ? "." : ""}`;
        return { dayFirst: a[0] === "D", sep, yearFirst, short, full: f };
    }

    /**
     * A date's year, month and day as numbers: a moment's read as numbers, since a moment in some languages
     * (Arabic, Hindi) formats with its own digits
     * @param {DateLike} date
     * @returns {[number, number, number]}
     */
    static ymd(date) {
        if (typeof date !== "string" && typeof date.month === "function" && typeof date.date === "function") return [date.year(), date.month() + 1, date.date()];
        const [y, m, d] = (typeof date === "string" ? date : date.format("YYYY-MM-DD")).split("-").map(Number);
        return [y, m, d];
    }

    /**
     * A date in a format, or in a part of one ("DD.MM.")
     * @param {string} format
     * @param {DateLike} date
     * @returns {string}
     */
    static render(format, date) {
        const [y, m, d] = Dates.ymd(date);
        const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
        /** @type {Record<string, string>} */
        const token = { YYYY: String(y), YY: two(y % 100), DD: two(d), D: String(d), MM: two(m), M: String(m) };
        return format.replace(/YYYY|YY|DD|D|MM|M/g, (t) => token[t] ?? t);
    }

    /**
     * Whether Obsidian's language writes the day before the month (English (UK), German, French), by its
     * own numeric date format; false when moment isn't there
     * @returns {boolean}
     */
    static languageDayFirst() {
        try {
            const numeric = String(/** @type {MomentFn} */ (moment).localeData().longDateFormat("L"));
            const d = numeric.indexOf("D"), m = numeric.indexOf("M");
            return d >= 0 && m >= 0 && d < m;
        } catch {
            return false;
        }
    }

    // ---------------------------------------------------------------- the format in use

    /**
     * The daily notes' names' format when the box would take it, else "YYYY-MM-DD"; "M/D/YY" without
     * Plainday's settings or Schedule. What an empty box gives.
     * @returns {string}
     */
    names() {
        const schedule = plainday?.Schedule;
        if (!plainday?.Settings?.get?.()?.dates || !schedule) return Dates.FALLBACK;
        const names = schedule.dailyOpts?.()?.format;
        return Dates.parse(names) ? String(names).trim() : Dates.NAMES_FALLBACK;
    }

    /**
     * The format Plainday writes dates in: the box's while *Use custom display format* is on and it holds
     * one, else the daily notes' names' (names())
     * @returns {string}
     */
    format() {
        const set = plainday?.Settings?.get?.()?.dates;
        if (set?.custom && Dates.parse(set.format)) return set.format.trim();
        return this.names();
    }

    /**
     * The format's parts
     * @param {string} [format]
     * @returns {FormatParts}
     */
    parts(format = this.format()) {
        return Dates.parse(format) ?? /** @type {FormatParts} */ (Dates.parse(Dates.FALLBACK));
    }

    /**
     * Whether a date typed with its day and month is read day first: as the format orders them, or, for a
     * format that starts with the year and so doesn't say, as Obsidian's language writes them
     * @returns {boolean}
     */
    dayFirst() {
        const p = this.parts();
        return p.yearFirst ? Dates.languageDayFirst() : p.dayFirst;
    }

    // ---------------------------------------------------------------- the forms

    /**
     * A date without its year: "9/17", "17.09.", "09-17"
     * @param {DateLike} date
     * @param {string} [format]
     * @returns {string}
     */
    day(date, format = this.format()) {
        return Dates.render(this.parts(format).short, date);
    }

    /**
     * A date with its year, in the whole format: "9/17/26", "17.09.2026"; `long` for a four-digit year, as
     * the invoice date prints it ("9/12/2026")
     * @param {DateLike} date
     * @param {boolean} [long]
     * @param {string} [format]
     * @returns {string}
     */
    year(date, long = false, format = this.format()) {
        const full = this.parts(format).full;
        return Dates.render(long ? full.replace(/YYYY|YY/, "YYYY") : full, date);
    }

    /**
     * A week by its first day: "Wk of 9/20"
     * @param {DateLike} date
     * @param {string} [format]
     * @returns {string}
     */
    week(date, format = this.format()) {
        return `Wk of ${this.day(date, format)}`;
    }

    /**
     * Two days as a range: "9/13-9/19", or "09-13–09-19" with an en dash when the format joins with a dash
     * @param {DateLike} from
     * @param {DateLike} to
     * @param {string} [format]
     * @returns {string}
     */
    range(from, to, format = this.format()) {
        return `${this.day(from, format)}${this.parts(format).sep === "-" ? "–" : "-"}${this.day(to, format)}`;
    }

    /**
     * A day and month typed with the format's own joiner when that isn't a slash ("5.10." under DD.MM.YYYY,
     * "5-10" under YYYY-MM-DD), with a year after or without, as the date readers read it: with slashes, in
     * the same order ("5/10"), which they read in the order dayFirst() gives (DateWords.chrono). Null for
     * anything else, which they read as typed.
     * @param {string} text
     * @param {string} [format]
     * @returns {string | null}
     */
    slashed(text, format = this.format()) {
        const { sep } = this.parts(format);
        if (sep === "/") return null;
        const s = sep === "." ? "\\." : "-";
        const m = String(text ?? "").trim().match(new RegExp(`^(\\d{1,2})${s}(\\d{1,2})(?:${s}(\\d{2}|\\d{4}))?${s}?$`));
        return m ? `${m[1]}/${m[2]}${m[3] ? `/${m[3]}` : ""}` : null;
    }
}
