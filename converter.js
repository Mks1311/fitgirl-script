import fs from 'fs/promises';

const content = await fs.readFile('./links.txt', 'utf-8');

const links = content
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean);

// Create JS file content
const fileContent = `// Auto-generated file. Do not edit manually.
export const links = ${JSON.stringify(links, null, 2)};
`;

// Write to links.js
await fs.writeFile('./links.js', fileContent, 'utf-8');

console.log('links.js created successfully');
