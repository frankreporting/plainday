// A date reader that gives the answers Natural Language Dates (Revived) gave, as
// datePrompt.revived.json records them (plugin/test/recordRevived.mjs): the three answers
// DatePrompt.readWith() asks a reader for, in Revived's own shape, on one recorded day. Plainday's
// own reader (DateWords) gives the same answers but for a few phrases (plugin/test/dateWords.test.mjs),
// so the date box's tests read through this one, in plain Node, without chrono-node.
import assert from "node:assert/strict";
import fs from "node:fs";

export const RECORD = JSON.parse(fs.readFileSync(new URL("datePrompt.revived.json", import.meta.url), "utf8"));

// The reader on `day` ("2026-09-27"). A phrase the record doesn't have is pushed on `missing` and
// reads as nothing, so a test can check that every phrase it used was recorded.
export function recordedReader(day, missing = []) {
    const rows = RECORD.days[day];
    if (!rows) throw new Error(`no recorded day ${day}`);
    const row = (t) => rows[t] ?? (missing.push(`${day} ${t}`), { parseDate: null, period: { date: day, granularity: "day" }, chronoDate: null, chronoWords: [], chronoBest: null });
    const local = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
    return {
        settings: { weekStart: "locale-default" },
        parseDate: (t) => {
            const r = row(t);
            return { moment: r.parseDate ? { isValid: () => true, format: () => r.parseDate } : { isValid: () => false } };
        },
        parser: {
            getParsedPeriod: (t) => ({ date: local(row(t).period.date), granularity: row(t).period.granularity }),
            getParsedDateResult: (t, now, opts) => {
                assert.equal(opts?.forwardDate, true, "asks chrono the way Revived's fallback does");
                return row(t).chronoDate ? local(row(t).chronoDate) : null;
            },
            // Each stretch of words read; the longest says which of year, month and day it stated
            getParsedResult: (t) => row(t).chronoWords.map((text) => {
                const best = row(t).chronoBest;
                return { text, start: { isCertain: (part) => (best && best.text === text ? !!best[part] : false) } };
            }),
        },
    };
}
