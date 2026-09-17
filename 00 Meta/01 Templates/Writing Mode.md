<%*
/* 
=============================================
ABOUT THIS SCRIPT
- Written by Gemini 3 Flash.
- Toggles the presence of the `writing` class on the `cssclasses` property. If the property isn't present, it's added. Map to a hotkey in Templater settings. 
=============================================
*/

const propertyName = "cssclasses";
const className = "writing";
const file = tp.config.active_file;

await app.fileManager.processFrontMatter(file, (frontmatter) => {
  let classes = frontmatter[propertyName];

  // If property doesn't exist, create it as an array with the class
  if (classes === undefined || classes === null) {
    frontmatter[propertyName] = [className];
    return;
  }

  // Convert string to array if user previously used a single string value
  if (typeof classes === 'string') {
    classes = classes.split(',').map(c => c.trim()).filter(c => c !== "");
  }

  // Toggle logic
  if (classes.includes(className)) {
    // Remove the class
    frontmatter[propertyName] = classes.filter(c => c !== className);
  } else {
    // Add the class
    classes.push(className);
    frontmatter[propertyName] = classes;
  }
});
-%>