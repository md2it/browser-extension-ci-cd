export async function publishChromePackage({ publisher, extensionId, token, fetchImpl = fetch }) {
  if (!publisher || !extensionId || !token) throw new Error('Chrome publish requires CHROME_PUBLISHER_ID, CHROME_EXTENSION_ID, and an access token.');
  const response = await fetchImpl(`https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(extensionId)}:publish`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Chrome publish failed: HTTP ${response.status}.`);
  return response.json();
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const { createSign } = await import('node:crypto');
    const account = JSON.parse(process.env.CHROME_SERVICE_ACCOUNT_JSON || '');
    const b64 = (value) => Buffer.from(value).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/chromewebstore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const signer = createSign('RSA-SHA256'); signer.update(`${header}.${payload}`);
    const assertion = `${header}.${payload}.${b64(signer.sign(account.private_key))}`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!tokenResponse.ok) throw new Error(`Chrome auth failed before publish: HTTP ${tokenResponse.status}.`);
    const tokenBody = await tokenResponse.json();
    await publishChromePackage({ publisher: process.env.CHROME_PUBLISHER_ID, extensionId: process.env.CHROME_EXTENSION_ID, token: tokenBody.access_token });
    console.log('Chrome publish submitted for review.');
  } catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
