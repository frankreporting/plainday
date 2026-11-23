import { moment } from "obsidian";
import { chronoEn } from "../host.js";

/** @import { DateReader, MomentFn, ParsedPeriod } from "../host.js" */
/** @import { Chrono, Parser, ParsedResult, ParsingOption } from "chrono-node" */
/**
 * A unit a date moves by, as Revived names them:
 * @typedef {"minute" | "hour" | "day" | "week" | "month" | "year" | "quarter"} DateUnit
 *
 * Revived's patterns (patterns()): its ordinal words with their numbers, the pattern an ordinal
 * matches, and one regular expression per rule.
 * @typedef {{
 *   ordinals: Record<string, number>, ordinal: string, inUnits: RegExp, weekdayAt: RegExp, weekday: RegExp,
 *   bareWeekday: RegExp, range: RegExp, ordinalOf: RegExp, lastDayOf: RegExp, weekdayOf: RegExp,
 *   nextPeriod: RegExp, periodAfter: RegExp, periodBefore: RegExp, quarter: RegExp, yearQuarter: RegExp,
 *   isoWeek: RegExp,
 * }} Patterns
 */

// Plainday's own reader of dates typed in words, in English (OBS-139): the date box behind Schedule,
// Due date, Jump to date and Invoice reads with it (DatePrompt).
//
// It's the reader Natural Language Dates (Revived) 0.9.85 has in English: chrono-node, the date
// library Revived runs on, with Revived's own rules on top, copied here. A bare weekday is the
// coming one, `next friday` is next week's, `in 3 days`, `the 15th of next month`, `next week` as
// a week, `Q3` as a quarter. Revived's rules are under the MIT License, Copyright (c) 2021 Argentina
// Ortega Sáinz (https://github.com/Amato21/nldates-revived); chrono-node's under the MIT License,
// Copyright (c) 2014, Wanasit Tanakitrungruang. main.js starts with both notices.
//
// The one difference: chrono-node here is newer than the one inside Revived, and reads "end of
// october" whole (10/31, where Revived reads "october", 10/1) and "end of month" (Revived can't).
//
// at(now) gives the three answers DatePrompt asks a reader for, in Revived's own shape, so the date
// box reads both the same way: parseDate(text), parser.getParsedPeriod(text), and
// parser.getParsedDateResult(text, ref, opts) with parser.getParsedResult(text). Dates are plain
// Dates, on the computer's clock and time zone, as Revived's are.

export default class DateWords {
    // The words for each unit, as Revived spells them in English. `m` is both a minute and a month:
    // Revived's last word for it wins, a month.
    /** @type {Record<DateUnit, string[]>} */
    static UNITS = {
        minute: ["minute", "minutes", "min", "mins", "m"],
        hour: ["hour", "hours", "h", "hr", "hrs"],
        day: ["day", "days", "d"],
        week: ["week", "weeks", "w"],
        month: ["month", "months", "m", "mo"],
        year: ["year", "years", "y", "yr", "yrs"],
        quarter: ["quarter", "quarters", "q", "qtr"],
    };
    /** @type {Record<string, number>} */
    static WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
    /** @type {Record<string, number>} */
    static ORDINAL_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
    // A number's ending as Revived reads it: 16th, and its other languages' 16e, 16ème, 16.
    static ORDINAL_END = /(?:st|nd|rd|th|ème|er|e|\.)$/i;

    // Made on first use: chrono-node's English with Revived's extra rule, { casual, gb } (gb is
    // British English, day before month, which Revived reads with when Obsidian's language is English
    // (UK)); and Revived's patterns, with its ordinal words and their numbers
    /** @type {{ casual: Chrono, gb: Chrono } | null} */
    static parsers = null;
    /** @type {Patterns | null} */
    static made = null;

    // ---------------------------------------------------------------- what DatePrompt asks

    // Revived's three answers, read by this reader with `now` as the clock
    /**
     * @param {Date} [now]
     * @returns {DateReader}
     */
    at(now = new Date()) {
        return {
            // Revived's plugin.parseDate: the period's first day for a week, month or year, else the day
            parseDate: (text) => ({ moment: /** @type {MomentFn} */ (moment)(this.parseDate(text, now)) }),
            parser: {
                getParsedPeriod: (text) => this.period(text, now),
                getParsedDateResult: (text, ref = now, opts = {}) => this.chronoDate(text, ref, opts),
                getParsedResult: (text) => this.chronoResults(text, now),
            },
        };
    }

