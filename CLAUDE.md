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
- Run `npm run test:coverage` before every commit of a task and read the
  table for the files you touched; `coverage/index.html` shows the
  uncovered lines.
- Never lower a threshold, add a file to the coverage `exclude`, or add
  `/* v8 ignore */` comments to get under the bar. Raise the branches
  threshold when the totals allow it.
- Every new issue (card) written for this repo lists in its Acceptance:
  "`npm run test:coverage` passes; every file the task adds or touches has
  ≥ 95 % of its lines covered by unit tests". Every PR's test plan reports
  the coverage of the files it touched.

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
  new top-level section means adding both a view and a route entry here, plus an `ion-item` in
  `src/components/AppMenu.vue` if it belongs in the menu.
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
- **App shell**: `App.vue` renders `<AppMenu />` (the left `ion-menu`) next to
  `<ion-router-outlet id="main-content" />`; the menu's `content-id` must match
  that outlet id. Every page wraps its content in `<ion-page>` and uses
  `src/components/AppHeader.vue` (menu button + `title` prop, an `end` slot for
  per-page header actions, and an "Account" button linking to `/account` that
  the header itself renders whenever the auth store says somebody is logged in,
  and `BanBanner.vue` under the toolbar while the user is banned).
  `App.vue` also holds `BanNotice.vue` (see Bans).
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
  Tables page's "Play with robots" toggle, on by default) seats three
  but deals nothing, so the page goes to `/tables/:id`, where the
  creator's Start deals (robots are always ready); a manager adds one
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
  as pending if it beats that board's `PlayingUpdated` (the same channel's
  `UserBanned` goes to the auth store, see Bans). A `TableUpdated` whose
  `board_id` went back to null mid-board means a player left and the board was
  abandoned: toast and back to `waiting`. The auth store follows the user
  channel from login/session restore to logout (`watchUser`/`unwatchUser`).
  `TablePlayPage.vue` draws it with `src/components/BridgeTable.vue` (the four
  seats rotated so the viewer is always at the bottom, dealer and
  red/green vulnerability, whose turn), `HandView.vue` and `PlayingCard.vue`;
  card sorting, rank labels (the backend skips 11: `12`=J … `15`=A), seat
  rotation and vulnerability live in `src/utils/cards.ts`. The detail page
  moves a seated player to `/play` when `board_id` changes to a new board.
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
  names it and, for declarer only (`autoPlaysForced()`, #69: a defender
  taps it themselves, no countdown or pulse),
  `src/composables/useForcedPlay.ts` plays it after 3 s
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
  while a trick is held) pops up the last of `tricks` in a `TrickArea`
  with `spread` (#70: no overlap, a seat tag per card, nudged sideways to
  stay on screen):
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
  The game store's `next()` posts `POST /tables/{id}/playing/next`
  through the same `isBehind` guard; the last player to ask gets the new
  board in the answer, the others through `PlayingUpdated` + `HandDealt`.
  Each player asks only for themselves (#72: no "for everyone", a manager
  included; the backend ignores `everyone`, bb#74), with `NextBoardBox`'s
  one **Next board** button, then "Waiting for …". Leaving
  between boards abandons nothing and keeps `board_id`; with three seated
  the next ask 409s, and once a fourth player sits down everyone's Start
  deals the board (the play page swaps `NextBoardBox` for `StartBox`).
  `leaveWarning()` / `moveConsequences()` in `src/utils/seatMove.ts` word
  leaving by phase (`game.phaseOf(id)`). The running score under a board's
  result is its set's (`BoardResultPanel`'s `setSoFar`, below).
- **Sets of four boards** (#73, bb#75, backend `docs/API.md` Sets): Start
  deals a set's first board, Next the other three, after the fourth Next
  409s ("The set is over…") and everyone's Start opens the next set. `set`
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
  feeds `BoardResultPanel`'s "Set N so far" line and, once the set is
  over (`endedSet`), shows `SetResultsPanel.vue` instead of the board
  result (also in `waiting` for a set ended mid-board), with `StartBox`
  below. `sets.ts` also has `setWinnerText`/`setWon` (from the viewer's
  side, "by forfeit"), `forfeitedSeat` (the forfeiting side's seat whose
  player is no longer at the table) + `forfeitText`, `setTotals` and
  `groupBySet` (history runs of one set, the owner's score summed),
  `runningSet` (the set a table is in the middle of, else null).
- **Away mid-set and the forfeit** (#74, bb#76, backend `docs/API.md` Away
  mid-set): a seat has `away_since`/`forfeit_at` (`TableSeat`, on payloads
  and `TableUpdated`); the backend's `tables:check-away` marks a quiet
  player away after a minute and their side forfeits 3 minutes on.
  `src/utils/away.ts`: `awaySeats`, `myAwaySeat`, `secondsLeft`/
  `formatClock`, `awayText` ("East is away. E-W lose the set in 2:41
  unless they come back."), `heldText` (own held seat), `setAtStake`
  (side + `forfeits`, false for an admin or while any away seat has
  `forfeit_at: null`), `lostSetText`, `SET_FORFEIT_MINUTES` (only quoted
  in confirmations; countdowns read `forfeit_at`). `AwayNotice.vue`
  (`useNow` ticks it, `held` for the own seat) on the play page above the
  status, the detail page, Tables and Home; `BridgeTable`'s `away` prop and
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
  `GET /users/{id}/playings` and `GET /boards/{id}/results` (every table's
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
  drops it. `PlayingReviewPage.vue` holds one number, `step` (cards
  played), and `src/utils/review.ts` derives the rest: `playedCards` (the
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
  and each `BoardResultsPage` row link to it, and so does the play page's
  "Review and export" once a board is `finished`.
- **Export** (#71): the review page's header "Export" opens an
  `ion-action-sheet`: Copy as text, Download .txt/.pbn/.json, Print / Save
  as PDF (only Copy on a native platform, `Capacitor.isNativePlatform()`:
  WebViews ignore `download` links and `window.print()`).
  `src/utils/export.ts` is pure: `boardText(review, extras)` (matchpoints
  in `extras` when `history.results[boardId]` holds this playing's row),
  `boardPbn(review)` (PBN 2.1 export format: the 15 mandatory tags in
  order, unknown ones `?`, a passed-out board's Declarer/Result empty and
  Contract `Pass`; then Auction, Play, Score; play lines in fixed seat
  columns from the opening leader, a claim leaves `-` and ends with `*`;
  CRLF line ends), `boardJson`, `trickRows`, `claimNote` (the review
  doesn't say who claimed: told from declarer's side), `exportFileName`.
  `src/utils/download.ts`: `downloadFile`, `copyText`. Print: the page adds
  `printing-board` to `<body>`, teleports `BoardPrintout.vue` there,
  `window.print()`, and drops it on `afterprint`/view leave;
  `src/theme/print.css` hides the rest and unpins Ionic's fixed body.
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
  `username`, `description`, `is_robot`, `is_admin`, never the email); `TableSeat.user` uses that type
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
