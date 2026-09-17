<%*
const name = tp.file.title.replace("!person","").trim();
const noteID = tp.date.now("YYYYMMDDHHmmssSS");
tR += "---\nid: " + noteID + '\naliases:\n';
tR += "tags: \n";
tR += "phone: \n";
tR += "email: \n";
tR += "twitter: \n";
tR += "LinkedIn: \n";
tR += "affiliation: \n";
tR += "role: \n";
tR += "---\n";
tp.file.cursor(0);

await tp.file.move('30 Reference/35 People/' + name);
%>