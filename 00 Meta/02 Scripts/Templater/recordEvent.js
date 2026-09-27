// Records a new log in its daily note (OBS-10), called from the Log template as
//     tp.user.recordEvent(dailyNoteText, { log, title, time }, customJS.CalendarSync, fresh)
// `log` is the note's name ("2026-09-16 Planning"), `title` the title without the date, and `time`
// (optional) the start to prefer when several lines share the title. `sync` is the calendar sync,
// whose line shape, matching and sort order this borrows rather than copies. `drop` (optional) is
// ⭕ or 🗃️ links, as written, to take off the event line once the log is linked: the Log template
// files a log in the project its line names, and then the line needs no ⭕ of its own (OBS-57).
// Returns { text, outcome, line }, where `line` is the event line as it was before this call (the
// one found present or linked, so the template can read its ⭕ links), or null, and the outcome is
// one of:
// - "present":  an event line already links the log (the log was made from it), so nothing
//               changes: with its note link at the end, `Title [[log|🗒️]]` (🔗 before OBS-87),
//               or with its title wrapped in the link, the way lines were written before OBS-57
//               (any checklist line whose whole title is the link). A link to the log elsewhere
//               (a task's 🗒️, a mention in prose you clicked to make the note) isn't its line.
// - "linked":   the [<] event line whose title is the log's title, timed or not, gets
//               ` [[log|🗒️]]` after the title and its marks, before any ⭕, keeping the rest of
//               the line and the lines under it. Exact title first, then exact but for case, else
//               the one line the title is a prefix of, as the sync's own adoption goes. A line
//               that already links a log, or has a link in its title, is never taken.
// - "inserted": no such line, so `- [<] title [[log|🗒️]]` is added. A log with no time can't sort
//               among the timed events, so it goes after them, above the tasks. In a note just
//               created from its template (`fresh`, or text that still opens with the template's
//               `<%`), it goes at the end, after the template's code, which Templater replaces
//               with the frontmatter a moment later.
// - "skipped":  no title to record
// The sync adopts an inserted line when the event reaches the calendar, and gives it its time.

// A checklist line: its lead, marker, the date link a forwarded event carries, its start (all
// day or a time, before the sync's tab or, on a line typed by hand, a space) and the rest
const LINE = /^(\s*[-*+]\s+\[(.)\]\s+)(?:\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s+)?(?:(all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+)?(.*)$/i;

function recordEvent(text, { log, title, time = "", drop = [] }, sync, fresh = false) {
    text = String(text ?? "");
    if (!title) return { text, outcome: "skipped", line: null };
    const lines = text.split("\n");
    const { LOG_LINK, NOTE_MARK } = sync.constructor;
    const logOf = (link) => link.match(/^\[\[([^[\]|]+)/)?.[1].split("#")[0].trim().split("/").pop().replace(/\.md$/, "");

    const wanted = normal(time);
    const candidates = [];
    for (const [i, line] of lines.entries()) {
        const match = line.match(LINE);
        if (!match) continue;
        const { rest, log: linked } = sync.splitTail(match[4], true);
        const event = match[2] === "<" || !!match[3];
        if ((rest.match(LOG_LINK) && logOf(rest) === log) || (linked && event && logOf(linked) === log)) {
            const dropped = without(line, drop);
            if (dropped === line) return { text, outcome: "present", line };
            lines[i] = dropped;
            return { text: lines.join("\n"), outcome: "present", line };
        }
        if (match[2] !== "<" || !rest || rest.includes("[[") || linked) continue;
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
        // After the title and its ℹ️ or 🆓, before the first ⭕ (or at the end)
        const line = lines[found.i];
        const end = found.at + found.rest.length;
        const tail = line.slice(end);
        const cut = tail.indexOf("[[");
        const marks = (cut === -1 ? tail : tail.slice(0, cut)).trimEnd();
        lines[found.i] = without(`${line.slice(0, end)}${marks} [[${log}|${NOTE_MARK}]]${cut === -1 ? "" : " " + tail.slice(cut)}`, drop);
        return { text: lines.join("\n"), outcome: "linked", line };
    }

    const block = [`- [<] ${title} [[${log}|${NOTE_MARK}]]`];
    if (fresh || /^\s*<%/.test(text)) {
        const body = text.replace(/\s+$/, "");
        return { text: `${body ? body + "\n" : ""}${block[0]}\n`, outcome: "inserted", line: null };
    }
    return { text: sync.insert(lines, block), outcome: "inserted", line: null };
}

// `line` without each of `links` (as written) and the space before it
function without(line, links) {
    for (const link of links) {
        const at = line.lastIndexOf(link);
        if (at === -1) continue;
        let from = at;
        while (from > 0 && /[ \t]/.test(line[from - 1])) from--;
        line = line.slice(0, from) + line.slice(at + link.length);
    }
    return line;
}

const normal = (t) => String(t ?? "").replace(/\s/g, "").toLowerCase();

module.exports = recordEvent;