    // The date the words name, as Revived's plugin.parseDate gives it
    /**
     * @param {string} text
     * @param {Date} now
     * @returns {Date | null}
     */
    parseDate(text, now) {
        const p = this.period(text, now);
        return p.granularity === "quarter" ? this.date(text, now) : p.date;
    }

    // What chrono-node alone reads, Revived's extra rule included: the date of the longest stretch of
    // words it read, or null
    /**
     * @param {string} text
     * @param {Date} ref
     * @param {ParsingOption} [opts]
     * @returns {Date | null}
     */
    chronoDate(text, ref, opts = {}) {
        try {
            return DateWords.longest(this.chrono().parse(text, ref, opts))?.start.date() ?? null;
        } catch {
            return null;
        }
    }

    // Every stretch of words chrono-node read, as its results
    /**
     * @param {string} text
     * @param {Date} now
     * @returns {ParsedResult[]}
     */
    chronoResults(text, now) {
        try {
            return this.chrono().parse(text, now);
        } catch {
            return [];
        }
    }

    // ---------------------------------------------------------------- Revived's rules

    // A day, as Revived's getParsedDate reads it: its own rules in order, then chrono-node. Words it
    // can't read at all are `now`, as Revived's are; DatePrompt tells those apart.
    /**
     * @param {string} text
     * @param {Date} now
     * @returns {Date | null}
     */
    date(text, now) {
        const R = this.patterns();
        const W = DateWords.WEEKDAYS;
        const cleaned = String(text).trim().replace(/[!?.]+$/, "");
        const t = cleaned.toLowerCase();
        const add = DateWords.add;
        const day = (/** @type {string} */ word) => W[word.toLowerCase()];
        /** @type {RegExpMatchArray | null} */
        let m;

        if (t === "now" || t === "today") return new Date(now.getTime());

        // "3 days ago"
        if ((m = t.match(/^(\d+)\s+(\w+)\s+ago$/i))) return add(now, -Number(m[1]), this.unitOf(m[2]));

        // "in 2 weeks and 3 days"
        if (/^in\s+/i.test(cleaned)) {
            const parts = cleaned.replace(/^in\s+/i, "").split(/\s+and\s+/gi).filter((p) => p && p.trim().toLowerCase() !== "and");
            if (parts.length >= 2) {
                let x = new Date(now.getTime());
                let any = false;
                for (const part of parts) {
                    const u = part.trim().match(/^(\d+)\s+(\S+)$/i);
                    if (u) { x = add(x, Number(u[1]), this.unitOf(u[2].toLowerCase())); any = true; }
                }
                if (any) return x;
            }
        }
        // "in 3 days"
        if ((m = cleaned.match(R.inUnits))) return add(now, Number(m[1]), this.unitOf(m[2].toLowerCase()));

        if (t === "tomorrow") return add(now, 1, "day");
        if (t === "yesterday") return add(now, -1, "day");

        // "from monday to friday": the coming Monday
        if ((m = cleaned.match(R.range))) return DateWords.coming(now, day(m[1]));

        // "next friday at 3pm": the day, then the time read from it
        if ((m = cleaned.match(R.weekdayAt))) {
            const x = this.weekday(now, m[1], day(m[2]));
            return this.chronoDate(m[3].trim(), x) ?? x;
        }
        // "this friday", "next friday", "last friday", in weeks that start on Sunday
        if ((m = cleaned.match(R.weekday))) return this.weekday(now, m[1], day(m[2]));
        // "friday": the coming one, today included
        if ((m = cleaned.match(R.bareWeekday))) return DateWords.coming(now, day(m[1]));

        // "the 15th of next month", "the 100th of this year"
        if ((m = cleaned.match(R.ordinalOf))) {
            const n = this.ordinal(m[1].trim());
            const unit = (m[3] ?? "").toLowerCase();
            const which = (m[4] || m[2] || "").toLowerCase();
            const units = DateWords.UNITS;
            if (units.month.includes(unit)) {
                const x = this.monthOf(now, which);
                x.setDate(Math.min(n, DateWords.daysIn(x)));
                return x;
            }
            if (units.year.includes(unit)) {
                const y = now.getFullYear() + DateWords.step(which);
                const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
                return new Date(y, 0, Math.min(n, leap ? 366 : 365));
            }
            return new Date(now.getTime());
        }

        // "last day of next month"
        if ((m = cleaned.match(R.lastDayOf))) {
            const which = (m[6] || m[4] || m[1] || "").toLowerCase();
            if (!DateWords.UNITS.month.includes((m[5] ?? "").toLowerCase())) return null;
            return DateWords.endOfMonth(this.monthOf(now, which));
        }

        // "first monday of next month", "last friday of this month"
        if ((m = cleaned.match(R.weekdayOf)) && DateWords.UNITS.month.includes((m[4] ?? "").toLowerCase())) {
            const first = m[1].toLowerCase() === "first";
            const i = day(m[2]);
            const which = (m[5] || m[3] || "").toLowerCase();
            if (!first && m[1].toLowerCase() === "last") {
                const end = DateWords.endOfMonth(this.monthOf(now, which));
                end.setDate(end.getDate() - (end.getDay() - i + 7) % 7);
                return end;
            }
            const start = first ? this.monthOf(now, which) : DateWords.step(which) === 1 ? add(DateWords.startOfMonth(now), 1, "month") : DateWords.startOfMonth(now);
            start.setDate(1 + (i - start.getDay() + 7) % 7);
            return start;
        }

        // "next month" or "next year" anywhere in the words: its first day
        if ((m = cleaned.match(R.nextPeriod))) {
            const u = m[2].toLowerCase();
            if (DateWords.UNITS.month.includes(u) && !DateWords.UNITS.week.includes(u)) return add(DateWords.startOfMonth(now), 1, "month");
            if (DateWords.UNITS.year.includes(u)) return new Date(now.getFullYear() + 1, 0, 1);
        }

        return this.chronoDate(text, now, { forwardDate: true }) ?? new Date(now.getTime());
    }

