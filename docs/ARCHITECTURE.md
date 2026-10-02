# Frontend architecture

_Status as of branch `bulbulica2/47-start-button`._

How the SPA is put together, for a developer joining the project. The
per-page detail is in [`SCREENS.md`](SCREENS.md); endpoint shapes are in
[backend `API.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md).

## The big picture

```
views (pages)  ──call──▶  Pinia stores  ──call──▶  services  ──axios──▶  bridge_backend
     ▲                        │   ▲                                        │
     └──── reactive state ────┘   └──── Echo (Reverb websocket) ◀── broadcasts
```

- **Views never call services directly.** A page reads state from a store
  and calls a store action; the store calls the service and keeps the
  result. That way two pages showing the same table (or the header and a
  page showing the same user) never disagree.
- **Services are thin**: one function per endpoint over the one shared
  axios instance, unwrapping the response envelope and nothing else.
- **Live updates go into the same stores** as HTTP answers, through the
  same code paths, so a page can't tell (and doesn't care) where a change
  came from.

## Source layout

| Folder | What lives there |
|---|---|
| `src/main.ts` | creates the app: Ionic, Pinia, the router, Ionic's CSS, dark mode |
| `src/App.vue` | the shell: side menu, router outlet, route progress bar |
| `src/router/` | `index.ts` (routes + guard + chunk and bid-list prefetch), `loading.ts` (the progress bar flag, `navigateAndSettle`) |
| `src/views/` | one `*Page.vue` per route |
| `src/components/` | shared pieces: `AppHeader`, `AppMenu`, the game table and cards, sheets, history list |
| `src/stores/` | Pinia stores, one per domain: `auth`, `tables`, `game`, `history`, `users` |
| `src/services/` | axios calls per domain, plus `http.ts` (the axios instance) and `echo.ts` (the websocket) |
| `src/composables/` | `useUserSearch` (debounced user lookup), `useForcedPlay` (the countdown that plays a forced card) |
| `src/utils/` | pure helpers: errors, toasts, cards, auction and play rules, results, seat-move wording |
| `src/theme/` | Ionic variables and the global toast styles |
| `tests/unit/`, `tests/e2e/` | Vitest and Cypress; tests are **not** next to the source |

`@/` is an alias for `src/` (set in both `tsconfig.json` and
`vite.config.ts`; keep them in sync).

## App shell

`App.vue` renders `AppMenu` (the left `ion-menu`) and
`<ion-router-outlet id="main-content">`; the menu's `content-id` must match
that id. Every page wraps its content in `<ion-page>` and starts with
`<AppHeader title="…">`, which draws the menu button, the title, an `end`
slot for page actions and, while somebody is logged in, an **Account**
button.

The menu depends on the auth state: **Home** always, **Login** for guests,
**Tables** and **My boards** once logged in. Other pages are reached from
buttons, not the menu.

Dark mode follows the operating system
(`@ionic/vue/css/palettes/dark.system.css` in `main.ts`).

## Routes and the guard

All routes are flat and lazy loaded, in `src/router/index.ts`:

| Path | Page | Access |
|---|---|---|
| `/` | redirects to `/home` | |
| `/home` | `HomePage` | everyone |
| `/login` | `LoginPage` | guests only |
| `/create-account` | `CreateAccountPage` | guests only |
| `/reset-password` | `ResetPasswordPage` (ask for a link) | guests only |
| `/password-reset/:token` | `ResetPasswordPage` (choose a new password) | guests only |
| `/account` | `AccountPage` | logged in |
| `/tables` | `TablesPage` | logged in |
| `/tables/:id` | `TableDetailPage` | logged in |
| `/tables/:id/play` | `TablePlayPage` | logged in |
| `/history` | `HistoryPage` | logged in |
| `/boards/:id/results` | `BoardResultsPage` | logged in |
| `/playings/:id` | `PlayingReviewPage` | logged in |
| `/users/:id` | `UserProfilePage` | logged in |

Access is declared as route meta and enforced by one `router.beforeEach`:
`meta.requiresAuth` sends a guest to `/login`, `meta.guestOnly` sends a
logged-in user to `/account`. Before deciding, the guard awaits
`authStore.loadSession()`, which calls `GET /api/user` **once per page
load**. That's what keeps you logged in across a browser reload: the
Sanctum session cookie is still valid, the SPA just has to ask.

A 401 that arrives *while a page is open* (the session expired after the
guard let you in) is handled by that page, which sends you to `/login`.

Adding a page = a view in `src/views/`, a route here (with its meta), and
an `ion-item` in `AppMenu.vue` only if it belongs in the menu.

## Auth and HTTP

`src/services/http.ts` is **the** axios instance. Never create another one:
it carries what Sanctum's cookie auth needs (`withCredentials`,
`withXSRFToken`, `Accept: application/json`) and the `baseURL` from
`VITE_API_BASE_URL`. State-changing requests first call
`GET /sanctum/csrf-cookie` so the `XSRF-TOKEN` cookie exists. The whole
flow, and why the origin must be `localhost:3000`, is in
[backend `AUTH.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/AUTH.md).

