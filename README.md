# RicoS-Menu

Public menu catalog for [RicoS](https://github.com/kilogold/RicoS). Each branch is an independent publish target.

## Rules

- **Do not** merge `preview` into `main` to promote menu content. `catalogVersion` is a per-branch counter, so preview's version cannot be carried over — a merge fails CI, and because the revalidate step is gated on a green verify, production keeps serving its cached catalog.
  - **Promote** a tested `preview` catalog with `bun scripts/promote-menu.mjs` (see below) instead.
- **Staff publish** should go through the RicoS admin menu editor (`POST /api/staff/admin/menu/commit-publish`), which bumps `catalogVersion` and updates `publishedAt`.
- **Direct git pushes** must increment `catalogVersion` by exactly `+1` and set `publishedAt` strictly later than the previous revision. CI enforces this on push.

## Promotion (`preview` → `main`)

`preview` is the tested release candidate; `main` is production.

```bash
bun scripts/promote-menu.mjs --dry-run   # report the version bump and item add/remove list
bun scripts/promote-menu.mjs             # commit on main
bun scripts/promote-menu.mjs --push      # commit and push
```

The script copies `preview`'s `menu.json` byte-for-byte and rewrites only `catalogVersion` (main's `+1`) and `publishedAt`, which is what the CI verifier demands. It commits via git plumbing, so your working tree and current branch are untouched — run it while sitting on `preview`. The release candidate is validated against `@ricos/shared` before anything is written; `main` is read leniently, since a stale production catalog is what the promotion is fixing.

`preview` is **not** guaranteed to be a superset of `main`. Read the `removed:` line in the output before promoting.

## CI

`.github/workflows/menu-catalog-ci.yml` runs:

1. `scripts/verify-menu-catalog-version.mjs` — schema + `catalogVersion` / `publishedAt` rules when `menu.json` changes.
2. `scripts/trigger-menu-revalidate.mjs` — `POST` to RicoS `/api/menu/revalidate` so the storefront cache picks up the new version (skipped when `menu.json` is unchanged).

### GitHub Actions secrets (RicoS-Menu repo)

| Secret | Value |
|--------|--------|
| `RICOS_PREVIEW_REVALIDATE_URL` | `https://<preview-host>/api/menu/revalidate` (no query string) |
| `RICOS_VERCEL_PROTECTION_BYPASS` | Vercel **Protection Bypass for Automation** secret (preview only) |
| `RICOS_PRODUCTION_REVALIDATE_URL` | `https://web-eight-roan-79.vercel.app/api/menu/revalidate` |

CI sends the bypass as the `x-vercel-protection-bypass` header (query params break Next.js API routing).

Local test:

```bash
GITHUB_REF_NAME=preview \
MENU_CATALOG_BASE_REF=HEAD~1 \
RICOS_PREVIEW_REVALIDATE_URL=https://web-git-preview-kelvin-bonillas-projects.vercel.app/api/menu/revalidate \
RICOS_VERCEL_PROTECTION_BYPASS=<secret> \
bun scripts/trigger-menu-revalidate.mjs
```

## Specification

See [SPEC.md](./SPEC.md) for the full menu catalog specification (modifier groups, `visibleWhen`, combo example).
