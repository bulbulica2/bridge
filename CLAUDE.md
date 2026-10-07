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
  intro with Log in / Create account for guests; for a logged-in user
  `YourTableHero` from the tables store's `myTable`, or "Find a table",
  then `YourForm` + `RecentBoards`),
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
  global and styles the toast's shadow parts through `::part()`. Creating
  a table and taking a seat on the Tables page are the exceptions to
  `navigateAndSettle`: **Deal me in** / **Create table** navigate to
  `/tables/:id` (where Start, the seats and Seat a player / Add robot
  are, #68), with or without robots (#132), as soon as `POST /tables`
  answers (#55; `createTable` seats the creator South, `CREATOR_SEAT`,
  robots N, E and W); a seat navigates as soon as
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
  Bans) and runs `useTurnTitle()` (see Away mid-set and the turn clock). `AppMenu.vue` is auth-aware too: "Login" while logged out,
  "Tables" and "My boards" once logged in, the current page marked
  `aria-current`. **Your table** (#99): `src/composables/useYourTable.ts`
  (header button + the menu's first entry) reads the tables store's
  `myTable` (nothing for a guest, a banned user or nobody seated): target
  `/tables/:id/play` if `board_id` or the seat is held/away, else
  `/tables/:id`; status `away` > `turn` (`turnNotice` on the game store's
  board for that table, `startNeeded` for a Start; `statusText` "Your
  turn · 0:42" while our turn clock runs, `useTurnClock`; `AppHeader`
  then makes its button the orange `.turn-pill` with `statusText` in
  `.table-shortcut-turn`, #162) > `board`; `current`
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
  see Start below, and the manager-only `PATCH /tables/{id}`
  `{set_minutes}` (`updateTable`, the store's `updateSettings`): 403 for
  non-managers, 409 mid-set, see the set clock below)
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
  `IDLE_NOTICE`). `AdminBadge.vue` marks admins on every plate
  (`BridgeTable`, `SeatPlate`), the profile sheet and `UserProfilePage`. `TableUpdated` leaves
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
  Tables page's **Deal me in**, with its card's `SetMinutesPicker`'s
  `set_minutes`; **Create table** for friends sends `robots: false` and
  no `set_minutes`) seats three
  but deals nothing, so the page goes to `/tables/:id`, where the
  creator's Start deals (robots are always ready); a manager adds one
  with the store's `seatRobot(id, seat)` ("Add robot" on the detail page).
  The backend moves them (a queued job per `PlayingUpdated`, about 1 s
  apart; `queue:work` must run) through the same rules as a human, so the
  SPA only shows them: a robot's icon as the avatar on every plate
  (`BridgeTable`, `SeatPlate` + "· robot"), `RobotBadge.vue` on the
  profile sheet (which has no "Full profile" link for a robot; the
  lobby's `TableCard` compass draws a robot's seat blue instead), and `BridgeTable`'s `thinking` prop + "robot-1 is
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
  vulnerability live in `src/utils/cards.ts`. Vulnerability in words
  (#151, #160): `vulnerabilityText(vulnerable, mySeat)` → `{text, red}`
  ("Nobody vulnerable" green; red "Vul: E-W" for the other side or no
  seat, "Vulnerable: N-S (you)", "Both (you too)"), drawn by
  `VulnerabilityLabel.vue` as a pill top left above the table (the play
  page's `.board-bar`, auction/play/finished: `.board-corner`, a 2×2 grid
  (#165), the pill and `AuctionPopover.vue` (the **Auction** button,
  `auctionButton`: from the first call to the end of the board, the
  `AuctionHistory` grid in a `usePopover` pop-up, `live` until finished,
  `bidding` during the auction, `auctionEvents` passed on) on one row at
  every width, under them a `.dealer-pill` "Dealer West" below 1100 px
  and `.set-bar` `boardPosition(set)` ("Board 2 of 4", `sets.ts`, no set
  number) under the button; before them `BoardTile.vue`, BBO's board
  tile, from 1100 px, holding the board's place in its set (`position`,
  never `board.number`); `BoardReview`'s `.board-bar`;
  `BoardResultsPage`'s `.board-info`), `BridgeTable`'s centre line and
  `BoardPrintout`'s meta line (its `mySeat` prop, text only); the seat
  stripes stay (the plate's top edge). The detail page moves a
  seated player to `/play` when `board_id` changes to a new board.
  `Playing.declarer_hand` is a robot declarer's remaining cards, only for
  its human dummy (null otherwise, and once `finished`); the same channel's
  `DeclarerHandShown` (`listenToUser`'s fourth handler; the fifth and
  sixth are `CallAlerted` / `CallQuestioned`, see Alerts, the seventh
  `BoardMessageSent`, see Board chat, the eighth `AuctionAlertsShown`,
  see Alerts) brings it when the
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
  `StartBox.vue` (a white card, #163) shows it on the detail page (whose
  compass ticks ready seats) and on the play page (`showSeats`: the four
  seats as `SeatPlate`s two by two, `li[data-seat]` `.is-ready`, an empty
  one `.start-empty` dashed orange "Empty · West" holding a manager's
  `.start-fill[data-fill-seat]` buttons), in `waiting` and in place of
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
  flight. It is **two taps plus confirm** (#160): `data-level` 1–7, then
  `data-strain` C D H S NT (or Pass/X/XX, `data-call`), then the
  `.confirm-call` button ("Bid 2♥" / "Pass" / "Double" / "Redouble",
  `data-picked`), the only thing that emits `call`; a level with no legal
  strain and a strain illegal at the picked level are disabled; the pick
  resets when `auction` changes and when `busy` goes true → false (taken or
  refused). Tests make calls through `bidWith(wrapper, '2C')` in
  `tests/unit/biddingBox.ts`. `AuctionHistory.vue` is the four-column grid, rotated like the
  table (the viewer's column last, so South reads W N E S), starting in the
  dealer's column. `CallLabel.vue` draws one call (`chip`: Daylight's
  chip, grey bid / green Pass / red X / blue XX; the auction grid and
  `BridgeTable`'s last calls use it). The page announces the
  contract (or "Passed out") and toasts it when the last call arrives live.
- **Alerts** (#101, #135, bb#100, bb#124, backend `docs/API.md` Alerts):
  a self-alert for the **opponents only** during the auction; partner sees
  it once the auction is over. `BiddingBox`'s Alert button and field
  (`v-model:alert` / `v-model:explanation`, owned by the play page's
  `alertDraft`; the field shows only while `alert` is on, turning it off
  drops the text;
  `ALERT_MAX` 200 in `src/utils/limits.ts`) goes out with the next call
  as `game.call(bidId, {alert, explanation})` (`makeCall` sends the two
  fields only when alerting), cleared once the call is taken, kept on a
  409, reset on a new board. The caller's own state has `alert`
  (`{explanation}`|null) and `question` (`{asked_by}`|null) on each
  `auction[]` entry for the opponents' calls and their own (null on
  partner's during the auction; from `play` every call's `alert`, partner's
  too, `question` still null on partner's); `PlayingUpdated` has neither, so the game store keeps an
  `AlertBook` (`src/utils/alerts.ts`: `takeNotes` from every HTTP state via
  `hold()`, `noteAlert`/`noteQuestion` from `CallAlerted`/`CallQuestioned`,
  `noteAlert` per entry from `AuctionAlertsShown` (`applyAuctionAlertsShown`,
  partner's alerts when the auction ends; only for the board held, another
  table's or board's dropped),
  `withNotes` laid on every state shown; by `playing_id` + call index, a
  newer board starts a new book, an older one's news is dropped).
  `AuctionHistory` draws each call with `AuctionCallCell.vue`: alerted =
  amber ring + "!", questioned = blue ring + "?", the pop-up (a dark
  card; `src/composables/usePopover.ts`, shared with
  `LastTrickPopover` and `AuctionPopover`: mouse hover, tap toggles, Escape / tap outside)
  titled "East alerted 2♦" ("You alerted 2♣" for your own, "Partner
  alerted 2♣" for partner's, "2♦ by West" / "Your 2♣" unalerted) shows
  `alertText()` ("Alerted, no explanation given." when empty, plain
  text) for
  partner's (`isPartner`; `AuctionHistory`'s `bidding`, set by the play
  page during the auction, hides partner's alert even if held); with
  `live` (auction and play) only an opponent's call offers **Ask** (`game.askAboutCall(index)`, `POST
  /tables/{id}/calls/{index}/question`; a robot's answer is in the
  response) and your own questioned call **Answer**, which opens
  `ExplainCallSheet.vue` (`game.explainCall(index, text)`, `PUT
  /tables/{id}/calls/{index}/explanation`; a 422 keeps it open; in the
  play the answer comes back to all four as `CallAlerted`, whose answer
  toast never tells the bidder their own). The play
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
  `open` = on show, `keepOpen` = the choice beside the table (#153,
  `setKeepOpen`, `localStorage` `bridge.chatOpen` `0`/`1`, try/catch,
  nothing stored = open), `about` = the call index attached, `unread` =
  others' messages above `seenUpTo` while not `open`, kept in
  `localStorage` `bridge.chatSeen`, try/catch).
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
  header's **Chat** button (`ion-badge color="action"` with `unread`, only once
  `playing_id` is set), `BoardChat.vue` (list + recipient switch, a segmented `.chat-to-options`
  group, #163 + "About
  2♥:" chip + textarea, Enter sends, the page owns `v-model:draft` and
  sending: cleared on success, kept and toasted on any refusal, 401 →
  login) in the content's `slot="fixed"` aside from 1100 px
  (`useMediaQuery`; `.play.with-chat-side` reserves its 328 px as
  content-box padding, stepped to 0 by a `clamp()` where the page-centred
  board already clears it, #114; the aside's `data-right-edge` is the
  right edge for `usePopover`), else an `ion-modal` sheet (breakpoint 0.5, page
  padded). **Open by default** (#153): the page's `chatWanted` (a
  `playing_id`, `viewActive`, then wide ? `chat.keepOpen` : its own
  `sheetOpen`, false at first) is what shows, and a watch keeps
  `chat.open` equal to it (anything else opening or closing the store is
  put back). The Chat button, `BoardChat`'s Close and Ask in the chat go
  through `showChat(value)` (wide: `setKeepOpen`, so it sticks across
  boards, pages and reloads; narrow: `sheetOpen`); leaving the view hides
  it, coming back shows it as left; `closeOverlays` closes only the
  sheet. `ChatMessageList.vue` (sender
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
  (`HandView`'s `forcedId` pulses it with "plays in 3" on the card,
  `forcedSeconds`, which `BridgeTable` passes on for dummy's and
  declarer's cards; the turn line counts down too). The
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
  The centre keeps the trick in progress meanwhile. Nothing changes height
  from card to card (#133): `BridgeTable` gives every seat a `.turn-slot`
  while `turn` is set (the label only on the seat on turn), the page's
  `TurnClockLine` is rendered for all of `auction`/`play` (empty during a
  claim) with two lines of room and its bar's track, and `.trick-foot`
  stacks the caption over `.trick-peek`,
  the 22 px pill row kept without the pill. One card is in flight
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
  claim but for it, and the play page keeps Claim disabled and grey as
  "Claim · locked" with `CLAIM_LOCKED_TEXT` under it (the sheet closes
  through `mayClaim`); a 409 for it toasts and reloads like any other.
  Claim is a solid navy button at its own width under the hand
  (`.claim-row`, bottom left). `ClaimSheet.vue` is the sheet (#161:
  `claimSummary` "7 tricks left · you have 4 · 4♠ needs 10", tiles 4 a
  row from the tricks left down to 0 (`data-tricks`, `.pick-count`), each
  with `claimOutcome(state, seat, n)` (`{result: "4♠ +1", down, score:
  "+450"}`, the claimer's side, from `contractScore` in `result.ts`:
  duplicate scoring, a hint) given `state` + `seat` (`claimSeat`);
  opening with all of the tricks left picked, #137; the orange send
  button "Claim all 7 · 4♠ +1 · +450" / "Claim 5 · …" / "Concede · …"
  for the 0 tile; a trick finishing re-picks the new maximum unless a
  lower number was picked by hand, kept while still possible; the
  outlined Concede sends 0; `claimAnswerersText` + `CLAIM_SECONDS`
  "Both opponents get 10 seconds. No answer counts as no."),
  `ClaimPanel.vue` the pending claim as a dark banner (`--bridge-popup`,
  the countdown `.claim-seconds` on the right, Accept / Reject two equal
  buttons, Withdraw). A claim
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
  without a seat, `viewerScore`, `percentText` "75 %", `contractShort`
  "2♣X W +2", `declaredText` "You declared" / "radu declared" / "E-W
  declared");
  `BoardResultPanel.vue` (#162, Daylight's result board) is a navy hero
  card: `declaredText` (`players` prop), the contract + made suffix
  ("2♣ +2", `.made-ok` green / `.made-down` red), "10 tricks · by
  claim", the viewer's score big right (N-S's tagged "N-S" for someone
  not seated), and "Against the other tables 67 %" + an amber bar when
  this board's matchpoints for the viewer's side are known (`extras`,
  from `playingExtras()` in `export.ts`: the board's results or a cached
  set's row by `playing_id`; `useBoardExport` uses it too); then **Same
  board elsewhere** (`others` = `history.results[boardId]`, which the play
  page reads with `loadResults` once `finished`, failures quiet;
  `otherTableRows(board, playingId)`: rows only with 2+ results, the
  first 5 with ours always in, labelled by the N-S pair's usernames since
  a result row has no table name, ours "You" + `.elsewhere-mine`), the
  double dummy line (below) with `doubleDummyVerdict` and a green
  `.dd-tick` when `doubleDummyDiff` ≥ 0, and `SetStrip` (`setPosition`
  = the board's `set`, `setSoFar` for the figures: `setStripTiles` in
  `sets.ts`, "Board 2 62 %", the current tile tinted, "now" until played,
  "·" to come, "—" with top 0; `onTable` is the navy B1–B4 version);
  `BridgeTable`'s `deal` prop lays each hand at its seat. **The next board comes by itself**
  (#98, bb#97): `next_board_at` (ISO 8601, `BRIDGE_NEXT_BOARD_SECONDS` =
  10 after the board ended; null when no deal is coming: set over, a seat
  empty, players changed) is when the backend's queued `DealNextBoard`
  deals it, with the usual `TableUpdated` + `PlayingUpdated` +
  `HandDealt`; the result stays on show until then. `NextBoardBox.vue`
  (prop `nextBoardAt`, `set` = the board's) is the next board bar: a
  `.next-ring` (conic gradient, `--ring-fill` = seconds left of
  `NEXT_BOARD_SECONDS` 10 in `sets.ts`, the seconds in `.next-ring-face`)
  counting down ("Next board in 0:08", then "Dealing the next board…";
  `useNow`, `secondsLeft`/`formatClock` from `away.ts`), `.next-sub`
  "Board 3 of 4 · or skip the wait" (no next board after the set's last,
  no "skip" once asked), Deal now orange, Leave a small clear button
  under it. Its optional **Deal now** is the
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
  set's boards (`BoardResultPanel`'s `SetStrip`, below), never a
  running score.
- **Sets of four boards** (#73, bb#75, backend `docs/API.md` Sets): Start
  deals a set's first board, the other three come by themselves
  (`next_board_at`, above); after the fourth `next_board_at` is null,
  Deal now 409s ("The set is over…") and everyone's Start opens the next
  set. `set`
  (`SetPosition` in `src/services/game.ts`: `id`, `number` at the table,
  `board` (this board's place / boards dealt), `of`, `finished`, `ended`
  `completed|abandoned` (no `forfeit` since bb#120), `replaced`
  `SetReplacement[]` `{seat, user_id, reason}`, reason
  `turn_timeout|set_time|away|moved|kicked`, `minutes`, `time_left`
  (the set clock, below)) is on `PublicPlaying` and
  `BroadcastTable` (null before the first Start); `SetResults` has
  `replaced`, `minutes`, `time_left` and `time_used` too, and `players`
  has the robot in a replaced seat.
  A board finishing sends no `TableUpdated` and a set broken off between
  boards sends only that, so read it through `currentSet(table, playing)` in
  `src/utils/sets.ts`, which merges both copies (a higher id wins; the
  longer `replaced`). The
  play page shows `boardPosition` ("Board 2 of 4") top left and in the
  header, the detail page `setLabel` ("Board 2 of 4 · Set 3") while a set
  runs. `getSet(id)` (`GET /sets/{id}`, in
  `src/services/history.ts`: finished `boards` with `matchpoints`/`top`,
  `totals`, `winner`; 403 unless a player of it or finished all its
  boards) is cached by the history store's `loadSet` (replaced on every
  read, 403/404 drop it). The play page reads it once per finished board
  and when the set ends (keyed, failures ignored: a newcomer gets 403),
  feeds `BoardResultPanel`'s set strip and matchpoints and, once the set is
  over (`endedSet`), shows `SetResultsPanel.vue` instead of the board
  result (also in `waiting` for a set ended mid-board; the same navy hero
  card, #162), with `StartBox` below. `sets.ts` also has `setWinnerText`/`setWon` (from the viewer's
  side), `replacementsOf` (`?? []`), `replacedText(entry, mine)` ("East
  didn't play in time: a robot took their seat." / "You didn't play in
  time: a robot took your seat."; `SetResultsPanel` lists one per
  `replaced`, "you" for `mySeat`), `seatInSet` (the viewer's seat, or the
  one a robot took over from them: `SetResultsPage`'s `mySeat`),
  `replacementOf(set, userId)` (never a `moved` one: the mover knows),
  `ReplacedFrom` + `replacedFromText`, `setTotals`
  (the viewer's side's matchpoints and percent: **no summed score**
  anywhere, #100; we play matchpoints, not rubber, so `SetResultsPanel`'s
  total is the matchpoints % or "No other table has played these boards
  yet.", and `HistoryList`'s set header shows `setPercent` from a set in
  `history.sets`, else nothing) and
  `groupBySet` (history runs of one set, with the owner's `seat`),
  `runningSet` (the set a table is in the middle of, else null).
- **Away mid-set and the turn clock** (#74, #130, #150, bb#76, bb#120, bb#138, backend
  `docs/API.md` Away mid-set, and the turn clock): the human the board
  waits for (`acting_user_id`), when there, has `BRIDGE_TURN_SECONDS`
  (60) to call, play or act on a claim (away, their seat's `replace_at`
  instead): `turn_deadline` on `PublicPlaying` (HTTP and
  compact `PlayingUpdated` alike, `expandPlaying` passes it through; not
  in a review), null between boards, while a claim is pending, for a
  robot or an admin. Only a move resets it. Past it the backend's
  `tables:check-away` (every 10 s) **hands the seat to a robot** for the
  rest of the set (`set.replaced`), the board goes on; sets are never
  forfeited, and `forfeit_at` is gone from `TableSeat`.
  `src/utils/turnClock.ts`: `turnDeadline(state)` (auction/play only),
  `actingSeat`, `turnClock(state, me, now)` (`{seconds, mine, seat, by}`,
  the acting user's seat from `players`, else `turn`; `by` =
  `turn_deadline_by` ?? `'move'`, `move|away|set`), `turnClockText`
  ("Your turn · 0:42" / "Waiting for East · 0:42" / with `by: 'set'`
  "Your time for the set: 0:42" / "East's time for the set: 0:42" /
  `TIME_UP_TEXT` "Time is up…"; with `by: 'away'` and not ours, "Waiting
  for East (away)", no clock: `awayOnTurn`), `turnClockTime` (the play
  page's line: "0:42" / "Set 0:42", '' without a clock, at 0 or for an
  away player), `turnClockFraction` (seconds / `TURN_SECONDS`, at most 1,
  null without a clock or away), `turnUrgent` (mine and ≤
  `TURN_URGENT_SECONDS` 15), `turnTitle`.
  **The set clock** (#143, bb#131, backend `docs/API.md` The set clock):
  each human's time bank for the set, the table's `set_minutes`
  (`SET_MINUTES` 8/12/16/20, `DEFAULT_SET_MINUTES` 16 in
  `src/services/tables.ts`; `BroadcastTable.set_minutes`, sent by
  `createTable`, changed by a manager between sets on the detail page,
  whose `SetMinutesPicker` shows only while `can_manage` and no set runs,
  a refusal toasted, the table reloaded and the picker re-keyed; else
  `setClockText`), copied as `set.minutes`; `set.time_left` (seat →
  seconds or null for a robot/admin) is as of the state's
  `turn_started_at` (HTTP and compact alike; with `turn_deadline_by`
  `move|away|set`; `PlayingReview` omits all three). `turn_deadline` is the
  earlier of the move's minute and the bank's end. `src/utils/setClock.ts`:
  `bankLeft`, `setBanks(state, now)` (only `actingSeat`'s runs, and only
  while `turnDeadline` is set; `{seconds, running, low}`, `low` under
  `SET_LOW_SECONDS` 60), `bankLabel`, `setClockText`, `timeUsedText`,
  `timeUsedRows` (`SetResultsPanel`'s "Time used"). Running out is a
  replacement with reason `set_time` ("East ran out of time for the set:
  a robot took their seat.", `REPLACED_WHY` in `sets.ts`; stats' reason
  "out of time for the set").
  `src/composables/useTurnClock.ts` (`useNow` while a deadline runs →
  `clock`, `text`, `time`, `fraction`, `urgent`, `banks` = `setBanks`,
  `BridgeTable`'s `banks` prop: `.seat-bank` under the name, `-running`
  bold, `-low` red) feeds the play page's `TurnClockLine.vue` (#161: the
  page's `lineText` left: "Your call", "Your lead", "Your turn from dummy
  · follow in ♦", "… · ♠Q plays in 3", "Waiting for East" (`actingSeat`),
  "robot-1 is thinking…", "Declarer plays your cards", `TIME_UP_TEXT`,
  away → `turnClockText`; `time` right in Barlow; a 6 px bar of
  `fraction`; `turn-line-mine` orange, `turn-line-urgent` red,
  `turn-line-robot`; two lines of room + the bar's track, rendered all
  through auction/play, empty during a claim; it replaced the old
  `.status` box and `.turn-clock` line; the urgent cue is the
  class `turn-urgent` on `HandView` (playing from it) and `BiddingBox`),
  `useYourTable`'s `statusText`, and `useTurnTitle` (`App.vue`: while
  `document.visibilityState` is hidden and the game store's board waits
  for us, `document.title` = "● Your turn (0:42) – Bridge", put back once
  the turn is taken or the page shows; `index.html`'s title is
  "Bridge"). The play page's `useStaleDeadline` rereads the game 2 s
  after `turn_deadline` (`viewActive` only), as for claims and
  `next_board_at`. **Away**: a seat has `away_since` and `replace_at`
  (`TableSeat`, on payloads and `TableUpdated`, bb#138);
  `tables:check-away` marks a quiet player (or a Leave) away and sets
  `replace_at` = `away_since` + 2 minutes, every away seat's running at
  once whoever's turn it is (null for an admin: the table waits).
  `src/utils/away.ts`: `TURN_SECONDS` (60), `AWAY_REPLACE_SECONDS` (120,
  quoted in the Leave confirmations; countdowns read `replace_at`),
  `awaySeats`, `myAwaySeat`, `secondsLeft`/`formatClock`,
  `adminAway(table)`, `awayTag(seat, now)` (`AwayTag` `{seconds|null,
  urgent}`, urgent ≤ `AWAY_URGENT_SECONDS` 15), `awayTags(table, me,
  now)`, `awayClockRuns`, `awayTagText` ("away · 0:42" / "replacing…" at
  0 / "away" without a clock), `awayNote` (`AWAY_NOTE` "Away players are
  replaced by a robot when their clock runs out." / `ADMIN_AWAY_NOTE`
  when only admins are away / null), `heldText(seat, table, now)` ("You're
  away from Friday club: a robot takes your seat in 0:42 unless you come
  back."), `setAtStake` (`{number, seat, side, held}`, `held` false for
  an admin viewer or while `adminAway`). `src/composables/useAwayTags.ts`
  (one `useNow` while `awayClockRuns`, so seats away together show the
  same time) feeds `BridgeTable`'s `away` prop (seat → `AwayTag`) on the
  play page and the detail compass, both drawn by `AwaySeatTag.vue` (red
  `away-tag-urgent`; single root, the parent's class lands on it).
  `AwayNotice.vue` (Daylight's orange-tint banner, #163; one line, never a
  countdown: `awayNote`; `held` for the own seat, counting down with its
  own `useNow`) on the play page
  above the turn clock, the detail page, Tables and Home. The
  tables store: `leave()` returns `held: true` on the 202 (still seated)
  and sets `heldTableId`, which `shouldBeat()` excludes;
  `watchTable(id, away)` also holds a seat found away when we weren't
  watching (`followSeat`); `comeBack(id)` (the play page after every
  load, the detail page's Come back) beats + `catchUp`; a
  `TableUpdated`/`loadTable` clearing our own `away_since` toasts
  `WELCOME_BACK` and reloads the game; marked away while beating, it
  beats at once; unseated by an update whose `set.replaced` names us
  (`replacementOf`, not `moved`) sets `replacedFrom` (`{id, number, seat,
  reason, tableId}`), toasts `replacedFromText`, and the table pages go
  to `/sets/:id`. `rememberSet` keeps the running set in `localStorage`
  (`bridge.setInProgress`), `checkReplaced` (from `load()`) reads
  `GET /sets/{id}` for it once we no longer sit there; Home shows
  `replacedFrom` until `dismissReplaced`. The game store's
  `noteReplacements` toasts each other player's replacement once
  (`replacementsKnown`, `set:seat:user`, from `applyTableUpdate` and
  `applyPlayingUpdate`; `hold()` notes an HTTP state's silently), all
  those one update brings in a single toast (`replacedTogetherText` in
  `sets.ts`: "South and West were away: robots took their seats.", mixed
  reasons a sentence each).
  `stakeOf(table)` feeds `confirmLeave`/`leaveMessage`/`leaveWarning` and
  `confirmMove`/`moveConsequences` in `seatMove.ts` (`robotTakesOver`:
  `held` and another human left there; else the set ends with no
  winner); `heldNotice()` and `removeCost` (an away player: a robot takes
  the seat, unless nobody else human is left) word the rest.
  `User.is_admin` (own record) is read only for `setAtStake` and `canBan`
  (Bans).
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
  South makes 10" / `DOUBLE_DUMMY_PENDING` / `DOUBLE_DUMMY_UNAVAILABLE`,
  "…isn't set up on this server.": `unavailable` is the server without a
  solver, bb#125, never the board, #138), `leadsInHandOrder`
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
  the guard's `notBanned`, and `TablesPage` replaces the two start cards
  with the ban, disables every Sit and shows table names as plain text. Game actions 403 with the ban in the
  message, which `errorMessage` already shows.
- **Public profiles**: `src/services/users.ts` wraps `GET /users/{id}` (auth,
  envelope, 404 for an unknown id) and defines `PublicUser` (`id`, `name`,
  `username`, `description`, `is_robot`, `is_admin`, never the email;
  `description` only from `GET /users/{id}`: seats and `players` leave it
  out to keep broadcasts under 10 KB, so it is optional); `TableSeat.user` uses that type
  too, since table payloads embed the same profile per seat. The Pinia store
  `src/stores/users.ts` caches profiles by id (a 404 drops the cached one)
  and `stats` by user id; `clear()` on logout (`endSession`) drops both.
  **Stats** (#131, bb#121): `getUserStats(id)` (`GET /users/{id}/stats`)
  and `getMyStats()` (`GET /api/user/stats`) → `UserStats` (`boards
  {played, compared, won, win_rate, average_percent}`, `sets {played,
  won, win_rate, average_percent}`, `leaving {abandoned,
  abandoned_by_reason, left_rate}`: rates 0–1, averages 0–100, null with
  nothing to divide by; no `forfeited`, sets aren't forfeited since
  bb#120). The store's `loadStats(id | null)` (null = your own, kept under
  the answer's `user_id`; a 404 drops them) runs on every showing, since
  they change after every board: `PlayerStats.vue` (`userId`, `compact`,
  exposes `load()`; skeleton, "Couldn't load the stats." + Retry, 401 →
  login, only the latest read settles) is loaded by `UserProfilePage`
  (with the history, `historyOwner`), `AccountPage`
  (`onIonViewWillEnter`) and `PlayerProfileSheet` (compact, after
  `nextTick` in its watch); never mounted for a robot.
  `src/utils/stats.ts` words it (`rateText`, `averageText` "56.0 %",
  `NO_FIGURE` "—", `setsLine`, `boardsLine`, `comparedNote`,
  `leavingLine`, `leavingReasons`, `statsSummary`, `STATS_EXPLAINED`);
  `percentText` takes a number or a formatted string.
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
  them during the auction): `CallAlerted` `{table_id, playing_id, index,
  explanation}` goes to each human opponent's user channel (all four
  humans' in the play), `CallQuestioned` `{…, asked_by}` to the bidder's,
  `AuctionAlertsShown` `{table_id, playing_id, alerts: [{index,
  explanation}]}` to each human whose partner alerted, when the auction
  ends (see Alerts); nor does the chat: `BoardMessageSent`
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
  mid-set (`midSet`, bb#76: going quiet there marks us away; a beat that
  finds the set over while hidden stops it); on return it beats at once, refetches
  the table and the game state, and a seat lost meanwhile (or a 403/404 from
  a beat) is told as `IDLE_NOTICE` and sets `kickedFrom`. A removal noticed
  while hidden keeps its toast until the page shows again.
  Running it needs `php artisan reverb:start` and `queue:work` on the backend
  (bridge_backend `docs/RUNNING.md`, Realtime), and away marks and the
  turn clock's robot need `schedule:work` (`tables:check-away` every 10 s).
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
  `closeOverlays`, then `nextTick`) before asking. The Tables page's
  `YourTableHero` has **Leave** (`.seated-leave`, its `actions` slot)
  for an unheld seat (`seatedAt`).
- **Dev server port is 3000 on purpose** (`vite.config.ts`, `strictPort`): the
  backend's CORS `allowed_origins` defaults to `http://localhost:3000` and that
  host is a Sanctum stateful domain. Keep `VITE_API_BASE_URL` on `localhost`
  (not `127.0.0.1`) so session/XSRF cookies are shared with the SPA.
- **Bootstrap**: `src/main.ts` installs `IonicVue`, Pinia and the router on the Vue
  app, and imports Ionic's core/theme CSS module-by-module (core, normalize,
  structure, typography, plus optional utility CSS). Dark mode is wired via
  `@ionic/vue/css/palettes/dark.system.css` (follows OS setting) — swap this
  import if dark mode behavior needs to change (class-based vs. always-on).
- **Theme: Daylight** (#160, design canvas linked from the issue): the
  tokens are `--bridge-*` custom properties in `src/theme/variables.css`
  (ground, surface, ink, muted, line, control, chip, table/table-inner,
  on-table, action/on-action/action-text/action-tint, amber, pass/double/
  redouble bg + text, question, popup, red-suit, card-face/ink/red/border,
  #163's plates (`--bridge-plate`/`-on-plate`(`-muted`)/`-plate-away`,
  avatar, ready tick, bank running/low), the table's leftovers
  (`--bridge-table-slot`, `-on-table-turn`/`-thinking`/`-wash`/`-chip`,
  vul stripes, `--bridge-vul-seat`), `--bridge-card-*` constants on a card
  face (muted, navy, amber-tint, edge, shadow), popup-action, shadows,
  radii, `--bridge-font` / `--bridge-font-numbers`), mapped onto Ionic's
  colours (`primary` = the table navy, `success`/`danger`/`warning` =
  pass/double/amber, `medium` = muted, `tertiary` = the robot blue) plus a
  custom **`action`** colour (`color="action"`, the one orange primary per
  screen: StartBox's Start, NextBoardBox's Deal now). Components read
  tokens, never hex (none left under `src/` since #163 but the
  printout's black on white); what stays white in both modes (card
  faces, the bidding box's cards, the plates' avatars) has tokens that
  dark mode never redefines. Dark mode: the same
  tokens get the Midnight values under `prefers-color-scheme: dark` on
  `:root, :root.ios, :root.md` (so they beat `dark.system.css`).
  `src/theme/daylight.css`: body font, `ion-button` 48 px (not small,
  toolbar or clear), sentence case, 12 px radius, outline neutral /
  `color="danger"` outline via `::part(native)`, grey disabled (sets
  `--ion-color-base` too, since a coloured button ignores `--background`).
  Fonts are bundled from `@fontsource/atkinson-hyperlegible` (400/700) and
  `@fontsource/barlow-semi-condensed` (600/700), imported in `main.ts`.
  `BridgeTable` is the navy panel: top and bottom seats span the grid's
  width, each seat a `.plate` (`.avatar`, `avatar-robot` with an inline
  robot icon, `.seat-user`, `AdminBadge` (the amber ADMIN tag),
  `.plate-sub` seat line, `.seat-bank` pill, `.seat-ready-mark` from the
  `ready` prop), `.seat-empty` dashed, `.last-call` per seat while `calls`
  is set (the play page passes the auction during `auction`; partner's
  alert never marked), side plates upright and 76 px below 576 px; it sets
  `--playable-ring` amber and white `--call-chip-*` for what lies on it.
  `TrickArea`'s `trump` rings `winningSoFar()` (`src/utils/play.ts`) and
  `mySlot` draws a dashed `.my-slot`. #161 did the play page during a
  board: `TurnClockLine`, the header (`headerTitle` "<table> · Board 2
  of 4" from `playing.set`, never `board.number`; the name alone in
  `waiting`), the chat badge in `action`, Claim, `ClaimSheet`'s tiles,
  `ClaimPanel`'s banner (tokens `--bridge-on-popup-clock`/`-ok`) and
  `HandView`'s `.forced-tag`; nothing draws a card back yet. #165 did the
  top-left corner (above, Vulnerability in words) in place of #161's
  contract chip and phone bar: no `AuctionHistory` on the page once the
  auction is over (the Auction button only), the contract bar
  (`.outcome`) only "5♣ by East" + `tricks_won` (and `.outcome-you` for a
  robot declarer's dummy), no declarer/dummy line, and no
  `board.number` anywhere on the play page: `BridgeTable`'s
  `boardLabel` (the centre's first line; left out "Board 7", the play
  page passes `boardPosition` or null). #162 did the finished board and the lobby
  (Board result above; **Lobby** below); tokens
  `--bridge-on-table-good`/`-bad`/`-accent`, `--bridge-table-dim`,
  `--bridge-on-table-faint`, `--bridge-navy-tint`(`-text`),
  `--bridge-action-line`; `.lobby-card` in `daylight.css` is the lobby's
  white card. #163 did the rest: `SeatPlate.vue` (+ `PlayerAvatar.vue`,
  initials or a robot's icon) is a seated player off the table
  (`StartBox`, the detail page's compass: N/S across, side plates upright
  below 576 px; an empty seat is the ion-button `.seat-sit` dashed orange
  "Sit here · North" / "Move here · North"), `PlayerProfileSheet`'s
  `.profile-avatar` and `SeatPlayerSheet`'s result avatars, the chat's
  bubbles, and the small buttons it touched 44 px tall. **The wide
  table**: `wideTable` on the play page = `chatWide` (≥ 1100 px) and the
  `.play` column ≥ `WIDE_TABLE_MIN_PX` (560, `src/utils/layout.ts`,
  measured by `useElementWidth`, a ResizeObserver, 0 without one, so page
  specs stay narrow unless they stub it); then `.play-wide` (1040 px,
  the chat `clamp()` at 1040 + 656 = 1696 px), `BridgeTable`'s `wide`
  (`.table-wide`, `auto minmax(0, 1fr) auto`, its own container
  `bridge-table`: side plates upright under 760 px) with the
  `BoardTile` in its `corner` slot (`.with-corner`: top seat in column 2;
  the board bar's tile hidden), and during the auction (`auctionCentre`)
  the `#centre` slot is `.centre-auction`: `AuctionHistory` +
  `BiddingBox` (or `.bids-missing`), shared with the below-table copies
  through `liveAuctionProps`/`auctionEvents`/`biddingProps`/
  `biddingEvents`, held at its tallest per board by `useSteadyHeight`
  (which now follows a `v-if`'d target, `flush: 'sync'`). The play keeps
  the trick slot. Tests: `tests/unit/wideTable.spec.ts` stubs
  `ResizeObserver` and `matchMedia`.
- **Lobby** (#162, the Lobby board): `TablesPage.vue` is 1280 px at most,
  `.lobby-main` + `.lobby-aside` wrapping to one column. `YourTableHero.vue`
  (navy; `useYourTable`'s table/target/status, so nothing for a guest,
  banned or unseated; `yourTableLine` "Set 3 · Board 2 of 4 · you sit
  South with radu"; `SetStrip` `onTable` from `currentSet(table, held
  board)` + `history.sets`, read by `loadSet` once `board > 1` or
  finished, failures quiet; **Back to the table** / **Come back** +
  `AwayNotice` held; `actions` slot) on Tables and Home. Two
  `.start-cards`: **Play now with robots** (`SetMinutesPicker` with
  `label`, styled as a 4-way segmented control; `.deal-me-in` →
  `create({name: null, robots: true, set_minutes})`) and the
  `form.start-friends` (**Create table** → `create({name, robots:
  false})`); `creating` is `'robots'|'friends'`, errors per card.
  **Open tables**: `.filter-chip`s (`TABLE_FILTERS`, `matchesFilter`,
  `filterCounts` in `src/utils/lobby.ts`: all / free = free seats /
  playing = `board_id` / robots = `unattended_since`), then
  `TableCard.vue` per table (`tableMeta(table, now)`: "16 min · set 2 ·
  board 2/4", "left 3 min ago · closes in 7"; `tableStatus` pill
  wait/play/robots; the compass from `compassSeats(table, me)`, kinds
  me/robot/away/player/empty; empty → `.compass-sit` "Sit N" (`join`,
  aria "Move to North" at our own table), a name → `player`). The aside
  (and Home's `.home-aside`): `YourForm.vue` (`users.loadStats(null)`:
  `averageText` board %, sets won / played, boards played; "—" unread)
  and `RecentBoards.vue` (`history.loadHistory(null)`, the first 3,
  `contractShort`, "Set 2 · B3", score, links to `/playings/:id`, "All my
  boards"); both expose `load()`, which the page calls after the tables
  load (failures quiet). Page specs mock `@/services/users`
  (`getMyStats`) and `@/services/history` (`getMyPlayings`, `getSet`).
- **Card size** (#136): `src/utils/cardSize.ts` is the setting, `normal`
  (the old 48 px card) / `large` (96 px, the default) / `xlarge` (120 px),
  on the Account page (an `ion-segment` + two preview cards), kept in
  `localStorage` `bridge.cardSize` (try/catch, like `bridge.menuPinned`;
  anything else reads as Large). `cardWidthCss` (`min(<width>px,
  var(--card-max, <width>px))`) is bound as `--card-w` on `PlayingCard`,
  `HandView`, `TrickArea` and `LeadAnalysis`; everything a card draws
  (height 17/12 of it, the corner: rank 0.38 and suit 0.32 of the width,
  no pip since #160) and every overlap or slot is a
  `calc()` of `--card-w`, never a fixed px. Playable cards rise 14 px with
  a `--playable-ring` (orange, amber on the table); a forced one pulses an
  amber halo. `--card-max` caps it where room
  is short: 72 px for a hand below 576 px, half the centre's width for the
  trick (`.centre-slot` is `container-type: inline-size`, `100cqi`), the
  screen's width for the spread pop-up. A hand's `--card-step` (the part of
  a card left showing) is `max(MIN_TARGET_PX = 44px, 0.46 × --card-w)`;
  `useSteadyHeight` (`src/composables/`, ResizeObserver) holds the hand at
  its tallest until a new deal, a size change or a width change.
  `DummyColumns` takes `cardTextSize` as `--hand-text` (at most 1.1rem
  below 576 px, so a finished deal's three hands fit 360 px).
  `BridgeTable` below 576 px is `auto minmax(0, 1fr) auto`. The play page,
  `PlayingReviewPage` and `BoardReviewModal` are 720 px wide at most (the
  chat aside's `clamp()` uses 720 + 2 × 328 = 1376 px); the play page's
  wide table 1040 px (1696 px).
- **Ionic events** (#158): Ionic Vue 8 dispatches every event in
  kebab-case (`ion-change`), but its wrappers declare the camelCase name
  as a component event and only re-emit it from an `ionChange` listener
  that never fires, so `@ion-change` / `@ionChange` / `@ionRefresh` /
  `@ionInfinite` **never run**. On Ionic form components use `v-model` or
  `:model-value` + `@update:model-value` (the wrapper's model hook does
  listen for the kebab event), never `@ion-change`; for an event without a
  value (`ion-refresh`, `ion-infinite`) use the `v-ion-event:<kebab-name>`
  directive (`src/directives/ionEvent.ts`), whose handler gets the
  CustomEvent. `tests/unit/ionEvent.spec.ts` fails on any `@ion…`
  listener in a template. Tests fire the element's real event through
  `tests/unit/ionEvents.ts` (`pickSegment`/`tapSegment`, `pullToRefresh`,
  `fireIonEvent`), never `vm.$emit('ionChange')`, which passes while the
  app is broken.
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