    // A period, as Revived's getParsedPeriod reads it: { date, granularity } with granularity "day",
    // "week", "month", "quarter" or "year" and date its first day (a week's ISO Monday; "this week"
    // stays today). Anything that isn't a period is a day.
    /**
     * @param {string} text
     * @param {Date} now
     * @returns {ParsedPeriod}
     */
    period(text, now) {
        const R = this.patterns();
        const t = String(text).trim().replace(/[!?.]+$/, "");
        let m = t.match(R.quarter) ?? t.match(R.yearQuarter);
        if (m) {
            const yearFirst = m[1].length === 4;
            const q = Number(yearFirst ? m[2] : m[1]);
            const y = yearFirst ? Number(m[1]) : m[2] ? Number(m[2]) : now.getFullYear();
            return { date: new Date(y, 3 * (q - 1), 1), granularity: "quarter" };
        }
        if ((m = t.match(R.isoWeek))) {
            const y = Number(m[1]);
            const jan4 = new Date(y, 0, 4);
            return { date: new Date(y, 0, 4 - (jan4.getDay() + 6) % 7 + 7 * (Number(m[2]) - 1)), granularity: "week" };
        }
        const before = t.match(R.periodAfter);
        const after = before ? null : t.match(R.periodBefore);
        const hit = before ? { which: before[1], unit: before[2] } : after ? { which: after[2], unit: after[1] } : null;
        if (hit) {
            const units = DateWords.UNITS;
            const which = DateWords.step(hit.which.toLowerCase());
            const u = hit.unit.toLowerCase();
            const g = units.week.includes(u) ? "week" : units.month.includes(u) ? "month" : units.quarter.includes(u) ? "quarter" : units.year.includes(u) ? "year" : null;
            if (g) {
                let x = DateWords.add(now, which, g);
                if (which !== 0 || g !== "week") {
                    if (g === "week") x = new Date(x.getFullYear(), x.getMonth(), x.getDate() - (x.getDay() + 6) % 7);
                    else if (g === "month") x = DateWords.startOfMonth(x);
                    else if (g === "quarter") x = new Date(x.getFullYear(), 3 * Math.floor(x.getMonth() / 3), 1);
                    else x = new Date(x.getFullYear(), 0, 1);
                }
                return { date: x, granularity: g };
            }
        }
        return { date: this.date(text, now), granularity: "day" };
    }

