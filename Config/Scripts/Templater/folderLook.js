// Called by the Project and Area templates as tp.user.folderLook(tp, "project") (or "area") when
// they've made the new note a folder of its own (OBS-142). Once Templater has written the note, it
// gives that folder its look in Notebook Navigator: a red circle for a project, a green archive for
// an area, or the icon and color the user has given #project or #area in Navigator. Navigator keeps
// the look where its settings say: in its own settings, or with "Use frontmatter metadata" on, in
// the folder note's icon and color. Writing after the template keeps the two writes apart.
// It also pins the note in its folder when Navigator's "Pin created folder notes" is on, as
// Navigator does for a folder note it makes itself.
// Without Navigator nothing happens, and a folder that already has a look keeps it.
//
// It waits for Templater's report that it wrote this note, as showNewNote does, not for
// tp.hooks.on_all_templates_executed: that hook fires only once Templater lists no note as in
// progress, and NewNoteGuard keeps a note a template has moved listed a moment longer, so after a
// project or area the hook came late, at the end of some other template, or never.

function folderLook(tp, tag) {
    const file = tp.config.target_file;
    const stop = () => { app.workspace.offref(ref); clearTimeout(timer); };
    const ref = app.workspace.on("templater:new-note-from-template", ({ file: written }) => {
        if (written !== file) return;
        stop();
        // Let Templater finish its own cursor handling first, which can save the note
        setTimeout(() => {
            folderLook.apply(file, tag).catch((e) => console.error(`folderLook: couldn't style ${file?.parent?.path} in Notebook Navigator`, e));
        }, folderLook.DELAY_MS);
    });
    const timer = setTimeout(stop, 10000); // in case Templater never reports the write
    return "";
}

folderLook.DELAY_MS = 150;

// The look a project or area folder gets when Navigator gives its tag none (Navigator's icon names)
folderLook.LOOKS = {
    project: { icon: "circle", color: "#ef4444" },
    area: { icon: "archive", color: "#168a42" },
};

// The work itself, after the template: `navigator` is the Notebook Navigator plugin, if installed
folderLook.apply = async (file, tag, navigator = app.plugins?.plugins?.["notebook-navigator"]) => {
    const metadata = navigator?.api?.metadata;
    const folder = file?.parent;
    // Only a folder note: the note named like its folder, which the template has just made
    if (!metadata || !folder || folder.path === "/" || file.basename !== folder.name) return;

    if (metadata.setFolderMeta && !metadata.getFolderMeta?.(folder)) {
        // The tag's own look wins; a tag with none gets the system's
        const look = metadata.getTagMeta?.(tag) ?? {};
        let meta = {};
        for (const key of ["icon", "color", "backgroundColor"]) if (look[key]) meta[key] = look[key];
        if (!Object.keys(meta).length) meta = { ...folderLook.LOOKS[tag] };
        if (Object.keys(meta).length) await metadata.setFolderMeta(folder, meta);
    }

    const settings = navigator.settings;
    if (settings?.enableFolderNotes && settings?.pinCreatedFolderNote && metadata.pin && !metadata.isPinned?.(file, "folder")) {
        await metadata.pin(file, "folder");
    }
};

module.exports = folderLook;
