# Screens

_Status as of branch `bulbulica2/44-remember-me`._

Every page of the SPA: what it shows, which store actions it calls, which
endpoints those reach, and which issues built it. `#N` is an issue in the
frontend repo ([bulbulica2/bridge](https://github.com/bulbulica2/bridge/issues));
`bb#N` is one in
[bulbulica2/bridge_backend](https://github.com/bulbulica2/bridge_backend/issues).
Endpoint shapes are in [backend `API.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md).

Every page also goes through the router guard, which calls
`GET /api/user` once per page load (see
[`ARCHITECTURE.md`](ARCHITECTURE.md#routes-and-the-guard)).

## Map

```
guest:      Home ─┬─ Login ─┬─ Create account
                  │         └─ Reset password ─▶ (email) ─▶ Choose new password ─▶ Login
                  └─ Create account

logged in:  Home ── Your table / Find a table
            Menu: Tables ─▶ Table detail ─▶ Play ─▶ Board results ⇄ Board review
                                 │            │
                                 └── player ──┴──▶ profile sheet ─▶ User profile ─▶ Board review
            Menu: My boards ─▶ Board review ⇄ Board results
            Header: Account (view / edit profile, log out)
```

## Home — `/home`

**Everyone.** Built by #3 (menu + home) and #25 (the real home page).

- **Guest**: an intro to the app with **Log in** and **Create account**.
- **Logged in**: a greeting and either a **Your table** card (the table you
  sit at, from the tables store's `myTable`, robots badged) or **Find a
  table**, plus a short how-to-play.

| Calls | Endpoint |
|---|---|
| `tables.load()` (logged in only) | `GET /tables` |

## Login — `/login`

**Guests only.** Built by #4.

Email, password and a **Remember me** checkbox (off by default, #65);
links to Create account and Reset password. On success it goes to
`/account` and shows a welcome toast.

Ticked, `POST /login` carries `remember: true` and the backend also sets
Laravel's long-lived remember cookie, so a reload after the session cookie
has expired (`SESSION_LIFETIME`, 120 minutes by default) still lands
logged in: the guard's `GET /api/user` logs the user back in from it.
Unticked, the login lasts as long as the session. Log out ends both.

| Calls | Endpoint |
|---|---|
| `auth.login()` | `GET /sanctum/csrf-cookie`, `POST /login`, `GET /api/user` |

Backend: the Breeze auth routes in `routes/auth.php` (present since the
first backend commit), described in [backend `AUTH.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/AUTH.md).

## Create account — `/create-account`

**Guests only.** Built by #5. Linked from Login and guest Home.

Name, username, email, password and confirmation; each 422 error shows
under its field. On success the user is logged in, lands on `/account`
and gets a welcome toast. There is no Remember me here: a new account is
logged in for the session only, and Remember me is on the Login page.

| Calls | Endpoint |
|---|---|
| `auth.register()` | `GET /sanctum/csrf-cookie`, `POST /register`, `GET /api/user` |

Backend: `routes/auth.php`. Email verification is not wired yet
(#33, bb#46).

## Reset password — `/reset-password` and `/password-reset/:token`

**Guests only.** Built by #6. One page, two stages:

1. `/reset-password` (from Login): enter your email; the page shows the
   backend's status message.
2. `/password-reset/:token?email=…` (the link in the email): choose a new
   password. A reset doesn't log you in, so it then goes to `/login`.

| Calls | Endpoint |
|---|---|
| `auth.requestPasswordReset()` | `GET /sanctum/csrf-cookie`, `POST /forgot-password` |
| `auth.resetPassword()` | `GET /sanctum/csrf-cookie`, `POST /reset-password` |

Backend: `routes/auth.php`, plus the link format in
`AppServiceProvider::boot` (`<FRONTEND_URL>/password-reset/<token>`).
Locally `MAIL_MAILER=log`, so the link lands in the backend's
`storage/logs/laravel.log` instead of an inbox.

## Account — `/account`

**Logged in.** Built by #7 (page, header button, logout) and #23 (edit
profile). Reached from the header's **Account** button.

Shows your name, username, email and description. **Edit profile** turns
the page into a form for name and description (username and email are
read-only). **Log out** ends the session, closes every channel and goes to
`/login` with a toast.

| Calls | Endpoint |
|---|---|
| `auth.updateProfile()` | `GET /sanctum/csrf-cookie`, `PATCH /api/user` |
| `auth.logout()` | `GET /sanctum/csrf-cookie`, `POST /logout` |

Backend: `PATCH /api/user` came with bb#21 (`15-player-identity`).

## Tables — `/tables`

**Logged in**, menu item **Tables**. Built by #8; seat moves by #22;
profile sheet by #24; robots by #53.

The list of open tables, each with its four seats (robots carry a
**robot** badge). Tap an empty seat to sit (or **move here** at your own
table), a player's name to open their profile sheet, **Open** for the
table's page. A table only robots sit at (`unattended_since` set: its last
person left) reads **Robots only — sit down to take over**. **Create
table** opens a modal with an optional name and **Play with robots**, on
by default: robots take the other three seats, the first board is dealt
at once and the page goes straight to `/play` (the modal closes as soon as
the table exists; #55). Without robots you stay on
the list and wait for players. Moving to another table asks first, because
leaving your seat can abandon a board there. No live updates on this page:
pull to refresh.

| Calls | Endpoint |
|---|---|
| `tables.load()` | `GET /tables` |
| `tables.create()` | `GET /sanctum/csrf-cookie`, `POST /tables` (`robots: true` by default) |
| `tables.join()` | `GET /sanctum/csrf-cookie`, `POST /tables/{id}/seats`, then `GET /tables` after a move |

Backend: bb#9 (create table, 3 active per creator), bb#12 (join a seat),
bb#25 (joining elsewhere moves you), bb#65 (robots).

## Table detail — `/tables/:id`

**Logged in.** Built by #15; manager Remove by #16; live updates by #21;
moves by #22; profile sheet by #24; heartbeat by #31; Seat a player by #32;
robots by #53. Reached from a table's **Open** button.

The four seats as a compass (N/E/S/W), robots badged. Sit, move or
**Leave** (confirmed; the last player leaving deletes the table and the
page goes back to `/tables`; if only robots are left the confirmation says
the table waits 10 minutes for somebody to take over). Managers
(`can_manage` in the payload) also get **Remove** on each player, and on
an empty seat **Seat a player** (a search sheet over all users, robots
never listed) and **Add robot**. While only robots sit there
(`unattended_since`), a note says so and **anyone** gets **Remove** on the
robots; the first person to sit down becomes the manager. Updates live
over the table channel; if you are removed, a toast and back to `/tables`.
When a board is dealt (`board_id` becomes non-null, e.g. a robot in the
fourth seat) a seated player is taken to `/play`.

| Calls | Endpoint |
|---|---|
| `tables.openTable()` on entry, `tables.loadTable()` on refresh | `GET /tables/{id}`, skipped on entry for the table you sit at (it is followed live) |
| `tables.join()` | `POST /tables/{id}/seats` |
| `tables.leave()` | `DELETE /tables/{id}/seats` |
| `tables.removePlayer()` | `DELETE /tables/{id}/seats/{user}` |
| `tables.seatUser()` (Seat a player sheet) | `GET /users?search=`, `POST /tables/{id}/seats/users` |
| `tables.seatRobot()` (Add robot) | `POST /tables/{id}/seats/robots` |
| `game.load()` (when seated at a dealt table) | `GET /tables/{id}/playing` |
| heartbeat, while seated | `POST /tables/{id}/heartbeat` every 30 s |
| channel | `private-table.{id}`: `TableUpdated` |

Backend: bb#10 and bb#11 (seat others, kick or quit), bb#22
(Reverb), bb#25 (moves), bb#41 (idle seats, heartbeat), bb#44 (user
search), bb#45 (`can_manage`), bb#65 (robots, unattended tables).

## Play — `/tables/:id/play`

**Logged in, seated at that table** (403 otherwise). Built by #26 (game
table), #27 (bidding), #28 (card play), #29 (board result and next board),
#47 (claims), #53 (robots), #57 (forced cards play themselves), #56 (last trick
pop-up); **Compare** by #30. Entered from the detail page, automatically when a
board is dealt, or straight from **Create table** with robots. The header's
**Table** button goes back to the detail page.

