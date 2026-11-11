// Records a new log in its daily note (OBS-10), called from the Log template as
//     tp.user.recordEvent(dailyNoteText, { log, title, time, home }, sync, fresh)
// `log` is the note's name ("2026-09-16 Planning"), `title` the title without the date, and `time`
// (optional) the start to prefer when several lines share the title. `sync` is the calendar sync,
// whose line shape, matching and sort order this borrows rather than copies. `home` (optional) is
// the ⭕ or 🗃️ link for the project or area the log is filed in: the event line's own ⭕ and 🗃️
// links give way to it, so the line and its log agree on where the meeting's time counts (OBS-90).
// Every note link ends its line, so the log's goes after the line's ⭕.
// Returns { text, outcome, line }, where `line` is the event line as it was before this call (the
// one found present or linked, so the template can read its ⭕ links), or null, and the outcome is
// one of:
// - "present":  an event line already links the log (the log was made from it), so nothing
//               changes but its ⭕: with its note link at the end, `Title [[log|⋯]]` (or ↗,
//               OBS-208), or with its title wrapped in the link, the way lines were written before
//               OBS-57 (any checklist line whose whole title is the link). A link to the log
//               elsewhere (a task's ⋯, a mention in prose you clicked to make the note) isn't its
//               line.
// - "linked":   the [<] event line whose title is the log's title, timed or not, gets
//               ` [[log|⋯]]` at the end, after the title, its marks and any ⭕, keeping the lines
//               under it. Exact title first, then exact but for case, else the one line the title
//               is a prefix of, as the sync's own adoption goes. A line that already links a log,
//               or has a link in its title, is never taken.
// - "inserted": no such line, so `- [<] title [[home|⭕]] [[log|⋯]]` is added (without the ⭕
//               when there's no `home`). A log with no time can't sort among the timed events, so
//               it goes after them, above the tasks. In a note just created from its template
//               (`fresh`, or text that still opens with the template's `<%`), it goes at the end,
//               after the template's code, which Templater replaces with the frontmatter a moment
//               later.
// - "skipped":  no title to record
// The sync adopts an inserted line when the event reaches the calendar, and gives it its time.

// A checklist line: its lead, marker, the date link a forwarded event carries, its start (all
// day or a time, before the sync's tab or, on a line typed by hand, a space) and the rest
const LINE = /^(\s*[-*+]\s+\[(.)\]\s+)(?:\[\[\d{4}-\d{2}-\d{2}\|[^\]]*\]\]\s+)?(?:(all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+)?(.*)$/i;
// A ⭕ project or 🗃️ area link, as the sync reads them (a phone may add or drop the U+FE0F)
const HOME_LINK = /\[\[[^[\]|]+\|\s*(?:⭕|🗃)️?\s*\]\]/gu;
// A note link
const NOTE_LINK = /\[\[[^[\]|]+\|\s*(?:⋯|↗\uFE0F?)\s*\]\]/u;
// One item of the run that ends a line, with the spaces before it: a ⋯ or ↗, 🚩, ⭕ or 🗃️
// link, or the ℹ️ or 🆓 mark (AddTaskNote.TRAIL_ITEM)
const TRAIL_ITEM = /[ ]*(?:\[\[[^\]|]+\|\s*(?:🚩\uFE0F?\s*\d{1,2}\/\d{1,2}|⋯|↗\uFE0F?|⭕\uFE0F?|🗃\uFE0F?)\s*\]\]|(?:ℹ|🆓)\uFE0F?)$/u;
// The item of the run that ends `text` (TRAIL_ITEM's match), or null: an ℹ️ or 🆓 only after a space
// or a tab, checked here since older iPhones can't run a lookbehind (AddTaskNote.trailItem)
function trailItem(text) {
    const item = text.match(TRAIL_ITEM);
    if (!item) return null;
    const at = item.index + item[0].search(/[^ ]/);
    return text[at] === "[" || /\s/.test(text[at - 1] ?? "") ? item : null;
}
// A block ID ending a line, which stays last
const BLOCK_ID = /\s+\^[A-Za-z0-9-]+$/;

function recordEvent(text, { log, title, time = "", home = null }, sync, fresh = false) {
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
        // A block ID at the end (` ^mtg1`) isn't part of the title or the links before it
        const { rest, log: linked } = sync.splitTail(match[4].replace(BLOCK_ID, ""), true);
        const event = match[2] === "<" || !!match[3];
        if ((rest.match(LOG_LINK) && logOf(rest) === log) || (linked && event && logOf(linked) === log)) {
            const homed = homeIn(line, home);
            if (homed === line) return { text, outcome: "present", line };
            lines[i] = homed;
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
    const link = `[[${log}|${NOTE_MARK}]]`;
    if (found) {
        // At the end: after the title, its ℹ️ or 🆓, and any ⭕
        const line = lines[found.i];
        const bare = line.replace(/\s+$/, "");
        const block = bare.match(BLOCK_ID)?.[0] ?? "";
        lines[found.i] = homeIn(`${bare.slice(0, bare.length - block.length)} ${link}${block}`, home);
        return { text: lines.join("\n"), outcome: "linked", line };
    }

    const block = [`- [<] ${title}${home ? ` ${home}` : ""} ${link}`];
    if (fresh || /^\s*<%/.test(text)) {
        const body = text.replace(/\s+$/, "");
        return { text: `${body ? body + "\n" : ""}${block[0]}\n`, outcome: "inserted", line: null };
    }
    return { text: sync.insert(lines, block), outcome: "inserted", line: null };
}

// `line` with `home` as its one ⭕ or 🗃️, before the first note link in the run that ends it (as
// AddTaskNote.withHome puts it); unchanged with no `home`, or when it already reads that way
function homeIn(line, home) {
    if (!home) return line;
    let bare = line.replace(/\s+$/, "");
    const block = bare.match(BLOCK_ID)?.[0] ?? "";
    bare = bare.slice(0, bare.length - block.length);
    // Taken off with one space beside each, keeping a space where two words would touch (as
    // AddTaskNote.withoutLinks does), so `Review [[Old|⭕]]🆓` doesn't become `Review🆓`
    for (const l of [...bare.matchAll(HOME_LINK)].map((m) => m[0])) {
        const at = bare.lastIndexOf(l);
        let from = at, to = at + l.length;
        if (bare[from - 1] === " ") from--;
        else if (bare[to] === " ") to++;
        const gap = from > 0 && to < bare.length && !/[\s([{]/.test(bare[from - 1]) && !/[\s,.;:!?)\]}]/.test(bare[to]) ? " " : "";
        bare = bare.slice(0, from) + gap + bare.slice(to);
    }
    bare = bare.replace(/\s+$/, "");
    let at = bare.length, before = null;
    for (let item; (item = trailItem(bare.slice(0, at)));) {
        at = item.index;
        if (NOTE_LINK.test(item[0])) before = at;
    }
    const out = before === null ? `${bare} ${home}` : `${bare.slice(0, before).replace(/ +$/, "")} ${home} ${bare.slice(before).trim()}`;
    return out + block === line.replace(/\s+$/, "") ? line : out + block;
}

const normal = (t) => String(t ?? "").replace(/\s/g, "").toLowerCase();

module.exports = recordEvent;
