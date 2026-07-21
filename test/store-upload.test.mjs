import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/release-extension.yml', import.meta.url), 'utf8');
const script = readFileSync(new URL('../scripts/chrome-webstore-upload.mjs', import.meta.url), 'utf8');
assert.match(workflow, /inputs\.store-upload-enabled == 'true'/);
assert.match(workflow, /vars\.STORE_UPLOAD_ENABLED == 'true'/);
assert.match(workflow, /chrome-service-account-json/);
assert.match(workflow, /Download ZIP from GitHub Release/);
assert.doesNotMatch(script, /:publish/);
assert.match(script, /:upload/);
console.log('store upload fail-closed and no-publish checks passed');
