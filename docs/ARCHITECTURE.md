# Frontend architecture

_Status as of branch `bulbulica2/38-robots`._

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
| `src/router/` | `index.ts` (routes + guard + chunk prefetch), `loading.ts` (the progress bar flag, `navigateAndSettle`) |
| `src/views/` | one `*Page.vue` per route |
| `src/components/` | shared pieces: `AppHeader`, `AppMenu`, the game table and cards, sheets, history list |
| `src/stores/` | Pinia stores, one per domain: `auth`, `tables`, `game`, `history`, `users` |
| `src/services/` | axios calls per domain, plus `http.ts` (the axios instance) and `echo.ts` (the websocket) |
| `src/composables/` | `useUserSearch` (debounced user lookup) |
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

Password reset is a two-step guest flow: `/reset-password` posts your email
to `/forgot-password`, the backend emails a link to
`<FRONTEND_URL>/password-reset/<token>?email=<email>`, and that route shows
the "choose a new password" form. A reset doesn't log you in, so the page
sends you to `/login` afterwards.

## Stores

| Store | Holds | Main actions |
|---|---|---|
| `auth` | `user` (own record, with email) | `login`, `register`, `logout`, `loadSession`, `updateProfile`, password reset |
| `tables` | `tables` (the list), `currentTable` (the one the detail page shows), `myTable`, `kickedFrom` | `load`, `loadTable`, `create`, `join`, `leave`, `removePlayer`, `seatUser`, `seatRobot`, `seatedTable`; owns the table channel and the heartbeat |
| `game` | one table's game: `tableId`, `playing` (public state + your hand), the bid list | `load`, `loadBids`, `call`, `play`, `claim`, `respondToClaim`, `withdrawClaim`, `next`, `loadSessionScore`, `phaseOf`; applies `PlayingUpdated` / `HandDealt` |
| `history` | finished boards per owner (`null` = you, a number = another user), results per board, reviews per playing | `loadHistory`, `loadMore`, `loadResults`, `loadReview` |
| `users` | public profiles by id | `load` |

A table changed by any answer or broadcast is written into both `tables`
and `currentTable`, so the list and the detail page stay in step.

## Services

| Service | Endpoints (see [backend `API.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md)) |
|---|---|
| `auth.ts` | `/sanctum/csrf-cookie`, `POST /login`, `/register`, `/logout`, `/forgot-password`, `/reset-password`, `GET` / `PATCH /api/user` |
| `tables.ts` | `GET` / `POST /tables`, `GET /tables/{id}`, `POST` / `DELETE /tables/{id}/seats`, `POST /tables/{id}/seats/users`, `POST /tables/{id}/seats/robots`, `DELETE /tables/{id}/seats/{user}`, `POST /tables/{id}/heartbeat` |
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
- **Robots** are users with `is_robot: true` (on every public profile). They
  fill seats nobody else takes: `POST /tables` with `robots: true` seats
  three and deals at once, and a manager adds one with
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
  from `GET /bids` once and looks a call up by its level and strain. Never
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
  returns nothing to wait on).
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
| `HandView` + `PlayingCard` | your hand; playable cards become buttons, the rest dim |
| `BiddingBox` | the call grid, on your turn during the auction |
| `AuctionHistory` + `CallLabel` | the calls so far, four columns rotated like the table |
| `TrickArea` | the current trick in the table's centre (a finished trick stays 2 s) |
| `DummyColumns` | dummy (or a claimer's or a finished hand) on a side seat |
| `ClaimSheet` | the bottom sheet for making a claim: a stepper from 0 to the tricks left, and **Concede** |
| `ClaimPanel` | a pending claim: what is claimed, who has accepted, **Accept** / **Reject** or **Withdraw** |
| `BoardResultPanel`, `NextBoardBox` | the score once a board is finished, and who is ready for the next |
| `RobotBadge` | the "robot" mark next to a robot's name (also on Home, Tables, Table detail and the profile sheet) |

`BridgeTable`'s `thinking` prop is set when the player acting for `turn`
(`acting_user_id`, declarer on dummy's turn) is a robot: that seat reads
"Thinking…" instead of "To act", and the status line under the table says
"robot-1 is thinking…".

Pure logic lives in `src/utils/`: `cards.ts` (sorting, rank labels, seat
rotation, vulnerability), `auction.ts` (call legality hints and labels),
`play.ts` (follow-suit hint, whose hand you play, trick layout), `claim.ts`
(who may claim, who still has to answer, the claim's wording), `result.ts`
(the score from your side), `seatMove.ts` (wording for leaving or moving by
game phase, and whether only robots would be left), `review.ts` (a replay's table after N cards: hands left, the
trick shown, tricks won, the trick-by-trick steps). These are the
best-tested parts of the app. For the rules
themselves see [`GAME-RULES.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/GAME-RULES.md).

## The board review

`PlayingReviewPage` (`/playings/:id`) replays one finished playing from
`GET /playings/{id}` with the same components: `BridgeTable` (with the
hands left at the current step, `replay` set so they aren't labelled "as
dealt"), `TrickArea`, `AuctionHistory` and `BoardResultPanel`. It keeps a
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
