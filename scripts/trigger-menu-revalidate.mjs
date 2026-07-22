#!/usr/bin/env bun

/**
 * POST RicoS /api/menu/revalidate after a menu.json push.
 *
 * Env:
 *   GITHUB_REF_NAME — branch (preview | main)
 *   MENU_CATALOG_BASE_REF — pre-push commit (e.g. github.event.before)
 *   MENU_CATALOG_HEAD_REF — default HEAD
 *   RICOS_PREVIEW_REVALIDATE_URL — https://<host>/api/menu/revalidate (no query string)
 *   RICOS_PRODUCTION_REVALIDATE_URL
 *   RICOS_VERCEL_PROTECTION_BYPASS — optional; sent as x-vercel-protection-bypass header (preview)
 *   MENU_PATH — default menu.json
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseMenuCatalogFile } from "../../RicoS/packages/shared/src/index.ts";

const MENU_PATH = process.env.MENU_PATH?.trim() || "menu.json";
const ZERO_SHA = "0".repeat(40);
const branch = process.env.GITHUB_REF_NAME?.trim() || "";

function quoteRef(ref) {
  return `'${ref.replaceAll("'", "'\\''")}'`;
}

function runGit(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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

const revalidateUrlByBranch = {
  preview: process.env.RICOS_PREVIEW_REVALIDATE_URL?.trim(),
  main: process.env.RICOS_PRODUCTION_REVALIDATE_URL?.trim(),
};

function fail(message) {
  console.error(`Menu cache revalidate failed: ${message}`);
  process.exit(1);
}

const baseRef = process.env.MENU_CATALOG_BASE_REF?.trim();
const headRef = process.env.MENU_CATALOG_HEAD_REF?.trim() || "HEAD";

if (!baseRef || baseRef === ZERO_SHA) {
  console.log("No usable base ref; skipping menu cache revalidate.");
  process.exit(0);
}

if (!menuChanged(baseRef, headRef)) {
  console.log(`${MENU_PATH} unchanged; skipping menu cache revalidate.`);
  process.exit(0);
}

if (!branch || !(branch in revalidateUrlByBranch)) {
  fail(`unsupported branch ${branch || "(empty)"}; expected preview or main`);
}

const urlRaw = revalidateUrlByBranch[branch];
if (!urlRaw) {
  fail(`missing revalidate URL secret for branch ${branch}`);
}

function resolveRevalidateRequest(urlValue) {
  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    fail(`revalidate URL is not valid: ${urlValue}`);
  }

  const bypassFromQuery = parsed.searchParams.get("x-vercel-protection-bypass")?.trim();
  if (bypassFromQuery) {
    parsed.searchParams.delete("x-vercel-protection-bypass");
  }

  const bypassFromEnv = process.env.RICOS_VERCEL_PROTECTION_BYPASS?.trim();
  const protectionBypass = bypassFromEnv || bypassFromQuery;

  const headers = { "content-type": "application/json" };
  if (protectionBypass) {
    headers["x-vercel-protection-bypass"] = protectionBypass;
  }

  return { url: parsed.toString(), headers };
}

const { url, headers } = resolveRevalidateRequest(urlRaw);

let catalogVersion;
try {
  const raw = readFileSync(MENU_PATH, "utf8");
  catalogVersion = parseMenuCatalogFile(JSON.parse(raw)).catalogVersion;
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

const response = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify({ catalogVersion }),
});

const text = await response.text();
if (!response.ok) {
  fail(`HTTP ${response.status}: ${text || response.statusText}`);
}

console.log(`Menu cache revalidate OK for v${catalogVersion}: ${text || response.statusText}`);
