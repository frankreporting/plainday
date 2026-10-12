---
mainfont:
  - Georgia
monofont:
  - Menlo
fontsize: 12pt
colorlinks: true
linkcolor: blue
geometry:
  - a5paper
  - margin=1cm
table_stripe_color: "#F0F0F0"
---

> [!tip] How to use this template
> - Make sure the Enhancing Exports plugin is installed
> - Optional: For "pretty tables," add `stripe-tables.lua` to your `lua` folder in the Enhancing Exports plugin folder under the hidden `.obsidian` settings folder
> - In Enhancing Export's settings, create a new template or update the PDF template using the following options:
> 	- arguments: 
>        ```
>        -f ${fromFormat}+table_attributes --resource-path="${currentDir}" --resource-path="${attachmentFolderPath}" --lua-filter="${luaDir}/pdf.lua" --lua-filter="${luaDir}/stripe-tables.lua" ${ options.textemplate ? `--resource-path="${pluginDir}/textemplate" --template="${options.textemplate}"` : ` ` } -o "${outputPath}" -t pdf`
>        ```
> 	- extra arguments: 
>        ```
>        --pdf-engine=xelatex --table-caption-position=below
>        ```
> - For tables, you can set captions by adding a line immediately below the table starting with `:` like this: `: your caption here`
> - You can optionally set exact column widths for your tables by appending `{column-widths="75,25"}` to the caption line. Note you need one value per column or it may default to equal widths.
> - Tweak the other file properties to adjust output. More on how to use LaTeX properties, including others you can add, [at this link](https://pandoc.org/MANUAL.html#variables-for-latex).
> - **Delete this block before export!**
