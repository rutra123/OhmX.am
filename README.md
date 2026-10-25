# OhmX.am

OhmX.am is an engineering-oriented online catalog for electrical, HVAC, heating, plumbing, controls and
automation equipment in the Armenian market. Besides a retail catalog it contains engineering tools:
load and equipment-selection calculators, a warm-floor designer and bill-of-materials (BOM) generation
that resolve requirements to real catalog items.

This repository is a source snapshot of the website plus an export of its public product catalog. It is
prepared so that the code and the catalog can be browsed and indexed together.

## Repository layout

| Path | Contents |
|---|---|
| `client/` | Frontend: React 18, TypeScript, Vite, Tailwind, zustand, react-router, i18next, pdfmake |
| `client/src/` | Pages, components, API client, building-project wizard and equipment-selection UI |
| `client/pwa/` | Static assets copied into the build (PWA manifest and service worker, category art, series images, warm-floor settings) |
| `client/tests/` | Frontend tests (`node:test` run through `tsx`) |
| `server/` | Backend: Node.js, Express, SQLite via `better-sqlite3`, TypeScript |
| `server/src/routes/` | HTTP API: catalog, categories, brands, series, products, search, orders, uploads, documents, tools, building project, warm-floor project, catalog matcher, AI engineering, admin |
| `server/src/utils/` | Domain logic: building-project loads, hydronics, solar, air and transmission calculations; warm-floor engine; catalog matcher; engineering configurator; hydronic BOM |
| `server/src/services/` | Catalog search index, full export, engineering selection, product relationships, calculator inference |
| `server/src/scripts/`, `server/src/cli/` | Maintenance and import tools (these write to a database; see below) |
| `server/src/data/` | Reference datasets: Armenian building climatology, PVGIS solar irradiance, warm-floor configuration |
| `server/test-fixtures/` | Schema-only DDL used by tests |
| `scripts/` | Python helpers for catalog audits and engineering product data, the catalog exporter and verifier, and the test runner |
| `tests/` | Root-level tests and `known-gaps.json` |
| `catalog/` | Export of the public product catalog (see below) |

## Catalog export

`catalog/` is a deterministic snapshot of the catalog database, written by `scripts/export_public_catalog.py`
and checked by `scripts/verify_public_catalog_export.py`. It holds one JSON Lines file per table in `catalog/data/`
(UTF-8, original column names and identifiers, sorted by primary key), the referenced images and documents under
`catalog/storage/` at the same relative paths as the site URLs, and manifests with record counts and SHA-256
checksums (`manifest.json`, `asset-manifest.tsv`, `extra-assets-manifest.tsv`). See `catalog/README.md` for the
table joins and scope rules.

The export covers products (including inactive ones, with their status), brands, categories, series, product
features and attributes, images, approved product relationships and the engineering specification tables. Orders,
customer data, accounts and application settings are not part of it, and the database file itself is not included.

Product photographs and manufacturer artwork are supplied through official distributor relationships. Their
redistribution is governed by the applicable agreements; they are not released under an open-source licence.
This repository currently has no licence file, so no reuse rights are granted by default.

## Development

Prerequisites: Node.js 24 (the version production runs) and a current npm, plus Python 3 for the helper tests.
Native modules (`better-sqlite3`, `esbuild`) need their install scripts, so use a normal `npm ci`.

```
npm ci
npm run dev          # client on 127.0.0.1:5173, server with file watching
```

The server reads its settings from environment variables (`PORT`, `CLIENT_URL`, `DB_PATH`, `ADMIN_PASSWORD`,
`ADMIN_TOKEN_SECRET`, optional SMTP settings and `OPENAI_API_KEY`). Admin login stays disabled until both admin
variables are set. No database is included: point `DB_PATH` at a database of your own. `npm run seed` fills an
empty one with demo data.

## Tests, type checks and lint

```
npm test                 # unit suites: server, client, root node tests, Python
npm run test:server      # server suites only
npm run test:client      # client suites only
npm run test:known-gaps  # tests that are known to fail (see below); exits non-zero while they do
npm run typecheck        # server and client type checks
npm run lint             # ESLint 10 flat config (eslint.config.mjs)
```

`scripts/run-tests.mjs` runs every suite with a scrubbed environment and a throwaway database path, so tests cannot
open a real database, read a `.env` file or call external services. Tests that need an outside input are skipped with
an explicit reason:

- `search.api-regression.test.js` needs `OHMX_SEARCH_BASE_URL` pointing at a disposable running server.
- Engineering research-package tests need `OHMX_ENGINEERING_RESEARCH_DIR` and `OHMX_ENGINEERING_BASELINE_DB`.
- Suites that compare against a database snapshot need `DB_PATH` and `OHMX_INFERENCE_TEST_DB` set to copies of one snapshot.

Do not run `db:reset`, `seed`, `import:*`, `apply:*` or the tools in `server/src/scripts/` against a database you want to keep.

## Build

`npm run build` compiles the client (`tsc -b && vite build` into `client/dist`) and the server
(`tsc -p server/tsconfig.prod.json` into `server/dist`, followed by copying runtime data files).
`client/dist`, `server/dist`, databases, uploads and `.env` files are generated or private runtime artifacts and are not
tracked here. The production build compiles an explicit list of server files (`server/tsconfig.prod.json`); some
source modules, for example the building-project quality and engineering-orchestrator modules, are not part of it.

## Known limitations

- `tests/known-gaps.json` lists the tests that currently fail, with the reason for each. Most check
  building-project service wiring that is not present in the service source. They are kept visible rather than
  weakened or skipped.
- `npm run typecheck` reports 11 type errors in server modules that are outside the production build;
  the production build itself compiles cleanly.
- `npm run lint` reports existing findings, mostly `@typescript-eslint/no-explicit-any`. They have not been suppressed.
- Redistribution rights for manufacturer images are not independently verified here (see above).
