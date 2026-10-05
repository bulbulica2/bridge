# Screens

_Status as of branch `bulbulica2/76-turn-timer`._

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
            Header: Your table (while seated: Play, or Table detail before a board)
            Header: Account (view / edit profile, log out)
```

**Menu and Your table** (#99): from 768 px up the side menu stays open
beside every page; the header's menu button collapses it and brings it
back, and the browser remembers which. On a phone it slides in as before.
While the user holds a seat, every page's header has a **Your table**
button (the table's name and a dot: green for a board in progress, blue
for your turn, amber for an away seat) and the menu lists **Your table**
first with the same status as a badge ("Your turn · 0:42" while your
turn clock runs, #130); the menu is 320 px wide so the
entry stays on one row and the same size whatever the badge says (#134),
a long table name ending in "…". One tap goes to Play once a board is dealt,
else to Table detail. On pages that load no table (My boards, a profile,
a review…) the router asks `GET /tables` once to find the seat. See
[`ARCHITECTURE.md`](ARCHITECTURE.md#app-shell).

## Home — `/home`

**Everyone.** Built by #3 (menu + home) and #25 (the real home page);
held seat by #74; a robot taking your seat by #130.

- **Guest**: an intro to the app with **Log in** and **Create account**.
- **Logged in**: a greeting and either a **Your table** card (the table you
  sit at, from the tables store's `myTable`, robots badged) or **Find a
  table**, plus a short how-to-play. After a Leave mid-set the card says
  so ("Your seat is held. If you aren't back to play within 1:00 of your
  turn, a robot takes it for the rest of the set.") and its button reads
  **Come back** (it opens the game, which brings you back).
- **Set N: a robot took your seat**: a card when your turn clock ran out
  (or you were removed while away) and a robot took your seat for the rest
  of the set, whether seen live or found on this visit (the set you were
  in the middle of is remembered in the browser): "You didn't play in
  time: a robot took your seat. You may sit down at that table again once
  set 3 is over.", with **See the set** (`/sets/:id`) and **Dismiss**.

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
their text can still be selected and copied). **Card size** (#136) picks
how big the cards are drawn at the table, **Normal**, **Large** (the
default) or **Extra large**, with two sample cards showing the pick at
once; it is kept in this browser (`bridge.cardSize`), not on the account.
**Log out** ends the session, closes every channel and goes to
`/login` with a toast.

| Calls | Endpoint |
|---|---|
| `auth.updateProfile()` | `GET /sanctum/csrf-cookie`, `PATCH /api/user` |
| `auth.logout()` | `GET /sanctum/csrf-cookie`, `POST /logout` |

Backend: `PATCH /api/user` came with bb#21 (`15-player-identity`).

## Tables — `/tables`

**Logged in**, menu item **Tables**. Built by #8; seat moves by #22;
profile sheet by #24; robots by #53; a seat opening the table by #67;
Start by #68; held seat by #74; banned users by #75; your seat with Leave
by #121.

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
by default. You sit **South** at the new table, and the page goes to its
page as soon as it exists (the modal closes first, #55; #132): with robots
they take North, East and West and your **Start** deals the first board
(robots are always ready); without them the other three seats are free
for players to take, or for you to fill with **Seat a player** / **Add
robot**. Moving to another table asks first, because
leaving your seat can abandon a board there; in the middle of a set it
says a robot takes your seat there for the rest of the set and you can't
sit down there again until it is over (bb#120). After a Leave mid-set a
notice at the top says your seat is held (and that a robot takes it if
you aren't back to play within a minute of your turn, #130), with
**Come back to …** (opens the game). Otherwise, while you sit
somewhere, a line at the top says so: **You sit at Club · Leave** (the
table's name links to its page). Going to another page never gets you up
from a table, so this is the way to leave it without opening it: the same
confirmation as on the table's pages, then a toast. No live updates on
this page: pull to refresh.

A **banned** user still sees the list, but the ban (reason and end date)
takes the place of **Create table**, every seat button is disabled and
there is no **Open**.

| Calls | Endpoint |
|---|---|
| `tables.load()` | `GET /tables` |
| `tables.create()` | `GET /sanctum/csrf-cookie`, `POST /tables` (`seat: 'S'`, `robots: true` by default) |
| `tables.join()` | `GET /sanctum/csrf-cookie`, `POST /tables/{id}/seats`, then `GET /tables` after a move |
| `tables.leave()` (You sit at … · Leave) | `DELETE /tables/{id}/seats` (202 mid-set: the seat is held) |

Backend: bb#9 (create table, 3 active per creator), bb#12 (join a seat),
bb#25 (joining elsewhere moves you), bb#65 (robots), bb#73 (nothing is
dealt before Start), bb#77 (bans).

## Table detail — `/tables/:id`

**Logged in.** Built by #15; manager Remove by #16; live updates by #21;
moves by #22; profile sheet by #24; heartbeat by #31; Seat a player by #32;
robots by #53; Start by #68; the set line by #73; away mid-set by #74 (a robot takes the seat instead of a forfeit by #130); admins' seats by #77; Leave and Remove after a set by #121. Reached from a table's **Open** button, by
taking a seat, or from **Create table**.

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

**Away mid-set** (#74, bb#76; #130, bb#120). A player quiet for a minute
in the middle of a set is marked **away** on the compass, with a plain
line, no countdown: "East is away. If they don't play within 1:00 of
their turn, a robot takes their seat." (an admin: "The table waits for
them."). It clears the moment they are back. **Leave** mid-set is
confirmed more sternly ("If you aren't back to play within 60 seconds of
your turn, a robot takes your seat for the rest of the set."): the
backend holds the seat (202), the page goes to `/tables` with a toast,
and the store stops the heartbeat. Opening this page again shows your
held seat, with **Come back** (no Leave or seat buttons meanwhile). Not
back in time, a robot takes your seat for the rest of the set and you are
sent to the set's results. Removing a player mid-set says what it costs:
a robot takes the seat of a player who is away, while removing one who is
there ends the set with no winner.

**After a set** (#121). Once the set's last board is finished nothing is
at stake: **Leave** says only that the board is over and what becomes of
the table, and frees the seat at once (a toast says so); a manager's
**Remove** takes each robot out with no word of a set. Leave and Remove
close the page's sheets before asking, and anything that goes wrong on
the way, even before a request is sent, is toasted ("Could not leave the
table. Please try again.") and logged to the console.

**Start.** A board is dealt only once the table is full and every person
seated there has pressed **Start**; robots are always ready. While the
next board waits for it (no board yet, one abandoned when somebody left,
or a finished one whose four players aren't all still in their seats), a
seated player sees the Start box: **Start**, then **Waiting for the
others…** with **Cancel**, and a line saying what is missing ("Waiting for
a fourth player, and for East (bob) to press Start."). Each ready seat on
the compass is marked **✓ Ready**. Everyone presses their own, the manager
included. Between boards with the same four players nothing is pressed:
the next board of the set comes by itself on the play page (#98), until
the set of four is over (#73): then it is everyone's Start again. While a set is going on, the table's info
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
(Start), bb#76 (away mid-set, Leave holds the seat), bb#120 (a robot takes the seat of a player who walks out), bb#78
(only an admin removes an admin; `is_admin` public on every seat).

## Play — `/tables/:id/play`

**Logged in, seated at that table** (403 otherwise). Built by #26 (game
table), #27 (bidding), #28 (card play), #29 (board result and next board),
#47 (claims), #96 (claims expire after 10 s, needs bb#96), #120 (both answer a claim at once, and a refused claim locks claims until the next card, needs bb#115), #98 (the next board by itself, needs bb#97), #53 (robots), #57 (forced cards play themselves), #56 (last trick
pop-up), #68 (Start), #69 (forced cards for declarer only), #70 (readable last
trick), #72 (no next board "for everyone"), #73 (sets of four boards), #74 (away
mid-set), #130 (the turn clock, needs bb#120), #95 (you play a robot partner's contract, needs bb#94),
#101 (bid alerts, needs bb#100), #102 (board chat, needs bb#101);
**Compare** by #30. Entered from the detail page,
automatically when a board is dealt, or from **Open the game table** before
anyone has pressed Start. The header's **Table** button goes back to the
detail page.

Robots play by themselves: each of their calls, cards, claim answers and
"ready"s arrives as an ordinary `PlayingUpdated` about a second apart, so
nothing on this page drives them. On a robot's turn its seat reads
**Thinking…** instead of **To act** and the status line says
"robot-1 is thinking…". Robots are badged at their seat and in the
next-board box, and count as having asked for the next board, so your
**Deal now** deals it at once instead of waiting out the countdown. When your robot partner wins the contract, it stays
declarer and you stay dummy, but **you play the hand**: the contract bar
says "robot-1 declares 4♠ — you play the hand", declarer's cards (yours
alone to see) lie across the top from the end of the auction, and on its
turn you tap one of them ("Play: your turn from North's hand."), on yours
one of your own. Forced cards play themselves on both hands, and you claim
for declarer ("You claim 4 of the remaining 5 tricks for North"). The
defenders still play by themselves. How they bid and play is in
[backend `ROBOTS.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/ROBOTS.md).

