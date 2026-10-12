// Called at the end of the Area, Log, Project and Task templates as tp.user.showNewNote(tp).
// Once Templater has written the note, if it's the note open in front of you:
// - redraws its properties panel. After those templates' move or rename, Obsidian's
//   panel misses Templater's write and stays empty in Live Preview (the note itself is fine,
//   and reopening it shows the properties), so it's synced from the note's text here.
// - moves the cursor from the title to the end of the body. Obsidian focuses the title of
//   every new note so you can name it, but these notes already have their name.
// Notes created in the background (e.g. by ConvertToProject) are left alone.

function showNewNote(tp) {
    const file = tp.config.target_file;
    const stop = () => { app.workspace.offref(ref); clearTimeout(timer); };
    const ref = app.workspace.on("templater:new-note-from-template", ({ file: written }) => {
        if (written !== file) return;
        stop();
        // Let Templater finish its own cursor handling first
        setTimeout(() => {
            const view = app.workspace.activeEditor;
            const editor = view?.editor;
            if (!editor || app.workspace.getActiveFile() !== file) return;
            const { getFrontMatterInfo, parseYaml } = tp.obsidian;
            const info = getFrontMatterInfo(editor.getValue());
            if (info.exists) view.metadataEditor?.synchronize?.(parseYaml(info.frontmatter) ?? {});
            editor.focus();
            editor.setCursor(editor.lastLine(), 0);
        }, 150);
    });
    const timer = setTimeout(stop, 10000); // in case Templater never reports the write
    return "";
}

module.exports = showNewNote;
