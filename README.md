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
