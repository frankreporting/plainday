import { plainday } from "../host.js";

/** @import { Moment } from "moment" */
/**
 * A date as the writers hold it: "YYYY-MM-DD", or a moment
 * @typedef {string | Moment} DateLike
 *
 * A date format read into its parts (Dates.parse): whether the day comes first, what joins the day
 * and the month, and whether the format ends with it too ("D.M.")
 * @typedef {{ dayFirst: boolean, sep: string, trailing: boolean }} FormatParts
 */

export default class Dates {
    // How Plainday writes a date (OBS-309): every 🚩, forward date, report column, timesheet, invoice,
    // Problem, notice, dialog and alias asks here, so they all follow the format set in Settings →
    // Plainday → Dates. The format is the day and the month as numbers (D or DD, M or MM), in either
    // order, joined by a slash, a dot or a dash, and maybe ending with it: "M/D", "D/M", "D.M.",
    // "DD-MM". With *Use my region's format* on, or the box empty, it's the computer's region's
    // (region()); without Plainday's settings (the Raycast timer, a test that sets none), "M/D".
    //
    // The forms:
    //   - day():      "9/17", "17.9."
    //   - year():     "9/17/26", "17.9.26": the year after the day and month, joined the way they are
    //   - week():     "Wk of 9/20"
    //   - range():    "9/13-9/19", "13.9.-19.9.", or with an en dash when the format joins with a dash
    // A weekday goes in front, in the words each place already uses ("Fri 9/11"), and moment-free, so
    // the time report's helpers can ask here and keep their own "M/D" where Plainday isn't loaded.
    //
    // What reads a label back: TimeReport.labelDay, in the format set now; the patterns that find a
    // label by its shape accept any of the three joiners, so labels written in an earlier format still
    // read.
    static FALLBACK = "M/D";
    // The format's own rule: one D or DD and one M or MM, either first, with /, . or - between them, and
    // a dot after them when they're joined by one ("D.M."): the patterns that find a label by its shape
    // take a trailing dot only (lookaheads, not lookbehinds, which older iPhones can't run)
    static FORMAT = /^(?=[^D]*D{1,2}[^D]*$)(?=[^M]*M{1,2}[^M]*$)(?:D{1,2}|M{1,2})(?:([/-])(?:D{1,2}|M{1,2})|(\.)(?:D{1,2}|M{1,2})\.?)$/;
    // A day whose day and month both have one digit, so a region that pads them shows two
    static PROBE = new Date(2026, 0, 2);
    // The region's format, read once
    /** @type {string | null} */
    static regionMade = null;

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
        const sep = m[1] ?? m[2];
        return { dayFirst: f.indexOf("D") < f.indexOf("M"), sep, trailing: f.endsWith(sep) };
    }

    /**
     * The format a region writes a day and month in, from Intl's parts for Dates.PROBE: a two-digit
     * part is padded; what joins them is kept without its spaces, so Korea's "1. 2." is "M.D.". A
     * region whose parts don't make a format the setting takes (another joiner, another calendar's
     * digits that don't read) gives "M/D".
     * @param {{ type: string, value: string }[]} parts
     * @returns {string}
     */
    static fromParts(parts) {
        let format = "";
        for (const { type, value } of parts) {
            if (type === "day") format += value.length > 1 ? "DD" : "D";
            else if (type === "month") format += value.length > 1 ? "MM" : "M";
            else if (type === "literal") format += value.replace(/[^./-]/g, "");
            else return Dates.FALLBACK;
        }
        return Dates.parse(format) ? format : Dates.FALLBACK;
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
     * A date's day and month in `format`, which parse() takes
     * @param {string} format
     * @param {DateLike} date
     * @returns {string}
     */
    static render(format, date) {
        const [, m, d] = Dates.ymd(date);
        const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
        return format.replace(/DD|D|MM|M/g, (t) => (t === "DD" ? two(d) : t === "D" ? String(d) : t === "MM" ? two(m) : String(m)));
    }

    // ---------------------------------------------------------------- the format in use

    /**
     * The computer's region's format, as Intl gives it in Obsidian
     * @returns {string}
     */
    region() {
        if (Dates.regionMade === null) {
            let parts = /** @type {{ type: string, value: string }[]} */ ([]);
            try { parts = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "numeric" }).formatToParts(Dates.PROBE); } catch { /* none */ }
            Dates.regionMade = Dates.fromParts(parts);
        }
        return Dates.regionMade;
    }

    /**
     * The format Plainday writes dates in: the one typed in Settings → Plainday → Dates while *Use my
     * region's format* is off, else the region's; "M/D" without Plainday's settings
     * @returns {string}
     */
    format() {
        const set = plainday?.Settings?.get?.()?.dates;
        if (!set) return Dates.FALLBACK;
        return !set.region && Dates.parse(set.format) ? set.format.trim() : this.region();
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
     * Whether the format puts the day first
     * @returns {boolean}
     */
    dayFirst() {
        return this.parts().dayFirst;
    }

    // ---------------------------------------------------------------- the forms

    /**
     * A date's day and month: "9/17", "17.9."
     * @param {DateLike} date
     * @param {string} [format]
     * @returns {string}
     */
    day(date, format = this.format()) {
        return Dates.render(format, date);
    }

    /**
     * With the year, joined as the day and month are: "9/17/26", "17.9.26"; `long` for the whole year,
     * as the invoice date prints it ("9/12/2026")
     * @param {DateLike} date
     * @param {boolean} [long]
     * @param {string} [format]
     * @returns {string}
     */
    year(date, long = false, format = this.format()) {
        const { sep, trailing } = this.parts(format);
        const y = String(Dates.ymd(date)[0]);
        return `${Dates.render(format, date)}${trailing ? "" : sep}${long ? y : y.slice(-2)}`;
    }

    /**
     * A week by its first day: "Wk of 9/20"
     * @param {DateLike} date
     * @param {string} [format]
     * @returns {string}
     */
    week(date, format = this.format()) {
        return `Wk of ${Dates.render(format, date)}`;
    }

    /**
     * Two days as a range: "9/13-9/19", or "13-09–19-09" with an en dash when the format joins with a dash
     * @param {DateLike} from
     * @param {DateLike} to
     * @param {string} [format]
     * @returns {string}
     */
    range(from, to, format = this.format()) {
        return `${Dates.render(format, from)}${this.parts(format).sep === "-" ? "–" : "-"}${Dates.render(format, to)}`;
    }

    /**
     * A day and month typed with the format's own joiner when that isn't a slash ("5.10." under D.M.,
     * "5-10" under D-M), with a year or without, as the date readers read it: with slashes, in the same
     * order ("5/10"), which they read in the format's order (DateWords.chrono). Null for anything else,
     * which they read as typed.
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
