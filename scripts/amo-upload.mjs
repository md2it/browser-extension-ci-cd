import { readFileSync } from 'node:fs';

const BASE = 'https://addons.mozilla.org/api/v5';
const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function validateAmoConfiguration({ uploadEnabled, publishEnabled, addonId, issuer, secret }) {
  if (uploadEnabled !== 'true' || publishEnabled !== 'true') return { enabled: false };
  if (!addonId || !issuer || !secret) throw new Error('AMO requires AMO_ADDON_ID, AMO_JWT_ISSUER, and AMO_JWT_SECRET before any API request.');
  return { enabled: true };
}

export async function uploadAndValidateAmo({ zipPath, addonId, jwt, fetchImpl = fetch, timeoutMs = 10 * 60 * 1000, sleep = sleepDefault, now = () => Date.now(), log = console.log, submit = false }) {
  if (!zipPath || !addonId || !jwt) throw new Error('AMO requires ZIP path, AMO_ADDON_ID, and JWT before any API request.');
  const form = new FormData(); form.append('upload', new Blob([readFileSync(zipPath)]), 'extension.zip'); form.append('channel', 'listed');
  const headers = { Authorization: `JWT ${jwt}` };
  const upload = await fetchImpl(`${BASE}/addons/upload/`, { method: 'POST', headers, body: form });
  if (!upload.ok) throw new Error(`AMO upload failed: HTTP ${upload.status}.`);
  const created = await upload.json();
  if (typeof created?.uuid !== 'string') throw new Error('AMO upload returned no upload UUID.');
  const started = now(); let detail;
  while (true) {
    const status = await fetchImpl(`${BASE}/addons/upload/${encodeURIComponent(created.uuid)}/`, { headers });
    if (!status.ok) throw new Error(`AMO validation status failed: HTTP ${status.status}.`);
    detail = await status.json(); log(`AMO validation processed=${Boolean(detail?.processed)} valid=${Boolean(detail?.valid)}`);
    if (detail?.processed) break;
    if (now() - started >= timeoutMs) throw new Error(`AMO validation timed out after ${timeoutMs} ms.`);
    await sleep(5000);
  }
  if (detail.valid !== true) throw new Error('AMO validation failed; listed submission was not sent.');
  if (!submit) return detail;
  const submission = await fetchImpl(`${BASE}/addons/addon/${encodeURIComponent(addonId)}/versions/`, { method: 'POST', headers, body: (() => { const f = new FormData(); f.append('upload', created.uuid); return f; })() });
  if (!submission.ok) throw new Error(`AMO listed submission failed: HTTP ${submission.status}.`);
  return submission.json();
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const { createHmac, randomUUID } = await import('node:crypto');
    const b64 = (value) => Buffer.from(value).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64(JSON.stringify({ iss: process.env.AMO_JWT_ISSUER, jti: randomUUID(), iat: now, exp: now + 300 }));
    const jwt = `${header}.${payload}.${createHmac('sha256', process.env.AMO_JWT_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
    await uploadAndValidateAmo({ zipPath: process.env.ZIP_PATH, addonId: process.env.AMO_ADDON_ID, jwt, submit: process.env.STORE_PUBLISH_ENABLED === 'true' && process.env.REPOSITORY_STORE_PUBLISH_ENABLED === 'true' });
    console.log('AMO upload and validation completed.');
  } catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
