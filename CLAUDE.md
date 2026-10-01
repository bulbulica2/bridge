# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
The human-facing docs for this app live in `docs/` and are updated in the
same PR as the code (see "Keep `docs/` in sync" at the end).

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
  that table, entered from the detail page), `/history` (`HistoryPage.vue`,
  `meta.requiresAuth`, the menu's "My boards"), `/boards/:id/results`
  (`BoardResultsPage.vue`, `meta.requiresAuth`, reached from a board's
  review or the play page's "Compare with other tables"),
  `/playings/:id` (`PlayingReviewPage.vue`, `meta.requiresAuth`, one
  finished playing replayed, reached from a history entry or a results
  row) and
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
  user with `showWelcomeToast` once `/account` is up. The toasts' styles live in
  `src/theme/toasts.css`: toasts render outside the pages, so the CSS is
  global and styles the toast's shadow parts through `::part()`. Create
  table is the exception to `navigateAndSettle`: its modal closes and it
  navigates to `/play` as soon as `POST /tables` answers (#55).
- **App shell**: `App.vue` renders `<AppMenu />` (the left `ion-menu`) next to
  `<ion-router-outlet id="main-content" />`; the menu's `content-id` must match
  that outlet id. Every page wraps its content in `<ion-page>` and uses
  `src/components/AppHeader.vue` (menu button + `title` prop, an `end` slot for
  per-page header actions, and an "Account" button linking to `/account` that
  the header itself renders whenever the auth store says somebody is logged in).
  `AppMenu.vue` is auth-aware too: "Login" while logged out, "Tables" and
  "My boards" once logged in. Because both read the auth store, mounting any page in a unit test
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
  non-managers, 404 when that player already left, and
  `POST /tables/{id}/seats/users` that seats another user: 403 for
  non-managers, 409 for a taken seat or a user seated anywhere, never a move,
  and `POST /tables/{id}/seats/robots` `{seat}` that seats a robot: 403 for
  non-managers, 409 for a taken seat)
  and `src/stores/tables.ts` keeps both the list (`tables`) and the table the detail
  page is showing (`currentTable`), syncing a changed table into both.
  `create` seeds `currentTable`, and `openTable(id)` (the detail and play
  pages' entry) reuses the held copy of the table the store watches
  instead of a `GET /tables/{id}`; their refreshes still `loadTable`. The
  local backend answers one request at a time (`php artisan serve` on
  Windows), so the play page awaits only `GET /tables/{id}/playing` on
  entry and asks for bids after it (#55, `docs/RUNNING.md` Local speed). The
  table endpoints sit at the root (not under `/api`) and answer with an envelope,
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
  The manager controls (Remove, "Seat a player", "Add robot", the next
  board for everyone) show from the payload's `can_manage` (`TablePolicy::manage` for
  the caller, admins included); never re-derive it from
  `moderated_by`/`created_by`. `TableUpdated` leaves it out, so the store's
  `withCanManage` keeps the last HTTP value and refetches the table when
  `moderated_by` changes (taking only `can_manage` from that answer). The
  channel payload is typed `BroadcastTable`, `Table` adds `can_manage`.
  "Seat a player" opens `src/components/SeatPlayerSheet.vue`, a search over
  `GET /users?search=` (`searchUsers` in `src/services/users.ts`) through
  `src/composables/useUserSearch.ts` (300 ms debounce, 2 characters minimum,
  latest answer only, since the endpoint is throttled); `seated` users are
  greyed out. The store's `seatUser` seats the pick; picking yourself is a
  plain join instead.
- **Robots** (bb#65, backend `docs/ROBOTS.md`): users with `is_robot: true`
  (on every `PublicUser`; `GET /users?search=` never returns them) that
  fill seats nobody else takes. `createTable({robots: true})` (the
  Tables page's "Play with robots" toggle, on by default) seats three and
  deals at once, so the page goes straight to `/play`; a manager adds one
  with the store's `seatRobot(id, seat)` ("Add robot" on the detail page).
  The backend moves them (a queued job per `PlayingUpdated`, about 1 s
  apart; `queue:work` must run) through the same rules as a human, so the
  SPA only shows them: `RobotBadge.vue` next to their name (Home, Tables,
  detail, `BridgeTable`, `NextBoardBox`, the profile sheet, which has no
  "Full profile" link for a robot), and `BridgeTable`'s `thinking` prop +
  "robot-1 is thinking…" status when `acting_user_id` is a robot. Robots
  mark themselves ready after a board, so the human's Next deals the next
  one. When the last human leaves, the table stays **unattended**
  (`unattended_since` on `BroadcastTable`, `moderated_by: null`): robots
  wait, **anyone** may `DELETE /tables/{id}/seats/{robot}` (`canRemove()`
  in `src/services/tables.ts` is the hint), the first human to sit down
  becomes moderator, and the backend deletes it after `UNATTENDED_MINUTES`
  (10). `whoIsLeft()` / `leaveNote()` / `moveConsequences()` in
  `src/utils/seatMove.ts` word leaving or moving away when only robots
  would be left.
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
  `auction[].bid`'s shape), which the game store's `loadBids()` reads once;
  `prefetchBids` in `src/router/index.ts` reads it in the background a
  second after a logged-in page shows.
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
- **Card play**: `play(cardId)` posts `POST /tables/{id}/cards` and takes
  its answer through the same `isBehind` guard as `call`. `turn` is the
  hand the card comes from and `acting_user_id` who sends it (declarer on
  dummy's turn), so `handToPlay()` in `src/utils/play.ts` says whether the
  user plays their own hand, dummy's, or nothing (dummy never plays).
  `legalCards()` is the follow-suit hint that dims cards in `HandView`
  (given `playable` ids it turns into buttons). When the hand on play has
  exactly one legal card to follow with, `forcedCard()` (null on the lead)
  names it and `src/composables/useForcedPlay.ts` plays it after 3 s
  (`HandView`'s `forcedId` pulses it, the status line counts down). The
  page keys it by playing/trick/cards/turn/card, so a new state restarts
  or drops it; it is null while a card or claim is in flight, the claim
  sheet is open or the view is left (`onIonViewWillLeave`), and a key it
  already fired for isn't re-armed. `trickBySide()` places a
  trick's cards by seat for `TrickArea.vue`, which fills `BridgeTable`'s
  `centre` slot. `dummy_hand` is public only after the opening lead.
  `BridgeTable` lays it across the top for declarer, where it can be tapped,
  or as `DummyColumns.vue` on a defender's side seat, and not at all for
  dummy, whose own hand is the same cards. `current_trick` empties as soon
  as a trick's fourth card lands, so the page holds that trick (the last of
  `tricks`) with its winner for 2 s before clearing it, but only when seen
  live. The contract bar above the table carries `tricks_won`. Under the
  trick in progress, `LastTrickPopover.vue` (from the second trick on, not
  while a trick is held) pops up the last of `tricks` in a `TrickArea`:
  mouse hover opens it and leaving closes it (`pointerType === 'mouse'`
  only), a click toggles it, a pointerdown outside or Escape closes it.
  The centre keeps the trick in progress meanwhile. One card is in flight
  at a time; a 409 toasts and reloads, as for calls.
- **Claims**: during `play` any player but dummy may claim `tricks` of the
  tricks left (`13 - tricks.length`; 0 concedes) with `POST
  /tables/{id}/claim`; the other non-dummy players answer through
  `POST /tables/{id}/claim/response` `{accept}` (one reject cancels it) and
  the claimer may `DELETE` it. The game store's `claim`,
  `respondToClaim` and `withdrawClaim` go through the same `act`/`isBehind`
  path as `call`/`play`. While `claim` (`{seat, tricks, hand, accepted}`)
  is non-null no card is played, so `handToPlay()` returns null; the
  claimer's `hand` lies face up at their seat (`BridgeTable`'s `claim`
  prop). `isBehind` orders answers to one claim by `accepted.length`, but
  a claim appearing or going away always counts as newer, since a reject
  or withdrawal leaves the cards unchanged. `src/utils/claim.ts` holds the
  hints (`canClaim`, `claimAction`: withdraw/answer/null,
  `claimWaitingFor`, `claimText`); `ClaimSheet.vue` is the sheet (one button per number, then
  "Claim N tricks"; Concede sends 0),
  `ClaimPanel.vue` the pending-claim banner with its buttons. A claim
  going away mid-play toasts; the last accept lands in `finished` with
  `result.claimed`, which `resultSummary`/`BoardResultPanel` word as
  "by claim".
- **Board result and next board**: in `finished` the state carries `result`
  (`score_ns` is from N-S's side whichever side declared; a passed-out board
  has `score_ns: 0` and the rest null), `deal` (all four hands as dealt) and
  `ready` (the seats that asked for the next board). `src/utils/result.ts`
  words it and turns it round for the viewer's side (`resultSummary`,
  `viewerScore`); `BoardResultPanel.vue` shows it, `BridgeTable`'s `deal`
  prop lays each hand at its seat, and `NextBoardBox.vue` shows who is ready.
  The game store's `next(everyone)` posts `POST /tables/{id}/playing/next`
  through the same `isBehind` guard; the last player to ask gets the new
  board in the answer, the others through `PlayingUpdated` + `HandDealt`.
  `everyone` is a manager's call (`canManage()` hint, 403 otherwise). Leaving
  between boards abandons nothing and keeps `board_id`; with three seated
  the next ask 409s and a fourth player sitting down deals the board.
  `leaveWarning()` / `moveConsequences()` in `src/utils/seatMove.ts` word
  leaving by phase (`game.phaseOf(id)`). The running score at a table comes
  from `GET /api/user/playings` (`src/services/history.ts`): the store's
  `loadSessionScore(id)` sums the user's latest run of boards at that table.
- **Results and history**: `src/services/history.ts` also wraps
  `GET /users/{id}/playings` and `GET /boards/{id}/results` (every table's
  finished playing of a board, best N-S first, with `matchpoints` `{ns, ew}`
  out of `top`; 403 unless the user has finished that board, 404 for an
  unknown one). Both read the playings' seat snapshots, so they outlive a
  deleted table (`table_id: null`). The Pinia store `src/stores/history.ts`
  keeps histories by owner (`null` = the user, a number = anyone) as far
  as they are paged in (`loadHistory` = first page, `loadMore` = next,
  skipping rows that slid down a page) and results by board id (a 403/404
  drops the cached one); logout clears it. `src/components/HistoryList.vue`
  (loading states + `ion-infinite-scroll`, `load()` exposed to the page)
  and `HistoryEntryItem.vue` serve both `/history` and the profile page's
  "Boards played". `BoardResultsPage.vue` highlights the tables the viewer
  sat at (`seatOfUser`) with their side's `matchpointPercent`.
- **Board review**: `GET /playings/{id}` (`getPlayingReview`, typed
  `PlayingReview` = `PublicPlaying` less `ready`, players nullable) is one
  finished playing with its auction and tricks, for anyone who finished
  that board (403 otherwise, 404 unknown or unfinished), even once the
  table is gone. The history store's `loadReview` caches it by playing id
  and never refetches it (a finished playing doesn't change); `clear()`
  drops it. `PlayingReviewPage.vue` holds one number, `step` (cards
  played), and `src/utils/review.ts` derives the rest: `playedCards` (the
  tricks, then a claim's unfinished `current_trick`), `reviewAt` (hands
  left from `deal`, the trick shown with its winner once complete, tricks
  won, who's next), `nextTrickStep`/`previousTrickStep` and `stepCaption`.
  It reuses `BridgeTable` (`deal` = hands left, `replay` for the label),
  `TrickArea`, `AuctionHistory` and, at the last step, `BoardResultPanel`.
  The viewer sits at the bottom if they played it (`seatOfUser`), else
  South. An empty `auction` (`isRecorded`) means a playing finished before
  bb#60: only the deal and the result, with a notice. `HistoryEntryItem`
  and each `BoardResultsPage` row link to it.
- **Public profiles**: `src/services/users.ts` wraps `GET /users/{id}` (auth,
  envelope, 404 for an unknown id) and defines `PublicUser` (`id`, `name`,
  `username`, `description`, `is_robot`, never the email); `TableSeat.user` uses that type
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
  **Heartbeat**: the backend frees idle seats (through the normal leave
  path), so the tables store sends `POST /tables/{id}/heartbeat` every 30 s
  for as long as it watches a table (`watchTable`/`unwatchTable` start and
  stop it, so leave, kick, move and logout end it too). It pauses while
  `document.visibilityState` is hidden; on return it beats at once, refetches
  the table and the game state, and a seat lost meanwhile (or a 403/404 from
  a beat) is told as `IDLE_NOTICE` and sets `kickedFrom`. A removal noticed
  while hidden keeps its toast until the page shows again.
  Running it needs `php artisan reverb:start` and `queue:work` on the backend
  (bridge_backend `docs/RUNNING.md`, Realtime).
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
app, checked out at `C:\xampp\htdocs\bridge_backend`) that is not in this
repo. Before assuming an endpoint, request/response shape, auth flow, or
data model, read the backend's docs rather than guessing:

- `API.md` — routes and request/response shapes
- `AUTH.md` — auth/cookie/CORS flow
- `DATA-MODEL.md` — data models
- `RUNNING.md` — how to run the backend locally
- `GAME-RULES.md` — the bridge rules and how the backend maps them

Where to read them: the backend repo's `docs/` (plus `ROBOTS.md`, how the
robot players bid and play). The local checkout can lag or sit on another
branch, so read `origin/main`, not the working tree:

```bash
git -C C:\xampp\htdocs\bridge_backend fetch -q
git -C C:\xampp\htdocs\bridge_backend show origin/main:docs/API.md
```

`src/` comments cite them as `bridge_backend docs/<file>`. The old
out-of-git `C:\xampp\htdocs\bridge_docs\` folder is out of date since
bulbulica2/bridge_backend#61 moved the docs into the backend repo; don't read it.

These docs change with the backend — re-read the file rather than trusting
a summary cached earlier in a conversation.

## Keep `docs/` in sync — in the same PR, not as a follow-up

`docs/` holds this app's docs for people (not Claude). They ship with the
code: a PR that changes what they describe updates them in its own diff,
so the reviewer sees both.

| File | Update it when you change... |
|---|---|
| `RUNNING.md` | setup or run steps, an `.env` key, a port, an npm script, the test setup, or what must run on the backend for the app to work |
| `ARCHITECTURE.md` | a route or route meta, the guard, a store (state or actions), a service or the endpoints it calls, error handling, loading/toast behaviour, a channel or event, the heartbeat, a shared component or util |
| `SCREENS.md` | a page is added or removed, or what a page shows, which store actions or endpoints it calls, or which frontend/backend issue it depends on |
| `README.md` | none of the above changed but the status line (branch reference) is stale |

Rules:
- Same commit as the code: if you touch `src/router/`, `src/stores/`,
  `src/services/`, `src/views/`, `.env`, `vite.config.ts` or
  `package.json` scripts, check whether `docs/` needs a matching edit
  before considering the task done. Bump the branch named at the top of
  every file you edit.
- Write for a developer joining the project, not for Claude: explain what
  and why in plain words, and link to the backend's docs on GitHub
  (`https://github.com/bulbulica2/bridge_backend/blob/main/docs/<file>`)
  for endpoint shapes rather than copying them.
- Docs reflect the code as it is. Something planned goes in as "coming"
  with its issue number, never as working.
- This file (CLAUDE.md) stays the detailed map for Claude; the
  architecture notes above and `ARCHITECTURE.md` cover the same ground,
  so when one changes, check the other.
