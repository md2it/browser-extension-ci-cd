import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const POLL_TIMEOUT_MS = 5 * 60 * 1000;
export const INITIAL_POLL_INTERVAL_MS = 1000;
export const MAX_POLL_INTERVAL_MS = 10000;
const b64 = (value) => Buffer.from(value).toString('base64url');

export async function waitForUpload({ fetchImpl = fetch, token, publisher, extensionId, initialState, timeoutMs = POLL_TIMEOUT_MS, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(), log = console.log }) {
  let state = initialState;
  let interval = INITIAL_POLL_INTERVAL_MS;
  const startedAt = now();
  if (!['SUCCEEDED', 'IN_PROGRESS', 'FAILED', 'NOT_FOUND'].includes(state)) throw new Error(`Chrome upload returned invalid uploadState: ${String(state)}`);
  while (true) {
    log(`Chrome upload status: ${state}`);
    if (state === 'SUCCEEDED') return state;
    if (state === 'FAILED') throw new Error('Chrome upload failed: uploadState=FAILED.');
    if (state === 'NOT_FOUND') throw new Error('Chrome upload failed: uploadState=NOT_FOUND.');
    if (now() - startedAt >= timeoutMs) throw new Error(`Chrome upload timed out after ${timeoutMs} ms while waiting for SUCCEEDED.`);
    await sleep(Math.min(interval, Math.max(0, timeoutMs - (now() - startedAt))));
    const response = await fetchImpl(`https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(extensionId)}:fetchStatus`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Chrome fetchStatus failed: HTTP ${response.status}.`);
    let body; try { body = await response.json(); } catch { throw new Error('Chrome fetchStatus returned invalid JSON.'); }
    state = body?.uploadState;
    if (typeof state !== 'string') throw new Error('Chrome fetchStatus returned no valid uploadState.');
    interval = Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
  }
}

export async function uploadChromePackage({ zipPath, publisher, extensionId, serviceAccountJson, fetchImpl = fetch, ...pollOptions }) {
  if (!zipPath || !publisher || !extensionId || !serviceAccountJson) throw new Error('Chrome upload requires ZIP path, CHROME_PUBLISHER_ID, CHROME_EXTENSION_ID, and CHROME_SERVICE_ACCOUNT_JSON.');
  const account = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/chromewebstore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256'); signer.update(`${header}.${payload}`);
  const assertion = `${header}.${payload}.${b64(signer.sign(account.private_key))}`;
  const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!tokenResponse.ok) throw new Error(`Chrome auth failed before upload: HTTP ${tokenResponse.status}.`);
  const tokenBody = await tokenResponse.json();
  if (typeof tokenBody?.access_token !== 'string') throw new Error('Chrome auth returned no access token.');
  const uploadResponse = await fetchImpl(`https://chromewebstore.googleapis.com/upload/v2/publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(extensionId)}:upload`, { method: 'POST', headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/zip' }, body: readFileSync(zipPath) });
  if (!uploadResponse.ok) throw new Error(`Chrome upload failed: HTTP ${uploadResponse.status}.`);
  const result = await uploadResponse.json();
  if (result?.uploadState === 'SUCCEEDED') return 'SUCCEEDED';
  return waitForUpload({ fetchImpl, token: tokenBody.access_token, publisher, extensionId, initialState: result?.uploadState, ...pollOptions });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { console.log(`Chrome upload completed: ${await uploadChromePackage({ zipPath: process.argv[2], publisher: process.env.CHROME_PUBLISHER_ID, extensionId: process.env.CHROME_EXTENSION_ID, serviceAccountJson: process.env.CHROME_SERVICE_ACCOUNT_JSON })}`); }
  catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
