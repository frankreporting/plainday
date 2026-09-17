// Start and end time of the calendar event a new log was made from, called from the Log
// template as tp.user.eventTimes(dailyNoteText, logName).
// Finds the daily note line that links to the log, e.g.
//     - [<] 1:30pm⇥[[2026-09-09 Intro call with Imogen Fenwick|…]]
//     ⇥- 1:40pm
// and returns { time: "1:30pm", endTime: "1:40pm" }. The line under it is the calendar sync's end
// time, or a time entry ("1:30pm - 2:15pm") once you've edited it, whose last time is the end.
// Older daily notes have no end line ("4:30pm ⇥[[…]]"), so endTime can be "". Returns null if no
// line with a time links to the log. All-day events have no time, so they don't count.

const TIME = /\d{1,2}:\d{2}\s?[ap]m/i;

function eventTimes(text, logName) {
    const lines = String(text ?? "").split("\n");
    const escaped = logName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const link = new RegExp(`\\[\\[${escaped}(?:\\.md)?(?:[|#\\]])`);
    for (let i = 0; i < lines.length; i++) {
        if (!link.test(lines[i])) continue;
        const start = lines[i].match(new RegExp(`^\\s*(?:[-*+]\\s+(?:\\[.\\]\\s+)?)?(${TIME.source})\\s*\\t`, "i"));
        if (!start) continue;
        const end = (lines[i + 1] ?? "").match(new RegExp(`^\\s+[-*+]\\s+(${TIME.source})(?:\\s*[-–—]\\s*(${TIME.source}))?`, "i"));
        return { time: normal(start[1]), endTime: end ? normal(end[2] ?? end[1]) : "" };
    }
    return null;
}

const normal = (t) => t.replace(/\s/g, "").toLowerCase();

module.exports = eventTimes;
