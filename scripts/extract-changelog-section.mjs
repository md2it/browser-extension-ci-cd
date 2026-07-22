import { readFileSync } from 'node:fs';

export function extractChangelogSection({ changelogPath, version }) {
  if (!changelogPath || !version) throw new Error('CHANGELOG path and version are required.');
  let source;
  try { source = readFileSync(changelogPath, 'utf8'); }
  catch { throw new Error(`CHANGELOG not found: ${changelogPath}.`); }
  const heading = `### ${version}`;
  const lines = source.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`CHANGELOG section '${heading}' was not found in ${changelogPath}.`);
  const end = lines.findIndex((line, index) => index > start && /^### /.test(line));
  const notes = lines.slice(start + 1, end < 0 ? lines.length : end).join('\n').trim();
  if (!notes) throw new Error(`CHANGELOG section '${heading}' is empty in ${changelogPath}.`);
  return notes;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { process.stdout.write(`${extractChangelogSection({ changelogPath: process.argv[2], version: process.argv[3] })}\n`); }
  catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
