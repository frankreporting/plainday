<%*
// OBS-171: Templater's trigger for new notes runs this on any note that appears with an empty body,
// including one that arrives through Sync, a move or a restore with only its properties. Such a note
// isn't new: stop before anything is written. NewNoteGuard normally keeps Templater off it, quietly;
// this is the backstop, and shows Templater's error notice. It's a Templater script, not one of
// Plainday's classes, so it works while Plainday reloads. Run mode 2 is that trigger
// (OverwriteFile); inserting a template by hand isn't stopped, and nor is a note made here that got
// its properties before Templater looked (a base's New button), which NewNoteGuard notes as made
// here.
if (tp.config.run_mode === 2 && !window.newNoteGuardMadeHere?.has(tp.config.target_file) && tp.user.arrivedNote(await app.vault.read(tp.config.target_file))) {
	// Templater's own notice only says "Template parsing error"; this one says why
	const why = `"${tp.file.title}" already has properties, so it isn't a new note: no template was applied and nothing changed`;
	new Notice(why, 10000);
	throw new Error(why);
}
if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(tp.file.title)) {
	let dailyNote = await tp.file.include("[[Daily Note]]");
	tR += dailyNote;
} 
else if (/^[0-9]{4}-[0-9]{2}$/.test(tp.file.title)) {
	let monthlyNote = await tp.file.include("[[Monthly Note]]");
	tR += monthlyNote;
} 
else if (/^[0-9]{4}$/.test(tp.file.title)) {
	let yearlyNote = await tp.file.include("[[Yearly Note]]");
	tR += yearlyNote;
} 
else if (/^[0-9]{4}w[0-9]{2}$/.test(tp.file.title)) {
	let weeklyNote = await tp.file.include("[[Weekly Note]]");
	tR += weeklyNote;
} 
else if (/!today/.test(tp.file.title)) {
	let log = await tp.file.include("[[Log]]");
	tR += log;
}
else if (tp.file.title.search(/^[0-9]{4}-[0-9]{2}-[0-9]{2} .*$/) !=-1) {
	let log = await tp.file.include("[[Log]]");
	tR += log;
} 
else if (/!person/.test(tp.file.title)) {
	let person = await tp.file.include("[[Person]]");
	tR += person;
} 
else if (/!entity/.test(tp.file.title)) {
	let entity = await tp.file.include("[[Entity]]");
	tR += entity;
} 
else if (/!project/.test(tp.file.title)) {
	let project = await tp.file.include("[[Project]]");
	tR += project;
}
else if (/!task/.test(tp.file.title)) {
	let task = await tp.file.include("[[Task]]");
	tR += task;
}
else if (/!area/.test(tp.file.title)) {
	let area = await tp.file.include("[[Area]]");
	tR += area;
}
else if (/🗃️/.test(tp.file.title)) {
	let area = await tp.file.include("[[Area]]");
	tR += area;
}
else {
	let note = await tp.file.include("[[Empty Note]]");
	tR += note;
}
%>