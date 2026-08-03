#!/usr/bin/env bash
set -euox pipefail

# publish-release.sh
# Usage: run from repository root after ensuring gh is authenticated (gh auth login)
# Requires: git, gh CLI, and either rsvg-convert (librsvg) or ImageMagick (convert).

SVG_PATH=".github/marketplace-logo.svg"
PNG_PATH=".github/marketplace-logo.png"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ ! -f "$SVG_PATH" ]; then
  echo "SVG not found at $SVG_PATH"
  exit 1
fi

if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 128 -h 128 "$SVG_PATH" -o "$PNG_PATH"
elif command -v convert >/dev/null 2>&1; then
  convert -resize 128x128 "$SVG_PATH" "$PNG_PATH"
else
  echo "Install rsvg-convert (librsvg) or ImageMagick (convert) and re-run this script"
  exit 1
fi

# Commit and push PNG if it changed
if git status --porcelain | grep -q ".github/marketplace-logo.png"; then
  git add "$PNG_PATH"
  git commit -m "Add marketplace PNG logo (generated from SVG)"
  git push origin "$BRANCH"
else
  echo "No changes to $PNG_PATH; skipping commit/push"
fi

# Create annotated release via gh
RELEASE_TAG="v2.0.0"
RELEASE_TITLE="v2.0.0 — First Marketplace release"
read -r -d '' RELEASE_NOTES <<'EOF'
v2.0.0 — First Marketplace release

- Add MIT license.
- Stable composite Action for building and packaging extensions.
- Reusable release workflow: tag validation, changelog extraction, store upload/publish options (Chrome/AMO).
- Shared browser test runner (Python + Chrome) and helper scripts for store uploads.
EOF

# Create or update release
if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  echo "Release $RELEASE_TAG already exists. Skipping release creation."
else
  gh release create "$RELEASE_TAG" --title "$RELEASE_TITLE" --notes "$RELEASE_NOTES" --target "$BRANCH"
  echo "Created release $RELEASE_TAG"
fi

echo "Done. To finish, open the repository Actions page in GitHub and publish the Action to the Marketplace (few clicks)."
