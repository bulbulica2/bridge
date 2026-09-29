# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Ionic Vue 3 frontend for the "bridge" card-game project, built with Vite and
wrapped with Capacitor for native (iOS/Android) builds.

## Commands

```bash
npm run dev          # start Vite dev server at http://localhost:3000 (hot reload)
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
Cypress e2e specs hit `baseUrl: http://localhost:3000` (see `cypress.config.ts`), so `npm run dev` must be running first.

## Architecture

- **Routing is flat, driven by a side menu**: `src/router/index.ts` defines
  `/` → redirect to `/home`, plus lazy-loaded `/home` (`HomePage.vue`: an
  intro with Log in / Create account for guests; for a logged-in user a
  "Your table" card from the tables store's `myTable`, or "Find a table"),
  `/login` (`LoginPage.vue`, `meta.guestOnly`), `/create-account`
  (`CreateAccountPage.vue`, `meta.guestOnly`, linked from the Login page and guest Home),
  `/reset-password` and `/password-reset/:token` (both `ResetPasswordPage.vue`,
  `meta.guestOnly`, reached from the Login page or the emailed link),
  `/account` (`AccountPage.vue`, `meta.requiresAuth`), `/tables`
  (`TablesPage.vue`, `meta.requiresAuth`, the menu's logged-in entry),
  `/tables/:id` (`TableDetailPage.vue`, `meta.requiresAuth`, one table's four
  seats, reached from the list's "Open" button, not from the menu),
  `/tables/:id/play` (`TablePlayPage.vue`, `meta.requiresAuth`, the game at
  that table, entered from the detail page) and
  `/users/:id` (`UserProfilePage.vue`, `meta.requiresAuth`, a player's public
  profile, reached from the profile sheet, not from the menu). Adding a
  new top-level section means adding both a view and a route entry here, plus an `ion-item` in
  `src/components/AppMenu.vue` if it belongs in the menu.
- **Route guard**: a single `router.beforeEach` in `src/router/index.ts` enforces
  the route meta declared in the same file (`RouteMeta` is augmented there):
  `requiresAuth` sends guests to `/login`, `guestOnly` sends logged-in users to
  `/account`. It awaits `authStore.loadSession()` first, which calls
  `GET /api/user` once per page load so a reload on an auth-only page doesn't
  bounce a user whose Sanctum session cookie is still valid.
- **Loading feedback**: `src/router/loading.ts` holds the route-loading flag.
  `beforeEach`/`afterEach`/`onError` in `src/router/index.ts` drive it, and
  `App.vue` shows it as an indeterminate `ion-progress-bar` after 150 ms. Forms
  that navigate on success call `navigateAndSettle(ionRouter, path)` (Ionic's
  `navigate()` returns nothing) and stay disabled until it resolves. `main.ts`
  mounts only after the first navigation (which on a reload includes
  `loadSession()`), so `index.html` carries a plain-CSS boot bar until then.
  After the first page shows, the router prefetches every lazy page chunk.
  Toasts go through `src/utils/toast.ts`; they outlive a navigation, so
  logout presents its toast once `/login` is up, and login/sign-up greet the
  user with `showWelcomeToast` once `/account` is up. Its styles live in
  `src/theme/toasts.css`: toasts render outside the pages, so the CSS is
  global and styles the toast's shadow parts through `::part()`.
- **App shell**: `App.vue` renders `<AppMenu />` (the left `ion-menu`) next to
  `<ion-router-outlet id="main-content" />`; the menu's `content-id` must match
  that outlet id. Every page wraps its content in `<ion-page>` and uses
  `src/components/AppHeader.vue` (menu button + `title` prop, an `end` slot for
  per-page header actions, and an "Account" button linking to `/account` that
  the header itself renders whenever the auth store says somebody is logged in).
  `AppMenu.vue` is auth-aware too: "Login" while logged out, "Tables" once
  logged in. Because both read the auth store, mounting any page in a unit test
  needs an active Pinia.
- **Auth / HTTP**: `src/services/http.ts` is the shared axios instance
  (`baseURL` from `VITE_API_BASE_URL` in `.env`, `withCredentials` +
  `withXSRFToken` for Sanctum's cookie flow). `src/services/auth.ts` wraps the
  Sanctum SPA calls (`GET /sanctum/csrf-cookie` → `POST /login` / `POST /register`
  / `POST /logout` / `POST /forgot-password` / `POST /reset-password`,
  `GET /api/user`, `PATCH /api/user`), and the Pinia store `src/stores/auth.ts`
  holds the logged-in user and exposes `login`, `register`, `logout`,
  `loadSession`, `requestPasswordReset`, `resetPassword` and `updateProfile`.
  Views call the store, not the services directly.
- **Profile edit** lives on `AccountPage.vue` as an in-page edit mode (no
  route of its own). `PATCH /api/user` takes only `name` and `description`
  (`null` clears it; username/email/password are ignored) and, unlike
  `GET /api/user`, answers with the `{status, message, data}` envelope. The
  store replaces `user` with `data`, so the header and menu update at once.
- **Password reset is a two-stage guest flow**: `/reset-password` posts the email
  to `/forgot-password`; the backend emails a link to
  `<FRONTEND_URL>/password-reset/<token>?email=<email>`
  (`AppServiceProvider::boot` in bridge_backend), which the
  `/password-reset/:token` route renders as the "choose a new password" stage.
  Both endpoints answer `200 {"status": "<message>"}` and the reset does **not**
  start a session, so the page redirects to `/login` afterwards.
- **Game domain (tables)**: `src/services/tables.ts` wraps the session-authenticated
  table endpoints (`GET /tables`, `POST /tables`, `GET /tables/{id}`,
  `POST /tables/{id}/seats`, `DELETE /tables/{id}/seats`, and the manager-only
  `DELETE /tables/{id}/seats/{user}` that kicks another player: 403 for
  non-managers, 404 when that player already left) and
  `src/stores/tables.ts` keeps both the list (`tables`) and the table the detail
  page is showing (`currentTable`), syncing a changed table into both. These
  endpoints sit at the root (not under `/api`) and answer with an envelope,
  `{status, message, data}`, so the service returns `data.data`; 409s carry
  their reason in `message`. A table exists only while somebody sits at it, so
  the last player leaving **deletes** it: that response's `data` is
  `{table_deleted: true}` instead of a table, and the id 404s afterwards.
  Taking a seat while holding one is a **move**, not a 409: a plain seat change
  at the same table, or, at another table, it frees the old seat with every
  consequence of leaving it. The store's `join` then reloads `GET /tables`
  (the response only describes the joined table), and both pages confirm a
  cross-table move first via `src/utils/seatMove.ts`; `myTable` /
  `seatedTable()` tell them where the user sits.
  `canManage()` mirrors the backend's `TablePolicy::manage`, but only as a hint —
  `is_admin` is hidden from `GET /api/user`, so admins read as non-managers.
- **Game (playing)**: `src/services/game.ts` wraps
  `GET /tables/{id}/playing` (seated players only, 403 otherwise) and types the
  game state (`Playing` = the public `PublicPlaying` + `my_seat` and `hand`,
  the caller's own cards only). The Pinia store `src/stores/game.ts` holds the
  state of one table (`tableId`, `playing`): `load()` replaces it all (also how
  a reload or reconnect rebuilds it); `PlayingUpdated` replaces the public part
  and carries the hand over (less any card played); `HandDealt` on the user's
  own channel `private-App.Models.User.{id}` brings a new board's hand, kept
  as pending if it beats that board's `PlayingUpdated`. A `TableUpdated` whose
  `board_id` went back to null mid-board means a player left and the board was
  abandoned: toast and back to `waiting`. The auth store follows the user
  channel from login/session restore to logout (`watchUser`/`unwatchUser`).
  `TablePlayPage.vue` draws it with `src/components/BridgeTable.vue` (the four
  seats rotated so the viewer is always at the bottom, dealer and
  red/green vulnerability, whose turn), `HandView.vue` and `PlayingCard.vue`;
  card sorting, rank labels (the backend skips 11: `12`=J … `15`=A), seat
  rotation and vulnerability live in `src/utils/cards.ts`. The detail page
  moves a seated player to `/play` when `board_id` turns non-null.
- **Bidding**: calls go out as a `bid_id`, and the ids aren't pinned to the
  rank, so they come from the public `GET /bids` (`getBids`, the 38 calls in
  `auction[].bid`'s shape), which the game store's `loadBids()` reads once.
  Never hard-code or compare bid ids; look a call up by `call` or
  `level`/`strain`. `call(bidId)` posts `POST /tables/{id}/calls` and takes
  the full state it answers with. Both it and `PlayingUpdated` skip a state
  that is behind the one shown for the same board (`isBehind`: phase, calls,
  cards, ready), since the HTTP answer and the channel race. The auction's
  rules (GAME-RULES.md §4) are mirrored in `src/utils/auction.ts` only as a
  hint (`isLegalCall`, `canDouble`, `canRedouble`), along with the labels and
  the grid layout. A 409 from the backend is the final word: the page toasts
  its `message` and reloads. On the play page, `BiddingBox.vue` shows only
  on the user's turn during `auction` and stays disabled while a call is in
  flight. `AuctionHistory.vue` is the four-column grid, rotated like the
  table (the viewer's column last, so South reads W N E S), starting in the
  dealer's column. `CallLabel.vue` draws one call. The page announces the
  contract (or "Passed out") and toasts it when the last call arrives live.
- **Public profiles**: `src/services/users.ts` wraps `GET /users/{id}` (auth,
  envelope, 404 for an unknown id) and defines `PublicUser` (`id`, `name`,
  `username`, `description`, never the email); `TableSeat.user` uses that type
  too, since table payloads embed the same profile per seat. The Pinia store
  `src/stores/users.ts` caches profiles by id (a 404 drops the cached one).
  Tapping a seated player's name on either table page opens
  `src/components/PlayerProfileSheet.vue`, a bottom-sheet `ion-modal` that
  shows the embedded copy at once, refreshes it from the store, and links to
  `/users/:id`. The own record with its email stays the auth store's `User`.
- **Realtime (Reverb)**: `src/services/echo.ts` holds one lazily created
  Laravel Echo instance (`broadcaster: 'reverb'`, `VITE_REVERB_*` in `.env`)
  whose `authorizer` signs private channels via `POST /broadcasting/auth`
  through the shared `http` instance (Echo's own authorizer skips
  `X-XSRF-TOKEN`). `private-table.{id}` admits only players seated there
  (403 otherwise) and the server never ends a subscription, so the tables
  store owns it: `watchTable(id)` / `unwatchTable()` follow the user's seat
  after create, join, a move, a leave and every load, and logout disconnects
  the socket. The same channel carries `PlayingUpdated`, which the tables
  store hands to the game store. Each `TableUpdated` carries the whole table and **replaces** it
  via the store's sync path; one that no longer seats the user (outside their
  own seat request) is a kick: toast, unsubscribe, and `kickedFrom` makes the
  detail page go back to `/tables`. After a reconnect the watched table is
  refetched once. The Tables list has no channel and stays refresh-only.
  Running it needs `php artisan reverb:start` and `queue:work` on the backend
  (`bridge_docs/backend/RUNNING.md`, Realtime).
- **Error handling**: `src/utils/errors.ts` is the one axios-error reader —
  `errorMessage(e, fallback)` for the text to show, `statusOf(e)` for the
  status to branch on and `fieldErrors(e)` for a 422's first message per field
  (shown under each input). Three envelopes reach the SPA: the game endpoints'
  `{status, message, data}`, Laravel's 422 `{message, errors}`, and a bare
  `{message}` from auth/policy failures.
- **Dev server port is 3000 on purpose** (`vite.config.ts`, `strictPort`): the
  backend's CORS `allowed_origins` defaults to `http://localhost:3000` and that
  host is a Sanctum stateful domain. Keep `VITE_API_BASE_URL` on `localhost`
  (not `127.0.0.1`) so session/XSRF cookies are shared with the SPA.
- **Bootstrap**: `src/main.ts` installs `IonicVue`, Pinia and the router on the Vue
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

## Git workflow: "commit and push"

When the user says to commit and push (in any wording), do the whole flow
without asking again:

1. Stage all changes and commit. The first line of every commit message is the
   current branch name, a space, then a short summary, e.g.
   `5-create-account-page Add Create Account page with registration flow`.
   Add a bullet body when useful, `Closes #N` on the issue's main commit
   (N = the branch's leading number), and the Co-Authored-By trailer.
2. `git push -u origin <branch>`.
3. If the branch has no open PR yet, create one against `main`: write the body
   to a file and run `gh pr create --base main --head <branch> --title "<issue title>"
   --body-file <file>` (a long inline `--body` breaks in Windows PowerShell 5.1).
   Body: `Closes #N`, a summary per file, anything deferred to other issues,
   and a test plan. If a PR is already open, the push updates it; don't create another.
4. Reply with the PR link.

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
