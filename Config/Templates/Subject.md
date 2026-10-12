<%*
const prompt = await tp.system.prompt("New subject:")
tR += "---\nid: " + tp.date.now("YYYYMMDDHHmmssSS") + "\naliases: ['§ " + prompt + "']\ntags: ['MOC','subject']\n---"
%>
<% tp.file.move("Reference/Subjects/" + prompt) %><% tp.file.cursor(0) %>