#!/usr/bin/env bun

/**
 * CI: when menu.json changes, catalogVersion must bump by +1 and publishedAt must advance.
 *
 * Env:
 *   MENU_PATH — default menu.json
 *   MENU_CATALOG_BASE_REF — pre-push commit (e.g. github.event.before)
 *   MENU_CATALOG_HEAD_REF — default HEAD
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseMenuCatalogFile } from "./parse-menu-catalog.mjs";

const MENU_PATH = process.env.MENU_PATH?.trim() || "menu.json";
const ZERO_SHA = "0".repeat(40);

function quoteRef(ref) {
  return `'${ref.replaceAll("'", "'\\''")}'`;
}

function runGit(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitOk(command) {
  try {
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function commitExists(ref) {
  return gitOk(`git cat-file -e ${quoteRef(ref)}^{commit}`);
}

function menuFileExistsAtRef(ref) {
  return gitOk(`git cat-file -e ${quoteRef(ref)}:${MENU_PATH}`);
}

function ensureBaseRefAvailable(baseRef) {
  if (commitExists(baseRef)) return;
  gitOk(`git fetch --no-tags --depth=1 origin ${quoteRef(baseRef)}`);
  if (!commitExists(baseRef)) {
    fail(
      `cannot resolve MENU_CATALOG_BASE_REF ${baseRef}. ` +
        "Ensure the workflow fetches the pre-push commit.",
    );
  }
}

function menuChanged(baseRef, headRef) {
  try {
    const names = runGit(
      `git diff --name-only ${quoteRef(baseRef)} ${quoteRef(headRef)} -- ${MENU_PATH}`,
    );
    return names.length > 0;
  } catch {
    return true;
  }
}

function readMenuAtRef(ref) {
  const raw = runGit(`git show ${quoteRef(ref)}:${MENU_PATH}`);
  return parseMenuCatalogFile(JSON.parse(raw));
}

function fail(message) {
  console.error(`Menu catalog version check failed: ${message}`);
  process.exit(1);
}

const baseRef = process.env.MENU_CATALOG_BASE_REF?.trim();
const headRef = process.env.MENU_CATALOG_HEAD_REF?.trim() || "HEAD";

if (!baseRef || baseRef === ZERO_SHA) {
  console.log("No usable base ref; skipping menu catalog version check.");
  process.exit(0);
}

ensureBaseRefAvailable(baseRef);

if (!menuChanged(baseRef, headRef)) {
  console.log(`${MENU_PATH} unchanged; skipping menu catalog version check.`);
  process.exit(0);
}

let headParsed;
try {
  headParsed = parseMenuCatalogFile(JSON.parse(readFileSync(MENU_PATH, "utf8")));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

if (!menuFileExistsAtRef(baseRef)) {
  if (headParsed.catalogVersion !== 1) {
    fail(
      `initial ${MENU_PATH} must have catalogVersion 1 (got ${headParsed.catalogVersion})`,
    );
  }
  console.log("Menu catalog version OK: initial catalogVersion 1");
  process.exit(0);
}

let baseParsed;
try {
  baseParsed = readMenuAtRef(baseRef);
} catch (err) {
  fail(
    `could not parse ${MENU_PATH} at ${baseRef}: ${err instanceof Error ? err.message : String(err)}`,
  );
}

const expectedVersion = baseParsed.catalogVersion + 1;
if (headParsed.catalogVersion !== expectedVersion) {
  fail(
    `catalogVersion must be exactly ${expectedVersion} (previous ${baseParsed.catalogVersion}, got ${headParsed.catalogVersion}). ` +
      "Use the staff menu editor or bump by +1 when editing menu.json manually.",
  );
}

const headPublishedMs = Date.parse(headParsed.publishedAtIso);
const basePublishedMs = Date.parse(baseParsed.publishedAtIso);
if (!Number.isFinite(headPublishedMs) || headPublishedMs <= basePublishedMs) {
  fail(
    `publishedAt must be strictly after ${baseParsed.publishedAtIso} (got ${headParsed.publishedAtIso})`,
  );
}

console.log(
  `Menu catalog version OK: v${baseParsed.catalogVersion} -> v${headParsed.catalogVersion} at ${headParsed.publishedAtIso}`,
);
