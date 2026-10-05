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
npm run test:unit        # run unit tests (Vitest, jsdom environment, watch mode)
npm run test:unit:ci      # run unit tests once (vitest run)
npm run test:coverage      # unit tests once with coverage + the 95 % rule, as CI does
npm run test:e2e        # run e2e tests headlessly (Cypress)
```

Running a single test:
```bash
npx vitest run tests/unit/example.spec.ts   # single unit test file
npx vitest run -t "test name"          # by test name
npx cypress open                  # interactive Cypress runner (pick one spec)
npx cypress run --spec "tests/e2e/specs/home.cy.ts"  # single e2e spec headlessly
```
Cypress e2e specs hit `baseUrl: http://localhost:3000` (see `cypress.config.ts`), so `npm run dev` (or `vite preview --port 3000`) must be running first.

CI (`.github/workflows/ci.yml`, Node from `.nvmrc`) runs four parallel jobs on
every PR to `main` and every push to `main`: `lint` (`npm run lint`), `unit`
(`npm run test:coverage`), `build` (`npm run build`) and `e2e` (the guest-only
smoke `tests/e2e/specs/home.cy.ts` against `vite preview` on port 3000, no
backend: it stubs `GET /api/user` as 401). Keep all four green; the job names
are what branch protection requires, so don't rename them. Ubuntu is
case-sensitive: an import's case must match the file's.

## Coverage: 95 % on every task, no exceptions

The user's standing rule (#91): **no task may leave code coverage under
95 %.** Every task ships as close to perfect as it can be.

- Every file under `src/` keeps **≥ 95 % of its lines** covered
  (`scripts/coverage-check.mjs`), and the app as a whole ≥ 95 % of lines,
  statements and functions and ≥ 90 % of branches (thresholds in
  `vite.config.ts`). `npm run test:coverage` and CI's `unit` job fail
  otherwise.
- Each task writes the tests for the code it adds or changes in the same
  PR: aim for every new line, branch and function covered, not just the
  95 % floor. Touching a file means it leaves the PR at ≥ 95 % even if it
  was lower before.
- Don't run `npm run test:coverage` locally by default: CI's `unit` job
  runs it on every push to a PR. Before committing, run the unit tests
  (`npm run test:unit:ci`, or just the specs you touched), `npm run lint`
  and `npm run build`.
- **Don't watch CI after pushing.** The user watches the PR's checks and
  says when one fails; until then, stop at the PR link: no `gh pr checks`,
  `gh run watch` or polling. When told a check failed, fix it: for a
  coverage failure in `unit`, run `npm run test:coverage` locally, read
  the table for the files you touched (`coverage/index.html` shows the
  uncovered lines), add the missing tests and push again.
- Never lower a threshold, add a file to the coverage `exclude`, or add
  `/* v8 ignore */` comments to get under the bar. Raise the branches
  threshold when the totals allow it.
