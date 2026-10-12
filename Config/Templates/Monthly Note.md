<%*
if (tp.file.folder(true) != "Reference/Planner/months") { 
	await tp.file.move("/Reference/Planner/months/" + tp.file.title) 
}
const displayDate = (datestr) => tp.date.now(datestr, 0, tp.file.title, "YYYY-MM")
tR+="---\n"
tR+="aliases: " + displayDate("MMMM YYYY")
tR+="\n---\n"
%>