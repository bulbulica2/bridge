# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Ionic Vue 3 frontend for the "bridge" card-game project, built with Vite and
wrapped with Capacitor for native (iOS/Android) builds.

## Commands

```bash
npm run dev          # start Vite dev server at http://localhost:5173 (hot reload)
npm run build         # type-check (vue-tsc) then production build to dist/
npm run preview        # serve the production build locally
npm run lint          # eslint .
npm run test:unit        # run unit tests (Vitest, jsdom environment)
npm run test:e2e        # run e2e tests headlessly (Cypress)
```

Running a single test:
```bash
npx vitest run tests/unit/example.spec.ts   # single unit test file
npx vitest run -t "test name"          # by test name
npx cypress open                  # interactive Cypress runner (pick one spec)
npx cypress run --spec "tests/e2e/specs/test.cy.ts"  # single e2e spec headlessly
```
Cypress e2e specs hit `baseUrl: http://localhost:5173` (see `cypress.config.ts`), so `npm run dev` must be running first.

## Architecture

- **Routing is flat, driven by a side menu**: `src/router/index.ts` defines
  `/` → redirect to `/home`, plus lazy-loaded `/home` (`HomePage.vue`) and
  `/login` (`LoginPage.vue`) routes. Adding a new top-level section means
  adding both a view and a route entry here, plus an `ion-item` in
  `src/components/AppMenu.vue` if it belongs in the menu.
- **App shell**: `App.vue` renders `<AppMenu />` (the left `ion-menu`) next to
  `<ion-router-outlet id="main-content" />`; the menu's `content-id` must match
  that outlet id. Every page wraps its content in `<ion-page>` and uses
  `src/components/AppHeader.vue` (menu button + `title` prop, with an `end`
  slot reserved for header actions such as a future Account button).
- **Bootstrap**: `src/main.ts` installs `IonicVue` and the router on the Vue
  app, and imports Ionic's core/theme CSS module-by-module (core, normalize,
  structure, typography, plus optional utility CSS). Dark mode is wired via
  `@ionic/vue/css/palettes/dark.system.css` (follows OS setting) — swap this
  import if dark mode behavior needs to change (class-based vs. always-on).
- **Path alias**: `@/*` maps to `src/*` (configured in both `tsconfig.json`
  and `vite.config.ts` — keep both in sync if it changes).
- **Capacitor**: `capacitor.config.ts` declares `webDir: 'dist'`, so native
  builds sync from the Vite production build, not the dev server.
- **Tests live under `tests/`, not colocated with source**: `tests/unit/`
  (Vitest) and `tests/e2e/` (Cypress specs/support/fixtures) — see
  `cypress.config.ts` for the exact path wiring.

## Backend API

This frontend consumes a backend API (`bridge_backend`, a separate Laravel
app) that is not in this repo. Its documentation lives in a sibling folder
on disk, not on GitHub:

```
C:\xampp\htdocs\bridge_docs
```

Before assuming an endpoint, request/response shape, auth flow, or data
model, read the relevant file there rather than guessing:

- `bridge_docs/backend/API.md` — routes and request/response shapes
- `bridge_docs/backend/AUTH.md` — auth/cookie/CORS flow
- `bridge_docs/backend/DATA-MODEL.md` — data models
- `bridge_docs/backend/RUNNING.md` — how to run the backend locally

This documentation is maintained independently from the backend side and
can change over time — re-read the file rather than trusting a summary
cached earlier in a conversation.