`src/stores/auth.ts` holds the logged-in `user` and exposes `login`,
`register`, `logout`, `loadSession`, `requestPasswordReset`,
`resetPassword` and `updateProfile`. On login or session restore it has
the `game` store follow the user's private channel; logout drops that and
the table channel, closes the socket and clears the `history` store (see
[Realtime](#realtime)).

**Remember me**: `login` takes an optional `remember` (the Login page's
checkbox) and sends it in the `POST /login` body. With it, the backend
sets Laravel's long-lived `remember_web_*` cookie next to the session
cookie. Sanctum authenticates through the `web` guard, so once the session
has expired, the guard's `GET /api/user` logs the user back in from that
cookie, and a reload lands logged in. `POST /logout` clears the remember
token on the server, so after a logout the next reload is a guest's.
Registration doesn't remember the user.

Password reset is a two-step guest flow: `/reset-password` posts your email
to `/forgot-password`, the backend emails a link to
`<FRONTEND_URL>/password-reset/<token>?email=<email>`, and that route shows
the "choose a new password" form. A reset doesn't log you in, so the page
sends you to `/login` afterwards.

## Stores

| Store | Holds | Main actions |
|---|---|---|
| `auth` | `user` (own record, with email) | `login`, `register`, `logout`, `loadSession`, `updateProfile`, password reset |
| `tables` | `tables` (the list), `currentTable` (the one the detail page shows), `myTable`, `kickedFrom` | `load`, `loadTable`, `openTable`, `create`, `join`, `leave`, `removePlayer`, `seatUser`, `seatRobot`, `start`, `cancelStart`, `seatedTable`; owns the table channel and the heartbeat |
| `game` | one table's game: `tableId`, `playing` (public state + your hand), the bid list | `load`, `adopt`, `loadBids`, `call`, `play`, `claim`, `respondToClaim`, `withdrawClaim`, `next`, `loadSessionScore`, `phaseOf`; applies `PlayingUpdated` / `HandDealt` |
| `history` | finished boards per owner (`null` = you, a number = another user), results per board, reviews per playing | `loadHistory`, `loadMore`, `loadResults`, `loadReview` |
| `users` | public profiles by id | `load` |

A table changed by any answer or broadcast is written into both `tables`
and `currentTable`, so the list and the detail page stay in step. `create`
also makes the new table the `currentTable`, so whichever page opens next
draws it straight away.

**Entering a table page costs one request at most** (#55). Locally the
backend answers one request at a time (see [RUNNING.md](RUNNING.md#local-speed)),
so every extra request on the way in delays the one the page needs:
- `openTable(id)` returns the copy the store already holds when it follows
  that table's channel (the user's own table, after Create, a join or a
  `load`), since `TableUpdated` keeps it current; any other table is read
  with `loadTable`. The detail and play pages use it on entry; their
  Refresh and pull-to-refresh still call `loadTable`.
- The play page waits only for `GET /tables/{id}/playing` (plus
  `GET /tables/{id}` when it doesn't hold the table, e.g. after a reload),
  and asks for the bid list after that. The bid list is normally already
  there: the router reads it in the background a second after the first
  logged-in page shows (`prefetchBids` in `src/router/index.ts`).
- Create with robots closes the modal and moves to the new table's page
  as soon as `POST /tables` answers; that page draws the table the store
  already holds (nothing is dealt until Start, #68).
- The Start that deals a board answers with the caller's game state.
  `tables.start` hands it to the game store (`adopt`) before applying the
  table, so the `board_id` watch on the detail page moves to `/play` with
  the board already drawn. The play page still reads
  `GET /tables/{id}/playing` on entry.

## Services

| Service | Endpoints (see [backend `API.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md)) |
|---|---|
| `auth.ts` | `/sanctum/csrf-cookie`, `POST /login`, `/register`, `/logout`, `/forgot-password`, `/reset-password`, `GET` / `PATCH /api/user` |
| `tables.ts` | `GET` / `POST /tables`, `GET /tables/{id}`, `POST` / `DELETE /tables/{id}/seats`, `POST /tables/{id}/seats/users`, `POST /tables/{id}/seats/robots`, `DELETE /tables/{id}/seats/{user}`, `POST` / `DELETE /tables/{id}/start`, `POST /tables/{id}/heartbeat` |
| `game.ts` | `GET /tables/{id}/playing`, `GET /bids`, `POST /tables/{id}/calls`, `POST /tables/{id}/cards`, `POST` / `DELETE /tables/{id}/claim`, `POST /tables/{id}/claim/response`, `POST /tables/{id}/playing/next` |
| `history.ts` | `GET /api/user/playings`, `GET /users/{id}/playings`, `GET /boards/{id}/results`, `GET /playings/{id}` |
| `users.ts` | `GET /users/{id}`, `GET /users?search=` |
| `echo.ts` | the websocket, and `POST /broadcasting/auth` to sign private channels |

Most game endpoints sit at the root (not under `/api`) and answer with an
envelope, `{status, message, data}`; the service returns `data.data`.

A few backend rules the stores rely on:
- A table exists only while somebody sits at it. The last player leaving
  **deletes** it: the answer's `data` is `{table_deleted: true}`, and the id
  404s from then on.
- Taking a seat while you hold one is a **move**, not an error. The pages
  ask before a move to another table, because leaving the old seat can
  abandon a board there.
- Manager controls (Remove, Seat a player, Add robot, next board for
  everyone) show when the table payload's `can_manage` says so. Don't work
  it out from `moderated_by` or `created_by`; the backend decides (admins
  can manage any table).
- **Nothing is dealt before Start** (bb#73). Filling a table deals no
  board: it is dealt once the table is full and every person seated there
  has pressed Start (`POST /tables/{id}/start`; `DELETE` takes it back).
  Each seat carries `ready` in the table payload and in `TableUpdated`;
  robots are always ready. Nobody presses for anybody else, a manager
  included. A finished board is followed by **Next** for the same four
  players; once one of them has left or been replaced, it is Start again.
  `src/utils/start.ts` holds the hints: `startNeeded()` (does the next
  board wait for Start, given the table and the game state held),
  `isReady()` and `startWaiting()` (the "Waiting for …" line);
  `StartBox.vue` draws it on the detail and play pages. `tables.start` and
  `cancelStart` skip applying an answer that a `TableUpdated` overtook
  while it was on its way, since two players pressing at once race.
- **Robots** are users with `is_robot: true` (on every public profile). They
  fill seats nobody else takes: `POST /tables` with `robots: true` seats
  three (the creator's Start then deals), and a manager adds one with
  `POST /tables/{id}/seats/robots`. They move by themselves on the backend,
  so the SPA only shows them (`RobotBadge`, "Thinking…" on their turn); each
  move arrives as a normal `PlayingUpdated`. How they bid and play:
  [backend `ROBOTS.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/ROBOTS.md).
- When the last **person** leaves a table with robots, the table is kept
  but **unattended** (`unattended_since` set, no moderator): the robots
  wait, anyone may remove them, the first person to sit down manages it,
  and the backend deletes it after 10 minutes. `canRemove()` in
  `services/tables.ts` is the hint for who gets Remove (a manager, or anyone
  for a robot at an unattended table); `whoIsLeft()` / `leaveNote()` in
  `utils/seatMove.ts` word what leaving does.
- Bid ids are not tied to the bid's rank, so the app reads the 38 calls
  from `GET /bids` once (in the background after login, see above) and
  looks a call up by its level and strain. Never
  hard-code a bid id.
- The auction, play and claim rules in `src/utils/auction.ts`, `play.ts`
  and `claim.ts` are only a hint (dimmed buttons and cards). The backend is the referee: a 409
  toasts its message and reloads the game.

## Error handling

`src/utils/errors.ts` is the one place that reads an axios error:
- `errorMessage(e, fallback)`: the text to show. A validation error's first
  field message wins over the top-level `message`; no response at all
  means "Cannot reach the server".
- `statusOf(e)`: the status to branch on (401 → login, 403 → not allowed,
  404 → gone, 409 → stale view, reload), or `null` if the server was never
  reached.
- `fieldErrors(e)`: a 422's first message per field, shown under each input.

Three body shapes reach the SPA: the game endpoints' `{status, message,
data}`, Laravel's 422 `{message, errors}`, and a bare `{message}` from auth
and policy failures. `errorMessage` handles all three.

## Loading feedback and toasts

- **Before the app mounts**, `index.html` shows a plain-CSS progress bar.
  `main.ts` mounts only once the first navigation (including the session
  check) is done, so there's no flash of the wrong page.
- **Between pages**, the guard and lazy page chunks can take a moment.
  `src/router/loading.ts` holds a flag that the router hooks drive, and
  `App.vue` shows it as a thin indeterminate bar if a navigation takes
  longer than 150 ms. After the first page shows, the router fetches every
  other page's chunk in the background.
- **Forms that navigate on success** (login, sign up, profile) call
  `navigateAndSettle(ionRouter, path)` and stay disabled until the next
  page is up. That prevents double submits (Ionic's own `navigate()`
  returns nothing to wait on). Create table and taking a seat on the
  Tables page are the exceptions: they navigate as soon as `POST /tables`
  or the seat request (plus the list reload after a move) answers, and the
  next page shows its own loading state. The seat buttons stay disabled
  until the list page has left (`onIonViewDidLeave`), so a second tap
  can't land meanwhile.
- **Pages that load data** show a skeleton or spinner only when there's
  nothing to show yet. Data already in a store stays on screen with a small
  "Refreshing…" row.
- **Toasts** go through `src/utils/toast.ts` (`showToast`, and
  `showWelcomeToast` after login/sign-up). They live outside the page and
  outlive a navigation, so the app navigates first and then toasts. Their
  styles are global, in `src/theme/toasts.css`.

## Realtime

Live updates come from Laravel Reverb over the Pusher protocol, through
**one** Laravel Echo instance in `src/services/echo.ts`, created the first
time somebody needs it (a guest never opens a socket). Private channels are
signed through the shared axios instance, because Echo's own authorizer
doesn't send the XSRF header Sanctum wants.

| Channel | Who owns it | Events |
|---|---|---|
| `private-table.{id}` | `tables` store, following your seat | `TableUpdated` (the whole table, replaces it), `PlayingUpdated` (public game state, handed to the `game` store) |
| `private-App.Models.User.{id}` | `game` store, from login to logout (started and stopped by `auth`) | `HandDealt` (your cards for a new board) |

- The table channel only admits players seated there, and the server never
  ends a subscription. So the `tables` store subscribes and unsubscribes
  itself as your seat changes: after create, join, move, leave and every
  load.
- A `TableUpdated` that no longer seats you (and wasn't your own request)
  means a manager removed you: a toast, the channel is dropped, and the
  detail page goes back to `/tables`.
- After the socket reconnects, whatever was broadcast meanwhile is lost,
  so the watched table is fetched again once.
- The Tables **list** has no channel; it refreshes on enter and on
  pull-to-refresh.
- HTTP answers and broadcasts race. The `game` store drops a state that is
  behind the one it shows for the same board (fewer calls, fewer cards,
  earlier phase, fewer accepts of the same claim). A claim appearing or
  going away always counts as newer: a rejected or withdrawn claim leaves
  the cards as they were, so there is nothing else to order it by.

**Heartbeat.** The backend frees the seats of players who went quiet. While
the `tables` store watches a table it sends `POST /tables/{id}/heartbeat`
every 30 s, and stops when it stops watching (leave, kick, move, logout).
It pauses while the browser tab is hidden. When the tab shows again it
beats at once and refetches the table and the game; if the seat was lost
in the meantime, the user sees a "removed after being inactive" toast and
goes back to `/tables`.

Without Reverb and a queue worker running on the backend, none of this
arrives, and the app falls back to what each request returns.

## The game screen

`TablePlayPage` draws the game from the `game` store with these components:

| Component | Shows |
|---|---|
| `BridgeTable` | the four seats, rotated so **you are always at the bottom**; dealer, vulnerability, whose turn; dummy's cards; a claimer's cards; the finished deal (or, in a replay, what is left of it) |
| `HandView` + `PlayingCard` | your hand; playable cards become buttons, the rest dim; a forced card (`forcedId`) stands raised and pulses |
| `BiddingBox` | the call grid, on your turn during the auction |
| `AuctionHistory` + `CallLabel` | the calls so far, four columns rotated like the table |
| `TrickArea` | the current trick in the table's centre (a finished trick stays 2 s) |
| `LastTrickPopover` | the **Last trick** button under the trick in progress and its pop-up with the last trick's cards (a `TrickArea`); a mouse opens it by hovering, a tap or key by clicking; a tap outside or Escape closes it |
| `DummyColumns` | dummy (or a claimer's or a finished hand) on a side seat; given `rows`, every suit column keeps room for that many cards |
| `ClaimSheet` | the bottom sheet for making a claim: one button per number from 1 to the tricks left (a tap picks, **Claim N tricks** sends), and **Concede the rest** |
| `ClaimPanel` | a pending claim: what is claimed, who has accepted, **Accept** / **Reject** or **Withdraw** |
| `BoardResultPanel`, `NextBoardBox` | the score once a board is finished, and who is ready for the next |
| `StartBox` | before a board: **Start**, or **Waiting for the others…** with **Cancel**, and what the board still waits for; with `showSeats`, each seat's ready mark (also on the detail page, which marks its compass instead) |
| `RobotBadge` | the "robot" mark next to a robot's name (also on Home, Tables, Table detail and the profile sheet) |

`BridgeTable`'s `thinking` prop is set when the player acting for `turn`
(`acting_user_id`, declarer on dummy's turn) is a robot: that seat reads
"Thinking…" instead of "To act", and the status line under the table says
"robot-1 is thinking…".

When the hand you play from (your own, or dummy's as declarer) has exactly
one legal card to follow with, `forcedCard()` in `play.ts` names it (never
on the lead) and the play page's `useForcedPlay` plays it after 3 s:
the card pulses and the status line counts down ("Playing ♥7 in 3 s…").
Tapping it plays it at once. The countdown is tied to the state it started
in (board, trick, cards in the trick, turn, card), so any new card restarts
or drops it; it also stops while a card or claim is in flight, the claim
sheet is open, a claim is pending or another page is on top. A state the
timer already sent a card for is not counted down again, so a refused card
waits for a tap. The backend's `isBehind` guard and a 409 → reload remain
the backstop.

Pure logic lives in `src/utils/`: `cards.ts` (sorting, rank labels, seat
rotation, vulnerability), `auction.ts` (call legality hints and labels),
`play.ts` (follow-suit hint, the forced card, whose hand you play, trick layout), `claim.ts`
(who may claim, who still has to answer, the claim's wording), `result.ts`
(the score from your side), `seatMove.ts` (wording for leaving or moving by
game phase, and whether only robots would be left), `start.ts` (whether
the next board waits for Start, and who for), `review.ts` (a replay's table after N cards: hands left, the
trick shown, tricks won, the trick-by-trick steps). These are the
best-tested parts of the app. For the rules
themselves see [`GAME-RULES.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/GAME-RULES.md).

## The board review

`PlayingReviewPage` (`/playings/:id`) replays one finished playing from
`GET /playings/{id}` with the same components: `BridgeTable` (with the
hands left at the current step, `replay` set so they aren't labelled "as
dealt", and `reserve` = the deal, so each hand keeps the height it had as
dealt and the replay buttons below the table don't move as cards go),
`TrickArea`, `AuctionHistory` and `BoardResultPanel`. It keeps a
single number, how many cards have been played, and `reviewAt()` in
`src/utils/review.ts` works out everything else from the deal and the
tricks. The review is cached in the `history` store by playing id and never
refetched (a finished playing doesn't change); logout clears it with the
rest of the store. Playings finished before the backend kept their calls
and cards come back with an empty `auction`; the page then shows only the
deal and the result.

## Tests

- **Unit** (`tests/unit/`, Vitest + jsdom + `@vue/test-utils`): stores with
  their service mocked, utils, and some pages mounted for real with
  `@/services/http` mocked.
  - Any test that mounts a page needs an active Pinia
    (`setActivePinia(createPinia())`), because the header and menu read the
    auth store.
  - Ionic's `disabled` and `color` are DOM properties, not attributes.
  - `onIonViewWillEnter` never fires in jsdom; page tests mock it as
    `onMounted`.
- **E2E** (`tests/e2e/`, Cypress): only the starter spec so far (#34).

See [`RUNNING.md`](RUNNING.md#tests) for the commands.
