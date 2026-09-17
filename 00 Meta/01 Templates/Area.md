<%*
let rx = /%F0%9F%97%83%EF%B8%8F/g;
let method = encodeURIComponent(tp.file.title).match(rx) ? "alias" : "standard";
console.log(method);

const thisID = tp.date.now("YYYYMMDDHHmmssSS");
let alias, cleanTitle;

if (method == "alias") {
	alias = tp.file.title;
	aliasEncoded = encodeURIComponent(alias);
	console.log("Title is a project with alias");
	let rxAlias = /%F0%9F%97%83%EF%B8%8F\.(.*)/;
	console.log(alias.match(rxAlias));
	let [fullMatch, cleanTitle] = aliasEncoded.match(rxAlias);
	let path = "20 Projects/" + cleanTitle;
	console.log(path);
	if (!(await app.vault.getAllLoadedFiles()).map(f => f.path).includes(path)) {
		await app.vault.createFolder(path);
	} 
	await tp.file.move(path + "/" + cleanTitle);
} else {
	console.log("File title does not look like an alias for a project");
	
	cleanTitle = tp.file.title.replace("!area", "").trim();
	alias = `🗃️.${cleanTitle}`;
	
	// New notes are created in the current folder (Obsidian's "Default location for new notes"),
	// so always ask where a new area belongs rather than only for notes made in 10 Inbox
	const pickedFile = await tp.user.pickParent(tp, (folder) => !folder.includes("00 Meta"), "Select parent...");
	let moved = false;
	if (pickedFile) {
		const path = pickedFile.parent.path + "/" + cleanTitle;
		if ((await app.vault.getAllLoadedFiles()).map(f => f.path).includes(path)) {
			new Notice("The folder you're trying to create already exists.");
		} else {
			await app.vault.createFolder(path);
			await tp.file.move(path + "/" + cleanTitle);
			moved = true;
		}
	}
	if (!moved && cleanTitle && cleanTitle != tp.file.title) {
		// Not moved: leave the note where it is, but drop "!area" from its name
		await tp.file.rename(cleanTitle);
	}
}

tR += "---\n";
tR += "id: " + thisID + "\n";
tR += `aliases: ["${alias}"]\n`;
tR += "tags: area\n";
tR += "---\n" + tp.file.cursor(0);
tR += "\n";
tp.user.showNewNote(tp);
%>