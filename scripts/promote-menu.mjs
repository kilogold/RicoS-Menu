#!/usr/bin/env bun

/**
 * Promote the `preview` menu catalog (tested release candidate) to `main`.
 *
 * Branch merges are forbidden here (see README): `catalogVersion` is a per-branch
 * counter, so preview's version cannot be carried over. This copies preview's
 * menu.json byte-for-byte and rewrites only `catalogVersion` (main + 1) and
 * `publishedAt`, which is what CI's verify step demands. The commit is built with
 * git plumbing, so the working tree and current branch are left untouched.
 *
 * Usage:
 *   bun scripts/promote-menu.mjs [--dry-run] [--push] [--no-fetch]
 */

import { execSync } from "node:child_process";
import { canonicalJson, parseMenuCatalogFile } from "../../RicoS/packages/shared/src/index.ts";

/** Root-level entry; the tree rewrite below does not descend into subtrees. */
const MENU_PATH = "menu.json";
const SOURCE_BRANCH = "preview";
const TARGET_BRANCH = "main";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const push = args.has("--push");
const shouldFetch = !args.has("--no-fetch");

const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

function fail(message) {
  console.error(`Menu promotion failed: ${message}`);
  process.exit(1);
}

function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}

/** Raw stdout, newlines preserved. */
function gitRaw(command, options = {}) {
  return execSync(`git ${command}`, { encoding: "utf8", cwd: repoRoot, ...options });
}

function git(command, options = {}) {
  return gitRaw(command, options).trim();
}

/**
 * The release candidate must satisfy the current schema. The target only supplies
 * catalogVersion/publishedAt, and is often stale enough to fail today's schema —
 * that is what the promotion is fixing, so it is read leniently.
 */
function readMenuAtRef(ref, { strict }) {
  const raw = gitRaw(`show ${ref}:${MENU_PATH}`);
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    fail(`${MENU_PATH} at ${ref} is not valid JSON: ${errorText(err)}`);
  }

  try {
    parseMenuCatalogFile(json);
  } catch (err) {
    const detail = `${ref} does not satisfy the current schema (${errorText(err)})`;
    if (strict) fail(detail);
    console.warn(`Note: ${detail}; promoting over it.`);
  }

  if (!Number.isInteger(json.catalogVersion)) {
    fail(`${MENU_PATH} at ${ref} has no integer catalogVersion`);
  }
  if (!Number.isFinite(Date.parse(json.publishedAt))) {
    fail(`${MENU_PATH} at ${ref} has no parseable publishedAt`);
  }
  return { raw, json };
}

/** Catalog content ignoring the two fields a promotion rewrites. */
function bodyOf(json) {
  const { catalogVersion: _version, publishedAt: _published, ...body } = json;
  return canonicalJson(body);
}

function itemIds(json) {
  return new Set(json.categories.flatMap((category) => category.items.map((item) => item.id)));
}

if (shouldFetch) {
  gitRaw(`fetch --no-tags origin ${TARGET_BRANCH} ${SOURCE_BRANCH}`, { stdio: ["pipe", "pipe", "inherit"] });
}

const target = readMenuAtRef(`origin/${TARGET_BRANCH}`, { strict: false });
const source = readMenuAtRef(`origin/${SOURCE_BRANCH}`, { strict: true });

if (bodyOf(target.json) === bodyOf(source.json)) {
  console.log(`origin/${TARGET_BRANCH} already matches origin/${SOURCE_BRANCH}; nothing to promote.`);
  process.exit(0);
}

const nextVersion = target.json.catalogVersion + 1;
const publishedAt = new Date().toISOString();
if (Date.parse(publishedAt) <= Date.parse(target.json.publishedAt)) {
  fail(`clock skew: now (${publishedAt}) is not after ${target.json.publishedAt}`);
}

const promoted = source.raw
  .replace(/("catalogVersion":\s*)\d+/, (_match, prefix) => `${prefix}${nextVersion}`)
  .replace(/("publishedAt":\s*)"[^"]*"/, (_match, prefix) => `${prefix}"${publishedAt}"`);

let promotedJson;
try {
  promotedJson = JSON.parse(promoted);
  parseMenuCatalogFile(promotedJson);
} catch (err) {
  fail(`promoted ${MENU_PATH} is invalid: ${errorText(err)}`);
}
if (promotedJson.catalogVersion !== nextVersion || promotedJson.publishedAt !== publishedAt) {
  fail(`rewrite did not apply cleanly to ${MENU_PATH}`);
}
if (bodyOf(promotedJson) !== bodyOf(source.json)) {
  fail("rewrite altered catalog content beyond catalogVersion/publishedAt");
}

const targetIds = itemIds(target.json);
const sourceIds = itemIds(source.json);
const added = [...sourceIds].filter((id) => !targetIds.has(id));
const removed = [...targetIds].filter((id) => !sourceIds.has(id));
const sourceSha = git(`rev-parse --short origin/${SOURCE_BRANCH}`);

console.log(
  `Promote origin/${SOURCE_BRANCH}@${sourceSha} (v${source.json.catalogVersion}) -> ` +
    `${TARGET_BRANCH} v${target.json.catalogVersion} -> v${nextVersion} at ${publishedAt}`,
);
console.log(`  items ${targetIds.size} -> ${sourceIds.size}`);
if (added.length > 0) console.log(`  added:   ${added.join(", ")}`);
if (removed.length > 0) console.log(`  removed: ${removed.join(", ")}`);

if (dryRun) {
  console.log("Dry run; no commit created.");
  process.exit(0);
}

const targetSha = git(`rev-parse origin/${TARGET_BRANCH}`);
const localSha = git(`rev-parse --verify --quiet refs/heads/${TARGET_BRANCH} || true`);
if (localSha && localSha !== targetSha) {
  fail(
    `local ${TARGET_BRANCH} (${localSha.slice(0, 7)}) differs from origin/${TARGET_BRANCH} ` +
      `(${targetSha.slice(0, 7)}); reconcile before promoting.`,
  );
}

const blobSha = git("hash-object -w --stdin", { input: promoted });
const entries = gitRaw(`ls-tree origin/${TARGET_BRANCH}`).split("\n");
const menuEntry = entries.findIndex((line) => line.endsWith(`\t${MENU_PATH}`));
if (menuEntry < 0) {
  fail(`${MENU_PATH} is not a root-level entry of origin/${TARGET_BRANCH}`);
}
entries[menuEntry] = `100644 blob ${blobSha}\t${MENU_PATH}`;
const treeSha = git("mktree", { input: entries.join("\n") });
const message =
  `Promote ${SOURCE_BRANCH} menu catalog to production (v${nextVersion})\n\n` +
  `Source: origin/${SOURCE_BRANCH}@${sourceSha} (v${source.json.catalogVersion})\n`;
const commitSha = git(`commit-tree ${treeSha} -p ${targetSha}`, { input: message });

git(`update-ref refs/heads/${TARGET_BRANCH} ${commitSha} ${localSha}`.trim());
console.log(`Committed ${commitSha.slice(0, 7)} on ${TARGET_BRANCH}.`);

if (push) {
  gitRaw(`push origin ${TARGET_BRANCH}`, { stdio: ["pipe", "inherit", "inherit"] });
  console.log(`Pushed; CI will verify v${nextVersion} and revalidate production.`);
} else {
  console.log(`Next: git push origin ${TARGET_BRANCH}`);
}
