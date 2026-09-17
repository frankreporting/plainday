<%*
// const regex = /^[0-9]{4}/g
// const year = tp.file.title.match(regex)[0]
// if (tp.file.folder(true) != "30 Reference/37 Journal/" + year) { 
//	await tp.file.move("/30 Reference/37 Journal/" + year + "/" + tp.file.title) 
//}
if (tp.file.folder(true) != "30 Reference/36 Planner/months") { 
	await tp.file.move("/30 Reference/36 Planner/months/" + tp.file.title) 
}
const displayDate = (datestr) => tp.date.now(datestr, 0, tp.file.title, "YYYY-MM")
tR+="---\n"
tR+="aliases: " + displayDate("MMMM YYYY")
tR+="\n---\n"
%>