# Browser Extension CI/CD

[![Release v2.0.0](https://img.shields.io/badge/release-v2.0.0-blue)](https://github.com/md2it/browser-extension-ci-cd/releases/tag/v2.0.0)

Centralized CI/CD tooling for browser extensions. It provides reusable build, packaging, and release-workflow building blocks. Product code and configuration specific to each browser extension remain in the product repositories; this project provides the shared tooling and workflows.

## What the build creates

The builder copies the extension root to temporary staging, minifies JavaScript with esbuild (ES2022), compacts CSS and SVG files, and creates a ZIP archive. The archive contains the extension runtime files and all assets required for store upload.

The builder excludes development and previous-build content: `.git`, `.github`, `node_modules`, `dist`, `build`, `coverage`, `.cache`, temporary directories, `publication`, `.DS_Store`, and existing ZIP archives.

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

`release-extension.yml` is a reusable workflow for a version-tag release. It validates that the `vX.Y.Z` tag matches `manifest.json`, builds the ZIP, uses the corresponding `### X.Y.Z` section of CHANGELOG.md as release notes, and optionally uploads/publishes to stores.

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

Store upload is fail-closed: both the product input and repository variable `STORE_UPLOAD_ENABLED` must equal `true`.

For each product, create variables `STORE_UPLOAD_ENABLED` (leave unset or any value other than `true`), `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, and `AMO_ADDON_ID` as applicable. Create secrets for any service account JSON required by store APIs.

AMO uses v5: upload ZIP with `channel=listed`, poll `/addons/upload/{uuid}/` until validation completes, and only with double publish opt-in create a version with the same validated upload UUID.

If Chrome returns `IN_PROGRESS`, the workflow polls `publishers.items.fetchStatus` with exponential backoff: 1s, 2s, 4s, up to 10s, for a maximum total of 5 minutes. `SUCCEEDED` succeeds; `FAILED` fails the job.

## Marketplace / Installation

This repository publishes a reusable GitHub Action and reusable workflows for building, testing and releasing WebExtensions. After release, install the Action in your workflow with the release tag, for example:

```yaml
- uses: md2it/browser-extension-ci-cd@v2.0.0
  with:
    extension-root: extension
    output-zip: dist/extension.zip
```

Release v2.0.0 will be created as part of this publish flow. The marketplace logo is available in the repo at `.github/marketplace-logo.svg` and `.github/marketplace-logo.png`.

---

For more details on usage, tests, and how uploads/publishing to stores work, read the other docs and the scripts in `scripts/` and `test-runner/`.
