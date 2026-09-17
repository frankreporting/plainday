<%*
if (tp.file.folder(true) != "30 Reference/36 Planner/days") { 
	await tp.file.move("/30 Reference/36 Planner/days/" + tp.file.title) 
}
const displayDate = (datestr) => tp.date.now(datestr, 0, tp.file.title, "YYYY-MM-DD")
tR+="---\n"
tR+="aliases: " + displayDate("M/D/YY dddd") + "\n"
tR+="---"
tp.file.cursor(0)
%>