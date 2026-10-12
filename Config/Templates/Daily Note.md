<%*
if (tp.file.folder(true) != "Reference/Planner/days") { 
	await tp.file.move("/Reference/Planner/days/" + tp.file.title) 
}
const displayDate = (datestr) => tp.date.now(datestr, 0, tp.file.title, "YYYY-MM-DD")
tR+="---\n"
tR+="aliases: " + displayDate("M/D/YY dddd") + "\n"
tR+="---"
tp.file.cursor(0)
%>