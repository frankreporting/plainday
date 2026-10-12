<%*
let thisID = tp.date.now("YYYYMMDDHHmmssSSS");
tR += "---\n";
tR += "id: " + thisID + "\n";
tR += "---\n";
tR += "\n\n";
tp.file.cursor(0);
await tp.file.move("Inbox/" + tp.file.title);
%>