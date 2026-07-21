#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".github",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
  "tmp",
  "temp",
  "publication",
]);
const EXCLUDED_FILE_NAMES = new Set([".ds_store"]);
const EXCLUDED_EXTENSIONS = new Set([".zip", ".crx", ".xpi"]);

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--extension-root" || argument === "--output-zip") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`Missing value for ${argument}.`);
      values[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${argument}`);
  }
  if (!values["extension-root"] || !values["output-zip"]) {
    fail("Usage: node scripts/build-extension.mjs --extension-root <path> --output-zip <path>");
  }
  return values;
}

function printUsage() {
  console.log("Usage: node scripts/build-extension.mjs --extension-root <path> --output-zip <path>");
}

function validateManifest(extensionRoot) {
  const manifestPath = join(extensionRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    fail(`manifest.json not found at extension root: ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${manifestPath} (${error.message})`);
  }

  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    fail(`manifest.json must contain an object: ${manifestPath}`);
  }
  if (![2, 3].includes(manifest.manifest_version)) {
    fail(`manifest.json has unsupported manifest_version (expected 2 or 3): ${manifestPath}`);
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    fail(`manifest.json has an empty or missing name: ${manifestPath}`);
  }
  if (typeof manifest.version !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
    fail(`manifest.json has an invalid version: ${manifestPath}`);
  }
  if (manifest.version.split(".").some((part) => Number(part) > 65535)) {
    fail(`manifest.json version contains a component greater than 65535: ${manifestPath}`);
  }
  return manifest;
}

function shouldExclude(relativePath, directory) {
  const name = basename(relativePath).toLowerCase();
  if (directory) return EXCLUDED_DIRECTORY_NAMES.has(name);
  return EXCLUDED_FILE_NAMES.has(name) || EXCLUDED_EXTENSIONS.has(extname(name));
}

function copyRuntime(source, destination, root = source) {
  for (const entry of readdirSync(source, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const sourcePath = join(source, entry.name);
    const relativePath = relative(root, sourcePath);
    if (shouldExclude(relativePath, entry.isDirectory())) continue;
    const destinationPath = join(destination, relativePath);
    if (entry.isDirectory()) {
      mkdirSync(destinationPath, { recursive: true });
      copyRuntime(sourcePath, destination, root);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      mkdirSync(dirname(destinationPath), { recursive: true });
      cpSync(sourcePath, destinationPath, { dereference: true });
    }
  }
}

function compactCss(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function compactSvg(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function minifyRuntime(directory) {
  const counts = { js: 0, css: 0, svg: 0 };
  const paths = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) walk(absolutePath);
      else if (entry.isFile()) paths.push(absolutePath);
    }
  }
  walk(directory);

  for (const filePath of paths) {
    const extension = extname(filePath).toLowerCase();
    if (extension === ".js") {
      const result = await esbuild.transform(readFileSync(filePath, "utf8"), {
        loader: "js",
        minify: true,
        target: "es2022",
        legalComments: "none",
      });
      writeFileSync(filePath, result.code);
      counts.js += 1;
    } else if (extension === ".css") {
      writeFileSync(filePath, compactCss(readFileSync(filePath, "utf8")));
      counts.css += 1;
    } else if (extension === ".svg") {
      writeFileSync(filePath, compactSvg(readFileSync(filePath, "utf8")));
      counts.svg += 1;
    }
  }
  return counts;
}

function createZip(stagingDirectory, outputZip) {
  mkdirSync(dirname(outputZip), { recursive: true });
  rmSync(outputZip, { force: true });
  const result = spawnSync("zip", ["-qr", outputZip, "."], {
    cwd: stagingDirectory,
    encoding: "utf8",
  });
  if (result.error) fail(`Unable to run zip: ${result.error.message}`);
  if (result.status !== 0) fail(`zip failed: ${result.stderr || result.stdout}`);
}

export async function buildExtension({ extensionRoot, outputZip }) {
  const resolvedRoot = resolve(extensionRoot);
  const resolvedOutput = resolve(outputZip);
  if (!existsSync(resolvedRoot) || !statSync(resolvedRoot).isDirectory()) {
    fail(`Extension root is not a directory: ${resolvedRoot}`);
  }
  validateManifest(resolvedRoot);

  const stagingDirectory = mkdtempSync(join(tmpdir(), "browser-extension-build-"));
  try {
    copyRuntime(resolvedRoot, stagingDirectory);
    const counts = await minifyRuntime(stagingDirectory);
    createZip(stagingDirectory, resolvedOutput);
    return { outputZip: resolvedOutput, counts };
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printUsage();
      return;
    }
    const result = await buildExtension({
      extensionRoot: options["extension-root"],
      outputZip: options["output-zip"],
    });
    console.log(`Created ${result.outputZip}`);
    console.log(`Minified: ${result.counts.js} JS, ${result.counts.css} CSS, ${result.counts.svg} SVG.`);
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
