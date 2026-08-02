# Browser Extension CI/CD

Centralized CI/CD tooling for browser extensions. It provides reusable build, packaging, and release-workflow building blocks. Product code and configuration specific to each browser extension remain in their respective repositories.

## What the build creates

The builder copies the extension root to temporary staging, minifies JavaScript with esbuild (ES2022), compacts CSS and SVG files, and creates a ZIP archive. The archive contains the extension runtime files with `manifest.json` at its root. Source files are never modified.

The builder excludes development and previous-build content: `.git`, `.github`, `node_modules`, `dist`, `build`, `coverage`, `.cache`, temporary directories, `publication`, `.DS_Store`, and existing `.zip`, `.crx`, and `.xpi` archives.

## Local use

```sh
npm ci
npm run build:extension -- \
  --extension-root /path/to/project/extension \
  --output-zip /tmp/project-extension.zip
```

Run the minimal packaging check with:

```sh
npm test
```

## Shared browser test runner

Product repositories keep their own `tests/index.html` and business tests. The shared runner owns localhost, browser execution, cleanup, exit codes, JSON reporting, and the browser test harness.

```sh
./test-runner/run-tests.sh /path/to/extension-project
```

It requires Python 3 and Chrome or Chromium. Exit code `0` means passed, `1` means failed tests, and `2` means an infrastructure error. `TEST_BROWSER` can point to a non-standard browser executable.

## GitHub Action

The composite action invokes the same builder. The calling workflow must check out the extension repository and provide Node.js 20 or later.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - uses: md2it/browser-extension-ci-cd@v1.0.0
    id: package
    with:
      extension-root: extension
      output-zip: dist/extension.zip
```

The resulting absolute ZIP path is available as `steps.package.outputs.zip-path`.

## Reusable release workflow

`release-extension.yml` is a reusable workflow for a version-tag release. It validates that the `vX.Y.Z` tag matches `manifest.json`, builds the ZIP, uses the corresponding `### X.Y.Z` section of the changelog as release notes, and creates a published GitHub Release.

```yaml
jobs:
  release:
    uses: md2it/browser-extension-ci-cd/.github/workflows/release-extension.yml@v1.3.1
    with:
      extension-root: extension
      zip-name: extension.zip
      changelog-path: CHANGELOG.md
      chrome-extension-id: ${{ vars.CHROME_EXTENSION_ID }}
      chrome-publisher-id: ${{ vars.CHROME_PUBLISHER_ID }}
      store-upload-enabled: ${{ vars.STORE_UPLOAD_ENABLED }}
      store-publish-enabled: ${{ vars.STORE_PUBLISH_ENABLED }}
    secrets:
      chrome-service-account-json: ${{ secrets.CHROME_SERVICE_ACCOUNT_JSON }}
```

Store upload is fail-closed: both the product input and repository variable `STORE_UPLOAD_ENABLED` must equal `true`. Chrome upload uses v2 `:upload` and `:fetchStatus`; a separate job calls only v2 `:publish` after successful upload and double opt-in. Chrome publish submits the version for review; it can become public only after Chrome review/signing and according to the item's existing visibility settings.

For each product, create variables `STORE_UPLOAD_ENABLED` (leave unset or any value other than `true`), `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, and `AMO_ADDON_ID` as applicable. Create secret `CHROME_SERVICE_ACCOUNT_JSON` only after enabling the integration; the service-account email must be granted Chrome Web Store API access. Missing IDs or the secret fail before a store request. AMO secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` are reserved and are not used by the current workflow.

AMO uses v5: upload ZIP with `channel=listed`, poll `/addons/upload/{uuid}/` until validation completes, and only with double publish opt-in create a version with the same validated upload UUID. Validation-only mode does not submit a version. A listed submission enters AMO review/signing; it becomes available to users only after AMO approves and signs it, subject to AMO processing. AMO requires `AMO_ADDON_ID`, `AMO_JWT_ISSUER`, and `AMO_JWT_SECRET`. To disable integrations, leave `STORE_UPLOAD_ENABLED` and `STORE_PUBLISH_ENABLED` unset or change them from `true`.

If Chrome returns `IN_PROGRESS`, the workflow polls `publishers.items.fetchStatus` with exponential backoff: 1s, 2s, 4s, up to 10s, for a maximum total of 5 minutes. `SUCCEEDED` succeeds; `FAILED`, `NOT_FOUND`, invalid/unknown states, invalid JSON, HTTP errors, and timeout fail the job. Logs contain status and HTTP codes only; credentials and Authorization headers are never logged.
