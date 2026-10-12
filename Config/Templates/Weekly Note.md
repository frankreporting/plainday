<%*
if (tp.file.folder(true) != "Reference/Planner/weeks") { 
	await tp.file.move("/Reference/Planner/weeks/" + tp.file.title) 
}
// Named gggg[w]ww (Notebook Navigator's week pattern), e.g. 2026w38
const week = moment(tp.file.title, "gggg[w]ww", true)
tR+="---\n"
tR+="aliases: " + (week.isValid() ? "Week of " + week.startOf("week").format("M/D/YY") : tp.file.title) + "\n"
tR+="---\n"
%>