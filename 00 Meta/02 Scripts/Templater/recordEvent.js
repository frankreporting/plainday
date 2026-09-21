// Records a new log in its daily note (OBS-10), called from the Log template as
//     tp.user.recordEvent(dailyNoteText, { log, title, time }, customJS.CalendarSync, fresh)
// `log` is the note's name ("2026-09-16 Planning"), `title` the title without the date, and `time`
// (optional) the start to prefer when several lines share the title. `sync` is the calendar sync,
// whose line shape, matching and sort order this borrows rather than copies. Returns
// { text, outcome }, where the outcome is one of:
// - "present":  a checklist line's title already links the log (the log was made from it), so
//               nothing changes. A link to the log elsewhere (a task's 🔗, a mention in prose you
//               clicked to make the note) isn't its line.
// - "linked":   the [<] event line whose title is the log's title, timed or not, gets that title
//               wrapped as [[log|title]], keeping the rest of the line and the lines under it.
//               Exact title first, then exact but for case, else the one line the title is a
//               prefix of, as the sync's own adoption goes. A line whose title is already a link,
//               or has one in it, is never taken.
// - "inserted": no such line, so `- [<] [[log|title]]` is added. A log with no time can't sort
//               among the timed events, so it goes after them, above the tasks. In a note just
//               created from its template (`fresh`, or text that still opens with the template's
//               `<%`), it goes at the end, after the template's code, which Templater replaces
//               with the frontmatter a moment later.
// - "skipped":  no title to record
// The sync adopts an inserted line when the event reaches the calendar, and gives it its time.

// A checklist line: its lead, marker, the date link a forwarded event carries, its start (all
// day or a time, before a tab) and the rest
const LINE = /^(\s*[-*+]\s+\[(.)\]\s+)(?:\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s+)?(?:(all day|\d{1,2}:\d{2}\s?[ap]m)\t)?(.*)$/i;

function recordEvent(text, { log, title, time = "" }, sync, fresh = false) {
    text = String(text ?? "");
    if (!title) return { text, outcome: "skipped" };
    const lines = text.split("\n");
    const LOG_LINK = sync.constructor.LOG_LINK;

    const wanted = normal(time);
    const candidates = [];
    for (const [i, line] of lines.entries()) {
        const match = line.match(LINE);
        if (!match) continue;
        const { rest } = sync.splitTail(match[4]);
        const link = rest.match(LOG_LINK);
        if (link && link[1].trim().split("/").pop().replace(/\.md$/, "") === log) return { text, outcome: "present" };
        if (match[2] !== "<" || !rest || rest.includes("[[")) continue;
        if (wanted && (!match[3] || normal(match[3]) !== wanted)) continue;
        candidates.push({ i, rest, at: line.length - match[4].length + match[4].indexOf(rest) });
    }
    const lower = title.toLowerCase();
    let found = candidates.find((c) => c.rest === title) ?? candidates.find((c) => c.rest.toLowerCase() === lower);
    if (!found) {
        // A prefix match only when one line could possibly be meant, as the sync adopts
        const near = candidates.filter((c) => c.rest.startsWith(title));
        if (new Set(near.map((c) => lines[c.i])).size === 1) found = near[0];
    }
    if (found) {
        const line = lines[found.i];
        lines[found.i] = `${line.slice(0, found.at)}[[${log}|${found.rest}]]${line.slice(found.at + found.rest.length)}`;
        return { text: lines.join("\n"), outcome: "linked" };
    }

    const block = [`- [<] [[${log}|${title}]]`];
    if (fresh || /^\s*<%/.test(text)) {
        const body = text.replace(/\s+$/, "");
        return { text: `${body ? body + "\n" : ""}${block[0]}\n`, outcome: "inserted" };
    }
    return { text: sync.insert(lines, block), outcome: "inserted" };
}

const normal = (t) => String(t ?? "").replace(/\s/g, "").toLowerCase();

module.exports = recordEvent;