Robots play by themselves: each of their calls, cards, claim answers and
"ready"s arrives as an ordinary `PlayingUpdated` about a second apart, so
nothing on this page drives them. On a robot's turn its seat reads
**Thinking…** instead of **To act** and the status line says
"robot-1 is thinking…". Robots are badged at their seat and in the
next-board box, and are ready for the next board at once, so your **Next
board** deals it. How they bid and play is in
[backend `ROBOTS.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/ROBOTS.md).

What it shows by phase:
- **waiting**: who's seated; the board starts when the fourth player sits.
- **auction**: your hand, the auction grid, and on your turn the bidding
  box. The contract (or "Passed out") is announced when the last call
  arrives.
- **play**: the contract bar with tricks won, the current trick in the
  centre, dummy's cards once the opening lead is made. From the second
  trick on, a **Last trick** button sits under the trick in progress:
  hovering it with a mouse pops up the last trick's four cards (each at its
  seat, turned like the table, the winner ringed), and moving away hides
  it; on a phone a tap opens it and a tap outside (or Escape) closes it.
  The trick in progress stays in the centre meanwhile. The button is hidden
  for the 2 s the trick just won is still shown in the centre.
  You tap a card from your own hand, or from dummy's if you're declarer.
  When only one card may follow suit (say dummy holds a single card in
  the suit led), it pulses and plays itself after 3 s, with the status
  line counting down ("Playing ♥7 in 3 s…"); tapping it plays it at once.
  Never on a lead. Opening the claim sheet, a claim or any new card on the
  table stops the countdown.
  Anyone but dummy can **Claim** some of the tricks left (or **Concede**
  them): the claim sheet has one button per number, 1 up to the tricks
  left, wrapping onto a second row; tapping one picks it and the send
  button then reads **Claim 4 tricks**, which sends it. Nothing is picked
  when the sheet opens. **Concede the rest** is its own button. While a claim is pending, a banner says what is claimed, the
  claimer's cards lie face up at their seat, no card can be played, the
  players who still have to answer get **Accept** / **Reject** and the
  claimer **Withdraw**. A reject or withdrawal toasts and play goes on; the
  last accept finishes the board.
- **finished**: the result from your side ("by claim" when a claim ended
  it), the running score at this
  table, all four hands face up, **Compare with other tables**, and the
  next-board box (who's ready; a manager can deal for everyone).

| Calls | Endpoint |
|---|---|
| `game.load()` | `GET /tables/{id}/playing`, the only request the page waits for on entry |
| `game.loadBids()` | `GET /bids`, once per session, normally already read in the background after login; asked again only after the board is drawn |
| `game.call()` | `POST /tables/{id}/calls` |
| `game.play()` | `POST /tables/{id}/cards` |
| `game.claim()`, `game.respondToClaim()`, `game.withdrawClaim()` | `POST /tables/{id}/claim`, `POST /tables/{id}/claim/response`, `DELETE /tables/{id}/claim` |
| `game.next()` | `POST /tables/{id}/playing/next` |
| `game.loadSessionScore()` | `GET /api/user/playings` |
| `tables.openTable()` on entry, `tables.loadTable()` on Refresh or a 409 | `GET /tables/{id}`, skipped on entry when the store already follows the table (after Create, a join, or the detail page) |
| `tables.leave()` | `DELETE /tables/{id}/seats` |
| channels | `private-table.{id}`: `TableUpdated`, `PlayingUpdated`; `private-App.Models.User.{me}`: `HandDealt` |

A 409 on a call, card, claim or next board toasts the backend's message and
reloads. A `TableUpdated` whose `board_id` goes back to null mid-board means
a player left and the board was abandoned: toast, back to waiting.

Backend: bb#18 (deal a board when a table fills), bb#36 (game state),
bb#37 (auction), bb#56 (`GET /bids`), bb#38 (card play), bb#39 (scoring),
bb#40 (next board), bb#43 (running score, results), bb#59 (claims).

## My boards — `/history`

**Logged in**, menu item **My boards**. Built by #30.

Your finished boards, newest first (20 a page, paged in as you scroll):
board number, contract and result, the seat you sat and your partner, the
table, and the score from your side. Tapping one opens its
[review](#board-review--playingsid).

| Calls | Endpoint |
|---|---|
| `history.loadHistory(null)`, `history.loadMore(null)` | `GET /api/user/playings?page=N` |

Backend: bb#43.

## Board results — `/boards/:id/results`

**Logged in, and only after you finished that board** (403 otherwise).
Built by #30. Reached from a board's review or **Compare with other tables**.

The same board at every table, best N-S score first, each with its
contract, declarer, score and matchpoints. The tables you sat at are
highlighted with your side's matchpoint percentage. Tapping a row opens
that table's [review](#board-review--playingsid). A 403 or 404 shows as a
reason on the page, not as an error.

| Calls | Endpoint |
|---|---|
| `history.loadResults()` | `GET /boards/{id}/results` |

Backend: bb#43.

## Board review — `/playings/:id`

**Logged in, and only after you finished that board** (403 otherwise; 404
for an unknown or unfinished playing). Built by #48. Reached from a history
entry (yours or another player's) or a row of Board results; not in the
menu. It works the same after the table is gone.

One table's playing of a board, replayed: the contract and the tricks each
side has won so far, the four hands face up (you at the bottom if you
played it, otherwise South), the trick in the middle, and the auction
below. A stepper moves card by card or a trick at a time (start, previous
trick, previous card, next card, next trick, end); the hands lose their
cards as they go but keep the room they took as dealt, so the buttons stay
in the same place at every step (#59). The line saying where you are
(trick and card) sits under the buttons. The result panel shows once the
replay reaches the end, and **Results** (header) / **Results at every
table** go back to the board's results. A passed-out board has only its
auction, the deal and the result; a board that ended by a claim stops where
the claim was made.

Boards finished before the backend kept their calls and cards (before
bb#60) say "The auction and play of this board weren't recorded" and show
only the deal and the result.

| Calls | Endpoint |
|---|---|
| `history.loadReview()` | `GET /playings/{id}` (once per session: a finished playing never changes) |

Backend: bb#60.

## User profile — `/users/:id`

**Logged in.** Built by #24; "Boards played" by #30. Reached from the
profile sheet (tap a seated player's name on Tables, Table detail or Play,
then **Full profile**; a robot's sheet has no such link).

A player's public profile (name, username, description, never the email)
and their finished boards, paged like My boards (each opens its review).

| Calls | Endpoint |
|---|---|
| `users.load()` | `GET /users/{id}` |
| `history.loadHistory(id)`, `history.loadMore(id)` | `GET /users/{id}/playings?page=N` |

Backend: bb#21 (public profiles), bb#43 (other users' boards).

## Shared pieces

| Piece | Where | Calls |
|---|---|---|
| `AppHeader` | every page | none (reads the auth store) |
| `AppMenu` | the app shell | none (reads the auth store) |
| `PlayerProfileSheet` | Tables, Table detail, Play, Board review | `users.load()` → `GET /users/{id}` |
| `RobotBadge` | Home, Tables, Table detail, Play (`BridgeTable`, `NextBoardBox`), profile sheet | none (`is_robot` on the user) |
| `SeatPlayerSheet` | Table detail (managers) | `useUserSearch` → `GET /users?search=` (300 ms debounce, 2 characters minimum) |
| `HistoryList` | My boards, User profile | `history.loadHistory` / `loadMore` |
| route progress bar, boot bar, toasts | the app shell | none (#18) |