- Every new issue (card) written for this repo lists in its Acceptance:
  "`npm run test:coverage` passes; every file the task adds or touches has
  ≥ 95 % of its lines covered by unit tests". Every PR's test plan lists
  the tests added for the files it touched (CI's `unit` job reports their
  coverage; don't wait for it to fill the PR in).

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
  `/sets/:id` (`SetResultsPage.vue`, `meta.requiresAuth`, one set of
  four boards' results, reached from a set's header in a history list),
  `/playings/:id` (`PlayingReviewPage.vue`, `meta.requiresAuth`, one
  finished playing replayed, reached from a history entry or a results
  row) and
  `/users/:id` (`UserProfilePage.vue`, `meta.requiresAuth`, a player's public
  profile, reached from the profile sheet, not from the menu). Adding a
  new top-level section means adding both a view and a route entry here
  (with `meta.findsSeat` if the page loads the Tables list or a table
  itself), plus an entry in `links` in `src/components/AppMenu.vue` if it
  belongs in the menu.
- **Route guard**: a single `router.beforeEach` in `src/router/index.ts` enforces
  the route meta declared in the same file (`RouteMeta` is augmented there):
  `requiresAuth` sends guests to `/login`, `guestOnly` sends logged-in users to
  `/account`, `notBanned` (on `/tables/:id` and `/tables/:id/play`) sends a
  banned user (`auth.isBanned`) to `/tables`. It awaits `authStore.loadSession()` first, which calls
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
  table and taking a seat on the Tables page are the exceptions to
  `navigateAndSettle`: Create's modal closes and, with robots, it
  navigates to `/tables/:id` (where Start is, #68) as soon as
  `POST /tables` answers (#55); a seat navigates as soon as
  `join` answers, to `/tables/:id/play` if the returned table's `board_id`
  is set, else `/tables/:id` (#67), with the seat buttons disabled until
  `onIonViewDidLeave`.
- **App shell**: `App.vue` wraps `<AppMenu />` (the left `ion-menu`) and
  `<ion-router-outlet id="main-content" />` in an `ion-split-pane`
  (`content-id="main-content"`, the menu's `content-id` must match). From
  `md` (768 px) up the menu stays beside the page (#99); the split pane's
  `when` is `PINNED_FROM` or `false` from `menuPinned` in
  `src/utils/menu.ts` (`localStorage` `bridge.menuPinned`, try/catch,
  default open). The menu is 320 px wide (#134): the split pane's
  `--side-min-width`/`--side-max-width` in `App.vue`, the overlay's
  `--width` on `ion-menu::part(container)` in `AppMenu.vue` (Ionic's own
  264 px below 341 px sits there; `--max-width: calc(100vw - 40px)`), so
  the Your table entry fits on one row; its badge sits in
  `.menu-table-status`, a grid cell sized by an invisible
  `.menu-table-sizer` badge holding the longest `STATUS_TEXT`, and the
  label's lines are `nowrap` + ellipsis (the name's `title` holds it whole). `AppHeader`'s menu button is `toggleMenu()`, not
  `ion-menu-button` (which hides beside a pinned menu): from `md` up it
  flips `menuPinned`, below it `menuController.toggle()` (the overlay, as
  before). `ion-menu-toggle` stays: Ionic ignores it for a menu shown in a
  split pane. Every page wraps its content in `<ion-page>` and uses
  `src/components/AppHeader.vue` (menu button, the **Your table** button,
  `title` prop, an `end` slot for per-page header actions, and an
  "Account" button linking to `/account` that the header itself renders
  whenever the auth store says somebody is logged in (icon only below
  576 px while Your table shows), and `BanBanner.vue` under the toolbar
  while the user is banned). `App.vue` also holds `BanNotice.vue` (see
  Bans). `AppMenu.vue` is auth-aware too: "Login" while logged out,
  "Tables" and "My boards" once logged in, the current page marked
  `aria-current`. **Your table** (#99): `src/composables/useYourTable.ts`
  (header button + the menu's first entry) reads the tables store's
  `myTable` (nothing for a guest, a banned user or nobody seated): target
  `/tables/:id/play` if `board_id` or the seat is held/away, else
  `/tables/:id`; status `away` > `turn` (`turnNotice` on the game store's
  board for that table, `startNeeded` for a Start) > `board`; `current`
  when the route is the target, `atTable` on either table page. `myTable`
  on every page: the router's `afterEach` calls the store's `findSeat()`
  (one `GET /tables`, deduped, skipped once anything held says where we
  sit) except on routes with `meta.findsSeat` (`/home`, `/tables`,
  `/tables/:id`, `/tables/:id/play`, which load it themselves; the detail
  page calls `findSeat()` after opening a table). `load()` then follows
  the seat's channel and heartbeat. Logout calls the store's `clear()`.
  Because the header and menu read the auth store, mounting any page in a
  unit test needs an active Pinia; they read the route through
  `inject(routeLocationKey, null)`, so tests without a router still mount.
- **Auth / HTTP**: `src/services/http.ts` is the shared axios instance
  (`baseURL` from `VITE_API_BASE_URL` in `.env`, `withCredentials` +
  `withXSRFToken` for Sanctum's cookie flow). `src/services/auth.ts` wraps the
  Sanctum SPA calls (`GET /sanctum/csrf-cookie` → `POST /login` / `POST /register`
  / `POST /logout` / `POST /forgot-password` / `POST /reset-password`,
  `GET /api/user`, `PATCH /api/user`), and the Pinia store `src/stores/auth.ts`
  holds the logged-in user and exposes `login`, `register`, `logout`,
  `loadSession`, `requestPasswordReset`, `resetPassword` and `updateProfile`.
  Views call the store, not the services directly. `LoginCredentials` has an
  optional `remember` (the Login page's "Remember me", off by default, #65):
  the backend then sets its long-lived `remember_web_*` cookie, so
  `loadSession()` stays logged in after the session expires; `/logout`
  clears it. Registration never remembers.
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
  non-managers, 409 for a taken seat, and `POST`/`DELETE /tables/{id}/start`,
  see Start below)
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
  The manager controls (Remove, "Seat a player", "Add robot") show from
  the payload's `can_manage` (`TablePolicy::manage` for the caller: the
  moderator or an admin, never the creator as such, bb#74); never re-derive it from
  `moderated_by`/`created_by`. Remove goes through `canRemove(table,
  user, viewer)`: never on your own seat (that is Leave), and an admin's
  seat (`PublicUser.is_admin`) only for an admin viewer, never the
  moderator (#77, bb#78: only an admin removes an admin, no timer frees
  them, so the tables store's `freedAsIdle` never tells an admin
  `IDLE_NOTICE`). `AdminBadge.vue` marks admins wherever `RobotBadge`
  goes, plus `StartBox` and `UserProfilePage`. `TableUpdated` leaves
  `can_manage` out, so the store's
  `withCanManage` keeps the last HTTP value and refetches the table when
  `moderated_by` changes (taking only `can_manage` from that answer);
  `canManageDue` keeps asking on every broadcast until an answer for the
  held moderator lands (`loadTable` clears it too), and a failed refetch
  retries `CAN_MANAGE_RETRIES` (3) times `CAN_MANAGE_RETRY_MS` (3 s) apart
  while the table is watched (#117). The play page's `StartBox` (`manage`
  = `can_manage`, with `showSeats`) offers Seat a player / Add robot per
  empty seat (`seatPlayer`/`addRobot` events, `fillingSeat`), run by the
  page's `fillSeat` (picking yourself is a `join`; a refusal toasts and
  `loadTable`s, 401 → login) with its own `SeatPlayerSheet` (#117). The
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
  Tables page's "Play with robots" toggle, on by default) seats three
  but deals nothing, so the page goes to `/tables/:id`, where the
  creator's Start deals (robots are always ready); a manager adds one
  with the store's `seatRobot(id, seat)` ("Add robot" on the detail page).
  The backend moves them (a queued job per `PlayingUpdated`, about 1 s
  apart; `queue:work` must run) through the same rules as a human, so the
  SPA only shows them: `RobotBadge.vue` next to their name (Home, Tables,
  detail, `BridgeTable`, the profile sheet, which has no "Full profile"
  link for a robot), and `BridgeTable`'s `thinking` prop + "robot-1 is
  thinking…" status when `acting_user_id` is a robot. Robots count as
  having asked for the next board, so a lone human's **Deal now** deals
  it at once. A robot declarer hands the play to its human dummy (#95, bb#94):
  `acting_user_id` is that dummy on declarer's turn and on dummy's, the
  play page reads it as `handToPlay() === 'declarer'`, and
  `playsForDeclarer()` (`src/utils/play.ts`) words it, auto-plays forced
  cards and makes `claimSeatOf()` declarer's seat (see Card play, Claims).
  When the last human leaves, the table stays **unattended**
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
  and carries the hand over (less any card played). It arrives **compact**
  (`CompactPlaying`: cards and calls as ids, bb#95), so the tables store
  hands it to `receivePlayingUpdate`, which expands it with
  `expandPlaying()` (`src/utils/compact.ts`) from `GET /cards` (`loadCards`)
  and `GET /bids`, then calls `applyPlayingUpdate` (which tests feed the
  HTTP shape directly; `tests/unit/compactPlaying.ts` compacts one). Events
  wait in order while the lists load; no lists, or an unknown id, reloads
  over HTTP; `HandDealt` on the user's
  own channel `private-App.Models.User.{id}` brings a new board's hand, kept
  as pending if it beats that board's `PlayingUpdated` (the same channel's
  `UserBanned` goes to the auth store, see Bans). A `TableUpdated` whose
  `board_id` went back to null mid-board means a player left and the board was
  abandoned: toast and back to `waiting`. The auth store follows the user
  channel from login/session restore to logout (`watchUser`/`unwatchUser`).
  `TablePlayPage.vue` draws it with `src/components/BridgeTable.vue` (the four
  seats rotated so the viewer is always at the bottom, dealer and
  red/green vulnerability, whose turn), `HandView.vue` and `PlayingCard.vue`;
  card sorting (`sortHand`/`groupBySuit` take an order, bridge order
  `SUITS` by default: the deal, a claimer's hand, exports; `HandView`
  defaults to `HAND_SUITS` ♥ ♣ ♦ ♠, the viewer's own hand; `BridgeTable`'s
  `trump` (the contract's strain) gives dummy and a robot declarer's cards
  `suitOrder(trump)`, that cycle rotated trumps first, #118), rank labels
  (the backend skips 11: `12`=J … `15`=A), seat rotation and
  vulnerability live in `src/utils/cards.ts`. The detail page moves a
  seated player to `/play` when `board_id` changes to a new board.
  `Playing.declarer_hand` is a robot declarer's remaining cards, only for
  its human dummy (null otherwise, and once `finished`); the same channel's
  `DeclarerHandShown` (`listenToUser`'s fourth handler; the fifth and
  sixth are `CallAlerted` / `CallQuestioned`, see Alerts, the seventh
  `BoardMessageSent`, see Board chat) brings it when the
  auction ends, `applyDeclarerHand` sets it on the board held, and
  `PlayingUpdated` carries it over less any card played, like `hand`.
- **Start** (#68, bb#73, backend `docs/API.md` Dealing): filling a table
  deals nothing; a board is dealt once the table is full and every human
  there has pressed Start (`POST /tables/{id}/start`, `DELETE` takes it
  back while nothing is dealt). Each `TableSeat` has `ready` (public, on the
  payload and `TableUpdated`; a robot's is always true); dealing clears it,
  and leaving or moving drops it. No Start for everyone, a manager
  included. The tables store's `start(id)` hands a dealing answer's
  `playing` to the game store (`adopt`) before syncing the table, so the
  detail page's `board_id` watch moves the presser on with the board in
  hand; `start`/`cancelStart` skip syncing an answer if a `TableUpdated`
  arrived while it was in flight (two Starts race). `src/utils/start.ts`:
  `startNeeded(table, playing)` (no board, a finished one whose set is
  over (`currentSet`), or one whose four aren't all still in their seats:
  then Start, not Next; unknown phase says no), `isReady`, `startWaiting` (the "Waiting for …" line).
  `StartBox.vue` shows it on the detail page (whose compass marks ready
  seats) and on the play page (`showSeats`), in `waiting` and in place of
  `NextBoardBox` for a finished board with new players or a set over.
  There (#121) it also carries the play page's only way off the seat
  (`canLeave` → `leave`) and a manager's Remove per seat (`removable` =
  the seats `canRemove` allows → `remove`, run by the page's `removeSeat`
  with `fillingSeat` as its busy mark), since `NextBoardBox`'s Leave is
  gone once a set is over.
- **Bidding**: calls go out as a `bid_id`, and the ids aren't pinned to the
  rank, so they come from the public `GET /bids` (`getBids`, the 38 calls in
  `auction[].bid`'s shape), which the game store's `loadBids()` reads once;
  `prefetchGameLists` in `src/router/index.ts` reads it (and `GET /cards`)
  in the background a second after a logged-in page shows.
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
- **Alerts** (#101, bb#100, backend `docs/API.md` Alerts): a self-alert
  for the **opponents only**, never partner. `BiddingBox`'s Alert field
  (`v-model:alert` / `v-model:explanation`, owned by the play page's
  `alertDraft`; typing turns the toggle on, turning it off drops the text;
  `ALERT_MAX` 200 in `src/utils/limits.ts`) goes out with the next call
  as `game.call(bidId, {alert, explanation})` (`makeCall` sends the two
  fields only when alerting), cleared once the call is taken, kept on a
  409, reset on a new board. The caller's own state has `alert`
  (`{explanation}`|null) and `question` (`{asked_by}`|null) on each
  `auction[]` entry for the opponents' calls and their own (null on
  partner's); `PlayingUpdated` has neither, so the game store keeps an
  `AlertBook` (`src/utils/alerts.ts`: `takeNotes` from every HTTP state via
  `hold()`, `noteAlert`/`noteQuestion` from `CallAlerted`/`CallQuestioned`,
  `withNotes` laid on every state shown; by `playing_id` + call index, a
  newer board starts a new book, an older one's news is dropped).
  `AuctionHistory` draws each call with `AuctionCallCell.vue`: alerted =
  amber + "!", the pop-up (`src/composables/usePopover.ts`, shared with
  `LastTrickPopover`: mouse hover, tap toggles, Escape / tap outside)
  shows `alertText()` ("Alerted, no explanation given." when empty, plain
  text), "You alerted: …" for your own; with `live` (auction and play) an
  opponent's call offers **Ask** (`game.askAboutCall(index)`, `POST
  /tables/{id}/calls/{index}/question`; a robot's answer is in the
  response) and your own questioned call **Answer**, which opens
  `ExplainCallSheet.vue` (`game.explainCall(index, text)`, `PUT
  /tables/{id}/calls/{index}/explanation`; a 422 keeps it open). The play
  page opens the sheet by itself once per question (`openQuestion`, only
  while the view is active). A review's `auction` has every `alert`
  (public once finished), shown the same way. The pop-up's **Ask in the
  chat** (`chat` event, `live` opponents' calls) opens the board chat with
  the call attached (below).
- **Board chat** (#102, #115, bb#101, bb#110, backend `docs/API.md`
  Chat): the whole table's, partner never reads an `opponents` message
  mid-board. `src/services/chat.ts`: `getMessages` (`GET
  /tables/{id}/messages` → `{playing_id, messages}`), `sendMessage`
  (`POST`, `{body, to, call_index?}`; `call_index` only when set),
  `BoardMessage` (`id`, `seat`, `user_id`, `to` `opponents|table`,
  `call_index`, `body` plain text, `created_at`), `BoardMessageSentEvent`.
  Both `to`s from the first deal on (#115, `chatRecipients(phase)` in
  `src/utils/chat.ts`: auction/play/finished `['table', 'opponents']`,
  table first, else none; a 409 before the first deal); `opponents` never
  reaches partner mid-board, and there is no partner-only message.
  `BoardChat`'s switch (`picked`, else the phase's first) goes to
  Opponents when a call is attached (`about`); `CHAT_MAX` 500 in
  `limits.ts`. The Pinia store `src/stores/chat.ts` holds one board's chat
  (`tableId`, `playingId`, `messages` merged by id via `mergeMessages`,
  `open`, `about` = the call index attached, `unread` = others' messages
  above `seenUpTo`, kept in `localStorage` `bridge.chatSeen`, try/catch).
  The play page's watch calls `follow(tableId, playingId, phase)`: first
  sight of a table `load`s (one request per table at a time, failures
  quiet), a newer board empties it, a board turning `finished` is read once
  more (partner's messages aren't re-pushed). `BoardMessageSent` on the
  user channel → the game store's `applyBoardMessage` → `chat.receive`
  (another table or an older board dropped, a newer board starts it); with
  the chat closed, an opponent's question about one of our calls
  (`asksAboutMyCall`) toasts at the **top** (`showToast`'s third argument,
  off the bidding box), and `tellQuestion` tells one question
  (`playing:index:asker`) once per 10 s, shared with `CallQuestioned`'s
  toast. The game store calls `useChatStore()` lazily (its `clear()`
  clears the chat too); the chat store rereads on reconnect. UI: the
  header's **Chat** button (`ion-badge` with `unread`, only once
  `playing_id` is set), `BoardChat.vue` (list + recipient switch + "About
  2♥:" chip + textarea, Enter sends, the page owns `v-model:draft` and
  sending: cleared on success, kept and toasted on any refusal, 401 →
  login) in the content's `slot="fixed"` aside from 1100 px
  (`useMediaQuery`; `.play.with-chat-side` reserves its 328 px as
  content-box padding, stepped to 0 by a `clamp()` where the page-centred
  board already clears it, #114; the aside's `data-right-edge` is the
  right edge for `usePopover`), else an `ion-modal` sheet (breakpoint 0.5, page
  padded); leaving the view closes it. `ChatMessageList.vue` (sender
  "You"/username, seat, "to opponents"/"to table", `chatTime`, the call
  as a `CallLabel` chip, `white-space: pre-wrap`) is also the review's
  chat: `PlayingReview.messages` (optional) under the auction in
  `BoardReview`, and `boardText` lists it (`chatLines`) after the alerts.
  Play page specs mock `@/services/chat` with plain never-settling
  functions (a `vi.fn` would be reset to `undefined`).
- **Card play**: `play(cardId)` posts `POST /tables/{id}/cards` and takes
  its answer through the same `isBehind` guard as `call`. `turn` is the
  hand the card comes from and `acting_user_id` who sends it (declarer on
  dummy's turn), so `handToPlay()` in `src/utils/play.ts` says whether the
  user plays their own hand, dummy's, declarer's (`'declarer'`: a robot
  declarer's human dummy on declarer's turn, #95), or nothing (a human
  declarer's dummy never plays); `cardsToPlay(state, from)` gives that
  hand's cards. Never re-derive whose move it is from the robot flags.
  `legalCards()` is the follow-suit hint that dims cards in `HandView`
  (given `playable` ids it turns into buttons). When the hand on play has
  exactly one legal card to follow with, `forcedCard()` (null on the lead)
  names it and, for declarer's game only (`autoPlaysForced()`, #69:
  declarer, or a robot declarer's dummy; a defender taps it themselves, no
  countdown or pulse),
  `src/composables/useForcedPlay.ts` plays it after 3 s
  (`HandView`'s `forcedId` pulses it, the status line counts down). The
  page keys it by playing/trick/cards/turn/card, so a new state restarts
  or drops it; it is null while a card or claim is in flight, the claim
  sheet or review modal is open or the view is left (`onIonViewWillLeave`), and a key it
  already fired for isn't re-armed. `trickBySide()` places a
  trick's cards by seat for `TrickArea.vue`, which fills `BridgeTable`'s
  `centre` slot. `dummy_hand` is public only after the opening lead.
  `BridgeTable` lays it across the top for declarer, where it can be tapped,
  or as `DummyColumns.vue` on a defender's side seat, and not at all for
  dummy, whose own hand is the same cards. For a robot declarer's dummy,
  `BridgeTable`'s `declarer` prop (+ `declarerPlayable`,
  `declarerForcedId`) lays `declarer_hand` across the top the same way,
  from the end of the auction; the contract bar adds "robot-1 declares 4♠
  — you play the hand". `current_trick` empties as soon
  as a trick's fourth card lands, so the page holds that trick (the last of
  `tricks`) with its winner for 2 s before clearing it, but only when seen
  live. The contract bar above the table carries `tricks_won`. Under the
  trick in progress, `LastTrickPopover.vue` (from the second trick on, not
  while a trick is held) pops up the last of `tricks` in a `TrickArea`
  with `spread` (#70: no overlap, a seat tag per card, nudged sideways to
  stay on screen):
  mouse hover opens it and leaving closes it (`pointerType === 'mouse'`
  only), a click toggles it, a pointerdown outside or Escape closes it.
  The centre keeps the trick in progress meanwhile. One card is in flight
  at a time; a 409 toasts and reloads, as for calls.
- **Claims**: during `play` any player but dummy (except a robot
  declarer's human dummy, who claims, answers and withdraws for
  declarer's seat: `claimSeatOf(state)` in `src/utils/claim.ts`, passed to
  `canClaim`/`claimAction`, `ClaimPanel`'s `actsFor`, `ClaimSheet`'s
  `forSeat`, and `claimText`'s fourth argument: "You claim … for North")
  may claim `tricks` of the
  tricks left (`13 - tricks.length`; 0 concedes) with `POST
  /tables/{id}/claim`; the other non-dummy players answer through
  `POST /tables/{id}/claim/response` `{accept}` (one reject cancels it) and
  the claimer may `DELETE` it. The game store's `claim`,
  `respondToClaim` and `withdrawClaim` go through the same `act`/`isBehind`
  path as `call`/`play`. While `claim` (`{seat, tricks, hand, accepted, expires_at}`)
  is non-null no card is played, so `handToPlay()` returns null; the
  claimer's `hand` lies face up at their seat (`BridgeTable`'s `claim`
  prop). `isBehind` orders answers to one claim by `accepted.length`, but
  a claim appearing or going away always counts as newer, since a reject
  or withdrawal leaves the cards unchanged. `src/utils/claim.ts` holds the
  hints (`canClaim`, `claimAction`: withdraw/answer/null,
  `claimWaitingFor`, `claimText`); both answerers get Accept / Reject at
  once, neither waits for the other. **Claim lock** (#120, bb#115): a
  claim that ends unaccepted (rejected, withdrawn, expired) sets the
  state's `claim_locked` (HTTP and compact `PlayingUpdated` alike,
  `expandPlaying` passes it through) until the next card clears it;
  `canClaim` is false then, `claimLocked(state, seat)` says who would
  claim but for it, and the play page keeps Claim disabled with
  `CLAIM_LOCKED_TEXT` under it (the sheet closes through `mayClaim`); a
  409 for it toasts and reloads like any other. `ClaimSheet.vue` is the sheet (one button per number, then
  "Claim N tricks"; Concede sends 0; a line quotes `CLAIM_SECONDS`),
  `ClaimPanel.vue` the pending-claim banner with its buttons. A claim
  going away mid-play toasts (`claimOffText`); the last accept lands in
  `finished` with `result.claimed`, which `resultSummary`/`BoardResultPanel`
  word as "by claim". **Silence means no** (#96, bb#96): the backend
  rejects a claim not fully accepted by `claim.expires_at` (10 s,
  `BRIDGE_CLAIM_SECONDS`) and clears it with `PlayingUpdated`.
  `ClaimPanel` counts down from `expires_at` (`useNow`;
  `claimClockText`: "Answer within 0:07" / "Waiting for East and West ·
  0:07" / "Time is up…", reusing `secondsLeft`/`formatClock` from
  `away.ts`) and disables its buttons at 0 (`claimExpired`); a claim gone
  at or after its deadline toasts "Nobody answered: the claim is off.",
  before it "South's claim is off.", each followed by "Play on: no claim
  until the next card." (`claimOffText`). `src/composables/useStaleDeadline.ts` rereads the game
  (`game.load()`, errors ignored) if the claim is still shown 2 s after
  `expires_at` (a lost update, bb#95), once per deadline and only while
  the view is active (the play page uses it for `next_board_at` too). A
  claim with an empty `expires_at` gets no countdown.
- **Board result and next board**: in `finished` the state carries `result`
  (`score_ns` is from N-S's side whichever side declared; a passed-out board
  has `score_ns: 0` and the rest null), `deal` (all four hands as dealt),
  `ready` (the seats that asked to deal now) and `next_board_at`.
  `src/utils/result.ts` words it in table notation and turns it round for
  the viewer's side (#100: `madeSuffix` "+2"/"="/"−1", `doubledMark`
  X/XX, `resultSummary(result, seat)` "2♣ W +2 · −130", N-S's tagged
  without a seat, `viewerScore`, `percentText` "75 %");
  `BoardResultPanel.vue` shows it at a glance: one big row ("2♣ by West
  +2" left, the viewer's score right, N-S's tagged "N-S" for someone not
  seated), "10 tricks · by claim" under it, no N-S/E-W line or summary,
  then the set's position ("Set 2 · 3 of 4 boards played") and this
  board's matchpoints for the viewer's side when known (`extras`, from
  `playingExtras()` in `export.ts`: the board's results or a cached set's
  row by `playing_id`; `useBoardExport` uses it too),
  `BridgeTable`'s `deal` prop lays each hand at its seat. **The next board comes by itself**
  (#98, bb#97): `next_board_at` (ISO 8601, `BRIDGE_NEXT_BOARD_SECONDS` =
  10 after the board ended; null when no deal is coming: set over, a seat
  empty, players changed) is when the backend's queued `DealNextBoard`
  deals it, with the usual `TableUpdated` + `PlayingUpdated` +
  `HandDealt`; the result stays on show until then. `NextBoardBox.vue`
  (prop `nextBoardAt`) counts down from it ("Next board in 0:08", then
  "Dealing the next board…"; `useNow`, `secondsLeft`/`formatClock` from
  `away.ts`; no seat chips or badges). Its optional **Deal now** is the
  game store's `next()`: `POST /tables/{id}/playing/next` through the
  same `isBehind` guard; once every human has asked (robots count as
  asked) the last one gets the new board in the answer, the others
  through `PlayingUpdated` + `HandDealt`. Each player asks only for
  themselves (#72: no "for everyone", a manager included; the backend
  ignores `everyone`, bb#74); after asking the box says "You asked to
  deal now. Waiting for …" (humans only). The play page's
  `useStaleDeadline` rereads the game if the finished board is still
  shown 2 s after `next_board_at`. `turnNotice()` says nothing in
  `finished` (nothing waits for the user). Leaving
  between boards abandons nothing and keeps `board_id`; with three seated
  the next ask 409s, and once a fourth player sits down everyone's Start
  deals the board (the play page swaps `NextBoardBox` for `StartBox`).
  `leaveWarning()` / `moveConsequences()` in `src/utils/seatMove.ts` word
  leaving by phase (`game.phaseOf(id)`). Under a board's result goes its
  set's position (`BoardResultPanel`'s `setSoFar`, below), never a
  running score.
- **Sets of four boards** (#73, bb#75, backend `docs/API.md` Sets): Start
  deals a set's first board, the other three come by themselves
  (`next_board_at`, above); after the fourth `next_board_at` is null,
  Deal now 409s ("The set is over…") and everyone's Start opens the next
  set. `set`
  (`SetPosition` in `src/services/game.ts`: `id`, `number` at the table,
  `board` (this board's place / boards dealt), `of`, `finished`, `ended`
  `completed|forfeit|abandoned`, `forfeited_by` `NS|EW`) is on
  `PublicPlaying` and `BroadcastTable` (null before the first Start).
  A board finishing sends no `TableUpdated` and a forfeit between boards
  sends only that, so read it through `currentSet(table, playing)` in
  `src/utils/sets.ts`, which merges both copies (a higher id wins). The
  play page shows `setLabel` ("Board 2 of 4 · Set 3") at the top, the
  detail page while a set runs. `getSet(id)` (`GET /sets/{id}`, in
  `src/services/history.ts`: finished `boards` with `matchpoints`/`top`,
  `totals`, `winner`; 403 unless a player of it or finished all its
  boards) is cached by the history store's `loadSet` (replaced on every
  read, 403/404 drop it). The play page reads it once per finished board
  and when the set ends (keyed, failures ignored: a newcomer gets 403),
  feeds `BoardResultPanel`'s set line and matchpoints and, once the set is
  over (`endedSet`), shows `SetResultsPanel.vue` instead of the board
  result (also in `waiting` for a set ended mid-board), with `StartBox`
  below. `sets.ts` also has `setWinnerText`/`setWon` (from the viewer's
  side, "by forfeit"), `forfeitedSeat` (the forfeiting side's seat whose
  player is no longer at the table) + `forfeitText`, `setTotals`
  (the viewer's side's matchpoints and percent: **no summed score**
  anywhere, #100; we play matchpoints, not rubber, so `SetResultsPanel`'s
  total is the matchpoints % or "No other table has played these boards
  yet.", and `HistoryList`'s set header shows `setPercent` from a set in
  `history.sets`, else nothing) and
  `groupBySet` (history runs of one set, with the owner's `seat`),
  `runningSet` (the set a table is in the middle of, else null).
- **Away mid-set and the forfeit** (#74, bb#76, backend `docs/API.md` Away
  mid-set): a seat has `away_since`/`forfeit_at` (`TableSeat`, on payloads
  and `TableUpdated`); the backend's `tables:check-away` marks a quiet
  player away after a minute; the clock runs **only for the away player
  the board waits for** (on turn, #116, bb#113): only that seat has
  `forfeit_at` (3 minutes from when the board began waiting for them),
  every other away seat `forfeit_at: null` until the turn reaches it.
  `src/utils/away.ts`: `awaySeats`, `myAwaySeat`, `secondsLeft`/
  `formatClock`, `awayText(seat, now, waits)` (clock: "East is away. E-W
  lose the set in 2:41 unless they come back."; none: "… if they aren't
  back within 3:00 of their turn."; `waits`: "The table waits for
  them."), `awayTogetherText` ("South and West are away. …"), `heldText`
  (own held seat, same split), `forfeitSuspended(table)` (an away seat's
  `user.is_admin`: nobody forfeits, the `waits` case), `setAtStake` (side
  + `forfeits`, false for an admin viewer or while `forfeitSuspended`;
  never read from a null `forfeit_at`), `lostSetText`,
  `SET_FORFEIT_MINUTES` (quoted in confirmations and the no-clock lines;
  countdowns read `forfeit_at`). `AwayNotice.vue` (`useNow` ticks it,
  `held` for the own seat; the clocked seat first with `away-clock`, the
  others one plain line each or `awayTogetherText`, never two
  countdowns) on the play page above the status, the detail page, Tables
  and Home; `BridgeTable`'s `away` prop and
  the detail compass tag seats. The tables store: `leave()` returns
  `held: true` on the 202 (still seated) and sets `heldTableId`, which
  `shouldBeat()` excludes; `watchTable(id, away)` also holds a seat found
  away when we weren't watching (`followSeat`); `comeBack(id)` (the play
  page after every load, the detail page's Come back) beats + `catchUp`;
  a `TableUpdated`/`loadTable` clearing our own `away_since` toasts
  `WELCOME_BACK` and reloads the game; marked away while beating, it beats
  at once; freed with `set.ended: forfeit` by our side sets `lostSet`
  (`{id, number, side, tableId}`), and the table pages go to `/sets/:id`.
  `rememberSet` keeps the running set in `localStorage`
  (`bridge.setInProgress`), `checkLostSet` (from `load()`) reads
  `GET /sets/{id}` for it once we no longer sit there; Home shows
  `lostSet` until `dismissLostSet`. `stakeOf(table)` feeds
  `confirmLeave`/`leaveMessage`/`leaveWarning`/`heldNotice` and
  `confirmMove`/`moveConsequences` in `seatMove.ts`. The game store toasts
  a forfeit once (`forfeitToldFor`). `User.is_admin` (own record) is read
  only for `setAtStake` and `canBan` (Bans).
- **Results and history**: `src/services/history.ts` also wraps
  `GET /users/{id}/playings`, `GET /boards/{id}/double-dummy` (see Double
  dummy) and `GET /boards/{id}/results` (every table's
  finished playing of a board, best N-S first, with `matchpoints` `{ns, ew}`
  out of `top`; 403 unless the user has finished that board, 404 for an
  unknown one). Both read the playings' seat snapshots, so they outlive a
  deleted table (`table_id: null`). The Pinia store `src/stores/history.ts`
  keeps histories by owner (`null` = the user, a number = anyone) as far
  as they are paged in (`loadHistory` = first page, `loadMore` = next,
  skipping rows that slid down a page) and results by board id (a 403/404
  drops the cached one) and sets by set id (`loadSet`); logout clears it.
  History rows carry `set` (`{id, number, board, of}` or null).
  `src/components/HistoryList.vue` (loading states +
  `ion-infinite-scroll`, `load()` exposed to the page, entries grouped by
  set under a header linking to `/sets/:id`)
  and `HistoryEntryItem.vue` serve both `/history` and the profile page's
  "Boards played". `BoardResultsPage.vue` highlights the tables the viewer
  sat at (`seatOfUser`) with their side's `matchpointPercent`.
- **Board review**: `GET /playings/{id}` (`getPlayingReview`, typed
  `PlayingReview` = `PublicPlaying` less `ready` and `set`, players nullable) is one
  finished playing with its auction and tricks, for anyone who finished
  that board (403 otherwise, 404 unknown or unfinished), even once the
  table is gone. The history store's `loadReview` caches it by playing id
  and never refetches it (a finished playing doesn't change); `clear()`
  drops it. The body is `src/components/BoardReview.vue` (prop `review`,
  `extras` for matchpoints; the page and the play page's modal both use
  it), which holds one number, `step` (cards played, back to 0 for another
  playing), and `src/utils/review.ts` derives the rest: `playedCards` (the
  tricks, then a claim's unfinished `current_trick`), `reviewAt` (hands
  left from `deal`, the trick shown with its winner once complete, tricks
  won, who's next), `nextTrickStep`/`previousTrickStep` and `stepCaption`.
  It reuses `BridgeTable` (`deal` = hands left, `replay` for the label,
  `reserve` = the deal: `DummyColumns`' `rows` pads each hand to its dealt
  `longestSuit` so the stepper below never moves; its position line sits
  under the buttons since it may wrap),
  `TrickArea`, `AuctionHistory` and, at the last step, `BoardResultPanel`.
  The viewer sits at the bottom if they played it (`seatOfUser`), else
  South. An empty `auction` (`isRecorded`) means a playing finished before
  bb#60: only the deal and the result, with a notice. `HistoryEntryItem`
  and each `BoardResultsPage` row link to it.
  **At the table** (#97): the play page's header "Last board" (and
  "Review and export" once `finished`) opens `BoardReviewModal.vue`
  (full-height `ion-modal`, content only `v-if="open"` since page tests
  stub `IonModal` with its slot) without navigating; `PlayingUpdated`
  keeps applying underneath. Its boards are `reviewChoices(setResults,
  seen, latest)` in `review.ts` (running set's `boards[].playing_id`, plus
  the page's `seenBoard` (last `finished` playing at this table) if the set
  read lags; else `seenBoard` (the previous set's last); else the history
  store's latest `listOf(null)` entry with this `table_id`), segment
  switcher, opening on the last; each via `history.loadReview`. On entry
  `findReviewable()` reads `GET /sets/{id}` mid-set and, if still none and
  past set 1 board 1, `loadHistory(null)`. `turnNotice()`
  (`src/utils/turn.ts`: bid, play, answer a claim, Next, Start) shows as a
  banner in the modal with "To the table" (closes it). `reviewOpen` nulls
  `useForcedPlay`'s key; `onIonViewWillLeave` and entering another table
  close it.
- **Double dummy** (#119, bb#114, backend `docs/API.md`
  `GET /boards/{board}/double-dummy` and `GAME-RULES.md` §6): solved in
  the backend's queue, refused (403) before the viewer finished the board.
  `getDoubleDummy(boardId)` in `src/services/history.ts` → `DoubleDummy`
  `{status: ready|pending|unavailable, table}` (`DoubleDummyTable` =
  seat → strain `C D H S NT` → tricks); the review's optional
  `double_dummy` is `PlayingDoubleDummy` (+ `leads: LeadTricks[]`
  `{card, tricks}`, null on a passed-out board). No par: the backend
  doesn't build it. The history store's `loadDoubleDummy` caches by board
  id (a `ready` one never refetched, a pending one is, 403/404 drop it);
  `loadReview` refetches a cached review whose analysis is pending.
  Pending is read **once** more after `DOUBLE_DUMMY_REREAD_MS` (5 s), no
  loop: `src/composables/useDoubleDummy.ts` (`analysis`, `load()`; failures
  quiet) for the table, `BoardReview`'s own timer for a review.
  `src/utils/doubleDummy.ts`: `doubleDummyLine` ("Double dummy: 4♠ by
  South makes 10" / `DOUBLE_DUMMY_PENDING`), `leadsInHandOrder`
  (`HAND_SUITS`), `bestLeads`, `leadSummary` ("Your lead ♠K: declarer can
  make 10. Best was ♥2: 9."), `doubleDummyLines` (text export),
  `pbnOptimumResultTable`. `DoubleDummyTable.vue` (N E S W down, ♣ ♦ ♥ ♠
  NT across, `highlight` {declarer, strain} + `highlightNote`, the pending
  / unavailable note, nothing while `analysis` is null) and
  `LeadAnalysis.vue` (`PlayingCard`s with tricks under them, `led` raised,
  `best` ringed) sit in `BoardReview` under the result; `BoardResultsPage`
  shows the table above the list (read after `loadResults` succeeds, the
  viewer's contract marked); the play page reads it once `finished`
  (`finishedBoardId`) and `BoardResultPanel`'s `doubleDummy` +
  `reviewable` give one line with **Review** (`review` event → the
  review modal). Play page specs that mock `@/services/history` keep
  `getDoubleDummy` never settling.
- **Export** (#71): the review page's header "Export" (and the review
  modal's) opens an `ion-action-sheet`, all of it in
  `src/composables/useBoardExport.ts` (`open`, `buttons`, `printing`,
  `extras`, `reset()` for view leave / modal close; it also resets on
  scope dispose): Copy as text, Download .txt/.pbn/.json, Print / Save
  as PDF (only Copy on a native platform, `Capacitor.isNativePlatform()`:
  WebViews ignore `download` links and `window.print()`).
  `src/utils/export.ts` is pure: `boardText(review, extras)` (the chat
  after the alerts via `chatLines`; the double dummy table and
  `leadSummary` at the end once ready; the alerts
  listed under the auction via `alertLines`; matchpoints
  in `extras` when `history.results[boardId]` or a cached set's `boards`
  holds this playing's row; `BoardResultPanel`'s `extras` shows them too),
  `boardPbn(review)` (PBN 2.1 export format: the 15 mandatory tags in
  order, unknown ones `?`, a passed-out board's Declarer/Result empty and
  Contract `Pass`; then Auction (an alerted call `2C =1=`, then a
  `[Note "1:…"]` per alert), `OptimumResultTable` (once the double dummy
  table is ready), Play, Score; play lines in fixed seat
  columns from the opening leader, a claim leaves `-` and ends with `*`;
  CRLF line ends), `boardJson`, `trickRows`, `claimNote` (the review
  doesn't say who claimed: told from declarer's side), `exportFileName`.
  `src/utils/download.ts`: `downloadFile`, `copyText`. Print: the page (or modal) adds
  `printing-board` to `<body>`, teleports `BoardPrintout.vue` there,
  `window.print()`, and drops it on `afterprint`/view leave/modal close;
  `src/theme/print.css` hides the rest (`ion-modal`, `ion-action-sheet`
  explicitly) and unpins Ionic's fixed body.
- **Bans** (#75, bb#77, backend `docs/API.md` Bans, `docs/AUTH.md` Bans):
  an admin bans a user for 1–365 days with a reason. `src/utils/ban.ts`:
  `canBan(viewer, target)` (viewer `is_admin`, target never themselves, an
  admin (`PublicUser.is_admin`, public since bb#45) or a robot),
  `banFormErrors`, `banDate` ("12 Oct 2026", spelled out, not
  `toLocaleDateString`), `banText`. `BanUserForm.vue` (inline on
  `UserProfilePage` and in `PlayerProfileSheet`; quick picks 1/7/30)
  calls the users store's `ban` (`POST /users/{id}/ban`, toasts the
  answer's message), which writes the ban onto the cached profile; an
  admin's `GET /users/{id}` carries `ban` (`UserBan`: `banned_by`,
  `lifted_*`, `active`) and `bans`. The profile page shows it with **Lift
  ban** (`liftBan`, `DELETE`, a 404 drops the cached ban). The banned user:
  the own `User.ban` (`Ban` = `{reason, until, banned_at}`, no admin) is
  the auth store's `ban`/`isBanned`; `UserBanned` on the user channel
  (`listenToUser`'s third handler, from the game store's `watchUser`) calls
  `auth.applyBan`, which runs `endSession()` (logout's local half, no
  `POST /logout`: the backend already deleted the session) and sets
  `banNotice`; `BanNotice.vue` navigates to `/login` and shows it in a
  modal until `dismissBanNotice` (plain text, not `ion-alert`, whose
  message is HTML). Logged in while banned: `BanBanner` on every page,
  the guard's `notBanned`, and `TablesPage` replaces Create with the ban,
  disables seats and hides Open. Game actions 403 with the ban in the
  message, which `errorMessage` already shows.
- **Public profiles**: `src/services/users.ts` wraps `GET /users/{id}` (auth,
  envelope, 404 for an unknown id) and defines `PublicUser` (`id`, `name`,
  `username`, `description`, `is_robot`, `is_admin`, never the email;
  `description` only from `GET /users/{id}`: seats and `players` leave it
  out to keep broadcasts under 10 KB, so it is optional); `TableSeat.user` uses that type
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
  store hands to the game store. Alerts never use it (partner would see
  them): `CallAlerted` `{table_id, playing_id, index, explanation}` goes to
  each human opponent's user channel, `CallQuestioned` `{…, asked_by}` to
  the bidder's (see Alerts); nor does the chat: `BoardMessageSent`
  `{table_id, playing_id, message}` goes to the user channel of every
  human who may read it, the sender included (see Board chat). Each
  `TableUpdated` carries the whole table and **replaces** it
  via the store's sync path; one that no longer seats the user (outside their
  own seat request) is a kick: toast, unsubscribe, and `kickedFrom` makes the
  detail page go back to `/tables`. After a reconnect the watched table is
  refetched once. The Tables list has no channel and stays refresh-only.
  Every broadcast fits in 10 KB (backend `docs/API.md`, Message size):
  hence the compact `PlayingUpdated` (see Game) and the length caps the
  forms mirror, `NAME_MAX` 50 / `USERNAME_MAX` 30 / `TABLE_NAME_MAX` 50 /
  `ALERT_MAX` 200 / `CHAT_MAX` 500 in `src/utils/limits.ts` and
  `MAX_BAN_REASON` 500 in `src/utils/ban.ts`.
  **Live or not** (#76): `echo.ts` writes the connection status and the
  table whose channel Pusher confirmed (`.subscribed()`; `.error()`,
  `leaveTable` and any non-`connected` status clear it) into
  `src/services/liveStatus.ts` (`isLive(id)`, kept out of `echo.ts` so
  pages read it while page tests mock `echo.ts`). `useLiveStatus(tableId)`
  gives `offline` after `OFFLINE_GRACE_MS` (5 s) not live, and
  `OfflineRefresh.vue` (note + Refresh, `refresh` event) is the detail and
  play pages' only Refresh button; pull-to-refresh stays. A stopped
  `queue:work` still reads as live (the client can't see it).
  `BoardResultsPage` and `SetResultsPage` (no channel) keep their Refresh.
  **Heartbeat**: the backend frees idle seats (through the normal leave
  path), so the tables store sends `POST /tables/{id}/heartbeat` every 30 s
  for as long as it watches a table (`watchTable`/`unwatchTable` start and
  stop it, so leave, kick, move and logout end it too), never for a held
  seat. It pauses while `document.visibilityState` is hidden, except
  mid-set (`midSet`, bb#76: going quiet there loses the set; a beat that
  finds the set over while hidden stops it); on return it beats at once, refetches
  the table and the game state, and a seat lost meanwhile (or a 403/404 from
  a beat) is told as `IDLE_NOTICE` and sets `kickedFrom`. A removal noticed
  while hidden keeps its toast until the page shows again.
  Running it needs `php artisan reverb:start` and `queue:work` on the backend
  (bridge_backend `docs/RUNNING.md`, Realtime), and away/forfeit need
  `schedule:work` (`tables:check-away` every 10 s).
- **Error handling**: `src/utils/errors.ts` is the one axios-error reader —
  `errorMessage(e, fallback)` for the text to show, `statusOf(e)` for the
  status to branch on and `fieldErrors(e)` for a 422's first message per field
  (shown under each input). Three envelopes reach the SPA: the game endpoints'
  `{status, message, data}`, Laravel's 422 `{message, errors}`, and a bare
  `{message}` from auth/policy failures. `logUnexpected(e)` logs a
  non-HTTP error to the console. Leave and Remove (detail, play and
  Tables pages, #121) keep their confirmation (`confirmLeave`,
  `confirmRemove` + `removeCost` in `seatMove.ts`) inside the request's
  `try`, so a failure before any request is toasted and logged, never
  silent, and close the page's own sheets/modals (`closeSheets` /
  `closeOverlays`, then `nextTick`) before asking. The Tables page shows
  "You sit at <table> · Leave" for an unheld seat (`seatedAt`).
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
4. Reply with the PR link and stop there. Don't watch the PR's CI
   (`gh pr checks`, `gh run watch`, polling): the user watches it and says
   when something needs fixing; until then, wait.

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