    // ---------------------------------------------------------------- the parts

    // chrono-node's English with Revived's extra rule: a number from 1 to 31, with or without its
    // ending, or an ordinal word, is that day of the reference month ("the 16th")
    /** @returns {Chrono} */
    chrono() {
        if (!DateWords.parsers) {
            /** @type {Parser} */
            const day = {
                pattern: () => new RegExp(this.patterns().ordinal),
                extract: (context, match) => ({ day: this.ordinal(match[0]), month: context.refDate.getMonth() + 1 }),
            };
            const make = (/** @type {Chrono} */ base) => { const c = base.clone(); c.parsers.push(day); return c; };
            DateWords.parsers = { casual: make(chronoEn.casual), gb: make(chronoEn.GB) };
        }
        return moment.locale() === "en-gb" ? DateWords.parsers.gb : DateWords.parsers.casual;
    }

    /** @returns {Patterns} */
    patterns() {
        if (DateWords.made) return DateWords.made;
        const U = DateWords.UNITS;
        // Alternatives, longest first, so "mon" doesn't win over "monday"
        const alt = (/** @type {string[]} */ words) => [...new Set(words)].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
        const ordinals = { ...DateWords.ORDINAL_WORDS };
        for (const [w, n] of Object.entries(DateWords.ORDINAL_WORDS).slice(0, 9)) { ordinals[`twenty ${w}`] = 20 + n; ordinals[`twenty-${w}`] = 20 + n; }
        ordinals["thirty first"] = 31;
        ordinals["thirty-first"] = 31;
        const ord = `(?:${alt(Object.keys(ordinals))}|[0-9]{1,2}(?:st|nd|rd|th|ème|er|e|\\.)?)`;
        const which = alt(["this", "next", "last"]);
        const wd = alt(Object.keys(DateWords.WEEKDAYS));
        const unit = alt([...U.minute, ...U.hour, ...U.day, ...U.week, ...U.month, ...U.year]);
        const period = alt([...U.week, ...U.month, ...U.year, ...U.quarter]);
        const re = (/** @type {string} */ s) => new RegExp(s, "i");
        DateWords.made = {
            ordinals,
            ordinal: ord,
            inUnits: re(`^\\s*in\\s+(\\d+)\\s*(${unit})\\s*$`),
            weekdayAt: re(`^\\s*(${which})\\s*(${wd})\\s+at\\s+(.+)$`),
            weekday: re(`^\\s*(${which})\\s*(${wd})\\s*$`),
            bareWeekday: re(`^\\s*(${wd})\\s*$`),
            range: re(`^\\s*from\\s*(${wd})\\s*(?:to|until|till)\\s*(${wd})\\s*$`),
            ordinalOf: re(`^\\s*(?:the|le|der|das|el|il|o|de|het)?\\s*(${ord})\\s+of\\s+(?:(${which})\\s+)?(${unit})(?:\\s+(${which}))?\\s*$`),
            lastDayOf: re(`^\\s*(?:(${which})\\s+)?(last)\\s+(${alt(U.day)})\\s+of\\s+(?:(${which})\\s+)?(${unit})(?:\\s+(${which}))?\\s*$`),
            weekdayOf: re(`^\\s*(first|${which})\\s+(${wd})\\s+of\\s+(?:(${which})\\s+)?(${unit})(?:\\s+(${which}))?\\s*$`),
            nextPeriod: re(`(next)\\s*(${alt([...U.week, ...U.month, ...U.year])})`),
            periodAfter: re(`^\\s*(${which})\\s*(${period})\\s*$`),
            periodBefore: re(`^\\s*(${period})\\s*(${which})\\s*$`),
            quarter: /^\s*q\s*([1-4])(?:\s+(\d{4}))?\s*$/i,
            yearQuarter: /^\s*(\d{4})\s*[-\s]\s*q\s*([1-4])\s*$/i,
            isoWeek: /^\s*(\d{4})-w(\d{1,2})\s*$/i,
        };
        return DateWords.made;
    }

