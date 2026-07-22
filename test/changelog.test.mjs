import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractChangelogSection } from '../scripts/extract-changelog-section.mjs';

const dir = mkdtempSync(join(tmpdir(), 'changelog-'));
const path = join(dir, 'CHANGELOG.md');
writeFileSync(path, '# Changelog\n\n### 1.2.3\n\n- First line\n- Second line\n\n### 1.2.2\n\n- Older\n');
assert.equal(extractChangelogSection({ changelogPath: path, version: '1.2.3' }), '- First line\n- Second line');
assert.throws(() => extractChangelogSection({ changelogPath: path, version: '9.9.9' }));
writeFileSync(path, '### 1.2.3\n\n### 1.2.2\n- Older');
assert.throws(() => extractChangelogSection({ changelogPath: path, version: '1.2.3' }));
console.log('changelog extraction tests passed');
