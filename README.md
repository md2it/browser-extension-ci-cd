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
    secrets:
      chrome-service-account-json: ${{ secrets.CHROME_SERVICE_ACCOUNT_JSON }}
```

Store upload is fail-closed: both the product input and repository variable `STORE_UPLOAD_ENABLED` must equal `true`. The reusable workflow downloads the ZIP from the GitHub Release, uploads it to the Chrome Web Store v2 `:upload` endpoint, and reports its upload state. It never calls `:publish`; upload can still enter Chrome review according to store rules, but users are not published to by this workflow.

For each product, create variables `STORE_UPLOAD_ENABLED` (leave unset or any value other than `true`), `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, and `AMO_ADDON_ID` as applicable. Create secret `CHROME_SERVICE_ACCOUNT_JSON` only after enabling the integration; the service-account email must be granted Chrome Web Store API access. Missing IDs or the secret fail before a store request. AMO secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` are reserved and are not used by the current workflow.

AMO listed upload is intentionally not automated. Current AMO v5 upload requires a `channel` (`listed` or `unlisted`); `listed` submits a version for listing/moderation and does not provide a guaranteed upload-only/no-publication operation. Use the AMO dashboard/manual review flow. `unlisted` signing may be performed manually when self-distribution is intended. To disable Chrome integration, unset or change `STORE_UPLOAD_ENABLED` and/or the product input.

If Chrome returns `IN_PROGRESS`, the workflow polls `publishers.items.fetchStatus` with exponential backoff: 1s, 2s, 4s, up to 10s, for a maximum total of 5 minutes. `SUCCEEDED` succeeds; `FAILED`, `NOT_FOUND`, invalid/unknown states, invalid JSON, HTTP errors, and timeout fail the job. Logs contain status and HTTP codes only; credentials and Authorization headers are never logged.