    // The unit a word names. A word in two lists ("m") is the later one's, as in Revived, and one in
    // none is guessed from its first letters, as Revived guesses (some of them for its other
    // languages).
    /**
     * @param {string} word
     * @returns {DateUnit}
     */
    unitOf(word) {
        const w = word.toLowerCase();
        const listed = /** @type {DateUnit[]} */ (["minute", "hour", "day", "week", "month", "year"]).filter((u) => DateWords.UNITS[u].includes(w)).pop();
        if (listed) return listed;
        if (w.startsWith("h")) return "hour";
        if (w.startsWith("d") || w.startsWith("j")) return "day";
        if (w.startsWith("w") || w.startsWith("s")) return "week";
        if (w.startsWith("min")) return "minute";
        if (w.startsWith("mo")) return "month";
        if (w.startsWith("y") || w.startsWith("a")) return "year";
        return "day";
    }

    // "this", "next" or "last" friday, in weeks that start on Sunday
    /**
     * @param {Date} now
     * @param {string} which
     * @param {number} i
     * @returns {Date}
     */
    weekday(now, which, i) {
        const step = DateWords.step(which.toLowerCase());
        const x = DateWords.setWeekday(now, i);
        return step === 0 ? x : DateWords.add(x, step, "week");
    }

    // The first day of this, next or last month
    /**
     * @param {Date} now
     * @param {string} which
     * @returns {Date}
     */
    monthOf(now, which) {
        return DateWords.add(DateWords.startOfMonth(now), DateWords.step(which), "month");
    }

    // 1 for "next", -1 for "last", 0 otherwise
    /** @param {string} which @returns {number} */
    static step(which) {
        return which === "next" ? 1 : which === "last" ? -1 : 0;
    }

    // The number an ordinal names: "16th", "16", "sixteenth"
    /** @param {string} text @returns {number} */
    ordinal(text) {
        const t = text.toLowerCase();
        return this.patterns().ordinals[t] ?? parseInt(t.replace(DateWords.ORDINAL_END, ""));
    }

    // The longest of chrono-node's results, or null
    /** @param {ParsedResult[]} results @returns {ParsedResult | null} */
    static longest(results) {
        return results.reduce((best, r) => (!best || r.text.length > best.text.length ? r : best), /** @type {ParsedResult | null} */ (null));
    }

    // ---------------------------------------------------------------- dates, the way moment counts them

    // `n` units on from a date; months and years keep the day, or the month's last when it's shorter
    // (Jan 31 + 1 month is Feb 28)
    /**
     * @param {Date} date
     * @param {number} n
     * @param {DateUnit} unit
     * @returns {Date}
     */
    static add(date, n, unit) {
        const x = new Date(date.getTime());
        if (unit === "minute") x.setMinutes(x.getMinutes() + n);
        else if (unit === "hour") x.setHours(x.getHours() + n);
        else if (unit === "day") x.setDate(x.getDate() + n);
        else if (unit === "week") x.setDate(x.getDate() + 7 * n);
        else {
            const months = unit === "year" ? 12 * n : unit === "quarter" ? 3 * n : n;
            const day = x.getDate();
            x.setDate(1);
            x.setMonth(x.getMonth() + months);
            x.setDate(Math.min(day, DateWords.daysIn(x)));
        }
        return x;
    }

    // The day of the same Sunday-to-Saturday week that's weekday `i` (0 is Sunday)
    /** @param {Date} date @param {number} i @returns {Date} */
    static setWeekday(date, i) {
        const x = new Date(date.getTime());
        x.setDate(x.getDate() - x.getDay() + i);
        return x;
    }

    // Weekday `i`'s next day, today included
    /** @param {Date} now @param {number} i @returns {Date} */
    static coming(now, i) {
        const x = DateWords.setWeekday(now, i);
        const day = (/** @type {Date} */ d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        return day(x) < day(now) ? DateWords.add(x, 1, "week") : x;
    }

    /** @param {Date} date @returns {number} */
    static daysIn(date) {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    }

    /** @param {Date} date @returns {Date} */
    static startOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    /** @param {Date} date @returns {Date} */
    static endOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    }
}