**Nothing jumps from card to card** (#133): while a board has a turn,
every seat keeps a line for the turn label (**Your turn**, **To act**,
**Thinking…**), filled only on the seat on turn; the status line under
the table, in a tinted box, is there for the whole auction and play with
room for two lines (empty while a claim's panel says what is going on);
and the trick's caption sits over the **Last trick** button's row, which
keeps its height while the button is hidden. So the table and your hand
stay put on a phone as on a desktop.

**Large cards** (#136): the cards are twice the old size unless the
Account page's **Card size** says otherwise, in your hand, dummy's and a
robot declarer's across the top, the trick and the **Last trick** pop-up;
dummy's columns, a claimer's and the finished deal use larger text. Every
card in your hand shows at least 44 px of itself to tap, so on a phone the
hand wraps whole suits, about two to a row, at 1.5 × the old size, and
keeps the height it had as dealt while you play. On a phone the side seats
narrow to their name and tags so the trick in the middle can be large.

Like the detail page, it shows **Refresh** (under a note, **Live updates
are off. Refresh to see the latest.**) only once live updates have been
off for 5 s; while they work, pull to refresh is the only manual reload
(#76).

Play goes in **sets of four boards** (#73): Start deals board 1, **Next
board** boards 2 to 4, and after the fourth the set is over. A line at the
top says where the table is: **Board 2 of 4 · Set 3** (**· set over** once
it is).

**The turn clock** (#130, bb#120). The player the board waits for has
**one minute** to call, play or act on a claim. A line over the status
counts it down from the game state's `turn_deadline`: **Your turn ·
0:42** for you (in red for the last 15 s, when your hand or the bidding
box is ringed in red too), **Waiting for East · 0:42** for everyone else,
and **Time is up…** at 0 until the backend acts (if nothing has arrived
2 s after the deadline, the page rereads the game). Nothing shows while a
robot or an admin is on turn, between boards or while a claim is
pending; the line keeps its place so nothing moves. While the tab is
hidden on your turn its title becomes **● Your turn (0:42) – Bridge**,
back to **Bridge** once you have played or look again; the header's
**Your table** counts down too. Let the clock run out and a **robot takes
your seat** for the rest of the set: the others get a toast ("East didn't
play in time: a robot took their seat."), the board goes on with the
robot, and partner plays the set out with it. You get a toast ("You
didn't play in time: a robot took your seat. You may sit down at that
table again once set 3 is over."), the page goes to the set's results,
and Home keeps a card until dismissed.

**Away mid-set** (#74, bb#76). A player quiet for a minute mid-set is
tagged **away** at their seat, and a notice above the turn clock says
so, with no countdown of its own ("East is away. If they don't play
within 1:00 of their turn, a robot takes their seat.", "South and West
are away. …" for several; an admin, who has no clock: "The table waits
for them."). It clears the moment they are back. Opening this page is
coming back: a seat held after a Leave, or marked away, is yours again,
with a **Welcome back. The set goes on.** toast and the board reloaded.
Mid-set the heartbeat keeps going while the tab is hidden, so switching
tabs is not going away (but the turn clock runs either way). **Leave the
table** mid-set (in the next-board box) is confirmed more sternly, as on
the detail page. Between sets, and before the first, the Start box has
its own **Leave the table**, and a manager gets **Remove** on each other
seat there (a robot, say), so finishing a set is no dead end (#121).
Leave and Remove close the review, the chat and any sheet before asking;
a failure is toasted and logged, never silent.

What it shows by phase:
- **waiting**: who's seated, and the same Start box as on the detail page
  (with each seat's ready mark), so opening the game table early is no dead
  end. The last Start deals the board right here. A manager (`can_manage`)
  also gets **Seat a player** and **Add robot** in the box for each empty
  seat, as on the detail page (#117): left alone after the others were
  freed or the set broken off, they fill the table without leaving the
  game, and get **Remove** on each other seat (#121). Everyone sees
  **Leave the table** under Start.
- **auction**: your hand (always ♥ ♣ ♦ ♠, red and black alternating), the auction grid, and on your turn the bidding
  box. The contract (or "Passed out") is announced when the last call
  arrives. Above the calls, an **Alert** field: "Explain to the opponents
  (optional)", up to 200 characters, and an **Alert** toggle (typing turns
  it on), so a call can be alerted with nothing written; "Only the
  opponents see this. Your partner doesn't." The next call goes out with
  it; it clears once the call is taken and stays if the call is refused.
  In the grid an alerted call stands out in amber with a "!"; hovering it
  (or a tap) pops up its explanation, or "Alerted, no explanation given.",
  and your own reads "You alerted: …". Partner's alerts never show. Any
  opponent's call, alerted or not, pops up **Ask what it means** until the
  board is over: a robot answers at once in the pop-up; a person gets a
  toast and a sheet to type the answer, which then shows like an
  explanation (closed, the sheet comes back from **Answer** in the call's
  pop-up). The grid stays below your hand during the play, where asking
  still works. The pop-up also offers **Ask in the chat** (below).
- **play**: the contract bar with tricks won, the current trick in the
  centre, dummy's cards once the opening lead is made, trumps on the left
  and the colours still alternating (4♠: ♠ ♥ ♣ ♦, 3♦: ♦ ♠ ♥ ♣, NT: ♥ ♣ ♦
  ♠; a robot declarer's cards, for its dummy, the same way). From the second
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
  left, wrapping onto a second row. It opens with every remaining trick
  picked, so the send button reads **Claim 5 tricks** at once and one tap
  claims them all (#137); tapping another number picks it instead. A trick
  finishing while it is open moves that default to the new maximum, and
  keeps a number picked by hand while it is still possible (capped to the
  new maximum otherwise). **Concede the rest** is its own button. The sheet
  says the others have 10 seconds to answer and that no answer counts as
  no. While a claim is pending, a banner says what is claimed, the
  claimer's cards lie face up at their seat, no card can be played, the
  players who still have to answer get **Accept** / **Reject** at once
  (both of them, neither waits for the other; one reject ends it) and the
  claimer **Withdraw**. The banner counts down to the claim's deadline:
  "Answer within 0:07" for those who still have to answer, "Waiting for
  East and West · 0:07" for everyone else, then "Time is up: no answer
  counts as no.", when its buttons disable. A reject or withdrawal toasts
  ("South's claim is off. Play on: no claim until the next card.") and
  play goes on; so does a claim nobody answered in time ("Nobody answered:
  the claim is off. Play on: no claim until the next card."). Until the
  next card is played nobody at the table may claim: **Claim** stays,
  disabled, with "The claim was refused: play a card before claiming
  again." under it, and comes back with the next card. If the backend's
  update hasn't come 2 s after the deadline, the page rereads the game.
  The last accept finishes the board.
- **finished**: the result at a glance (#100), written the way it is at
  the table: one big row with the contract and how it went on the left
  (**2♣ by West +2**, **4♠X by South −1**, **3NT by North =**, or
  **Passed out**) and your score on the right in green or red (**−130**;
  N-S's, tagged "N-S", if you didn't play it), then a small line
  ("10 tricks · by claim"), and one double dummy line (#119): "Double
  dummy: 4♠ by South makes 10" with **Review** (the board review at the
  table, where the whole table is), or "Double dummy analysis is being
  worked out…" while the backend solves it. Below it, where the set stands ("Set 2 · 3 of
  4 boards played", read from the set) and, once another table has played
  the board, its matchpoints for your side ("Matchpoints 75 %"). Scores
  are never added up over a set: each board is compared with the other
  tables. All four hands lie face up, **Compare with other tables**, **Review
  and export** (the board review at the table, below), and the next-board
  box: **Next board in 0:08**, counting down to the set's next board, which
  is dealt by itself (#98; then "Dealing the next board…"). The result and
  the deal stay on show until it arrives, then the page moves to its
  auction; **Last board** still reviews the one just played. **Deal now**
  is optional: it deals at once once every person at the table has pressed
  it (robots count as pressed), and after pressing it the box says who
  hasn't ("You asked to deal now. Waiting for bob."). Nobody, a manager
  included, asks for the others (#72). If nothing has arrived 2 s after
  the countdown ends, the page rereads the game. If one of
  the four has left or been replaced since, the Start box takes the
  next-board box's place: the next board waits for every person's Start.
- **set over** (after the fourth board, or earlier when it is broken off
  between boards): the set's results take the board result's place: who
  won, from your side ("You won the set.", "You lost the set."), whom a
  robot replaced and why ("East didn't play in time: a robot took their
  seat."), the four boards (number, contract and declarer, result, your
  side's score and matchpoint %, each opening its review) and the totals.
  Below it the Start box: everyone's Start opens the next set, **Board 1
  of 4 · Set 4**. A set that ended mid-board (a player taken out of it)
  shows its results the same way once the table is back to waiting. They
  update live for all four: the set ending arrives with the last card's
  `PlayingUpdated` (or the `TableUpdated` that broke it off), and the
  page then reads the set again.

**Board chat** (#102): from the first deal on, the header's **Chat**
button (with a red badge counting the others' messages since you last
looked) opens the board's chat: beside the table on a screen 1100 px wide
or more (the board stays centred in the room left of the chat, menu
pinned or not, and doesn't move at all where it already clears the chat;
#114), as a half-height sheet on a phone (the page stays usable above
it, and scrolls the bidding box and your hand clear of it). Each message
shows who wrote it and their seat, who reads it ("to opponents", "to
table"), the time, and the call it is about as a chip; the text is plain
(no HTML, links not clickable). In every phase (#115) a message goes to
the **Table** (the default: "Everyone at the table sees this.", for a
greeting, "good luck" or "sorry") or to the **Opponents** ("Only the
opponents see this, not your partner."): while the board is on you never
read partner's messages to the opponents, nor they yours. There is no
partner-only message. **Ask in the chat** in an opponent's call pop-up
opens it with the call attached ("About 2♥:") and the switch on
**Opponents**; a robot answers such a question at once, and
the **Ask what it means** question and its answer show in the chat too.
Sending is disabled while a message is on its way and clears the text
once sent; a refusal (409, 422, 429 too many at once) is toasted at the
top and keeps the text. An opponent's question about one of your calls,
with the chat closed, is told in a toast at the top, which never covers
the bidding box or the hand. Once the board is finished the whole chat is
read again (every message is public then), and it stays in the board's
review.

**Board review at the table** (#97): once a board of this table has been
finished, **Last board** (header) opens the board review in a full-height
sheet over the game, at any phase: the same replay and Export as
[Board review](#board-review--playingsid), without leaving the table. It
opens on the latest finished board, with a switcher (**Board 5**,
**Board 6** …) for the set's other finished boards; on a set's first board
it offers the previous set's last. The game goes on underneath; when it
waits for you ("Your turn to bid", "Your turn to play", "A claim waits for
your answer", "Your Start: …") a
banner in the sheet says so with **To the table**. A forced card doesn't
play itself while it is open, and leaving the page closes it. It fits a
360 px screen.

| Calls | Endpoint |
|---|---|
| `game.load()` | `GET /tables/{id}/playing`, the only request the page waits for on entry |
| `game.loadBids()` | `GET /bids`, once per session, normally already read in the background after login; asked again only after the board is drawn |
| `game.call()` (with the alert, if any) | `POST /tables/{id}/calls` |
| `game.askAboutCall()`, `game.explainCall()` | `POST /tables/{id}/calls/{index}/question`, `PUT /tables/{id}/calls/{index}/explanation` |
| `game.play()` | `POST /tables/{id}/cards` |
| `chat.follow()` (entering the table, and when a board finishes) | `GET /tables/{id}/messages`, after the board is drawn; failures are quiet |
| `chat.send()` | `POST /tables/{id}/messages` |
| `game.claim()`, `game.respondToClaim()`, `game.withdrawClaim()` | `POST /tables/{id}/claim`, `POST /tables/{id}/claim/response`, `DELETE /tables/{id}/claim` |
| `game.next()` (**Deal now**, optional) | `POST /tables/{id}/playing/next` |
| `tables.start()`, `tables.cancelStart()` | `POST /tables/{id}/start`, `DELETE /tables/{id}/start`; the Start that deals answers with the new board, so it is drawn without another read |
| `tables.seatRobot()`, `tables.seatUser()` (managers, Start box, #117) | `POST /tables/{id}/seats/robots`, `GET /users?search=` + `POST /tables/{id}/seats/users` (picking yourself is `tables.join()`, `POST /tables/{id}/seats`); a refusal toasts and rereads the table |
| `game.load()` 2 s after a claim's or the next board's deadline with no update | `GET /tables/{id}/playing` |
| `history.loadSet()` (after each finished board, when the set ends, and on entry mid-set) | `GET /sets/{id}` |
| `history.loadReview()` (the board review) | `GET /playings/{id}`, once per board per session (again while its double dummy analysis is pending) |
| `history.loadDoubleDummy()` (once a board is finished; once more 5 s later if pending) | `GET /boards/{id}/double-dummy` |
| `history.loadHistory()` (on entry, only when no board to review is known but one may have been finished here) | `GET /api/user/playings` |
| `tables.openTable()` on entry, `tables.loadTable()` on pull to refresh, Refresh (offline only) or a 409 | `GET /tables/{id}`, skipped on entry when the store already follows the table (after Create, a join, or the detail page) |
| `tables.leave()` | `DELETE /tables/{id}/seats` (202 mid-set: the seat is held) |
| `tables.comeBack()` on entry | `POST /tables/{id}/heartbeat` and `GET /tables/{id}`, only when your seat was held or away |
| channels | `private-table.{id}`: `TableUpdated` (seats, away marks, a robot taking a seat over), `PlayingUpdated` (with `turn_deadline`); `private-App.Models.User.{me}`: `HandDealt`, `DeclarerHandShown` (a robot declarer's cards, when you play them), `CallAlerted` (an opponent's alert or answer), `CallQuestioned` (a question about your call), `BoardMessageSent` (a chat message you may read) |

A 409 on a call, card, claim or next board toasts the backend's message and
reloads (after a set's last board, Deal now 409s: "The set is over: press Start
for a new one.", though the page shows Start instead by then). A `TableUpdated` whose `board_id` goes back to null mid-board means
a player left and the board was abandoned: toast, back to waiting (and to
Start once the table is full again).

Backend: bb#18 (deal a board), bb#73 (only after everyone's Start), bb#36 (game state),
bb#37 (auction), bb#56 (`GET /bids`), bb#38 (card play), bb#39 (scoring),
bb#40 (next board; bb#74 dropped its `everyone`; bb#97 deals it by itself), bb#43 (results), bb#59 (claims), bb#96 (claims expire), bb#115 (claims answered at once, the claim lock),
bb#75 (sets of four boards), bb#76 (away mid-set), bb#120 (the turn clock, a robot taking the seat of a player who walks out), bb#100 (alerts), bb#101 (board chat).

## My boards — `/history`

**Logged in**, menu item **My boards**. Built by #30; grouped by set by #73.

Your finished boards, newest first (20 a page, paged in as you scroll),
grouped by the set they were dealt in. Each set's header reads **Set 3 ·
table 5**, how many of its boards are listed ("2 of 4 boards") and, if the
set's results have been read (its page, or the play page) and another
table has played its boards, your matchpoints over it ("62 %"); never a
summed score (#100). It opens the [set's results](#set-results--setsid). Under
it, each board: board number, contract and result in table notation
("4♠X by N −1"), the seat you sat and
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
it, else N-S's, also when a robot finished it for you), whom a robot
replaced and why, each board opening its review (contract in
table notation, your side's score and matchpoints), and the set's
matchpoints for your side ("62 %", with "5 of 8") instead of a summed
score, or "No other table has played these boards yet." (#100). A 403 or
404 shows as a reason on the page.

| Calls | Endpoint |
|---|---|
| `history.loadSet()` | `GET /sets/{id}` |

Backend: bb#75.

## Board results — `/boards/:id/results`

**Logged in, and only after you finished that board** (403 otherwise).
Built by #30. Reached from a board's review or **Compare with other tables**.

The same board at every table, best N-S score first, each with its
contract, declarer, score and matchpoints. The tables you sat at are
highlighted with your side's matchpoint percentage. Above the list, the
board's double dummy table (#119): the tricks each declarer (N E S W) makes
in each strain (♣ ♦ ♥ ♠ NT) with every card in view and best play on both
sides, your contract marked, so every result can be held up against what
was possible ("being worked out…" while the backend solves it). Tapping a
row opens that table's [review](#board-review--playingsid). A 403 or 404
shows as a reason on the page, not as an error.

| Calls | Endpoint |
|---|---|
| `history.loadResults()` | `GET /boards/{id}/results` |
| `history.loadDoubleDummy()` (after the results; once more 5 s later if pending) | `GET /boards/{id}/double-dummy` |

Backend: bb#43, bb#114 (double dummy).

## Board review — `/playings/:id`

**Logged in, and only after you finished that board** (403 otherwise; 404
for an unknown or unfinished playing). Built by #48. Reached from a history
entry (yours or another player's) or a row of Board results; not in the
menu. The play page shows the same review in a sheet (#97: `BoardReview`
and `useBoardExport` serve both). It works the same after the table is gone.

One table's playing of a board, replayed: the contract and the tricks each
side has won so far, the four hands face up (you at the bottom if you
played it, otherwise South), the trick in the middle, and the auction
below, with every alert of the board (public once it is over) marked and
popped up as on the play page, and under it the board's whole chat (#102),
partner's messages to the opponents included, since the board is over. A stepper moves card by card or a trick at a time (start, previous
trick, previous card, next card, next trick, end); the hands lose their
cards as they go but keep the room they took as dealt, so the buttons stay
in the same place at every step (#59). The line saying where you are
(trick and card) sits under the buttons. The result panel shows once the
replay reaches the end, and **Results** (header) / **Results at every
table** go back to the board's results.

Under the result, what was possible double dummy (#119): the board's double
dummy table (declarers N E S W down the side, ♣ ♦ ♥ ♠ NT across, tricks
not levels) with this contract's cell marked, then the **opening lead**:
the leader's cards as the hand is held, each with the tricks declarer makes
after that lead, the lead made raised, the best leads (fewest tricks for
declarer) ringed green, and in words ("Your lead ♠K: declarer can make 10.
Best was ♥2: 9."). While the backend is still solving it the page says
"Double dummy analysis is being worked out…" and reads the board once more
5 s later. A passed-out board has only its
auction, the deal, the result and the double dummy table; a board that ended by a claim stops where
the claim was made.

Boards finished before the backend kept their calls and cards (before
bb#60) say "The auction and play of this board weren't recorded" and show
only the deal and the result.

**Export** (header, #71) opens a menu to take the board out of the app:

- **Copy as text**: a plain summary for a chat: board, dealer and
  vulnerability, the players (robots marked "(robot)"), the four hands as
  dealt, the auction as a W N E S grid, contract, declarer and opening
  lead, one line per trick (leader, the four cards in the order played,
  winner), the alerts and the chat under the auction, where a claim ended the play and how the tricks left went, the
  result and, if you opened the board's results this session, the
  matchpoints; then the double dummy table and the opening lead in words,
  once solved.
- **Download .txt**: the same text as a file.
- **Download .pbn**: the board in Portable Bridge Notation 2.1 (export
  format), for other bridge software: deal, auction (each alert a note,
  `=1=` and `[Note "1:…"]`), play (a claim ends it with `*`), contract,
  result and score, plus the double dummy table as `OptimumResultTable`
  once solved.
- **Download .json**: the review exactly as the backend sent it, for
  debugging and for work on the robots.
- **Print / Save as PDF**: the browser's print dialog with a paper layout
  of the board (no app menu or header): the board line and result, the
  hands round a compass, the auction (alerted calls marked "!" and listed
  under it) and a trick-by-trick table.

A board without a recorded auction and play exports the deal and the result
and says why nothing else is there. The files and printing need a browser:
in the native app the menu only offers Copy as text.

| Calls | Endpoint |
|---|---|
| `history.loadReview()` | `GET /playings/{id}` (once per session: a finished playing never changes; read again while its double dummy analysis is pending) |

Backend: bb#60, bb#101 (the chat), bb#114 (double dummy).

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
the player is taken off their table (mid-set a robot takes their seat)
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
| `AppHeader` | every page | none (reads the auth store; **Your table** from the tables store's `myTable` via `useYourTable`; the menu button collapses the pinned menu; `BanBanner` under it while you are banned) |
| `BanNotice` | the app shell | none (shows `auth.banNotice` after `UserBanned`, goes to Login) |
| `BanUserForm` | User profile, profile sheet (admins) | `users.ban()` → `POST /users/{id}/ban` |
| `AppMenu` | the app shell | none (reads the auth store; **Your table** first while seated, via `useYourTable`) |
| `BoardReview` | Board review, Play (`BoardReviewModal`) | none (given the review from `history.loadReview`) |
| `PlayerProfileSheet` | Tables, Table detail, Play, Board review | `users.load()` → `GET /users/{id}`; **Ban** for admins (`BanUserForm`) |
| `RobotBadge` | Home, Tables, Table detail, Play (`BridgeTable`), profile sheet | none (`is_robot` on the user) |
| `AdminBadge` | Home, Tables, Table detail, Play (`BridgeTable`, `StartBox`), profile sheet, User profile | none (`is_admin` on the user, #77) |
| `SeatPlayerSheet` | Table detail (managers) | `useUserSearch` → `GET /users?search=` (300 ms debounce, 2 characters minimum) |
| `HistoryList` | My boards, User profile | `history.loadHistory` / `loadMore` |
| `SetResultsPanel` | Play (set over), Set results | none (given the set from `history.loadSet`) |
| `AwayNotice` | Play, Table detail (who is away, no countdown); Table detail, Tables, Home (your held seat) | none (reads `away_since` from the table) |
| route progress bar, boot bar, toasts | the app shell | none (#18) |
