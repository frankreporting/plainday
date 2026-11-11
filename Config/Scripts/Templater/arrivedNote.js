// Whether a note's text is an existing note's rather than a new one's (OBS-171): it has properties
// and nothing below them. Called from Get Template and the Log template as
// tp.user.arrivedNote(text) when Templater's trigger for new notes runs them, so a note that
// arrived through Sync, a move or a restore isn't templated as if new.
// The same rule as CustomJS's NewNoteGuard.arrived (tests keep the two the same). It's here too
// because Templater loads its own scripts, and CustomJS can be mid-reload, with every class gone,
// exactly when synced notes and script updates arrive together.

const FRONTMATTER = /^\uFEFF?---\r?\n(?:[\s\S]*?\r?\n)?---[^\S\r\n]*(?:\r?\n|$)/;

function arrivedNote(text) {
    const s = String(text ?? "");
    const m = s.match(FRONTMATTER);
    return !!m && s.slice(m[0].length).trim() === "";
}

module.exports = arrivedNote;
