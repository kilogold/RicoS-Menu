# RicoS-Menu

Public menu catalog for [RicoS](https://github.com/kilogold/RicoS). Each branch is an independent publish target.

| Branch | Deployment |
|--------|------------|
| `main` | Production (`MENU_PUBLISH_MENU_JSON_URL` → `.../main/menu.json`) |
| `preview` | Preview / local dev (`.../preview/menu.json`) |

## Rules

- **Do not** merge `preview` into `main` to promote menu content. Production and preview menus evolve separately.
- **Staff publish** should go through the RicoS admin menu editor (`POST /api/staff/admin/menu/commit-publish`), which bumps `catalogVersion` and updates `publishedAt`.
- **Direct git pushes** must increment `catalogVersion` by exactly `+1` and set `publishedAt` strictly later than the previous revision. CI enforces this on push.

## Layout

```
menu.json   # catalogVersion, publishedAt, categories, items, …
```

## CI

`.github/workflows/menu-catalog-ci.yml` validates version bumps using the shared verifier from the RicoS app repo.
