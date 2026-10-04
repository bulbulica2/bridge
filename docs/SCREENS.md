# Screens

_Status as of branch `bulbulica2/60-claim-timeout`._

Every page of the SPA: what it shows, which store actions it calls, which
endpoints those reach, and which issues built it. `#N` is an issue in the
frontend repo ([bulbulica2/bridge](https://github.com/bulbulica2/bridge/issues));
`bb#N` is one in
[bulbulica2/bridge_backend](https://github.com/bulbulica2/bridge_backend/issues).
Endpoint shapes are in [backend `API.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md).

Every page also goes through the router guard, which calls
`GET /api/user` once per page load (see
[`ARCHITECTURE.md`](ARCHITECTURE.md#routes-and-the-guard)).

**Banned users** (#75, bb#77): while the logged-in user is banned, every
page's header shows **You are banned until 12 Oct 2026: <reason>**, and
the guard sends them from Table detail and Play to Tables. A ban that
lands while the app is open (`UserBanned`) ends the session at once: the
app goes to Login under a dialog with the reason and the end date, which
stays until **OK**. See [`ARCHITECTURE.md`](ARCHITECTURE.md#bans).

## Map

```
guest:      Home ─┬─ Login ─┬─ Create account
                  │         └─ Reset password ─▶ (email) ─▶ Choose new password ─▶ Login
                  └─ Create account

logged in:  Home ── Your table / Find a table
            Menu: Tables ─▶ Table detail ─▶ Play ─▶ Board results ⇄ Board review
                                 │            │      (set over: each board ─▶ Board review)
                                 └── player ──┴──▶ profile sheet ─▶ User profile ─▶ Board review
            Menu: My boards ─┬▶ Board review ⇄ Board results
                             └▶ Set results ─▶ Board review
            Header: Account (view / edit profile, log out)
```

## Home — `/home`

**Everyone.** Built by #3 (menu + home) and #25 (the real home page);
held seat and lost set by #74.

- **Guest**: an intro to the app with **Log in** and **Create account**.
- **Logged in**: a greeting and either a **Your table** card (the table you
  sit at, from the tables store's `myTable`, robots badged) or **Find a
  table**, plus a short how-to-play. After a Leave mid-set the card counts
  down ("Your seat is held. N-S lose the set in 2:41 unless you come
  back.") and its button reads **Come back** (it opens the game, which
  brings you back).
- **Set N lost by forfeit**: a card when your side lost a set because you
  were away too long, whether seen live or found on this visit (the set
  you were in the middle of is remembered in the browser), with **See the
  set** (`/sets/:id`) and **Dismiss**.

| Calls | Endpoint |
|---|---|
| `tables.load()` (logged in only) | `GET /tables`; then `GET /sets/{id}` once, if you were in the middle of a set at a table you no longer sit at |

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

Name (at most 50 characters), username (at most 30), email, password and
confirmation; each 422 error shows under its field. On success the user is logged in, lands on `/account`
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
the page into a form for name (at most 50 characters) and description (username and email are
read-only, with the plain arrow cursor rather than the text cursor, #66;
their text can still be selected and copied). **Log out** ends the session, closes every channel and goes to
`/login` with a toast.

| Calls | Endpoint |
|---|---|
| `auth.updateProfile()` | `GET /sanctum/csrf-cookie`, `PATCH /api/user` |
| `auth.logout()` | `GET /sanctum/csrf-cookie`, `POST /logout` |

Backend: `PATCH /api/user` came with bb#21 (`15-player-identity`).

## Tables — `/tables`

**Logged in**, menu item **Tables**. Built by #8; seat moves by #22;
profile sheet by #24; robots by #53; a seat opening the table by #67;
Start by #68; held seat by #74; banned users by #75.

The list of open tables, each with its four seats (robots carry a
**robot** badge). Tap an empty seat to sit (or **move here** at your own
table), a player's name to open their profile sheet, **Open** to look at a
table's page. Taking a seat takes you to the table as soon as the seat
request answers: to `/play` when the table the answer describes has a
board (`board_id` set: a finished board still on it, waiting for its seats
to be refilled), otherwise to its page, where you press **Start**. Sitting
down never deals a board. The seat's
spinner and the disabled seat buttons stay until the page has changed. A
cancelled move or a seat taken meanwhile (409, toasted) keeps you on the
list. A table only robots sit at (`unattended_since` set: its last
person left) reads **Robots only — sit down to take over**. **Create
table** opens a modal with an optional name and **Play with robots**, on
by default: robots take the other three seats and the page goes to the
new table's page, where your **Start** deals the first board (robots are
always ready; the modal closes as soon as the table exists, #55). Without
robots you stay on
the list and wait for players. Moving to another table asks first, because
leaving your seat can abandon a board there; in the middle of a set it
says **Your side loses the set now** (the backend forfeits it at once,
bb#76). After a Leave mid-set a notice at the top counts down to the
forfeit, with **Come back to …** (opens the game). No live updates on this
page: pull to refresh.

A **banned** user still sees the list, but the ban (reason and end date)
takes the place of **Create table**, every seat button is disabled and
there is no **Open**.

| Calls | Endpoint |
|---|---|
| `tables.load()` | `GET /tables` |
| `tables.create()` | `GET /sanctum/csrf-cookie`, `POST /tables` (`robots: true` by default) |
| `tables.join()` | `GET /sanctum/csrf-cookie`, `POST /tables/{id}/seats`, then `GET /tables` after a move |

Backend: bb#9 (create table, 3 active per creator), bb#12 (join a seat),
bb#25 (joining elsewhere moves you), bb#65 (robots), bb#73 (nothing is
dealt before Start), bb#77 (bans).

## Table detail — `/tables/:id`

**Logged in.** Built by #15; manager Remove by #16; live updates by #21;
moves by #22; profile sheet by #24; heartbeat by #31; Seat a player by #32;
robots by #53; Start by #68; the set line by #73; away and the forfeit by #74; admins' seats by #77. Reached from a table's **Open** button, by
taking a seat, or from **Create table** with robots.

The four seats as a compass (N/E/S/W), robots and admins badged. Sit, move or
**Leave** (confirmed; the last player leaving deletes the table and the
page goes back to `/tables`; if only robots are left the confirmation says
the table waits 10 minutes for somebody to take over). Managers
(`can_manage` in the payload: the moderator or an admin, bb#74) also get **Remove** on each other player, and on
an empty seat **Seat a player** (a search sheet over all users, robots
never listed) and **Add robot**. While only robots sit there
(`unattended_since`), a note says so and **anyone** gets **Remove** on the
robots; the first person to sit down becomes the moderator. An **admin**'s
seat has **Remove** only for another admin, never for the moderator
(bb#78); a 403 still toasts the backend's reason. Updates live
over the table channel; if you are removed, a toast and back to `/tables`.
While live updates work there is no Refresh button, only pull to refresh;
once they have been off for 5 s (Reverb down, the channel refused, or a
table you don't sit at, which has no channel) a note says **Live updates
are off. Refresh to see the latest.** above a **Refresh** button (#76).

**Away mid-set** (#74, bb#76). A player quiet for a minute in the middle
of a set is marked **away** on the compass, and a notice counts down from
their seat's `forfeit_at`: "East is away. E-W lose the set in 2:41 unless
they come back." It clears the moment they are back. **Leave** mid-set is
confirmed more sternly ("If you don't come back within 3 minutes, N-S lose
the set."): the backend holds the seat (202), the page goes to `/tables`
with a toast, and the store stops the heartbeat. Opening this page again
shows your held seat counting down, with **Come back** (no Leave or seat
buttons meanwhile). Not back in time, your side forfeits: the seat is
freed and you are sent to the set's results. Removing a player mid-set
says what it costs: a player who is away loses the set for their side,
one who is there only ends it with no winner.

**Start.** A board is dealt only once the table is full and every person
seated there has pressed **Start**; robots are always ready. While the
next board waits for it (no board yet, one abandoned when somebody left,
or a finished one whose four players aren't all still in their seats), a
seated player sees the Start box: **Start**, then **Waiting for the
others…** with **Cancel**, and a line saying what is missing ("Waiting for
a fourth player, and for East (bob) to press Start."). Each ready seat on
the compass is marked **✓ Ready**. Everyone presses their own, the manager
included. Between boards with the same four players nothing changes:
**Next board** on the play page, until the set of four is over (#73): then
it is everyone's Start again. While a set is going on, the table's info
says where it is: **Board 2 of 4 · Set 3**. When a board is dealt (`board_id` changes
to a new board, from the Start answer or a `TableUpdated`) a seated player
is taken to `/play`, the one whose Start dealt it included.

| Calls | Endpoint |
|---|---|
| `tables.openTable()` on entry, `tables.loadTable()` on pull to refresh or Refresh (offline only) | `GET /tables/{id}`, skipped on entry for the table you sit at (it is followed live) |
| `tables.join()` | `POST /tables/{id}/seats` |
| `tables.leave()` | `DELETE /tables/{id}/seats` (202 mid-set: the seat is held) |
| `tables.comeBack()` (Come back) | `POST /tables/{id}/heartbeat`, `GET /tables/{id}` |
| `tables.removePlayer()` | `DELETE /tables/{id}/seats/{user}` |
| `tables.seatUser()` (Seat a player sheet) | `GET /users?search=`, `POST /tables/{id}/seats/users` |
| `tables.seatRobot()` (Add robot) | `POST /tables/{id}/seats/robots` |
| `tables.start()`, `tables.cancelStart()` (Start box) | `POST /tables/{id}/start`, `DELETE /tables/{id}/start` |
| `game.load()` (when seated at a dealt table) | `GET /tables/{id}/playing` |
| heartbeat, while seated | `POST /tables/{id}/heartbeat` every 30 s |
| channel | `private-table.{id}`: `TableUpdated` |

Backend: bb#10 and bb#11 (seat others, kick or quit), bb#22
(Reverb), bb#25 (moves), bb#41 (idle seats, heartbeat), bb#44 (user
search), bb#45 (`can_manage`), bb#65 (robots, unattended tables), bb#73
(Start), bb#76 (away mid-set, the forfeit, Leave holds the seat), bb#78
(only an admin removes an admin; `is_admin` public on every seat).

## Play — `/tables/:id/play`

**Logged in, seated at that table** (403 otherwise). Built by #26 (game
table), #27 (bidding), #28 (card play), #29 (board result and next board),
#47 (claims), #96 (claims expire after 10 s, needs bb#96), #53 (robots), #57 (forced cards play themselves), #56 (last trick
pop-up), #68 (Start), #69 (forced cards for declarer only), #70 (readable last
trick), #72 (no next board "for everyone"), #73 (sets of four boards), #74 (away
and the forfeit), #95 (you play a robot partner's contract, needs bb#94);
**Compare** by #30. Entered from the detail page,
automatically when a board is dealt, or from **Open the game table** before
anyone has pressed Start. The header's **Table** button goes back to the
detail page.

Robots play by themselves: each of their calls, cards, claim answers and
"ready"s arrives as an ordinary `PlayingUpdated` about a second apart, so
nothing on this page drives them. On a robot's turn its seat reads
**Thinking…** instead of **To act** and the status line says
"robot-1 is thinking…". Robots are badged at their seat and in the
next-board box, and are ready for the next board at once, so your **Next
board** deals it. When your robot partner wins the contract, it stays
declarer and you stay dummy, but **you play the hand**: the contract bar
says "robot-1 declares 4♠ — you play the hand", declarer's cards (yours
alone to see) lie across the top from the end of the auction, and on its
turn you tap one of them ("Play: your turn from North's hand."), on yours
one of your own. Forced cards play themselves on both hands, and you claim
for declarer ("You claim 4 of the remaining 5 tricks for North"). The
defenders still play by themselves. How they bid and play is in
[backend `ROBOTS.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/ROBOTS.md).

Like the detail page, it shows **Refresh** (under a note, **Live updates
are off. Refresh to see the latest.**) only once live updates have been
off for 5 s; while they work, pull to refresh is the only manual reload
(#76).

Play goes in **sets of four boards** (#73): Start deals board 1, **Next
board** boards 2 to 4, and after the fourth the set is over. A line at the
top says where the table is: **Board 2 of 4 · Set 3** (**· set over** once
it is).

**Going away costs the set** (#74, bb#76). A player quiet for a minute
mid-set is tagged **away** at their seat, and a notice above the status
line counts down from their seat's `forfeit_at`: "East is away. E-W lose
the set in 2:41 unless they come back." (the last minute in red; with no
deadline, an admin away, "The table waits for them."). It clears the
moment they are back. Opening this page is coming back: a seat held after
a Leave, or marked away, is yours again, with a **Welcome back. The set
goes on.** toast and the board reloaded. Mid-set the heartbeat keeps going
while the tab is hidden, so switching tabs is not going away. Not back in
3 minutes, their side **forfeits**: a toast ("bob is gone: E-W lose set 2
by forfeit."), the board in progress is abandoned, and the set's results
show (below). If it was you, your seat is freed and the page goes to the
set's results. **Leave the table** mid-set (in the next-board box) is
confirmed more sternly, as on the detail page.

What it shows by phase:
- **waiting**: who's seated, and the same Start box as on the detail page
  (with each seat's ready mark), so opening the game table early is no dead
  end. The last Start deals the board right here.
- **auction**: your hand, the auction grid, and on your turn the bidding
  box. The contract (or "Passed out") is announced when the last call
  arrives.
- **play**: the contract bar with tricks won, the current trick in the
  centre, dummy's cards once the opening lead is made. From the second
  trick on, a **Last trick** button sits under the trick in progress:
  hovering it with a mouse pops up the last trick's four cards (each at its
  seat, turned like the table and tagged N/E/S/W or **You**, spread apart
  so every rank and suit shows, the winner ringed), and moving away hides
  it; on a phone a tap opens it and a tap outside (or Escape) closes it.
  The trick in progress stays in the centre meanwhile. The button is hidden
  for the 2 s the trick just won is still shown in the centre.
  You tap a card from your own hand, or from dummy's if you're declarer.
  As declarer, when only one card may follow suit (say dummy holds a
  single card in the suit led), it pulses and plays itself after 3 s, with
  the status line counting down ("Playing ♥7 in 3 s…"); tapping it plays
  it at once. Never on a lead, and never for a defender: their other cards
  are dimmed, but they tap the one left themselves. Opening the claim sheet or the board review, a claim or any new card on the
  table stops the countdown.
  Anyone but dummy can **Claim** some of the tricks left (or **Concede**
  them): the claim sheet has one button per number, 1 up to the tricks
  left, wrapping onto a second row; tapping one picks it and the send
  button then reads **Claim 4 tricks**, which sends it. Nothing is picked
  when the sheet opens. **Concede the rest** is its own button. The sheet
  says the others have 10 seconds to answer and that no answer counts as
  no. While a claim is pending, a banner says what is claimed, the
  claimer's cards lie face up at their seat, no card can be played, the
  players who still have to answer get **Accept** / **Reject** and the
  claimer **Withdraw**. The banner counts down to the claim's deadline:
  "Answer within 0:07" for those who still have to answer, "Waiting for
  East and West · 0:07" for everyone else, then "Time is up: no answer
  counts as no.", when its buttons disable. A reject or withdrawal toasts
  and play goes on; so does a claim nobody answered in time ("Nobody
  answered: the claim is off, play on."). If the backend's update hasn't
  come 2 s after the deadline, the page rereads the game. The last accept
  finishes the board.
- **finished**: the result from your side ("by claim" when a claim ended
  it), the set's running score so far ("Set 3 so far: 2 of 4 boards, you
  +450", read from the set), all four hands face up, **Compare with other tables**, **Review
  and export** (the board review at the table, below), and the next-board box (who's ready, and **Next board** to ask for
  yourself; nobody, a manager included, asks for the others, #72). If one of
  the four has left or been replaced since, the Start box takes the
  next-board box's place: the next board waits for every person's Start.
- **set over** (after the fourth board, or earlier when a side forfeits
  between boards): the set's results take the board result's place: who
  won, from your side ("You won the set.", "You lost the set by
  forfeit."), a forfeit's reason ("N-S forfeited, East didn't come back in
  time."), the four boards (number, contract and declarer, result, your
  side's score and matchpoint %, each opening its review) and the totals.
  Below it the Start box: everyone's Start opens the next set, **Board 1
  of 4 · Set 4**. A set that ended mid-board (a forfeit, or a player taken
  out of it) shows its results the same way once the table is back to
  waiting. They update live for all four: the set ending arrives with the
  last card's `PlayingUpdated` (or a forfeit's `TableUpdated`), and the
  page then reads the set again.

**Board review at the table** (#97): once a board of this table has been
finished, **Last board** (header) opens the board review in a full-height
sheet over the game, at any phase: the same replay and Export as
[Board review](#board-review--playingsid), without leaving the table. It
opens on the latest finished board, with a switcher (**Board 5**,
**Board 6** …) for the set's other finished boards; on a set's first board
it offers the previous set's last. The game goes on underneath; when it
waits for you ("Your turn to bid", "Your turn to play", "A claim waits for
your answer", "The next board waits for your Next", "Your Start: …") a
banner in the sheet says so with **To the table**. A forced card doesn't
play itself while it is open, and leaving the page closes it. It fits a
360 px screen.

| Calls | Endpoint |
|---|---|
| `game.load()` | `GET /tables/{id}/playing`, the only request the page waits for on entry |
| `game.loadBids()` | `GET /bids`, once per session, normally already read in the background after login; asked again only after the board is drawn |
| `game.call()` | `POST /tables/{id}/calls` |
| `game.play()` | `POST /tables/{id}/cards` |
| `game.claim()`, `game.respondToClaim()`, `game.withdrawClaim()` | `POST /tables/{id}/claim`, `POST /tables/{id}/claim/response`, `DELETE /tables/{id}/claim` |
| `game.next()` | `POST /tables/{id}/playing/next` |
| `tables.start()`, `tables.cancelStart()` | `POST /tables/{id}/start`, `DELETE /tables/{id}/start`; the Start that deals answers with the new board, so it is drawn without another read |
| `history.loadSet()` (after each finished board, when the set ends, and on entry mid-set) | `GET /sets/{id}` |
| `history.loadReview()` (the board review) | `GET /playings/{id}`, once per board per session |
| `history.loadHistory()` (on entry, only when no board to review is known but one may have been finished here) | `GET /api/user/playings` |
| `tables.openTable()` on entry, `tables.loadTable()` on pull to refresh, Refresh (offline only) or a 409 | `GET /tables/{id}`, skipped on entry when the store already follows the table (after Create, a join, or the detail page) |
| `tables.leave()` | `DELETE /tables/{id}/seats` (202 mid-set: the seat is held) |
| `tables.comeBack()` on entry | `POST /tables/{id}/heartbeat` and `GET /tables/{id}`, only when your seat was held or away |
| channels | `private-table.{id}`: `TableUpdated` (seats, away marks, a forfeit), `PlayingUpdated`; `private-App.Models.User.{me}`: `HandDealt`, `DeclarerHandShown` (a robot declarer's cards, when you play them) |

A 409 on a call, card, claim or next board toasts the backend's message and
reloads (after a set's last board, Next 409s: "The set is over: press Start
for a new one.", though the page shows Start instead by then). A `TableUpdated` whose `board_id` goes back to null mid-board means
a player left and the board was abandoned: toast, back to waiting (and to
Start once the table is full again).

Backend: bb#18 (deal a board), bb#73 (only after everyone's Start), bb#36 (game state),
bb#37 (auction), bb#56 (`GET /bids`), bb#38 (card play), bb#39 (scoring),
bb#40 (next board; bb#74 dropped its `everyone`), bb#43 (results), bb#59 (claims), bb#96 (claims expire),
bb#75 (sets of four boards), bb#76 (away mid-set and the forfeit).

## My boards — `/history`

**Logged in**, menu item **My boards**. Built by #30; grouped by set by #73.

Your finished boards, newest first (20 a page, paged in as you scroll),
grouped by the set they were dealt in. Each set's header reads **Set 3 ·
table 5**, how many of its boards are listed ("2 of 4 boards") and your
total over them, and opens the [set's results](#set-results--setsid). Under
it, each board: board number, contract and result, the seat you sat and
your partner, the table, and the score from your side. Tapping one opens
its [review](#board-review--playingsid). Boards played before sets existed
have no header.

| Calls | Endpoint |
|---|---|
| `history.loadHistory(null)`, `history.loadMore(null)` | `GET /api/user/playings?page=N` |

Backend: bb#43.

## Set results — `/sets/:id`

**Logged in, and only for a player of that set, or after you finished all
its boards** (403 otherwise). Built by #73. Reached from a set's header in My
boards (yours or another player's); not in the menu. The backend has
`GET /sets/{id}`, so the set has a page of its own rather than only showing
inline. It works the same after the table is gone, and while the set is
still going on (with the boards finished so far).

The table and when the set finished (or started), the two pairs, and the
same set view as on the play page: who won (from your side if you played
it, else N-S's), a forfeit, each board opening its review, and the totals. A
403 or 404 shows as a reason on the page.

| Calls | Endpoint |
|---|---|
| `history.loadSet()` | `GET /sets/{id}` |

Backend: bb#75.

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
menu. The play page shows the same review in a sheet (#97: `BoardReview`
and `useBoardExport` serve both). It works the same after the table is gone.

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

**Export** (header, #71) opens a menu to take the board out of the app:

- **Copy as text**: a plain summary for a chat: board, dealer and
  vulnerability, the players (robots marked "(robot)"), the four hands as
  dealt, the auction as a W N E S grid, contract, declarer and opening
  lead, one line per trick (leader, the four cards in the order played,
  winner), where a claim ended the play and how the tricks left went, the
  result and, if you opened the board's results this session, the
  matchpoints.
- **Download .txt**: the same text as a file.
- **Download .pbn**: the board in Portable Bridge Notation 2.1 (export
  format), for other bridge software: deal, auction, play (a claim ends it
  with `*`), contract, result and score.
- **Download .json**: the review exactly as the backend sent it, for
  debugging and for work on the robots.
- **Print / Save as PDF**: the browser's print dialog with a paper layout
  of the board (no app menu or header): the board line and result, the
  hands round a compass, the auction and a trick-by-trick table.

A board without a recorded auction and play exports the deal and the result
and says why nothing else is there. The files and printing need a browser:
in the native app the menu only offers Copy as text.

| Calls | Endpoint |
|---|---|
| `history.loadReview()` | `GET /playings/{id}` (once per session: a finished playing never changes) |

Backend: bb#60.

## User profile — `/users/:id`

**Logged in.** Built by #24; "Boards played" by #30; bans by #75. Reached from the
profile sheet (tap a seated player's name on Tables, Table detail or Play,
then **Full profile**; a robot's sheet has no such link).

A player's public profile (name, username with the **Admin** badge for an
admin (#77), description, never the email) and their finished boards, paged and grouped by set like My boards (each
opens its review).

**Admins** see more. A banned player's profile shows the ban in force
(until when, the reason, since when and by which admin) with **Lift ban**.
Any player but themselves, another admin or a robot has **Ban** (**Ban
again** while banned, which replaces the ban): a form with the number of
days (1–365, quick picks 1, 7 and 30) and a required reason (at most 500
characters), which the player is shown. Sending it toasts the backend's **User banned until …**;
the player is taken off their table (mid-set their side loses the set)
and logged out at once. The profile sheet has the same **Ban** form and
shows the ban, but lifting it is only here.

| Calls | Endpoint |
|---|---|
| `users.load()` | `GET /users/{id}` (an admin also gets `ban` and `bans`) |
| `history.loadHistory(id)`, `history.loadMore(id)` | `GET /users/{id}/playings?page=N` |
| `users.ban()` (admins) | `POST /users/{id}/ban` |
| `users.liftBan()` (admins) | `DELETE /users/{id}/ban` |

Backend: bb#21 (public profiles), bb#43 (other users' boards), bb#77 (bans).

## Shared pieces

| Piece | Where | Calls |
|---|---|---|
| `AppHeader` | every page | none (reads the auth store; `BanBanner` under it while you are banned) |
| `BanNotice` | the app shell | none (shows `auth.banNotice` after `UserBanned`, goes to Login) |
| `BanUserForm` | User profile, profile sheet (admins) | `users.ban()` → `POST /users/{id}/ban` |
| `AppMenu` | the app shell | none (reads the auth store) |
| `BoardReview` | Board review, Play (`BoardReviewModal`) | none (given the review from `history.loadReview`) |
| `PlayerProfileSheet` | Tables, Table detail, Play, Board review | `users.load()` → `GET /users/{id}`; **Ban** for admins (`BanUserForm`) |
| `RobotBadge` | Home, Tables, Table detail, Play (`BridgeTable`, `NextBoardBox`), profile sheet | none (`is_robot` on the user) |
| `AdminBadge` | Home, Tables, Table detail, Play (`BridgeTable`, `NextBoardBox`, `StartBox`), profile sheet, User profile | none (`is_admin` on the user, #77) |
| `SeatPlayerSheet` | Table detail (managers) | `useUserSearch` → `GET /users?search=` (300 ms debounce, 2 characters minimum) |
| `HistoryList` | My boards, User profile | `history.loadHistory` / `loadMore` |
| `SetResultsPanel` | Play (set over), Set results | none (given the set from `history.loadSet`) |
| `AwayNotice` | Play, Table detail (who is away, counting down); Table detail, Tables, Home (your held seat) | none (reads `away_since` / `forfeit_at` from the table) |
| route progress bar, boot bar, toasts | the app shell | none (#18) |
