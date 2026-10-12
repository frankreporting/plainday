<%*
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
else if (/¶/.test(tp.file.title)) {
	let entry = await tp.file.include("[[Writing]]");
	tR += entry;
}
else {
	let note = await tp.file.include("[[Empty Note]]");
	tR += note;
}
%>