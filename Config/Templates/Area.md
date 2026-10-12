<%*
// "🗃️.Name" (an area link that doesn't resolve yet) or "!area Name"
const thisID = tp.date.now("YYYYMMDDHHmmssSS");
const fromAlias = /^🗃\uFE0F?\./u.test(tp.file.title);
const cleanTitle = (fromAlias ? tp.file.title.replace(/^🗃\uFE0F?\./u, "") : tp.file.title.replace("!area", "")).trim();
const alias = fromAlias ? tp.file.title : `🗃️.${cleanTitle}`;

// No menu (OBS-55): a new area gets a folder at the top of Projects, and MoveToProject files it
// under another area afterwards. A name another note already has stops here, as in the Project
// template: the new note would take over that note's links.
const path = "Projects/" + cleanTitle;
if (cleanTitle && app.vault.getMarkdownFiles().some((f) => f !== tp.config.target_file && f.basename.toLowerCase() === cleanTitle.toLowerCase())) {
	const why = `A note named "${cleanTitle}" already exists, so no area was made: give it another name`;
	new Notice(why, 10000);
	throw new Error(why);
}
let moved = false;
if (!cleanTitle) {
	// Nothing to name the folder: leave the note where it is
} else if (app.vault.getAbstractFileByPath(path)) {
	new Notice("The folder you're trying to create already exists.");
} else {
	await app.vault.createFolder(path);
	await tp.file.move(path + "/" + cleanTitle);
	moved = true;
}
if (!moved && cleanTitle && cleanTitle != tp.file.title) {
	// Not moved: leave the note where it is, but drop "!area" from its name
	await tp.file.rename(cleanTitle);
}

tR += "---\n";
tR += "id: " + thisID + "\n";
tR += `aliases: ["${alias}"]\n`;
tR += "tags: area\n";
tR += "---\n" + tp.file.cursor(0);
tR += "\n";
tp.user.showNewNote(tp);
%>