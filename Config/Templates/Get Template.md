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
// The daily, weekly, monthly and yearly notes aren't routed here: Plainday makes and finishes them, and
// keeps this trigger off them (FinishPeriodicNotes, OBS-120). Nor are task notes: Add note makes them
// from a task line (OBS-121), so a title starting "!task" is a note like any other. Nor are event logs:
// Add note and New event log make them, and a note an event line links is finished as one (EventLog,
// OBS-122), so a title starting with a date or "!today" is a note like any other too. Nor are projects and
// areas: New project, New area and Convert to project make them (ProjectNotes, OBS-123), so a title starting
// "!project" or "!area", or a "🗃️." link clicked, is a note like any other as well.
if (/!person/.test(tp.file.title)) {
	let person = await tp.file.include("[[Person]]");
	tR += person;
} 
else if (/!entity/.test(tp.file.title)) {
	let entity = await tp.file.include("[[Entity]]");
	tR += entity;
} 
else {
	let note = await tp.file.include("[[Empty Note]]");
	tR += note;
}
%>