<%*
const name = tp.file.title.replace("!entity","").trim();
const noteID = tp.date.now("YYYYMMDDHHmmssSS");
tR += "---\nid: " + noteID + '\naliases:\n';
tR += "tags: \n";
tR += "email: \n";
tR += "phone: \n";
tR += "website: \n";
tR += "twitter: \n";
tR += "---\n";
tp.file.cursor(0);
tR += '\n';

await tp.file.move('30 Reference/34 Entities/' + name);
%>