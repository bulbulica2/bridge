# Frontend architecture

_Status as of branch `bulbulica2/113-bridge4u-name`._

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
| `src/App.vue` | the shell: split pane with the side menu and the router outlet, route progress bar, the ban notice, and the tab title while your turn waits in a hidden tab (`useTurnTitle`) |
| `src/router/` | `index.ts` (routes + guard + prefetch of the page chunks and the bid and card lists), `loading.ts` (the progress bar flag, `navigateAndSettle`) |
| `src/views/` | one `*Page.vue` per route |
| `src/components/` | shared pieces: `AppHeader`, `AppMenu`, the game table and cards, sheets, history list |
| `src/stores/` | Pinia stores, one per domain: `auth`, `tables`, `game`, `history`, `users` |
| `src/services/` | axios calls per domain, plus `http.ts` (the axios instance), `echo.ts` (the websocket) and `liveStatus.ts` (whether live updates reach the table) |
| `src/composables/` | `useUserSearch` (debounced user lookup), `useForcedPlay` (the countdown that plays a forced card), `useNow` (a ticking clock for the turn, claim and next-board countdowns), `useStaleDeadline` (rereads the game when a turn's, a claim's or the next board's deadline passes with no update), `useTurnClock` (the turn clock of a board and each seat's time for the set, ticking), `useTurnTitle` (the tab's title while your turn waits and the tab is hidden), `useLiveStatus` (live updates on or off, for the table pages' Refresh), `useYourTable` (the header's and menu's shortcut to the user's table), `usePopover` (the hover-or-tap pop-up of the Last trick button, the play page's Auction and locked Claim buttons and the auction's calls, kept off the screen's edges and a `data-right-edge` panel, and brought down below the screen's top when it opens upward), `useDoubleDummy` (a board's double dummy table, read once more if it is still being solved), `useElementWidth` (an element's width as it is resized: the play page's column, for the wide table, and dummy's single row), `useSteadyHeight` (an element held at its tallest: a hand, the wide table's auction) |
| `src/directives/` | `ionEvent.ts`: `v-ion-event:ion-refresh="refresh"` listens for an Ionic event on the element itself (pull-to-refresh, the history's infinite scroll); see [Ionic events](#ionic-events) |
| `src/utils/` | pure helpers: errors, toasts, cards, auction and play rules, results, seat-move wording, bans, expanding a compact `PlayingUpdated` (`compact.ts`), the turn clock (`turnClock.ts`), the set clock (`setClock.ts`), a player's stats in words (`stats.ts`), the backend's length limits (`limits.ts`), the menu's collapse preference (`menu.ts`), the wide table's minimum column (`layout.ts`), dummy's single row (`handRow.ts`) |
| `src/theme/` | the Daylight design tokens (`variables.css`), the shared button and font rules (`daylight.css`), the global toast styles, the shared form fields (`forms.css`) and the print stylesheet |
| `tests/unit/`, `tests/e2e/` | Vitest and Cypress; tests are **not** next to the source |

`@/` is an alias for `src/` (set in both `tsconfig.json` and
`vite.config.ts`; keep them in sync).

### Ionic events

Ionic Vue 8 dispatches every component event in kebab-case (`ion-change`,
`ion-refresh`). Its Vue wrappers, though, declare the camelCase name
(`ionChange`) as a component event and only pass it on from a listener for
that camelCase name, which never fires (and only on components with a
value). So a template's `@ion-change`, `@ionChange`, `@ionRefresh` or
`@ionInfinite` is silently ignored (#158: the Account page's card size, a
manager's set minutes and the review modal's board switcher did nothing,
and neither did pull-to-refresh or loading older boards).

- **Components with a value** (`ion-segment`, `ion-toggle`, inputs): use
  `v-model`, or `:model-value` + `@update:model-value` when the pick needs
  checking first. The wrapper's model hook listens for the kebab event and
  emits `update:modelValue` with the element's value.
- **Events without a value** (`ion-refresh`, `ion-infinite`): use the
  `v-ion-event:<kebab-name>` directive (`src/directives/ionEvent.ts`). Its
  handler gets the `CustomEvent`, whose `target` is the Ionic element (to
  call `complete()` on).

A unit test fails on any `@ion…` listener in a template, and tests drive
these components by dispatching the element's real event
(`tests/unit/ionEvents.ts`), never by emitting `ionChange` from the Vue
wrapper, which passes while the app is broken.

## App shell

**The name** (#198): the app is **Bridge4U**, **B4U** where room is
tight, tagline "Bridge for you": `APP_NAME`, `APP_SHORT_NAME` and
`APP_TAGLINE` in `src/utils/brand.ts`, which the guest Home's heading,
the menu's title, the guest forms' line above the card
(`.bridge-form-brand` in `forms.css`) and the turn title read. Only
`index.html` (the tab's `<title>`, the description, the icons) and
`public/manifest.webmanifest` spell it out, being served before any
code runs (see [`RUNNING.md`](RUNNING.md#icons-and-the-web-app-manifest)).

`App.vue` wraps `AppMenu` (the left `ion-menu`) and
`<ion-router-outlet id="main-content">` in an `ion-split-pane`
(`content-id="main-content"`); the menu's `content-id` must match that id.
Every page wraps its content in `<ion-page>` and starts with
`<AppHeader title="…">`, which draws the menu button, the **Your table**
button (below), the title (with an optional `subtitle` line under it,
the play page's **Board 2 of 4 · Set 3**), an `end` slot for page actions and, while
somebody is logged in, an **Account** button. While the logged-in user is
banned, `AppHeader` also shows `BanBanner` under its toolbar (**You are
banned until 12 Oct 2026: <reason>**), so the ban is on every page.
`App.vue` holds `BanNotice`, the dialog shown when a ban throws the user
out (see [Bans](#bans)).

**The menu stays open** (#99): from Ionic's `md` breakpoint (768 px) up the
split pane shows the menu beside the page, and picking an entry leaves it
there (`ion-menu-toggle` only closes the slide-in overlay; Ionic ignores
it for a menu shown in a split pane). The header's menu button is not
Ionic's `ion-menu-button` (which hides itself next to a pinned menu) but
`toggleMenu()` from `src/utils/menu.ts`: from `md` up it collapses the
menu and brings it back, below `md` it slides the overlay in as before.
The choice is the split pane's `when` (`'md'`, or `false` while
collapsed), kept in `localStorage` (`bridge.menuPinned`, read and written
in try/catch); a browser that never chose, or whose storage refuses, gets
it open. On a phone the menu is the overlay whatever was chosen.

**The menu is 320 px wide** (#134), pinned or as the overlay: the split
pane's `--side-min-width`/`--side-max-width` in `App.vue`, the overlay's
`--width` on the menu's `container` part in `AppMenu.vue` (Ionic sets its
own 264 px there below 341 px), less a 40 px strip of the page on a phone
narrower than 360 px. That fits the **Your table** entry on one row: icon,
"YOUR TABLE" over the table's name, and the longest status badge, **Board
in progress**. Beside the pinned menu the page still has 448 px at
768 px; the play page's column only has a `max-width` and works from a
phone's width up, chat aside included (1100 px leaves it 420 px). The
wide table (#163, see [Look: Daylight](#look-daylight)) needs the column
to be 560 px wide, so with the menu pinned and the chat open it starts
around 1240 px.

The menu depends on the auth state: **Home** always, **Login** for guests,
**Tables** and **My boards** once logged in, with the page on screen
highlighted (`aria-current="page"`). Other pages are reached from buttons,
not the menu.

**Your table** (#99): while the user holds a seat, the header shows a
button with the table's name next to the menu button, and the menu lists
the same entry first. Both come from `src/composables/useYourTable.ts`,
which reads the tables store's `myTable` and leads to the table's one
page, the game table `/tables/:id/play`, board or not (#181). Its status, most pressing first: **Away** (the seat is
held after a Leave mid-set, or marked away), **Your turn**
(`turnNotice()` on the board the game store holds for that table, or a
Start the table waits for; "Your turn · 0:42" while your turn clock
runs), **Board in progress**; the header draws it as
a coloured dot (spelled out in the button's `aria-label`) and, on your
turn, turns the button into Daylight's orange pill with the turn written
out, "Your turn · 0:42" (`statusText`; below 576 px the pill drops the
name, #162), the menu as a badge. The menu's badge sits at the end of the row in a cell as wide as
an invisible copy of the longest status, so the entry keeps its size
whatever the status says, or with none; "YOUR TABLE" and the name never
wrap, and a long name (up to 50 characters) ends in "…" with the whole
name in its `title`. The header's button needs none of this: its name is
capped at 10em with an ellipsis and its status is the dot. On the page it leads to, the button is marked current and leads
nowhere. Nothing is shown to a guest, a banned user or somebody not seated.

`myTable` has to be known on every page, not only after the Tables list
loaded. Home and Tables load the list, and the game table opens its
table, so those routes carry `meta.findsSeat`. On every other page the
router's `afterEach` calls the tables store's `findSeat()`, which asks
`GET /tables` once (nothing while a table held already says where the user
sits, at most one request at a time, a failure asked again on the next
page). Its `load()` also follows that table's channel and heartbeat, so
after a reload on My boards the button keeps up with the table live. The
game table calls `findSeat()` too when its board is refused (403: a
table the user doesn't sit at). Logging out empties the store (`clear()`), so the next user starts
from nothing.

Dark mode follows the operating system
(`@ionic/vue/css/palettes/dark.system.css` in `main.ts`).

## Look: Daylight

The app's look is **Daylight** (#160, the design canvas linked from that
issue): light, phone first, a navy table and one orange button for
whatever the table is waiting for.

- **Tokens.** `src/theme/variables.css` defines them as `--bridge-*`
  custom properties (ground, surface, ink, muted, line, control, table,
  action, amber, the pass/double/redouble chip colours, the suit reds, the
  radii) and maps Ionic's colours onto them: `primary` is the table's
  navy, `success`/`danger`/`warning` the pass green, the double red and
  the amber, `medium` the muted text. A custom Ionic colour, **`action`**
  (`color="action"` on an `ion-button`, styled by `.ion-color-action`),
  is the orange primary action. Components read tokens, never a hex of
  their own (card faces and the bidding box's cards stay white in both
  modes, so their colours are fixed: the `--bridge-card-*` tokens, never
  redefined for dark). #163 added the plates' tokens (`--bridge-plate`,
  `-plate-away`, the avatar's, the ready tick's, the set clock's
  running/low pill), the table's leftovers (`--bridge-table-slot`,
  `-on-table-turn`/`-thinking`/`-wash`/`-chip`, the vulnerable stripes and
  seat head) and the shadows; no component under `src/` has a hex colour
  of its own any more, except the printout (`BoardPrintout`, black on
  white on paper). In dark mode
  (`prefers-color-scheme: dark`) the same tokens take the Midnight values
  (ground `#0C0F15`, surface `#1B2130`, action `#FFB547`, accent
  `#8EA8FF`); `:root.ios`/`:root.md` are named so they win over
  `dark.system.css`.
- **Type.** Atkinson Hyperlegible (400/700) for all text and Barlow Semi
  Condensed (600/700) for card ranks, clocks and numbers
  (`--bridge-font`, `--bridge-font-numbers`), bundled from
  `@fontsource/atkinson-hyperlegible` and `@fontsource/barlow-semi-condensed`
  (imported in `main.ts`, so they work offline and in the Capacitor build).
- **Buttons** (`src/theme/daylight.css`): 48 px tall (small and toolbar
  buttons keep Ionic's sizes), sentence case, 12 px radius. One solid
  orange `color="action"` per screen (Start, Deal next board), the solid navy
  default as the secondary, `fill="outline"` as the neutral outline,
  `fill="outline" color="danger"` as the red danger outline, and a grey
  disabled state rather than a faded one. A small button (a seat's
  Remove, Seat a player, a sheet's close) is still 44 px tall to tap.
- **Form fields** (#170, `src/theme/forms.css`, imported in `main.ts`
  next to `toasts.css`): every text field is an `ion-input` /
  `ion-textarea` with `class="bridge-field"` and a stacked label, outside
  any `ion-item`. The label sits above in 14 px bold; the field is a
  48 px white box with a 1.5 px border (`--bridge-field-border`), 12 px
  corners and 12 px padding; focus is a 2 px ring in `--bridge-focus`
  (navy, the accent in dark mode); `bridge-field-invalid` turns the border
  `--bridge-error` red, with the message in a `.bridge-field-message`
  right under the field (its id is the field's `aria-describedby`);
  disabled is the ground colour with muted text. A global rule gives the
  browser's **autofill** the field's own colours on every `ion-input`
  (an inset shadow in `--bridge-field-bg` and the text fill in
  `--bridge-field-ink`), so a field filled from saved credentials looks
  like a typed one in Chrome, Edge and Firefox, light or dark. Password
  fields carry Ionic's `ion-input-password-toggle` (Login, Create
  account, the new-password stage of Reset password). The guest pages'
  white card is `.bridge-form-card` in a 420 px `.bridge-form-page`, its
  quiet links `.bridge-form-links`; `.bridge-check` gives a checkbox a
  44 px tap area. Used by Login, Create account, Reset password,
  Account's profile edit and `BanUserForm`; the claim, chat and alert
  inputs keep their own layout.

The play page during a board (#161) has the **turn clock line**
(`TurnClockLine`), the chat's orange unread badge in the header, the **claim
dialog**'s tiles with each number's result and score (`contractScore` in
`src/utils/result.ts`, `claimOutcome` in `claim.ts`), the pending claim
(since #186 a centred dialog, `ClaimAnswerDialog`), and a forced card's
**plays in 3** on the card itself.
Nothing in the app draws a card back yet.

The finished board and the lobby (#162) follow the same boards. A board's
result is a navy **hero card** (`BoardResultPanel`: who declared, the
contract with its result green or red, your score big in Barlow, and the
matchpoints against the other tables with an amber bar), the review's last
step; at the table it is the **result dialog** (`BoardResultDialog`, #174:
the same navy card, shorter, then the other tables with yours tinted
orange, one double dummy line, a ring emptying over the wait and **Deal
next board** orange); `SetResultsPanel` uses the same navy card. The
Tables page is the **lobby**: `YourTableHero` (navy, the set's tiles,
**Back to the table** orange), **Play now with robots** (the
`SetMinutesPicker` as a four-way segmented control, **Deal me in**) and
**Open a table for friends** side by side, the open tables as
`TableCard`s with filter chips and a mini compass, and an aside with
`YourForm` and `RecentBoards`; Home reuses the hero and the aside. The
lobby's white cards share `.lobby-card` (`daylight.css`); the navy
cards' own tokens (`--bridge-on-table-good`/`-bad`/`-accent`,
`--bridge-table-dim`, `--bridge-on-table-faint`, `--bridge-navy-tint`,
`--bridge-action-line`) have light and Midnight values.

The sheets and the wide table (#163) finish the redesign. Since #181 the
seats are only ever drawn on the table itself (an empty one a dashed
**Empty · West** button); `PlayerAvatar` heads the profile sheet and each
seat-a-player result. `AwayNotice` is the orange-tint banner, the chat
has a segmented **Table / Opponents** switch and bubbles (yours on the
right, navy-tinted), and the profile and seat-a-player sheets show the
plates' avatar. **The wide table**: on a screen 1100 px wide or more whose
column still has 560 px (`WIDE_TABLE_MIN_PX` in `src/utils/layout.ts`,
measured by `useElementWidth`, a `ResizeObserver`), the play page is
1040 px wide at most and `BridgeTable` gets `wide` (boards A/B's layout,
in Daylight's colours): partner top centre, the opponents' plates on the sides (upright
while the table itself is under 760 px, a container query) and, during
the auction, the auction and the bidding box in the table's centre,
which keeps the height it reached until the next board
(`useSteadyHeight`, which now follows an element a `v-if` brings). The
play is dummy and the trick, as before. Narrower, the table keeps the
layout it has on a tablet, the auction below it.

**The board's details in the table's corners** (#171, after #165's
top-left bar): nothing sits above or under the table any more, so the
table, the trick and the hand fit one screen. `BridgeTable` has four
corner slots, `top-left`, `top-right`, `bottom-left` and `bottom-right`,
laid over the navy panel's corners beside partner and you at every
width. They take no row height (absolutely placed; the table is a
container, and a corner is `--corner-w` wide at most: a share of the
table's width, 84 px on a phone up to 128 px, or 120–190 px on the wide
table), and partner's and your plates keep that width clear on both
sides, so nothing covers a plate, dummy or the trick and the table keeps
its height from card to card (#133). The play page fills them:
- top left, the vulnerability as `VulnerabilityLabel`'s `compact` pill
  (28 px, smaller words that may wrap, no dot), from the deal to the end
  of the board;
- top right, through the play, **5♣ by East** (`CallLabel` + the doubled
  mark, **4♥X by East**) over **NS 0 · EW 0** in Barlow, and **you play
  it** for a robot declarer's dummy, white on the navy and `aria-live`
  (empty during the auction);
- bottom left, the **Auction** button (`AuctionPopover`, from the first
  call to the end of the board: the auction grid in a pop-up that opens
  upward, `usePopover`, with Ask / Ask in the chat while the board is
  on). Once the auction is over it is the only place the auction shows;
- bottom right, **Claim** (`ClaimButton`): small, 36 px with a 44 px tap
  area; locked after a refused claim it reads **Claim · locked** in grey
  and a tap or a hover shows why in a pop-up, which is also its
  `aria-describedby`.

The board's place in its set is the header's second line,
**Board 2 of 4 · Set 3** (`AppHeader`'s `subtitle`, `setLabel` in
`src/utils/sets.ts`, **· set over** once it is), under the table's name;
the dealer is the **D** on their plate (`aria-label` "dealer"). The board
tile and the dealer pill are gone, and so is the board's number in the
database: `BridgeTable`'s centre line is `boardLabel` ("Board 2 of 4",
none outside a set, and none when it is left out). **No page shows
`board.number`** (#189): it is the board's place in the backend's global
sequence, which means nothing to a player. `boardInSetText(set, withOf)` in
`src/utils/sets.ts` words the board's place instead ("Board 2 of 4",
"Board 2" where the set is already named, plain "Board" without a set):
the review page's title and an unrecorded review's centre line (from the
review's `set`, bb#146), history entries, the export's first line, the
"copied" toast and the printout. Only the PBN export's `Board` tag (PBN
readers check it against the dealer and vulnerability) and the export's
file name keep the number. The Leave and Watch confirmations name the
board by its place in the set too ("Board 2 is in progress…").

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
| `/tables/:id` | redirects to `/tables/:id/play` (the table's old page, #181) | |
| `/tables/:id/play` | `TablePlayPage`, the game table: the table's one page | logged in, not banned |
| `/history` | `HistoryPage` | logged in |
| `/boards/:id/results` | `BoardResultsPage` | logged in |
| `/sets/:id` | `SetResultsPage` | logged in |
| `/playings/:id` | `PlayingReviewPage` | logged in |
| `/users/:id` | `UserProfilePage` | logged in |

Access is declared as route meta and enforced by one `router.beforeEach`:
`meta.requiresAuth` sends a guest to `/login`, `meta.guestOnly` sends a
logged-in user to `/account`, and `meta.notBanned` sends a banned user to
`/tables`, where the lobby is still readable but its actions are replaced
by the ban. Before deciding, the guard awaits
`authStore.loadSession()`, which calls `GET /api/user` **once per page
load**. That's what keeps you logged in across a browser reload: the
Sanctum session cookie is still valid, the SPA just has to ask.

A 401 that arrives *while a page is open* (the session expired after the
guard let you in) is handled by that page, which sends you to `/login`.

Adding a page = a view in `src/views/`, a route here (with its meta,
`findsSeat` if the page loads the Tables list or a table itself), and a
link in `AppMenu.vue`'s `links` only if it belongs in the menu.

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
`resetPassword` and `updateProfile`, plus the ban state (`ban`,
`isBanned`, `banNotice`, `applyBan`, `dismissBanNotice`, see
[Bans](#bans)). On login or session restore it has
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

## Bans

An admin can ban a user for 1–365 days with a reason (bb#77, backend
[`API.md` Bans](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md#bans)
and [`AUTH.md` Bans](https://github.com/bulbulica2/bridge_backend/blob/main/docs/AUTH.md#bans)).

- **The admin's side.** `canBan(viewer, target)` in `src/utils/ban.ts` says
  who gets **Ban**: an admin (`user.is_admin`), never on themselves, another
  admin or a robot. `BanUserForm.vue` (on the profile page and in the
  profile sheet) checks the days and reason with `banFormErrors` and calls
  the `users` store's `ban`, which posts `POST /users/{id}/ban` and puts the
  answer on the cached profile. An admin's `GET /users/{id}` carries the
  user's `ban` (and `bans`, the history); the profile page shows it with
  **Lift ban** (`liftBan`, `DELETE /users/{id}/ban`).
- **Thrown out at once.** The ban frees the user's seat and deletes their
  sessions on the server, then sends `UserBanned` on their own channel. The
  `game` store's user-channel listener hands it to `auth.applyBan`, which
  does the local half of a logout (no `POST /logout`: the session is
  already gone) and keeps the ban in `banNotice`. `BanNotice.vue` (in
  `App.vue`) goes to `/login` and shows why until the user taps OK.
- **Logged in while banned.** Logging in still works. `GET /api/user`
  carries `ban` (`{reason, until, banned_at}`), which the `auth` store
  exposes as `ban` / `isBanned`. Every page shows it through `BanBanner`;
  the guard keeps the user off the table and play pages; the Tables page
  shows the ban in place of **Create table**, disables the seat buttons and
  hides **Open**. History, profiles and the account work as usual. The ban
  ends by itself at `until`; the app notices on the next reload.
- **Anything else** a banned user tries gets a 403 whose message names the
  ban, which `errorMessage` shows as it comes.

## Stores

| Store | Holds | Main actions |
|---|---|---|
| `auth` | `user` (own record, with email, `is_admin` and `ban`), `ban` / `isBanned`, `banNotice` (a ban that just threw you out) | `login`, `register`, `logout`, `loadSession`, `updateProfile`, password reset, `applyBan`, `dismissBanNotice` |
| `tables` | `tables` (the list), `currentTable` (the one the game table shows), `myTable` (the seated table only), `kibitzingId` (the table you watch without a seat, #182), `kickedFrom`, `heldTableId` (your seat held after a Leave mid-set), `replacedFrom` (a set a robot took your seat over in) | `load`, `loadTable`, `openTable`, `create`, `join`, `leave`, `watch`, `stopWatching`, `resumeWatching` (a reload while watching), `removePlayer`, `seatUser`, `seatRobot`, `updateSettings` (a manager's time for a set and Allow kibitzers), `start`, `cancelStart`, `seatedTable`, `findSeat` (the router's lookup for **Your table**), `comeBack`, `stakeOf`, `dismissReplaced`, `applyUnseated` (`UnseatedFromTable`), `clear` (on logout); owns the table channel and the heartbeat, for a seat or a kibitzer's place |
| `game` | one table's game: `tableId`, `playing` (public state + your hand, and a robot declarer's hand when you are its dummy; a kibitzer's has neither, and `my_seat` null), the bid and card lists | `load`, `adopt`, `loadBids`, `loadCards`, `call` (with an optional alert), `askAboutCall`, `explainCall`, `play`, `claim`, `respondToClaim`, `withdrawClaim`, `next`, `phaseOf`; expands and applies `PlayingUpdated` (`receivePlayingUpdate`), applies `HandDealt` / `DeclarerHandShown` / `CallAlerted` / `CallQuestioned` / `AuctionAlertsShown`, hands `BoardMessageSent` to `chat` (`applyBoardMessage`); keeps the board's known alerts by call index (see [Alerts](#alerts)) |
| `chat` | the chat of the board the play page shows: `tableId`, `playingId`, `messages`, `open` (the panel on show), `keepOpen` (the player's choice beside the table, `bridge.chatOpen`), `about` (the call a message is about), `unread` | `follow` (the play page's board: read, emptied for a new board, read again once finished), `load`, `receive`, `send`, `setOpen`, `setKeepOpen`, `askAbout`, `clear`; see [Board chat](#board-chat) |
| `history` | finished boards per owner (`null` = you, a number = another user), results per board, double dummy tables per board, results per set, reviews per playing | `loadHistory`, `loadMore`, `loadResults`, `loadDoubleDummy`, `loadSet`, `loadReview` |
| `users` | public profiles by id (with `ban`/`bans` for an admin), players' stats by id (your own under your id) | `load`, `loadStats` (a number, or `null` for your own; read again every time a page shows them, since they change after every board; a 404 drops the cached ones), `ban`, `liftBan`, `clear` (on logout) |

**Player stats** (#131, backend
[`API.md`, `GET /users/{user}/stats`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md))
are worked out by the backend on every read (matchpoints move as more
tables finish a board), so the SPA never trusts a cached copy for long:
`PlayerStats.vue` shows the held one at once and reads them again each
time its page calls `load()`. It is a card with three lines (sets,
boards, sets left early) worded by `src/utils/stats.ts` (`rateText` for
the 0–1 rates, `averageText` for the 0–100 averages, "—" for the
backend's `null`), or one line (`compact`, the profile sheet). It has its
own skeleton and a quiet "Couldn't load the stats." with **Retry**, so a
failure never hides the rest of the page; a 401 goes to Login. Nobody
mounts it for a robot. There is no "forfeited" count: since bb#120 a set
is never forfeited, and a seat a robot took over counts as an abandon
(`leaving.abandoned_by_reason` says why).

A table changed by any answer or broadcast is written into both `tables`
and `currentTable`, so the list and the game table stay in step. `create`
also makes the new table the `currentTable`, so whichever page opens next
draws it straight away.

**Entering a table page costs one request at most** (#55). Locally the
backend answers one request at a time (see [RUNNING.md](RUNNING.md#local-speed)),
so every extra request on the way in delays the one the page needs:
- `openTable(id)` returns the copy the store already holds when it follows
  that table's channel (the user's own table, after Create, a join or a
  `load`), since `TableUpdated` keeps it current; any other table is read
  with `loadTable`. The game table uses it on entry; its
  Refresh (shown only while live updates are off) and pull-to-refresh
  still call `loadTable`.
- The play page waits only for `GET /tables/{id}/playing` (plus
  `GET /tables/{id}` when it doesn't hold the table, e.g. after a reload),
  and asks for the bid list after that. The bid list is normally already
  there: the router reads it, and the card list `PlayingUpdated` needs, in
  the background a second after the first logged-in page shows
  (`prefetchGameLists` in `src/router/index.ts`).
- Create (with or without robots, #132) and every seat taken on Tables
  go straight to the game table (#181) as soon as `POST /tables` (or the
  seat request) answers; it draws the table the store already holds
  (nothing is dealt until Start, #68). The
  service seats the creator South (`CREATOR_SEAT`; the backend's default
  is North), since the table is drawn from the viewer's seat at the
  bottom; robots take N, E and W.
- The Start that deals a board answers with the caller's game state.
  `tables.start` hands it to the game store (`adopt`) before applying the
  table, so the game table draws the board at once, with no second read.

## Services

| Service | Endpoints (see [backend `API.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md)) |
|---|---|
| `auth.ts` | `/sanctum/csrf-cookie`, `POST /login`, `/register`, `/logout`, `/forgot-password`, `/reset-password`, `GET` / `PATCH /api/user` |
| `tables.ts` | `GET` / `POST /tables`, `GET` / `PATCH /tables/{id}`, `POST` / `DELETE /tables/{id}/kibitzers` (`watchTable` / `unwatchTable`), `POST` / `DELETE /tables/{id}/seats`, `POST /tables/{id}/seats/users`, `POST /tables/{id}/seats/robots`, `DELETE /tables/{id}/seats/{user}`, `POST` / `DELETE /tables/{id}/start`, `POST /tables/{id}/heartbeat` |
| `game.ts` | `GET /tables/{id}/playing`, `GET /bids`, `GET /cards`, `POST /tables/{id}/calls`, `POST /tables/{id}/calls/{index}/question`, `PUT /tables/{id}/calls/{index}/explanation`, `POST /tables/{id}/cards`, `POST` / `DELETE /tables/{id}/claim`, `POST /tables/{id}/claim/response`, `POST /tables/{id}/playing/next` |
| `history.ts` | `GET /api/user/playings`, `GET /users/{id}/playings`, `GET /boards/{id}/results`, `GET /boards/{id}/double-dummy`, `GET /playings/{id}`, `GET /sets/{id}` |
| `users.ts` | `GET /users/{id}`, `GET /users?search=`, `POST` / `DELETE /users/{id}/ban`, `GET /users/{id}/stats` (`getUserStats`), `GET /api/user/stats` (`getMyStats`) |
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
- Manager controls (Remove, Seat a player, Add robot) show when the table
  payload's `can_manage` says so: the table's moderator or an admin
  (bb#74; the creator only while they are the moderator). Don't work it out
  from `moderated_by` or `created_by`; the backend decides. `TableUpdated`
  carries no `can_manage`, so the `tables` store keeps the last HTTP value
  and, when `moderated_by` changes, reads the table again for it (only
  `can_manage` is taken from that answer). Until an answer for the
  moderator it holds lands, every broadcast asks again, and a failed read
  is retried 3 times, 3 s apart (#117: left alone after three seats were
  freed in a row, no broadcast may follow). At the game table a manager
  finds Seat a player and Add robot in an empty seat's action sheet, and
  Remove in a player's profile sheet (#117, #181). Nothing at the
  table moves the others on: within a set the next board comes by itself,
  and **Deal next board** only votes for the player who presses it (#72,
  #98, #174).
- **Nothing is dealt before Start** (bb#73). Filling a table deals no
  board: it is dealt once the table is full and every person seated there
  has pressed Start (`POST /tables/{id}/start`; `DELETE` takes it back).
  Each seat carries `ready` in the table payload and in `TableUpdated`;
  robots are always ready. Nobody presses for anybody else, a manager
  included. Within a set, a finished board is followed by the next one by
  itself for the same four players (below); once one of them has left or
  been replaced, it is Start again.
  `src/utils/start.ts` holds the hints: `startNeeded()` (does the next
  board wait for Start, given the table and the game state held),
  `isReady()` and `startWaiting()` (the "Waiting for …" line);
  `StartBox.vue` draws it in the game table's centre (#181). `tables.start` and
  `cancelStart` skip applying an answer that a `TableUpdated` overtook
  while it was on its way, since two players pressing at once race.
- **The Start timer** (bb#142, [`API.md`, The Start timer](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md#the-start-timer)):
  once a full table waits for one person's Start and another person has
  pressed, that seat carries `start_deadline` (15 s on). `startClock()`
  and `startClockText()` in `utils/start.ts` count it down from the
  deadline in `StartBox` ("Press Start · 0:12", red under
  `START_URGENT_SECONDS` 5, or "Waiting for East · 0:12"). Past it the
  backend frees the seat: `UnseatedFromTable` on the user channel (below)
  or the `TableUpdated` freeing a seat that had the deadline, whichever
  comes first, toasts `START_TIMEOUT_NOTICE` and sends the page to
  `/tables`. A manager changing `set_minutes` takes every Start back: a
  `TableUpdated` that clears our own `ready` while `set_minutes` changed
  toasts `startRevokedText` ("The set time changed to 8 min: press Start
  again.").
- **Boards come in sets of four** (#73, bb#75). Start deals a set's first
  board; the other three are dealt by themselves (#98, bb#97): a finished
  board carries `next_board_at`, 15 s after it ended
  (`BRIDGE_NEXT_BOARD_SECONDS` on the backend, 15 since bb#140), and the
  backend's queue deals the next board then, with the usual
  `TableUpdated`, `PlayingUpdated` and `HandDealt`. The result and the
  deal stay on show until they arrive. The result dialog
  (`BoardResultDialog`, #174, see [The result dialog](#the-result-dialog))
  counts down from `next_board_at` (`useNow`, `secondsLeft`/`formatClock`
  from `utils/away.ts`), its ring a full circle at `NEXT_BOARD_SECONDS`
  (15, `utils/sets.ts`); its optional **Deal next board** (`game.next()`,
  `POST /tables/{id}/playing/next`), a vote, deals at once when every
  human at the table has pressed it (robots count as voted), so a player
  alone with robots skips the wait. If nothing has
  come 2 s after `next_board_at`, the play page rereads the game
  (`useStaleDeadline` → `game.load()`, once per deadline), as for a
  claim's deadline. `next_board_at` is null when no deal is coming: the
  set is over (then the vote is refused: everyone presses Start again
  for the next set), a seat is empty or the players changed (both Start). The game state
  and the table payload both carry `set` (`{id, number, board, of,
  finished, ended, replaced}`, typed `SetPosition` in
  `services/game.ts`; `replaced` lists whom a robot took a seat over
  from). A board finishing sends no `TableUpdated`, while a set broken
  off between boards comes only as one, so `currentSet()` in
  `src/utils/sets.ts` merges the two copies; `startNeeded()` says Start
  once it is `finished`. A set's results (each board with its
  matchpoints, the totals, the winner) come from `GET /sets/{id}`, read by
  `history.loadSet()` after every finished board and when the set ends;
  they give the set line under a board's result (its position, and the
  board's matchpoints once another table has played it: `playingExtras()`
  in `export.ts` finds this playing's row), and the set-over view
  (`SetResultsPanel`) under the table while it waits for the next set's
  Start (#191). Scores are never summed over
  a set (#100): its total is the matchpoints (`setTotals()`), shown as a
  percentage when there is anything to compare. `sets.ts` also words the
  winner from your side, whom a robot replaced and why, and groups the
  history by set
  (`groupBySet()`, with the owner's seat so a header can show
  `setPercent()` from a set already read).
- **Robots** are users with `is_robot: true` (on every public profile). They
  fill seats nobody else takes: `POST /tables` with `robots: true` seats
  three (the creator's Start then deals), and a manager adds one with
  `POST /tables/{id}/seats/robots`. They move by themselves on the backend,
  so the SPA only shows them (`RobotBadge`, "Thinking…" on their turn); each
  move arrives as a normal `PlayingUpdated`. How they bid and play:
  [backend `ROBOTS.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/ROBOTS.md).
- **A robot declarer hands the play to its human dummy** (#95, bb#94).
  Declarer and dummy stay who they are, but `acting_user_id` names the
  human dummy on declarer's turn and on dummy's, so `handToPlay()` in
  `utils/play.ts` returns `'declarer'` on declarer's turn (still read from
  `acting_user_id`, never from the robot flags). Declarer's remaining cards
  come as `declarer_hand`, only in that player's own state (`GET
  /tables/{id}/playing` and the answers to their moves) and pushed as
  `DeclarerHandShown` on their user channel when the auction ends; the
  `game` store carries it across `PlayingUpdated` less the cards played,
  like `hand`, until the play is over. `BridgeTable`'s `declarer` prop lays
  it across the top, where it is tapped on its turn. `playsForDeclarer()`
  tells the page this case: forced cards play themselves on both hands,
  and `claimSeatOf()` in `utils/claim.ts` makes declarer's seat the one the
  user claims and answers for ("You claim 4 of the remaining 5 tricks for
  North").
- When the last **person** leaves a table with robots, the table is kept
  but **unattended** (`unattended_since` set, no moderator): the robots
  wait, anyone may remove them, the first person to sit down manages it,
  and the backend deletes it after 10 minutes. `canRemove(table, user,
  viewer)` in `services/tables.ts` is the hint for who gets Remove (a
  manager, or anyone for a robot at an unattended table, never on your own
  seat); `whoIsLeft()` / `leaveNote()` in `utils/seatMove.ts` word what
  leaving does, and `removeCost()` / `confirmRemove()` there word and ask
  before a Remove (the game table's profile sheet, #121, #181).
  `removeBlocked(table, playing, user, viewer)` there (#190) says when a
  Remove `canRemove()` allows must wait: while the table's set is running
  (`runningSet()`), since the backend then refuses a kick with a 409
  (bb#147), except for an admin viewer and for a robot of an unattended
  table. The play page passes it to the profile sheet
  (`profileRemoveBlocked`), whose Remove is then greyed out
  (`is-locked`, `aria-disabled`) with `REMOVE_BLOCKED_TEXT` in a
  `usePopover` tooltip, and `removePlayer` refuses it without asking.
- **Admins' seats** (#77, bb#78): `is_admin` is public on every seat's
  user. Only another admin may remove an admin, never the moderator, so
  `canRemove()` gives an admin's seat Remove only when the viewer is an
  admin; a 403 still toasts the backend's message. No timer frees an
  admin's seat either, so the `tables` store never words their removal as
  the idle notice. `AdminBadge` marks admins wherever a seat is drawn, so
  players see an admin is at the table.
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
- `formErrors(e, fields, fallback)`: splits a failure for a form: the 422
  messages of the fields it shows go under them, anything else (a field
  it doesn't show, such as a reset link's `token`, another status, no
  answer) becomes the one message under the form.
- `logUnexpected(e)`: logs an error that didn't come from the backend (a
  bug, an alert that failed to open) to the console, since the toast's
  fallback text would otherwise hide it.

Leave and Remove keep their confirmation inside the same `try` as the
request (#121): whatever fails on the way, before any request too, is
toasted and logged, never lost. The pages close their own sheets and
modals before asking, so nothing of theirs stands over the alert.

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
  styles are global, in `src/theme/toasts.css`, next to the form fields'
  (`src/theme/forms.css`, see [Look: Daylight](#look-daylight)).
- **Forms with fields** (Login, Create account, Reset password, Account,
  the ban form) show a 422's message under its own field, the field's
  border red, and anything else under the form (`formErrors` below).

## Realtime

Live updates come from Laravel Reverb over the Pusher protocol, through
**one** Laravel Echo instance in `src/services/echo.ts`, created the first
time somebody needs it (a guest never opens a socket). Private channels are
signed through the shared axios instance, because Echo's own authorizer
doesn't send the XSRF header Sanctum wants.

| Channel | Who owns it | Events |
|---|---|---|
| `private-table.{id}` | `tables` store, following your seat (or the table you watch) | `TableUpdated` (the whole table, replaces it), `PlayingUpdated` (public game state in its compact shape, expanded by the `game` store) |
| `private-App.Models.User.{id}` | `game` store, from login to logout (started and stopped by `auth`) | `HandDealt` (your cards for a new board), `DeclarerHandShown` (a robot declarer's cards, for you, its dummy, to play), `CallAlerted` (an opponent alerted or explained a call; in the play, anyone's answer), `CallQuestioned` (an opponent asks what your call means), `AuctionAlertsShown` (partner's alerts, once the auction is over), `BoardMessageSent` (a chat message you may read: handed to the `chat` store), `UnseatedFromTable` (your seat, or your place as a kibitzer, taken away without you asking: handed to `tables.applyUnseated`), `UserBanned` (an admin banned you: handed to `auth.applyBan`) |

- The table channel only admits players seated there and its kibitzers,
  and the server never ends a subscription. So the `tables` store
  subscribes and unsubscribes itself as your seat changes: after create,
  join, move, leave and every load, and when you start or stop watching.
  A kibitzer gets nothing on the user channel but `UnseatedFromTable`
  (and `UserBanned`): no hand, no alert, no chat.
- A `TableUpdated` that no longer seats you (and wasn't your own request)
  means a manager removed you: a toast, the channel is dropped, and the
  game table goes back to `/tables` (to the set's results when a robot
  took your seat over, see Away mid-set below; the Start timer's own
  words when your seat had its `start_deadline`).
- `UnseatedFromTable` `{table_id, reason, kibitzing}` (bb#142) comes on
  your own channel when the backend frees your seat by itself. For
  `start_timeout`, if the store still follows that table (the
  `TableUpdated` hasn't come yet), `applyUnseated` drops your seat from
  its copies, leaves the channel, sets `kickedFrom` and toasts; the
  `TableUpdated` after it is then ignored. With `kibitzing: true` (the
  table allows kibitzers) you watch it instead: the channel stays,
  `kibitzingId` is set, the game is read again as a kibitzer's and the
  page stays ("You didn't press Start in time: you're watching the table
  now."). The `TableUpdated` freeing your timed seat says the same when it
  comes first (its `allow_kibitzers` decides). `kibitzers_off` (a manager
  turned kibitzers off while you watched) leaves the channel, toasts and
  sends the page back to `/tables`, as does a `TableUpdated` whose
  `allow_kibitzers` went false.
- Mid-set, `TableUpdated` also says who is away (`away_since` per seat),
  who is back, and a robot taking a seat over (the seat's new `user`,
  `set.replaced`).
- `PlayingUpdated` comes **compact**: every card and call is an id, so a
  whole finished board fits in a broadcast's 10 KB
  ([`API.md`, Event `PlayingUpdated`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md#event-playingupdated)).
  The `game` store's `receivePlayingUpdate` expands it with
  `expandPlaying()` (`src/utils/compact.ts`) from the `GET /cards` and
  `GET /bids` lists, back into the shape `GET /tables/{id}/playing`
  answers, and applies that as before. If the lists aren't loaded yet,
  events wait for them in arrival order; if they can't be loaded, or an
  event names an id they lack, the store reloads the state over HTTP
  instead (and the lists, for a stale id). HTTP answers, `HandDealt` and
  `DeclarerHandShown` are not compact.
- Alerts never come over the table channel: the bidder's partner mustn't
  see them during the auction, so `PlayingUpdated` carries none and each
  opponent gets `CallAlerted` on their own channel; partner gets them as
  `AuctionAlertsShown` once the auction is over (see [Alerts](#alerts)). Nor does the
  board chat: each message goes as `BoardMessageSent` to the user channel
  of every human who may read it (see [Board chat](#board-chat)).
- For the same 10 KB, a seat's `user` and the state's `players` carry no
  `description` (`PublicUser.description` is optional; the profile sheet
  shows it once `GET /users/{id}` is in), and the free text that gets
  broadcast is capped: `name` 50 and `username` 30 characters, a table's
  name 50, an alert's explanation 200, a chat message 500
  (`src/utils/limits.ts`), a ban's reason 500 (`MAX_BAN_REASON`).
  The forms cap their inputs at those lengths.
- After the socket reconnects, whatever was broadcast meanwhile is lost,
  so the watched table is fetched again once.
- The Tables **list** has no channel; it refreshes on enter and on
  pull-to-refresh. A board's and a set's results have no channel either
  and keep their Refresh button.

**Live or not** (#76). The game table shows a **Refresh**
button only while live updates are off. `echo.ts` writes what the socket
says into `src/services/liveStatus.ts`: Echo's connection status
(`connecting`, `connected`, `failed`, `disconnected`) and the table whose
channel Pusher confirmed (`subscription_succeeded`; a `subscription_error`
or leaving the channel clears it, and so does any connection status other
than `connected`, until Pusher resubscribes and confirms it again). A
table is **live** when the socket is connected *and* its channel is
subscribed (`isLive(id)`). `useLiveStatus(tableId)` turns that into
`offline`, true only after 5 s of not live (`OFFLINE_GRACE_MS`), so the
first connection or a short reconnect doesn't flash the button.
`OfflineRefresh.vue` is the note ("Live updates are off. Refresh to see
the latest.") and the button, under the page's content. Pull-to-refresh
stays whatever the status.
Known limit: the client can't see the backend's queue worker. With the
socket up but `queue:work` stopped no event arrives, yet the page counts
as live and hides the button; pull-to-refresh or a browser reload still
works ([RUNNING.md](RUNNING.md) says the worker must run).
- HTTP answers and broadcasts race. The `game` store drops a state that is
  behind the one it shows for the same board (fewer calls, fewer cards,
  earlier phase, fewer accepts of the same claim). A claim appearing or
  going away always counts as newer: a rejected or withdrawn claim leaves
  the cards as they were, so there is nothing else to order it by.
- A claim nobody finishes answering is rejected by the backend after 10 s
  (silence means no, bb#96): the claim carries its deadline as
  `expires_at`, and `PlayingUpdated` clears it when it runs out. The play
  page counts down from `expires_at` (never from when the claim arrived),
  and if the claim is still on screen 2 s after the deadline it rereads
  the game itself (`useStaleDeadline` → `game.load()`), since that update may
  have been lost (bb#95). One reread per deadline: a backend that still
  answers with the claim (its queue worker stopped) is left to the next
  update or a Refresh.
- Both players who must answer a claim see **Accept** / **Reject** the
  moment it arrives; neither waits for the other or for a turn, and one
  reject ends it. A claim that ends **without** being accepted (rejected,
  withdrawn or expired) locks claims for the whole table until the next
  card (bb#115): the state's `claim_locked` is true meanwhile (over HTTP
  and in the compact `PlayingUpdated`, which `expandPlaying` passes
  through), `canClaim()` says no, and the play page keeps the **Claim**
  button in the table's corner grey, reading **Claim · locked**
  (`aria-disabled`); a tap or a hover shows why in a small pop-up ("The
  claim was refused: play a card before claiming again."), which is also
  the button's `aria-describedby`. The next card's `PlayingUpdated` clears it by itself;
  a claim sent anyway gets the backend's 409, toasted with a reread like
  any other.

**Heartbeat.** The backend frees the seats of players who went quiet. While
the `tables` store watches a table it sends `POST /tables/{id}/heartbeat`
every 30 s, and stops when it stops watching (leave, kick, move, logout).
Outside a set it pauses while the browser tab is hidden (a kibitzer's
pauses mid-set too: there is no seat to be marked away from). A heartbeat
refused while watching (403: your place was dropped as idle; 404: the
table went) ends watching with a toast and sends the game table back to
`/tables`. **In the middle
of a set it keeps beating while hidden** (what bb#76 asks for): there,
three quiet minutes cost your side the set, and switching tabs while
partner thinks isn't leaving. When the tab shows again it beats at once
and refetches the table and the game; if the seat was lost in the
meantime, the user sees a "removed after being inactive" toast (an admin,
whom no timer frees, a plain "removed" one) and goes back to `/tables`.

**Away mid-set and the turn clock** (#74, #130, #150, bb#76, bb#120, bb#138, backend
[`API.md`, Away mid-set, and the turn clock](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md)).
The player the board waits for (`acting_user_id`: declarer on dummy's
turn) has **one minute** to call, play or act on a claim: the game state's
`turn_deadline` (null when no clock runs: between boards, a claim
pending, a robot or an admin on turn). Only a move resets it, never a
heartbeat. Past it, the backend's check (every 10 s) takes them out and a
**robot takes their seat** for the rest of the set; the board goes on and
their partner plays it out with the robot. Sets are never forfeited any
more. The SPA never keeps a clock of its own, it only reads the deadline
(`src/utils/turnClock.ts`, `useTurnClock`):
- **The play page's turn clock line** (`TurnClockLine`, #161): what the
  board waits for on the left ("Your call", "Your lead", "Your turn ·
  follow in ♦", "Waiting for East", "robot-1 is thinking…"), the clock
  on the right ("0:42", or "Set 0:42" when the time for the set ends
  first: `turnClockTime()`), and a 6 px bar under them emptying over the
  move's minute (`turnClockFraction()`). Orange on your move, red in the
  last 15 s (when your hand or the bidding box is ringed too); "Time
  is up…" at 0 until the backend's update lands. For an away player on
  turn (`turn_deadline_by: "away"`, the deadline being their seat's
  `replace_at`) it reads "Waiting for East (away)" with no clock or bar,
  since their seat's tag counts down (`awayOnTurn()`). It replaces the
  old status box: one line through the auction and the play, with room
  for two lines of text and the bar's track always there, so nothing
  moves; empty while a claim's dialog says it all. 2 s after the
  deadline with the same turn still shown, `useStaleDeadline` rereads
  the game once.
- **The ping**: while the tab is hidden and the board the game store
  holds waits for you, `useTurnTitle` (run by `App.vue`) sets the tab's
  title to "● Your turn (0:42) – Bridge4U" (`turnTitle`, from `APP_NAME`),
  and puts the page's own title back once the turn
  is taken or the tab shows. The **Your table** shortcut counts it down
  too.
- **Away**: the backend marks a player with no sign of life for a minute
  away (`away_since` on the seat, in every table payload and
  `TableUpdated`), and gives the seat its own clock, `replace_at`
  (`away_since` + 2 minutes, bb#138): it runs whoever's turn it is, every
  away seat's at once, so players who went together are replaced
  together. `BridgeTable` tags every away
  seat with it (`AwaySeatTag`: "away · 0:42", red in the last 15 s,
  "replacing…" at 0 until the `TableUpdated` with the robot lands; a
  plain "away" for an admin, who has no `replace_at`). The tags come from
  `useAwayTags(table, me)`, one `useNow` per page, so seats away together
  show the same time. `AwayNotice` then says it once, whoever and however
  many are away, with no countdown: "Away players are replaced by a robot
  when their clock runs out." (only admins away: "An admin is away: the
  table waits for them.").
- **Leave mid-set** answers 202 and *holds* the seat for 2 minutes: you
  stay seated, away, with your seat's `replace_at`. Away from the table
  (Tables, Home; at the table until the mark is taken back) `AwayNotice held` counts it down: "You're
  away from Friday club: a robot takes your seat in 0:42 unless you come
  back." The store then sets `heldTableId` and stops beating (a beat would
  bring you back). It also holds a seat it finds away on a fresh load (the
  tab was closed). Opening the game table calls `comeBack(id)`: it beats
  at once and refetches the table.
- **Back in time**: a `TableUpdated` (or refetch) that clears your own
  `away_since` toasts **Welcome back. The set goes on.** and reloads the
  board. If the backend marks you away while this client still beats (a
  lost beat), it beats at once.
- **A robot takes a seat over** (`set.replaced`: `{seat, user_id,
  reason}`, reason `turn_timeout`, `set_time`, `away`, `moved` or `kicked`): the game
  store toasts it once per seat, whichever of `TableUpdated` and
  `PlayingUpdated` brings it first ("East didn't play in time: a robot
  took their seat.", worded by `replacedText()` in `sets.ts`), several
  arriving in one update in a single toast ("South and West were away:
  robots took their seats.", `replacedTogetherText()`); the ones
  already there when a board is read aren't news. If it was *your* seat
  (not a move you made), the tables store sets `replacedFrom`, toasts
  "You didn't play in time: a robot took your seat. You may sit down at
  that table again once set 3 is over.", the table pages go to
  `/sets/:id`, and Home shows a card until dismissed. The set you are in
  the middle of is kept in `localStorage` (`bridge.setInProgress`), so a
  replacement that happened while the tab was closed is found on the next
  visit (`GET /sets/{id}` from `load()`).
- **The set clock** (#143, bb#131, backend
  [`API.md`, The set clock](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md)):
  each human also has a **time bank for the whole set**, like a chess
  clock: the table's `set_minutes` (8, 12, 16 or 20, 16 by default),
  picked in the create-table form (`POST /tables`) and changed by a
  manager between sets from the game table's gear (`PATCH /tables/{id}`, the
  tables store's `updateSettings`; a 409 mid-set is toasted). A set copies
  it as `set.minutes`; `set.time_left` holds each seat's seconds left as
  of the game state's `turn_started_at` (null for a robot or an admin).
  Only the bank of the player the board waits for runs, so
  `src/utils/setClock.ts` (`setBanks`, run by `useTurnClock` on the turn
  clock's tick) counts that one down from `turn_started_at` and leaves the
  others standing; `BridgeTable` shows each under the player's name,
  bold while it runs, red under a minute. `turn_deadline` is whichever
  runs out first, and `turn_deadline_by: "set"` makes the turn clock
  line's clock read "Set 0:42" (`turnClockText`'s "Your time for the set:
  0:42" stays for the header's Your table). Running out is a replacement like a turn timeout,
  with reason `set_time`: "East ran out of time for the set: a robot took
  their seat." / "You ran out of time for the set: …". The set's results
  show no time used (#191): `time_used` is typed but never drawn.
- **Leave and move confirmations** say what is at stake (`stakeOf(table)`
  → `setAtStake` in `utils/away.ts`, `held` when a Leave would hold the
  seat): a Leave "Your seat is kept for 2 minutes: come back before
  then, or a robot takes it for the rest of the set. Your time for the
  set keeps running when it's your turn.", a move "A robot
  takes your seat there for the rest of set 3, and you can't sit down
  there again until it is over." (`robotTakesOver()` in `seatMove.ts`). An
  admin, or anyone while an admin there is away, or a move that leaves
  only robots, just ends the set with no winner. Removing an away player
  mid-set hands their seat to a robot too (`removeCost()`).

Without Reverb and a queue worker running on the backend, none of this
arrives, and the app falls back to what each request returns.

## Kibitzers

A **kibitzer** (#182, backend
[`API.md`, Kibitzers](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md#kibitzers))
watches a table without a seat. A table allows it or not
(`allow_kibitzers`, set when created and changed by a manager between
sets); every table payload counts its kibitzers (`kibitzers`), which the
lobby's cards show with a **Watch** button.

- `tables.watch(id)` (`POST /tables/{id}/kibitzers`) sets `kibitzingId`
  and follows the table's channel and heartbeat as for a seat; watching
  another table gives the first one up. `stopWatching()` leaves the
  channel and then sends `DELETE /tables/{id}/kibitzers` (a 409 or 404 is
  the same outcome). Never from a seat: the backend refuses (409), so the
  lobby leaves your seat first, after asking (`confirmWatch` in
  `seatMove.ts`).
- Sitting down anywhere (a join, a create, a manager seating you) ends
  watching; `myTable` (and so **Your table**) only ever names the seated
  table.
- The game state a kibitzer reads is the public one: `my_seat`, `hand`
  and `declarer_hand` null, an alerted call's explanation null until the
  board is over. A reload doesn't remember `kibitzingId`: the play page
  calls `resumeWatching(id)` when `GET /tables/{id}/playing` answers and
  the table doesn't seat you.
- The play page's **watching mode** (`watching`: `kibitzingId` is this
  table and you don't sit there) draws the table from South's side with no
  hand, bidding box, Claim or chat, the result dialog without its vote,
  the header's **Watching** pill and **Stop watching**, and, between sets
  only, **Sit here** on an empty seat. `BridgeTable` with no `mySeat` lays
  dummy (and a claimer's cards) at the bottom seat too; `AuctionCallCell`
  with no seat says the explanation shows once the board is over.

## The game screen

`TablePlayPage` draws the game from the `game` store with these components:

| Component | Shows |
|---|---|
| `BridgeTable` | Daylight's navy panel (#160) with the four seats, rotated so **you are always at the bottom**, partner and you across its width, the opponents left and right. Each seat is a **plate**: avatar (two initials; a robot's icon, `avatar-robot`), name (opens the profile sheet), seat, the `AdminBadge`, and each human's time for the set as a pill (`banks`: grey idle, white while it runs, red under a minute, none for a robot or an admin). The seat on turn is ringed orange, an away seat's plate is red, a seat that pressed Start gets a green tick (`ready`, the play page's seats while Start is awaited), an empty seat is dashed ("Empty · North"; with `seatable` a button emitting `empty` with its seat, the game table's action sheet, #181); the plate's top edge is red/green for vulnerability. During the auction each seat's **last call** sits beside its plate as a chip (`calls`), an opponent's alerted one ringed amber with "!" (partner's never during the auction); whose turn (while there is a turn, every seat keeps a `turn-slot` line for the label, filled on the seat on turn only, so the table's height doesn't follow the turn round, #133); dummy's cards and a robot declarer's cards trumps first (`trump`, the contract's strain); a robot declarer's cards for its dummy (`declarer`); a claimer's cards; the finished deal (or, in a replay, what is left of it); a seat away mid-set dashed and tagged with its clock, **away · 0:42** (`away`: seat → `AwayTag`, drawn by `AwaySeatTag`); the dealer's plate has a **D** (`aria-label` "dealer"); the centre's first line while it shows the board is `boardLabel` (the play page's "Board 2 of 4", none outside a set, #165; left out, no such line: never the board's number, #189); with `wide` (#163) the wide screen's layout; four corner slots, `top-left`, `top-right`, `bottom-left`, `bottom-right` (#171), laid over the panel's corners at every width without taking a row's height, partner's and your plates keeping them clear; with `bottomRightRoom` (the review's double dummy grid, #180) your whole seat, hand included, keeps the larger bottom-right corner's width clear on both sides, and a table under 340 px gives that corner a row of its own under your seat |
| `VulnerabilityLabel` | who is vulnerable in words (`vulnerabilityText`), Daylight's pill: green **Nobody vulnerable**, else red with a dot, **Vul: E-W** for the other side, **Vulnerable: N-S (you)** for yours, **Both (you too)**; on the board results page (#151, #160), and `compact` (28 px, smaller words that may wrap, no dot) in the play page's and `BoardReview`'s top-left table corner (#171, #180) |
| `AuctionPopover` | the play page's **Auction** button in the table's bottom-left corner (#165, #171), from the first call to the end of the board: the `AuctionHistory` grid in a pop-up opening upward (`usePopover`: a mouse hovering opens it, a tap toggles it, a tap outside or Escape closes it), passing on `ask` / `explain` / `chat`, so Ask and Ask in the chat work there while the board is on |
| `ClaimButton` | the play page's **Claim** in the table's bottom-right corner (#171): a light 36 px button with a 44 px tap area, `claim` on a tap, `disabled` while a card or a claim is in flight; `locked` after a refused claim, it reads **Claim · locked** in grey (`aria-disabled`) and a tap or a hover opens a small pop-up above it with `CLAIM_LOCKED_TEXT` (`usePopover`), always in the DOM as the button's `aria-describedby` |
| `OfflineRefresh` | the note and **Refresh** at the bottom of the play page, only after live updates have been off for 5 s (`useLiveStatus`) |
| `AwayNotice` | Daylight's orange-tint banner (#163): one line while others are away mid-set, with no countdown (the seats' tags have it): "Away players are replaced by a robot when their clock runs out." (only admins away: the table waits for them); with `held`, your own held seat counting down (the play page, Tables, Home) |
| `AwaySeatTag` | an away seat's tag: "away · 0:42" to its `replace_at`, red in the last 15 s, "replacing…" at 0, a plain "away" for an admin (`BridgeTable`) |
| `HandView` + `PlayingCard` | your hand, always ♥ ♣ ♦ ♠ (or the suits in `order`). A card face is plain white with a thin border, a big rank over its suit in the top-left corner, no pips (#160). Playable cards become buttons, raised 14 px and ringed orange (amber on the navy table, `--playable-ring`), the rest dim; a forced card (`forcedId`) stands raised with a pulsing amber halo; each card shows at least 44 px of itself, the part a tap reaches, and the hand keeps the height it had as dealt while its cards go (`useSteadyHeight`); see [Card size](#card-size) |
| `BiddingBox` | on your turn during the auction, **two taps plus confirm** (#160): a level (1–7), then a strain (♣ ♦ ♥ ♠ NT), and only the full-width orange **Bid 2♥** under them sends the call; Pass, X and XX preview as **Pass** / **Double** / **Redouble** and need the confirm too. A level with no legal strain is disabled, and so is a strain too low at the picked level (`isLegalCall`, a hint). The pick resets on a new state and once a call settles (taken or refused). The **Alert** button alerts the next call and opens its explanation above the rows (both owned by the page) |
| `AuctionHistory` + `AuctionCallCell` + `CallLabel` | the calls so far, four columns rotated like the table, as chips (`CallLabel`'s `chip`: grey bids, green Pass, red X, blue XX); the vulnerable side's seat headers red, the call awaited a "?" ringed orange; an alerted call ringed amber with a "!", one asked about ringed blue with a "?", its explanation in a dark pop-up ("East alerted 2♦", `usePopover`), and with `live` an **Ask** and **Ask in the chat** on the opponents' calls and an **Answer** on yours when asked |
| `BoardChat` + `ChatMessageList` | the board chat (header **Chat**, see [Board chat](#board-chat)): the messages (sender and seat, who reads it, the time, the call it is about), then who it goes to (a segmented **Table / Opponents** switch, #163) and the line to write; the others' messages grey, yours on the right in the navy tint, a message to the table marked green; `ChatMessageList` alone is the review's chat |
| `ExplainCallSheet` | the bottom sheet for explaining one of your calls to the opponents (the answer to their question), up to 200 characters |
| `TrickArea` | the current trick in the table's centre (a finished trick stays 2 s), its cards as large as the setting and the centre's width allow; the winner is ringed amber but never drawn over a neighbour's rank and suit; given `trump`, the card winning so far is ringed while the trick is in progress (`winningSoFar` in `play.ts`), and `mySlot` draws a dashed place for your card. `spread` (the pop-up) parts the four cards and tags each with its seat or **You** |
| `LastTrickPopover` | the **Last trick** button (22 px tall; the play page keeps that row, `trick-peek`, under the trick's caption while the button is hidden, #133) under the trick in progress and its pop-up with the last trick's cards (a spread `TrickArea`, shifted sideways if centring it on the button would cross the screen's edge); a mouse opens it by hovering, a tap or key by clicking; a tap outside or Escape closes it (all of that is `usePopover`, shared with the auction's calls) |
| `DummyColumns` | dummy (or a claimer's or a finished hand) on a side seat, in `order` (bridge order ♠ ♥ ♦ ♣ by default; dummy trumps first); given `rows`, every suit column keeps room for that many cards; its text follows the card size (1.15rem ranks when Large, at most 1.1rem on a phone) |
| `ClaimSheet` | the claim dialog (#173: a centred `ion-modal`, class `claim-dialog`, at most 400 px wide and as tall as its content, no breakpoints; #161's tiles): the title "Claim" ("Claim for North" with `forSeat`) and an **X** (`aria-label="Close"`, 44 px) that emits `close`, as the backdrop and Escape do; then a 4-column grid of tiles from all the tricks left down to 0, each with the contract's result ("4♠ +1", "4♠ −2" in red) and the claimer's side's score ("+450"), from `claimOutcome()` (`state` + `seat`, the seat claimed for); all of them picked on opening (#137: a tap picks fewer; a trick finishing moves the default to the new maximum and keeps a hand-picked number while still possible); the one orange button reads **Claim 7 · 4♠ +1 · +450** / **Claim 5 · 4♠ −1 · −50**, and **Concede** for the 0 tile (sends 0); no other text: the countdown and the answers are `ClaimAnswerDialog`'s once the claim is out |
| `ClaimAnswerDialog` | a pending claim as a centred dialog over the table (#186, replacing #161's banner above it, so the table never moves): an `ion-modal`, class `claim-answer-dialog`, sized like `ClaimSheet`'s; the title "Claim" ("Claim for North" when you claimed for a robot declarer's seat, `actsFor`), the claim in one line (`claimText`: "South claims 9 of 9") with `claimOutcome()` from the claimer's side ("4♠ +1", red going down), a countdown ring like the result dialog's vote ring (`claimSecondsLeft` out of `CLAIM_SECONDS` 10, `role="timer"`, red under `CLAIM_URGENT_SECONDS` 4, ticked by `useNow`, none without `expires_at`), the claimer's cards in a single-row `HandView` in bridge order, the answerers (✓ / …, "you"), **Accept** (orange) / **Reject** or **Withdraw**, disabled while `busy` and once the time is up (a late tap can't earn a 409), "Waiting for West…" (`claimWaitingText`) for anyone without an answer to give. The claimer and an answerer still to answer can't dismiss it (`backdrop-dismiss` false, no X); anyone else has an **X** (`close`, as the backdrop and Escape). It holds the last claim's content until `did-dismiss`, so it never empties while closing. The play page opens it while a claim is pending, the view is shown and the review is closed, unless closed for that claim (`claimDismissed`, keyed by playing, cards played and claimer); `closeOverlays` closes it |
| `TurnClockLine` | the play page's turn clock line (#161): the words, the clock and the move's minute as a bar, orange for `mine`, red for `urgent`, blue for a `robot`; two lines of room and the bar's track always there, so its height never changes |
| `BoardResultPanel` | a finished board's result in the review (#162), as a navy hero card: who declared (`declaredText`: "You declared", "radu declared", "E-W declared"), the contract and its result ("2♣ +2", the suffix green, red when down), the tricks ("10 tricks · by claim"), your score big on the right (N-S's, tagged, for someone who didn't play it) and, once another table has played it, "Against the other tables 67 %" with an amber bar |
| `BoardResultDialog`, `ResultPill` | the play page's finished board (#174): a centred `ion-modal` (`result-dialog`, at most 420 px wide, as tall as its content, no breakpoints) with the result ("4♠ by South +1", "11 tricks · by claim", your side's score big), the matchpoints with a bar (`extras`), up to `OTHER_TABLES_MAX` (4) other tables (`otherTableRows`, yours tinted, **Compare with other tables** when there are more), one `doubleDummyLine` once `ready`, and the footer: a ring counting down `nextBoardAt`, **Deal next board** (`vote`; then "Waiting for bob…", the humans not in `ready`), and nothing else: no Leave or Review (#188, the header has both). `othersLoading` / `ddLoading` hold a skeleton line. With `setOver` (the set's number, after its last board) it shows that board's result like any other, with no countdown and no vote, and the line "Set 1 is over: its results are under the table." (#191). The X emits `close`, as the backdrop and Escape do (`did-dismiss` while still open); the content stays until it has finished closing. `ResultPill` is the "Result · 0:12" pill in the table's top-right corner that opens it again |
| `SetStrip` | a set's boards as tiles, B1–B4: your side's matchpoints on each board finished (`setStripTiles` in `utils/sets.ts`; "—" while no other table has played it), the board on now tinted ("now" until it is finished), light under a board's result or `onTable` on a navy card (Your table) |
| `DoubleDummyTable`, `LeadAnalysis` | a board's double dummy table (declarers N E S W down the side, ♣ ♦ ♥ ♠ NT across, tricks; `highlight` marks the contract played) on the results page, or a note while it is being solved; `compact` (#180) is the grid alone, small, on a white card, no title, note or legend, and nothing at all until it is `ready`: the review's bottom-right table corner; the opening leader's cards each with the tricks declarer makes after that lead, the lead made raised, the best ones ringed, then in words: see [Double dummy](#double-dummy) |
| `BoardReviewModal` | the table's finished boards reviewed and exported over the play page (**Last board**, #97): see [Reviewing at the table](#reviewing-at-the-table) |
| `SetResultsPanel` | once the set is over (also on `/sets/:id`), in the same navy card as a board's result: who won from your side, whom a robot replaced and why ("you" for the viewer it replaced), each board with your side's score and matchpoints (opening its review), and the set's matchpoints for your side (never a summed score); no time used (#191). The play page draws it under the table (`setResultsBelow`: `endedSet` and `showStart`), never above it |
| `SetMinutesPicker` | the time for a set, 8 / 12 / 16 / 20 minutes, as a four-way segmented control (an `ion-segment`, `v-model`, `label`): the lobby's **Play now with robots** and `TableSettingsDialog` |
| `TableSettingsDialog` | the game table's settings (#181): a small centred `ion-modal` (`settings-dialog`) with **Table settings**, an X, `SetMinutesPicker` (`minutes`, `busy`, `pickerKey` to put it back after a refusal) and a note that a change takes every Start back; `change` / `close` events, the page sends `tables.updateSettings()`. Opened by a manager's gear in the table's top-right corner while no set runs; the others read the time there ("16 min") |
| `StartBox` | the game table's centre before a board (#181), on the navy: **Ready to play?** / **Waiting for the others…**, what the board still waits for (`startWaiting`), the orange **Start** or **Cancel**, and while a seat has `start_deadline` the Start timer counting down (`startClock`: "Press Start · 0:12" orange, red under 5 s; "Waiting for East · 0:12"); `start` / `cancel` events. The seats and their ticks are the table's own plates |
| `PlayerAvatar` | two initials or a robot's icon in a circle: heads the profile sheet and each seat-a-player result |
| `RobotBadge` | the "robot" mark next to a robot's name (the profile sheet; at the table and on the plates the robot icon says it, in the lobby's compass the blue seat) |
| `AdminBadge` | the amber **ADMIN** tag next to an admin's name, on every plate at the table, the profile sheet and the User profile page |

The lobby (Tables and Home, #162) has its own pieces:

| Component | Shows |
|---|---|
| `YourTableHero` | the table you sit at (`useYourTable`, so nothing for a guest, a banned user or somebody not seated): its name, "Set 3 · Board 2 of 4 · you sit South with radu" (`yourTableLine` in `utils/lobby.ts`), the set's tiles (`SetStrip`, from `history.sets`, read with `loadSet` once a board of the set is finished, failures quiet), **Back to the table** (or **Come back** with the held seat's countdown) and an `actions` slot (the Tables page's **Leave**) |
| `TableCard` | one open table: its name (a link to its page, not for a banned user), a meta line (`tableMeta`: "16 min · set 2 · board 2/4", "left 3 min ago · closes in 7"), a pill (`tableStatus`), and a mini compass (`compassSeats`: you, robots, away players, players, empty seats as **Sit N**, `join` event; a name opens the profile, `player` event) |
| `YourForm`, `RecentBoards` | your stats in three figures (average board %, sets won / played, boards played; `users.loadStats(null)`) and your last three boards (`history.loadHistory(null)`, each opening its review), both read by the page through their exposed `load()` once the tables are in; failures are quiet |

The Tables page's filter chips (`TABLE_FILTERS`, `matchesFilter`,
`filterCounts` in `utils/lobby.ts`: All, Seat free, Playing, Robots only)
count over the list the page holds; it has no channel.

`BridgeTable`'s `thinking` prop is set when the player acting for `turn`
(`acting_user_id`, declarer on dummy's turn) is a robot: that seat reads
"Thinking…" instead of "To act", and the turn clock line under the table
says "robot-1 is thinking…". That line is rendered for the whole auction
and play (empty while a claim is pending) with room for two lines of text
over its bar, so the hand below never moves with what it says (#133; see
Away mid-set and the turn clock).

When you are declarer (or a robot declarer's dummy, playing both hands)
and the hand you play from (your own, dummy's or declarer's) has
exactly one legal card to follow with, `forcedCard()` in `play.ts` names it
(never on the lead) and the play page's `useForcedPlay` plays it after 3 s:
the card pulses with **plays in 3** on it (`HandView`'s `forcedSeconds`,
passed through `BridgeTable` for dummy's and declarer's cards) and the turn
clock line counts down too ("Your turn from dummy · ♥7 plays in 3").
Tapping it plays it at once. The countdown is tied to the state it started
in (board, trick, cards in the trick, turn, card), so any new card restarts
or drops it; it also stops while a card or claim is in flight, the claim
sheet or the board review is open, a claim is pending or another page is on top. A state the
timer already sent a card for is not counted down again, so a refused card
waits for a tap. The backend's `isBehind` guard and a 409 → reload remain
the backstop. A defender never gets this (`autoPlaysForced()` in
`play.ts`, #69): the pause before following is time to think, and a card
landing at once would tell the table they are out of the suit led. The
follow-suit hint still dims the other cards, and they tap the one left.

Pure logic lives in `src/utils/`: `cards.ts` (sorting, rank labels, seat
rotation, vulnerability: `isVulnerable`, `vulnerabilityLabel` and
`vulnerabilityText(vulnerable, mySeat)`, the words and colour of the
**Vulnerable: N-S (you)** label every board carries (#151); the suit orders: `HAND_SUITS` ♥ ♣ ♦ ♠ for your own
hand, `suitOrder(trump)` the same cycle rotated so trumps come first for
dummy and a robot declarer's cards, so red and black always alternate, and
`SUITS` ♠ ♥ ♦ ♣ for the claimer's hand, the deal and the exports, PBN
requiring it), `auction.ts` (call legality hints and labels),
`alerts.ts` (the alert book the `game` store keeps, and the alerts' wording),
`chat.ts` (who a message may go to by phase, merging messages, a message's
sender, time and call, the question toast, the export's chat lines),
`play.ts` (follow-suit hint, the forced card and who it plays itself for, whose hand you play, trick layout), `claim.ts`
(who may claim, `claimLocked` after a refused claim, who still has to answer,
the claim's wording, its countdown and how it ended: `claimText`,
`CLAIM_SECONDS`, `claimWaitingText`, `claimExpired`, `claimOffText`), `result.ts`
(the score from your side, and the table notation: `madeSuffix()` for "+2"
/ "=" / "−1", `doubledMark()` for X / XX, `resultSummary()` for "2♣ W +2 ·
−130" in toasts and the text export, `percentText()`), `seatMove.ts` (wording for leaving or moving by
game phase and by what is at stake in the set, and whether only robots
would be left), `away.ts` (who is away, each away seat's clock and tag, the
one-line note and your held seat's line, the clock formatting, what
leaving would put at stake),
`turnClock.ts` (the turn clock: whose, the seconds left, its wording, red
in the last 15 s, the tab title), `setClock.ts` (each seat's time for the
set at a moment, red under a minute),
`start.ts` (whether
the next board waits for Start, and who for), `sets.ts` (where the table is
in its set, the set's winner and matchpoints from your side, a robot
replacing a player, worded for the others and for them, the history
grouped by set), `review.ts` (a replay's table after N cards: hands left, the
trick shown, tricks won, the trick-by-trick steps; which boards the play page's review offers),
`turn.ts` (what the game waits for you to do, told in that review), `doubleDummy.ts` (the double dummy line, the leads in hand order, the best ones and the lead in words, the table for the exports), `export.ts` (a finished
board as text, PBN and JSON, and the pieces the printout uses). These are the
best-tested parts of the app. For the rules
themselves see [`GAME-RULES.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/GAME-RULES.md).

### Card size

The cards are large from the start (#136): many players are older, so the
table has to read well without zooming. `src/utils/cardSize.ts` holds the
setting, **Normal** (the old 48 × 68 px card), **Large** (96 × 136 px, the
default) or **Extra large** (120 × 170 px), picked on the Account page and
kept per browser in `localStorage` (`bridge.cardSize`, read and written in
try/catch like the pinned menu; a browser that never chose, or whose
storage refuses, gets Large).

One CSS variable, `--card-w`, sizes every card: `PlayingCard` draws its
height (17/12 of the width) and its corner (a rank 0.38 and a suit 0.32 of
the width, small enough that "10" fits the 44 px a hand leaves showing)
from it, and `HandView`,
`TrickArea` and `LeadAnalysis` set the same value on themselves so the
overlaps and the trick's cross agree with the cards. Its value,
`cardWidthCss`, is the setting's width capped by `--card-max` where the
room is short: on a phone (below 576 px) a hand's cards are 72 px (1.5 ×
the old card), and the trick's cards are at most half the table centre's
width (the centre is a size container, so `100cqi` is its width). On a
phone the side seats take only the room their plate (76 px, upright) and
any hand need, and the centre the rest. In a hand each card shows `--card-step`
of itself, never less than 44 px (`MIN_TARGET_PX`, the touch-target
minimum), so a 13-card hand wraps whole suits onto two or three rows;
`useSteadyHeight` then holds the hand at the height it had as dealt, so
it doesn't shrink under the page as cards go (#133).

Dummy's cards across the top of the table, and a robot declarer's for its
dummy, never wrap (#172): `BridgeTable` gives that `HandView` `singleRow`,
which measures the row's width (`useElementWidth`) and lays the cards out
from `src/utils/handRow.ts`. The usual step where 13 cards fit; else the
cards overlap more, down to their corner (0.42 of the card, "10" included,
never under 22 px), and if even that doesn't fit, the cards get smaller.
The card size is worked out for a full hand of four suits, so it stays the
same as the cards are played; the row always keeps room for cards to rise,
so it never changes height and the table never moves. A card that can be
tapped on dummy's turn keeps the usual step (at least 44 px) where the row
allows it. The play page, the review page and the review modal are 832 px
wide at most: 13 Extra large cards at their usual step (120 + 12 × 55.2 +
3 × 4 px between the suits) plus the table's padding; the play page's wide
table is 1040 px (#163). The printout is text and doesn't follow the
setting.

## Alerts

A player may **alert** their own call for the opponents (#101, bb#100;
[`API.md`, Alerts](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md#alerts)): the bidding box's
**Alert** button, which opens its explanation (up to `ALERT_MAX` = 200
characters in `utils/limits.ts`) above the bidding box's rows, goes out
with the next call (`game.call(bidId, alert)`), is cleared once the call is
taken, and stays if it is refused. The opponents see it; **partner
doesn't while the auction lasts** (that would be unauthorised information),
only once it is over (#135, bb#124), so:

- Your own state (`GET /tables/{id}/playing` and the action answers) has
  `alert` (`{explanation}` or null) and `question` (`{asked_by}`, an open
  question) on the opponents' calls and your own, null on partner's. From
  the end of the auction (phase `play`) every call's `alert` is there,
  partner's too; `question` stays null on partner's calls.
- `PlayingUpdated` carries neither. The `game` store keeps an **alert
  book** (`AlertBook` in `utils/alerts.ts`): the board's notes by call
  index, filled from every HTTP state (`takeNotes`) and from the user
  channel's `CallAlerted` / `CallQuestioned` / `AuctionAlertsShown`, and
  laid back on every state
  it shows (`withNotes`), so a known alert is never dropped. A new board
  starts a new book; news of an older board is ignored.
- When the auction ends, each human whose partner alerted something gets
  those alerts once as `AuctionAlertsShown` (the auction usually ends on a
  robot's call, so no HTTP answer of ours has them yet): the store's
  `applyAuctionAlertsShown` notes each into the book, only for the board it
  holds (another table's, an older or a newer board's is dropped; a later
  load reads them from the state).
- An opponent's call can be **asked** about until the board is over
  (`game.askAboutCall(index)`). A robot answers at once, in the answer; a
  human bidder gets `CallQuestioned` (a toast wherever they are, and on the
  play page the `ExplainCallSheet` opens by itself, once per question) and
  answers with `game.explainCall(index, text)`, which reaches both
  opponents as `CallAlerted` (all four humans during the play; the asker's
  side is told the answer in a toast, the bidder never their own).
- Robots alert their conventional calls themselves (Stayman, transfers,
  the strong 2♣ …), with their explanation.
- Once the board is finished every alert is public: the review
  (`GET /playings/{id}`) has every call's `alert`, so the review and the
  exports show them all.

`AuctionCallCell` draws each call: an alerted one ringed amber with a
"!" (never the red and green of vulnerability), one asked about ringed
blue with a "?"; hovering it with a mouse, or a tap, pops up a dark card
titled "East alerted 2♦" ("You alerted …", "Partner alerted …") with the
explanation as plain text, or "Alerted, no explanation given.". **Ask**
and **Ask in the chat** are only on the opponents' calls, never partner's.
During the auction the play page passes `bidding` to `AuctionHistory`, so
partner's calls show no alert even if one is held (`isPartner` in
`utils/alerts.ts`).

## Board chat

A chat per board (#102, bb#101;
[`API.md`, Chat](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md#chat)),
for everyone at the table (#115): partners who just met can greet each
other or say "sorry, my mistake" mid-board, and the opponents can ask what
a call means and the bidder answer in their own words. A message goes to
the **table** (all four) or to the **opponents** only, which **partner
never reads during the board**; there is no partner-only message:

- `src/services/chat.ts`: `getMessages(tableId)` (`GET
  /tables/{id}/messages`: the current board's `playing_id` and the messages
  you may read) and `sendMessage(tableId, {body, to, call_index})`
  (`POST`). `to` is `opponents` (you and your two opponents) or `table`
  (all four); both are allowed from the first deal on, the table first
  (`chatRecipients()` in `utils/chat.ts`; nothing before the first deal).
  A message about a call (Ask in the chat) is a question for the
  opponents: attaching a call switches `BoardChat` to Opponents. A body is 1–500 characters
  (`CHAT_MAX`), plain text.
- Live, each message comes as `BoardMessageSent` on the user channel of
  every human who may read it, yours included, never on the table channel.
  The `game` store's `applyBoardMessage` hands it to the `chat` store
  (`receive`), which keeps one board's messages by id (`mergeMessages`:
  HTTP and the channel may bring the same one); a newer board's message
  starts its chat, an older one's is dropped.
- The play page calls `chat.follow(tableId, playingId, phase)` whenever
  its board changes: entering a table reads the chat, a new board starts
  an empty one, and a board just **finished** is read once more, since
  partner's earlier messages are public then but aren't pushed again. A
  reconnect reads it again. Failed reads are quiet: the chat never keeps
  the board from showing.
- **Unread**: the others' messages with an id above the last one you saw
  while the panel was open (`bridge.chatSeen` in `localStorage`, try/catch;
  ids only grow, so one number covers every board). The header's **Chat**
  button shows them as a badge.
- **Asking**: an opponent's call pops up **Ask in the chat** next to
  **Ask what it means** (see [Alerts](#alerts)); it opens the chat with
  the call attached (`chat.askAbout(index)`, "About 2♥:"), and the message
  goes with its `call_index`. A robot bidder answers at once, in the chat.
  The Alerts endpoints write their question and answer into the chat too.
- **Notifications**: a message about one of your calls from an opponent,
  with the chat closed, is told in a toast at the top (off the bidding box
  and the hand); the same question asked with **Ask** (`CallQuestioned`)
  isn't told twice within 10 s.
- **Panel**: on a screen 1100 px wide or more (`useMediaQuery`) the chat
  sits in the content's `fixed` slot beside the table. The board's column
  reserves the chat's room as right padding, so it is centred in what the
  chat leaves; a CSS `clamp()` drops that padding once the content (menu
  pinned or not) is wide enough for the page-centred board to clear the
  chat, so opening the chat doesn't move it (#114): 832 + 2 × 328 px, or
  1040 + 2 × 328 px for the wide table (#163). The panel carries
  `data-right-edge`, which `usePopover` treats as the screen's right edge,
  so the auction's and the last trick's pop-ups stay off it. On
  a phone it is a bottom sheet (`ion-modal`, half height, the page usable
  above it and padded so the bidding box and the hand can scroll clear).
  A refused message (409, 422, 429) is told in a toast and keeps its text.
- **Open by default** (#153): beside the table the chat is on show from
  the first deal without pressing anything; the **Chat** button (or the
  panel's Close) collapses it, giving the table its room back, and brings
  it back. The choice is the `chat` store's `keepOpen`, kept in
  `localStorage` (`bridge.chatOpen`, `0`/`1`, try/catch; nothing stored
  reads as open), so the next board, page or reload shows it as the player
  left it; logging out keeps it. A phone's sheet would cover the cards, so
  there it starts closed every time and the button opens it as before
  (the choice beside the table isn't touched). **Ask in the chat** opens
  it either way. The play page decides what is on show (`chatWanted`:
  a board, the view active, then `keepOpen` or the sheet's own flag) and
  keeps the store's `open` in step with it, so `unread` still counts only
  while the chat isn't on show. Leaving the view hides it and coming back
  shows it as it was left; closing the page's overlays before a
  confirmation closes a phone's sheet, not the panel beside the table.
- **After the board**: the review's `messages` is the whole chat;
  `BoardReview` shows it under the stepper and the text export lists it
  (`chatLines`).

## The board review

`PlayingReviewPage` (`/playings/:id`) replays one finished playing from
`GET /playings/{id}`. Its body is `src/components/BoardReview.vue`, which
the play page's review modal shows too, built from the same components: `BridgeTable` (with the
hands left at the current step, `replay` set so they aren't labelled "as
dealt", and `reserve` = the deal, so each hand keeps the height it had as
dealt and the replay buttons below the table don't move as cards go),
`TrickArea`, `AuctionHistory`, `BoardResultPanel` and, under the
stepper, the board's whole chat (`ChatMessageList`). Like the play page
(#171) it puts the board's details in the table's corners (#180):
`VulnerabilityLabel` (`compact`) top left; the contract ("4♠X by South",
or "Passed out") and the tricks won at the step shown top right; and,
only before the opening lead and only once the analysis is `ready`, a
`compact` `DoubleDummyTable` bottom right (`BridgeTable`'s
`bottomRightRoom`). The table's centre holds the auction before the
opening lead and the trick from the first card on: both lie in one grid
cell, the one not shown `visibility: hidden` (`layer-off`, `aria-hidden`),
so the centre is as tall as the taller at every step; the grid in the
corner keeps its room the same way once hidden. A passed-out board keeps
its auction in the centre; an unrecorded one has neither. It keeps a
single number, how many cards have been played, and `reviewAt()` in
`src/utils/review.ts` works out everything else from the deal and the
tricks. The review is cached in the `history` store by playing id and never
refetched (a finished playing doesn't change); logout clears it with the
rest of the store. Playings finished before the backend kept their calls
and cards come back with an empty `auction`; the page then shows only the
deal and the result.

### Double dummy

Once a board is over, the backend's solver says what was possible on it
(#119, bb#114; [`GAME-RULES.md` §6, Double dummy](https://github.com/bulbulica2/bridge_backend/blob/main/docs/GAME-RULES.md)):
the **double dummy table**, how many tricks each declarer makes in each
strain with all four hands in view and best play on both sides, and, for
a playing's contract, the tricks declarer makes after each possible
**opening lead**. Both are solved in the backend's queue, so an answer can
be `pending` (or `unavailable` on a server without the solver); like a
board's results they are refused (403) until you have finished the board.

- `GET /boards/{id}/double-dummy` (`getDoubleDummy` in
  `src/services/history.ts`) is the table alone. The `history` store's
  `loadDoubleDummy` caches it by board id: a `ready` one is never asked
  for again (it depends on the deal only), a pending one is, and a 403/404
  drops it.
- The review (`GET /playings/{id}`) carries `double_dummy`: the table plus
  `leads` (null on a passed-out board). `loadReview` reads a review again
  if its analysis was still pending.
- **Pending** shows "Double dummy analysis is being worked out…" (on the
  results page; the review shows nothing until it is ready) and is read
  **once** more 5 s later (`DOUBLE_DUMMY_REREAD_MS`): `useDoubleDummy` for
  the table, `BoardReview` itself for a review. No polling loop; a refresh or
  another visit asks afresh.
- **Unavailable** means the server has no solver set up (the backend's
  `DDS_LIBRARY`, bb#125), for every board alike, so it reads "Double dummy
  analysis isn't set up on this server." (`DOUBLE_DUMMY_UNAVAILABLE`, #138)
  in the table, and is never read again.

Where it shows: `BoardReview` (the review page and the play page's review
modal) has a `compact` `DoubleDummyTable` in the table's bottom-right
corner before the opening lead, the contract played marked (nothing while
pending or unavailable, #180), and `LeadAnalysis` under the stepper; `BoardResultsPage` has the table above the results, your
contract marked; the play page, once a board is `finished`, reads the table
and the result dialog gives one line, "Double dummy: 4♠ by South makes 10",
once it is ready (a skeleton line until `useDoubleDummy`'s `settled`: ready,
failed, or still pending after the reread; nothing then). The text export adds the table and
the lead in words; the PBN export adds the optional `OptimumResultTable`
tag. Par isn't built by the backend, so none is shown.

### The result dialog

When a board ends, the play page shows its result in `BoardResultDialog`
(#174) instead of a stack of panels under the table, which keeps only the
deal (all four hands). Its rules, all in `TablePlayPage`:

- It is open (`resultOpen`) while the board is `finished` with a result,
  the view is active, the review modal is closed and the player hasn't
  closed it for this board (`resultDismissed`, set by the X, the backdrop
  or `closeOverlays` before a confirmation; cleared by the pill and on
  entering the view). A new board, `onIonViewWillLeave` or the review
  closes it.
- It opens without jumping: once the board's other tables are read
  (`history.loadResults` settled, or already held) and, after a set's last
  board, the set's results are in; or after `RESULT_WAIT_MS` (1 s) at
  most. Rows still being read hold a skeleton line.
- `resultVote` (`!showStart && !endedSet`): the countdown and **Deal next
  board** only while the same four go on to the set's next board. After
  the set's last board it shows that board's result with no countdown and
  no vote, plus "Set 1 is over: its results are under the table."
  (`setOver` = `endedSet.number`); `StartBox` is in the table's centre and
  `SetResultsPanel` under the table (`setResultsBelow`, #191) until the
  next set's first deal.
- It offers no way off the seat and no review (#188): leaving mid-set
  only marks a player away until a robot takes the seat, and the next
  board comes 15 s later, no time to step through one. The header's
  **Leave** and **Last board** are always there for both.

### Reviewing at the table

The play page reviews the table's finished boards without leaving it
(#97): **Last board** in its header (a finished board's result dialog
steps aside while the review is open) opens
`BoardReviewModal`, a centred
`ion-modal` with the same `BoardReview` and Export. It is a dialog, not a
sheet (#187): `--height` 90 % of the screen (`90dvh` where the browser has
`dvh`, else `90vh`, so 5 % stays free above and below, Ionic's full-screen
phone modal included), `--width` `min(100%, 880px)` (below 768 px
`calc(100% - 16px)`), 16 px corners and the result and claim dialogs'
shadow and backdrop; its header stays put and `ion-content` scrolls. Close,
the backdrop and Escape all end in `did-dismiss` → `close`. The game goes on
underneath: `PlayingUpdated` keeps arriving and the page keeps drawing it.
Which boards it offers is `reviewChoices()` in `src/utils/review.ts`:

- the running set's finished boards, from `GET /sets/{id}` (the page reads
  it after each finished board, and on entry mid-set), switched with a
  segment; it opens on the latest;
- plus the board the page just saw finish, until the set's read has it;
- on the next set's first board, the last board the page saw finish;
- after a reload with none of these, your latest history entry at this
  table (`GET /api/user/playings`, read only when a board may have been
  finished here: past the first board of the first set).

Each choice (`ReviewChoice`) carries the board's place in its set,
`position` (the set's `boards[].position`, the seen board's
`playing.set.board`, a history entry's `set.board`; null without a set,
#189): the segments read "Board 1", "Board 2" ("Board" without one) and
the title "Board 2 review" ("Board review"), never the board's number.
Each board loads through `history.loadReview()`, cached. When the game
waits for you (a call, a card, an answer to a claim or your Start:
`turnNotice()` in `src/utils/turn.ts`), a banner in the modal says so with
**To the table**, which closes it; nothing closes it by force. While it is
open the forced card doesn't play itself, and leaving the view closes it
with its export sheet and any printout.

### Exporting a board

The review's **Export** menu (an `ion-action-sheet`, #71, on the review
page and in the play page's review modal) turns the same payload into
files. `src/composables/useBoardExport.ts` holds the menu's buttons, the
copy, the downloads and printing for both. `src/utils/export.ts` holds pure functions of the
review: `boardText()` (the chat-friendly summary), `boardPbn()` (Portable
Bridge Notation 2.1 in export format: the 15 mandatory tags, then the
auction, play and `Score`; the play lines keep fixed seat columns starting
with the opening leader, and a claim leaves `-` for the unplayed cards and
ends the section with `*`; an alerted call carries a note reference, `2C =1=`,
with `[Note "1:Stayman"]` after the auction; once solved, the double dummy
table as an `OptimumResultTable` between the auction and the play) and
`boardJson()`. The text lists
the alerts and then the board's chat under the auction, ends with the
double dummy table and the opening lead in words once solved, and the printout marks the alerts. They reuse `cards.ts`,
`auction.ts` and `result.ts` for labels. The review doesn't say who claimed,
so a claim is told from declarer's side ("declarer took 2 of the last 5").
Matchpoints are added (and shown under the review's result) when the
board's results or its set's are already in the `history` store; nothing
fetches them for this. `src/utils/download.ts`
hands over a file (a Blob behind a temporary `download` link) and copies to
the clipboard.

**Print / Save as PDF** needs no library: the page (or modal) adds `printing-board` to
`<body>`, teleports a `BoardPrintout` there and calls `window.print()`;
`src/theme/print.css` hides everything else on paper and undoes Ionic's
fixed, clipped `<body>` so the printout can run onto a second page. The
printout is dropped on `afterprint`, when the page is left or the modal
closed; the modal and its sheet are hidden on paper too. The native
shells' WebViews ignore `download` links and `window.print()`, so there
the menu offers only Copy as text (`Capacitor.isNativePlatform()`).

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
  - `IonModal` only renders its content once presented, which jsdom never
    does: sheet tests stub it with `<div><slot /></div>`.
  - Ionic components fire kebab-case DOM events; tests dispatch them on
    the element with `tests/unit/ionEvents.ts` (`pickSegment`,
    `pullToRefresh`, `fireIonEvent`), never `vm.$emit('ionChange')`. See
    [Ionic events](#ionic-events).
  - **Coverage** (#91): every file under `src/` keeps 95 % of its lines
    covered, and the app as a whole 95 % of lines, statements and functions
    and 90 % of branches. `npm run test:coverage` (and CI's `unit` job)
    fails otherwise; see [`RUNNING.md`](RUNNING.md#code-coverage).
- **E2E** (`tests/e2e/`, Cypress): one guest-only smoke spec, `home.cy.ts`
  (`/` redirects to `/home`, the intro and its Log in / Create account
  buttons, Log in reaches `/login`). It stubs `GET /api/user` as 401, so
  it needs no backend; flows behind a login are #34.
- **CI** (`.github/workflows/ci.yml`, #87): lint, unit (with coverage),
  build and e2e as four parallel jobs on every PR to `main` and every push to `main`; see
  [`RUNNING.md`](RUNNING.md#continuous-integration).

See [`RUNNING.md`](RUNNING.md#tests) for the commands.
