/*
 * The one place to rename the product or point the download button somewhere real.
 * index.html fills every [data-brand] element, the Claude Code command and all download
 * buttons from this object at load. The only other copy of the name is the <title> in index.html.
 */
const BRAND = {
  // Product name, shown in the header, headings, footer and the Claude Code command hint.
  name: 'Solamar',

  // Lower-case id used as the MCP server name in `claude mcp add ... <slug> ...`.
  slug: 'solamar',

  // Where the download buttons go: the Windows installer and the macOS disk image (or a page with
  // both Mac versions). The hero's button picks the visitor's system.
  // Leave them starting with '#' while there is no installer: the buttons then scroll to the
  // download section, which says the installers are coming soon.
  // Example: 'https://github.com/OWNER/REPO/releases/latest'
  downloadUrl: 'https://github.com/Bambeek/solamar/releases/latest/download/Solamar-Setup.exe',
  macDownloadUrl: 'https://github.com/Bambeek/solamar/releases/latest/download/Solamar-arm64.dmg',

  // Optional link to the source code once it is published. Empty hides the "Source" links.
  repoUrl: 'https://github.com/Bambeek/solamar',

  // Port of the local MCP server (Settings > Claude Code in the app; 47821 is the default).
  mcpPort: 47821
};
