import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExtension } from "../scripts/build-extension.mjs";

const fixture = mkdtempSync(join(tmpdir(), "browser-extension-build-test-"));
const extensionRoot = join(fixture, "extension");
const outputZip = join(fixture, "output", "extension.zip");
mkdirSync(join(extensionRoot, ".git"), { recursive: true });
mkdirSync(join(extensionRoot, ".github"), { recursive: true });
mkdirSync(join(extensionRoot, "node_modules", "ignored"), { recursive: true });
mkdirSync(join(extensionRoot, "build"), { recursive: true });
mkdirSync(join(extensionRoot, "app"), { recursive: true });
writeFileSync(join(extensionRoot, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Test extension", version: "1.2.3" }));
writeFileSync(join(extensionRoot, "app", "main.js"), "// source comment\nconst value = 1 + 2; console.log(value);\n");
writeFileSync(join(extensionRoot, "app", "style.css"), "/* source comment */\n.test { color: red; }\n");
writeFileSync(join(extensionRoot, "app", "icon.svg"), "<!-- source comment -->\n<svg>  <path /> </svg>\n");
writeFileSync(join(extensionRoot, ".git", "config"), "ignored");
writeFileSync(join(extensionRoot, ".github", "workflow.yml"), "ignored");
writeFileSync(join(extensionRoot, "node_modules", "ignored", "index.js"), "ignored");
writeFileSync(join(extensionRoot, "build", "old.zip"), "ignored");
writeFileSync(join(extensionRoot, "previous.zip"), "ignored");

await buildExtension({ extensionRoot, outputZip });

const entries = execFileSync("unzip", ["-Z1", outputZip], { encoding: "utf8" }).trim().split("\n");
assert(entries.includes("manifest.json"), "manifest.json must be at the ZIP root");
assert(entries.includes("app/main.js"), "runtime JavaScript must be included");
assert(!entries.some((entry) => entry.includes(".git") || entry.includes(".github") || entry.includes("node_modules") || entry.includes("build/") || entry.endsWith(".zip")), "development and previous build artifacts must be excluded");
assert.match(readFileSync(join(extensionRoot, "app", "main.js"), "utf8"), /source comment/, "source files must remain unchanged");
assert(!execFileSync("unzip", ["-p", outputZip, "app/main.js"], { encoding: "utf8" }).includes("source comment"), "staged JavaScript must be minified");

const invalidExtensionRoot = join(fixture, "invalid-extension");
mkdirSync(invalidExtensionRoot);
writeFileSync(join(invalidExtensionRoot, "manifest.json"), "{ invalid json");
await assert.rejects(
  buildExtension({ extensionRoot: invalidExtensionRoot, outputZip: join(fixture, "invalid.zip") }),
  /manifest\.json is not valid JSON/,
  "an invalid manifest must produce a clear error"
);

console.log("build-extension test passed");
