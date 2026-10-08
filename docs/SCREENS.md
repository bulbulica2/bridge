# Screens

_Status as of branch `bulbulica2/119-lead-tricks-on-the-cards`._

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
the guard sends them from the game table to Tables. A ban that
lands while the app is open (`UserBanned`) ends the session at once: the
app goes to Login under a dialog with the reason and the end date, which
stays until **OK**. See [`ARCHITECTURE.md`](ARCHITECTURE.md#bans).

## Map

```
guest:      Home ─┬─ Login ─┬─ Create account
                  │         └─ Reset password ─▶ (email) ─▶ Choose new password ─▶ Login
                  └─ Create account

logged in:  Home ── Your table / Find a table
            Menu: Tables ─▶ Play (the game table) ─▶ Board results ⇄ Board review
                                 │      (set over: each board ─▶ Board review)
                                 └── player ──▶ profile sheet ─▶ User profile ─▶ Board review
            Menu: My boards ─┬▶ Board review ⇄ Board results
                             └▶ Set results ─▶ Board review
            Header: Your table (while seated: Play)
            Header: Account (view / edit profile, log out)
```

**Menu and Your table** (#99): from 768 px up the side menu stays open
beside every page, titled **Bridge4U** (#198); the header's menu button
collapses it and brings it back, and the browser remembers which. On a phone it slides in as before.
While the user holds a seat, every page's header has a **Your table**
button (the table's name and a dot: green for a board in progress, blue
for your turn, amber for an away seat) and the menu lists **Your table**
first with the same status as a badge ("Your turn · 0:42" while your
turn clock runs, #130); the menu is 320 px wide so the
entry stays on one row and the same size whatever the badge says (#134),
a long table name ending in "…". One tap goes to the game table (Play),
board or not (#181). On pages that load no table (My boards, a profile,
a review…) the router asks `GET /tables` once to find the seat. See
[`ARCHITECTURE.md`](ARCHITECTURE.md#app-shell).

## Home — `/home`

**Everyone.** Built by #3 (menu + home) and #25 (the real home page);
held seat by #74; a robot taking your seat by #130; the Daylight lobby
look by #162.

- **Guest**: an intro to the app under its name, **Bridge4U**, and the
  tagline "Bridge for you" (#198), with **Log in** and **Create account**.
- **Logged in**: a greeting, then the **Your table** card (navy, as on
  Tables: the table's name, "Set 3 · Board 2 of 4 · you sit South with
  radu", the set's boards so far as tiles B1–B4 with your side's
  matchpoints and the board on now in amber, and an orange **Back to the
  table**, the game table) or
  "You're not at a table" with **Find a table**. Then **Your form** (your
  average board %, sets won of sets played, boards played) and **Recent
  boards** (your last three, each opening its review, then **All my
  boards**), and a short how-to-play. While your seat is held (after a
  Leave mid-set, or marked away) the card counts down ("You're away from
  Club: a robot takes your seat in 1:42 unless you come back.", #150) and
  its button reads **Come back** (it opens the game, which brings you
  back).
- **Set N: a robot took your seat**: a card when your turn clock ran out
  (or you were removed while away) and a robot took your seat for the rest
  of the set, whether seen live or found on this visit (the set you were
  in the middle of is remembered in the browser): "You didn't play in
  time: a robot took your seat. You may sit down at that table again once
  set 3 is over.", with **See the set** (`/sets/:id`) and **Dismiss**.

| Calls | Endpoint |
|---|---|
| `tables.load()` (logged in only) | `GET /tables`; then `GET /sets/{id}` once, if you were in the middle of a set at a table you no longer sit at |
| `users.loadStats(null)` (Your form), `history.loadHistory(null)` (Recent boards), once the tables are in | `GET /api/user/stats`, `GET /api/user/playings`; failures are quiet |
| `history.loadSet()` (Your table's tiles, once a board of the set is finished) | `GET /sets/{id}`; failures are quiet |

## Login — `/login`

**Guests only.** Built by #4; Daylight's colours throughout by #163 (as on
every page below: the tokens, fonts and buttons, no colour of its own).

Email, password and a **Remember me** checkbox (off by default, #65);
links to Create account and Reset password. On success it goes to
`/account` and shows a welcome toast.

The form (#170) is a white card under the app's name, **Bridge4U**, small
(#198: a guest who came from a link sees where they are; Create account
and Reset password have it too), at most 420 px wide and centred (full
width less a 16 px gutter on a phone), with Daylight's fields
(`forms.css`): the password has a show/hide button, a browser's autofill
looks like typed text (no yellow or blue patch), and a 422 shows under
its field with the field's border red ("These credentials do not match
our records." under Email). **Log in** is the orange primary button,
**Remember me** a checkbox with a 44 px tap area, and Create account /
Reset password quiet text links under the button.

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

**Guests only.** Built by #5; Daylight's colours by #163. Linked from Login and guest Home.

Name (at most 50 characters), username (at most 30), email, password and
confirmation, in the same white card and fields as Login (#170), both
password fields with a show/hide button and **Create account** in orange;
each 422 error shows under its field, its border red. On success the user is logged in, lands on `/account`
and gets a welcome toast. There is no Remember me here: a new account is
logged in for the session only, and Remember me is on the Login page.

| Calls | Endpoint |
|---|---|
| `auth.register()` | `GET /sanctum/csrf-cookie`, `POST /register`, `GET /api/user` |

Backend: `routes/auth.php`. Email verification is not wired yet
(#33, bb#46).

## Reset password — `/reset-password` and `/password-reset/:token`

**Guests only.** Built by #6; Daylight's colours by #163. One page, two stages:

1. `/reset-password` (from Login): enter your email; the page shows the
   backend's status message.
2. `/password-reset/:token?email=…` (the link in the email): choose a new
   password. A reset doesn't log you in, so it then goes to `/login`.

Both stages use Login's white card and fields (#170); the new password and
its confirmation have a show/hide button. A 422 shows under its field;
one about something not on the form (an invalid token) under the form.

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
profile); Daylight's colours by #163. Reached from the header's **Account** button.

Shows your name, username, email and description. **Edit profile** turns
the page into a form for name (at most 50 characters) and description,
in a white card with Daylight's fields (#170: a 422 under its field, the
field's border red) (username and email are
read-only, with the plain arrow cursor rather than the text cursor, #66;
their text can still be selected and copied). **Card size** (#136) picks
how big the cards are drawn at the table, **Normal**, **Large** (the
default) or **Extra large**, with two sample cards showing the pick at
once; it is kept in this browser (`bridge.cardSize`), not on the account.
**Stats** (#131) are your own, as on your profile (see User profile),
read again every time the page opens.
**Log out** ends the session, closes every channel and goes to
`/login` with a toast.

| Calls | Endpoint |
|---|---|
| `auth.updateProfile()` | `GET /sanctum/csrf-cookie`, `PATCH /api/user` |
| `auth.logout()` | `GET /sanctum/csrf-cookie`, `POST /logout` |
| `users.loadStats(null)` (`PlayerStats`) | `GET /api/user/stats` |

Backend: `PATCH /api/user` came with bb#21 (`15-player-identity`), the
stats with bb#121.

## Tables — `/tables`

**Logged in**, menu item **Tables**. Built by #8; seat moves by #22;
profile sheet by #24; robots by #53; a seat opening the table by #67;
Start by #68; held seat by #74; banned users by #75; your seat with Leave
by #121; the time for a set by #143; the Daylight lobby by #162;
watching a table (kibitzers) by #182.

The lobby, up to 1280 px wide: the list on the left and, beside it from
about 1000 px (below it on a phone), **Your form** and **Recent boards**
(as on Home; each board "Set 2 · B3", or plain "Board" outside a set,
#189).

- **Your table** (navy, while you sit somewhere): the table's name, "Set
  3 · Board 2 of 4 · you sit South with radu", the set's boards as tiles
  B1–B4 (your side's matchpoints on each board finished, **now** in amber
  on the board being played), an orange **Back to the table** and
  **Leave**. Going to another page never gets you up from a table, so
  Leave is the way to leave it without opening it: the same confirmation
  as at the game table, then a toast. While your seat is held after a
  Leave mid-set (or you were marked away) the card counts down the 2
  minutes it is kept ("You're away from Club: a robot takes your seat in
  1:42 unless you come back.", #150) and the button reads **Come back**
  (it opens the game). The header's **Your table** turns into an orange
  pill, "Your turn · 0:42", whenever the game waits for you.
- **Play now with robots**: "Your time for a set of 4 boards", 8, 12, 16
  or 20 minutes per player (the set clock, 16 unless picked), and
  **Deal me in**: a table where you sit **South** and robots take North,
  East and West. **Open a table for friends**: an optional name and
  **Create table**: you sit South, the other three seats are free for
  players to take, or for you to fill with **Seat a player** / **Add
  robot** (its time for a set is the backend's default until you change
  it from the game table's gear). Both cards have an **Allow kibitzers**
  switch, on by default: whether people without a seat may watch the
  table (#182). Either way the page goes straight to
  the new table's game table as soon as it exists (#55, #132, #181),
  where your **Start** deals the first board (robots are always ready). A
  refusal shows under the card it came from.
- **Open tables**, with filter chips counted over the list: **All**,
  **Seat free**, **Playing** (a board on) and **Robots only** (the last
  person left: anyone may sit down and run the table). Each table is a
  card: its name (opening its game table), a line with the time for a set and
  where it is ("16 min · set 2 · board 2/4", "16 min · no set yet", or
  "left 3 min ago · closes in 7" while only robots are left), a pill ("1
  seat free", "Playing", "Full", "Robots only") and a mini compass of the
  four seats: names, robots in blue, away players in red ("nick · away"),
  you in orange, and an empty seat as a dashed **Sit N**. Tap a name to
  open that player's profile sheet, **Sit N** to sit. Taking a seat takes
  you straight to the game table, `/tables/:id/play`, as soon as the seat
  request answers (#181): the board if one is on, else the waiting table,
  where you press **Start**. Sitting down never deals a board.
  The seat's spinner and the disabled seats stay until the page has
  changed. A cancelled move or a seat taken meanwhile (409, toasted) keeps
  you on the list. Moving to another table asks first, because leaving
  your seat can abandon a board there; in the middle of a set it says a
  robot takes your seat there for the rest of the set and you can't sit
  down there again until it is over (bb#120).
  Under the compass, how many people watch the table ("2 watching") and,
  where the table allows it and you don't sit there, **Watch** (#182):
  you watch the table without a seat and go to its game table in
  watching mode (below, Play). The table you watch reads **Watching**
  (a tap goes back to it). Watching is never done from a seat: sitting
  at another table, Watch asks to leave it first ("Leave Club to watch
  Late night?", with Leave's own words for what that costs); in the
  middle of a set your seat would only be held, so it says "You're in
  the middle of set 2 at Club: you can watch another table once it's
  over." instead. A refusal (the table doesn't allow kibitzers) is
  toasted.

No live updates on this page: pull to refresh.

A **banned** user still sees the list, but the ban (reason and end date)
takes the place of the two start cards, every **Sit** is disabled and the
tables' names don't open their game tables, and there is no **Watch**.

| Calls | Endpoint |
|---|---|
| `tables.load()` | `GET /tables` |
| `tables.create()` | `GET /sanctum/csrf-cookie`, `POST /tables` (`seat: 'S'` and `allow_kibitzers`; **Deal me in**: `robots: true` and `set_minutes`; **Create table**: `robots: false`) |
| `tables.watch()` (**Watch**) | `POST /tables/{id}/kibitzers` (a 409 reads `GET /tables` and asks to leave your seat first) |
| `tables.join()` | `GET /sanctum/csrf-cookie`, `POST /tables/{id}/seats`, then `GET /tables` after a move |
| `tables.leave()` (Your table · Leave) | `DELETE /tables/{id}/seats` (202 mid-set: the seat is held) |
| `users.loadStats(null)` (Your form), `history.loadHistory(null)` (Recent boards), once the list is in | `GET /api/user/stats`, `GET /api/user/playings`; failures are quiet |
| `history.loadSet()` (Your table's tiles, once a board of the set is finished) | `GET /sets/{id}`; failures are quiet |

Backend: bb#9 (create table, 3 active per creator), bb#12 (join a seat),
bb#25 (joining elsewhere moves you), bb#65 (robots), bb#73 (nothing is
dealt before Start), bb#77 (bans), bb#121 (stats), bb#131 (`set_minutes`),
bb#143 (kibitzers).

## Play — `/tables/:id/play`

**Logged in, seated at that table or watching it** (403 otherwise).
Built by #26 (game
table), #27 (bidding), #28 (card play), #29 (board result and next board),
#47 (claims), #96 (claims expire after 10 s, needs bb#96), #120 (both answer a claim at once, and a refused claim locks claims until the next card, needs bb#115), #98 (the next board by itself, needs bb#97), #53 (robots), #57 (forced cards play themselves), #56 (last trick
pop-up), #68 (Start), #69 (forced cards for declarer only), #70 (readable last
trick), #72 (no next board "for everyone"), #73 (sets of four boards), #74 (away
mid-set), #130 (the turn clock, needs bb#120), #143 (the set clock, needs bb#131), #95 (you play a robot partner's contract, needs bb#94),
#101 (bid alerts, needs bb#100), #135 (partner's alerts after the auction, needs bb#124), #102 (board chat, needs bb#101), #151 (vulnerability in words), #153 (the chat open by default), #160 (Daylight: the navy table with seat plates, the new cards, call chips, the board tile and the two-tap bidding box), #161 (Daylight during a board: the turn clock line, the header, the claim tiles with scores, the claim banner), #163 (the wide table, the Start box's plates, the away banner and the chat's look), #165 (the Auction button, the board's place in its set, the contract without the declarer/dummy line), #171 (the board's details in the table's corners, the set in the header, the dealer's D), #172 (dummy on one row), #173 (the claim as a small centred dialog), #174 (the board's result in a dialog with the countdown and the vote, 15 s with bb#140), #186 (a pending claim in a dialog, so the table never moves), #196 (Last trick in the table's top-right corner), #203 (a robot partner's alerts during the auction, needs bb#152), #204 (your HCP in the bottom-right corner while bidding with three robots);
**Compare** by #30; the table's one page (the waiting table, Remove in the
profile, Leave in the header, the set time's gear, the Start timer) by
#181, needs bb#142; watching mode (kibitzers) by #182, needs bb#143.
Reached from **Deal me in**, **Create table**, every
**Sit** on Tables, a table's name, and the header's **Your table**:
there is no separate table page any more, and the old `/tables/:id`
address goes here.

Robots play by themselves: each of their calls, cards, claim answers and
"ready"s arrives as an ordinary `PlayingUpdated` about a second apart, so
nothing on this page drives them. On a robot's turn its seat reads
**Thinking…** instead of **To act** and the turn clock line says
"robot-1 is thinking…". Robots are badged at their seat, and count
as having voted for the next board, so your **Deal next board** deals it
at once instead of waiting out the countdown. When your robot partner wins the contract, it stays
declarer and you stay dummy, but **you play the hand**: the contract in
the table's top-left corner says **you play it** under the tricks,
declarer's cards (yours
alone to see) lie across the top from the end of the auction, and on its
turn you tap one of them ("Play: your turn from North's hand."), on yours
one of your own. Forced cards play themselves on both hands, and you claim
for declarer (the claim's dialog is titled "Claim for North"). The
defenders still play by themselves. How they bid and play is in
[backend `ROBOTS.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/ROBOTS.md).

**Daylight** (#160). The table is a navy panel: each seat a plate
(initials or a robot's icon, name, seat, the set clock as a pill, an
amber **ADMIN** tag), the seat on turn ringed orange, an away seat red,
a seat that pressed Start ticked green, an empty one dashed. During the
auction each seat's last call sits beside its plate as a chip, an
opponent's alerted one with an amber "!". Cards are plain white faces
with a big rank over the suit in the corner; the cards you may play
stand raised and ringed, the others dimmed; in the trick the card winning
so far is ringed amber and a dashed place waits for yours. The auction
grid is a card of chips (green Pass, red X, blue XX), the vulnerable
side's seats red, the call awaited a "?" ringed orange. **Start** and
**Deal next board** are the orange buttons.

**The wide table** (#163, the design canvas's boards A and B in
Daylight's colours). On a screen 1100 px wide or more, once the page's
column has 560 px for it (with the menu pinned and the chat open, from
about 1240 px), the page is up to 1040 px wide and the table spreads out:
partner at the top, the opponents'
plates on the left and right (upright while the table is under 760 px
wide), you at the bottom with your hand under the table. During the
auction the auction grid sits in the table's centre with your bidding
box under it; the centre keeps the height it reached until the next
board, so the table doesn't shrink once your call is made. During the
play it is dummy and the trick, as on any screen. The chat stays on the
right. Narrower, the table keeps the layout it has on a tablet, with the
auction under it while the bidding lasts.

**Nothing jumps from card to card** (#133): while a board has a turn,
every seat keeps a line for the turn label (**Your turn**, **To act**,
**Thinking…**), filled only on the seat on turn; the turn clock line
under the table is there for the whole auction and play with room for two
lines over its bar (empty while a claim's dialog says what is going on);
and the trick's caption is always there under the trick. **Last trick**
lives in the top-right corner, whose room is kept from the first card of
the play (#196), and the contract's corner keeps the same lines from the
first card to the last (#210). So the table and your hand stay put on a phone as on a
desktop.

**Large cards** (#136): the cards are twice the old size unless the
Account page's **Card size** says otherwise, in your hand, dummy's and a
robot declarer's across the top, the trick and the **Last trick** pop-up;
dummy's columns, a claimer's and the finished deal use larger text. Every
card in your hand shows at least 44 px of itself to tap, so on a phone the
hand wraps whole suits, about two to a row, at 1.5 × the old size, and
keeps the height it had as dealt while you play. On a phone the side seats
narrow to their name and tags so the trick in the middle can be large.

**Dummy on one row** (#172): dummy's cards across the top (and a robot
declarer's, for its dummy) always lie on one row, so the table never moves
as they go. The page is up to 832 px wide, room for 13 Extra large cards;
narrower (a phone, a small laptop, the chat beside the table) they overlap
more, down to each card's rank and suit, and on a small phone the cards
get smaller rather than wrap. On dummy's turn the cards you may play keep
a full 44 px to tap where the row has room.

It shows **Refresh** (under a note, **Live updates
are off. Refresh to see the latest.**) only once live updates have been
off for 5 s; while they work, pull to refresh is the only manual reload
(#76).

Play goes in **sets of four boards** (#73): Start deals board 1, **Next
board** boards 2 to 4, and after the fourth the set is over. The header
says where the table is (below). The page never shows the board's number
in the database.

**The table's corners** (#151, #160, #165, #171). Nothing sits above the
table or under your hand: the board's details lie in the four corners of
the navy table, beside partner and you, on a phone as on a desktop, so
the table, the trick, your hand and the bidding box fit one screen. They
take no room of their own (the table keeps its height from card to card)
and never cover a seat, dummy or the trick; on a phone their words wrap to
two short lines. The top-left corner is the exception during the play:
with the contract under the pill it is taller than partner's plate, so
partner's seat makes room for it beside the plate (#210, as #196 did for
the top-right one), and the left-hand seat and a hand across the top
start below it rather than under it. That room is there from the first
card, so nothing moves from card to card.
- **Top left**, from the deal to the end of the board: who is
  vulnerable, in words, as a small pill: **Nobody vulnerable** in green,
  else red: **Vul: E-W** for the other side, **Vulnerable: N-S (you)**
  for yours, **Both (you too)**. Under it through the play, 6 px below
  and left-aligned like it (#210): the contract, **2♠ by North**
  (**4♥X by East** doubled), and the tricks, **NS 3 · EW 2** (one line
  whatever the count); for a robot declarer's dummy a third line, **you
  play it**. Nothing under the pill during the auction.
- **Top right**, through the play: the **Last trick** button alone, from
  the second trick on (#196: its icon and words, the icon alone on a
  table under 420 px wide), whose pop-up opens downward and to the left
  over the top and right seats; its room is kept on the first trick.
  Between sets the table's time for a set (below), and on a finished
  board the **Result** pill.
- **Bottom left**, from the first call until the board is over: the
  **Auction** button. Hovering it with a mouse pops up the auction grid
  above it (chips, the vulnerable side's seats red, alerts "!", questions
  "?") and moving away hides it; a tap opens it and a tap outside (or
  Escape) closes it. While the board is on, an opponent's call in it
  still offers **Ask what it means** and **Ask in the chat**.
- **Bottom right**, during the play: **Claim** (below). During the
  auction at a table where the other three seats are all robots (#204),
  your hand's high card points instead, **21 HCP** (A 4, K 3, Q 2, J 1),
  white in Barlow, from the deal until the last call; never with another
  human at the table, after the auction, or for a kibitzer.

The dealer is the **D** on their plate; the plates keep a red/green top
edge, and the table's centre says **Board 2 of 4**, the dealer and the
same words until the first trick takes its place.

**The header** reads the table's name over the board's place in its set,
**Board 2 of 4 · Set 3** (**· set over** once it is; #161, #171), never
the board's number in the database; just the name before the first
deal.

**The turn clock** (#130, bb#120; its line #161). The player the board
waits for has **one minute** to call, play or act on a claim. One line
under the table says what the board waits for and counts it down from
the game state's `turn_deadline`, with a bar under it emptying over the
minute: **Your call** / **Your lead** / **Your turn · follow in ♦**
and **0:42** in orange for you (in red for the last 15 s, when your hand
or the bidding box is ringed in red too), **Waiting for East** and
**0:42** for everyone else, **robot-1 is thinking…** for a robot, and
**Time is up…** at 0 until the backend acts (if nothing has arrived 2 s
after the deadline, the page rereads the game). No clock or bar while a
robot or an admin is on turn, and the line is empty while a claim is
pending; it keeps its height so nothing moves. While the tab is
hidden on your turn its title becomes **● Your turn (0:42) – Bridge4U**,
back to **Bridge4U** once you have played or look again; the header's
**Your table** counts down too. Let the clock run out and a **robot takes
your seat** for the rest of the set: the others get a toast ("East didn't
play in time: a robot took their seat."), the board goes on with the
robot, and partner plays the set out with it. You get a toast ("You
didn't play in time: a robot took your seat. You may sit down at that
table again once set 3 is over."), the page goes to the set's results,
and Home keeps a card until dismissed.

**The set clock** (#143, bb#131). Each person also has a time bank for
the whole set (the table's 8 / 12 / 16 / 20 minutes, like a chess clock),
shown under their name at their seat as **13:32**. Only the bank of the
player the board waits for runs, counted down from the game state's
`turn_started_at` (in bold); the others stand still, and one turns red
under a minute. Robots and admins have none. When the bank would run out
before the move's minute (`turn_deadline_by: "set"`), the turn clock
line's clock reads **Set 0:42**. Running out is like letting the turn clock run
out: a robot takes the seat for the rest of the set, told once ("East ran
out of time for the set: a robot took their seat." / "You ran out of time
for the set: a robot took your seat. …").

**Away mid-set** (#74, bb#76; #150, bb#138). A player quiet for a
minute mid-set is tagged at their seat with its own clock, **away ·
0:42**, counting down to the robot taking it, whoever's turn it is (red
in the last 15 s, **replacing…** at 0 until the robot sits down; an
admin's is a plain **away**). Several away count down together, and one
line above the turn clock says what for, with no countdown: "Away
players are replaced by a robot when their clock runs out." When the
board waits for one of them the turn clock's line reads **Waiting for
East (away)**, with no clock or bar of its own.
Robots taking several seats at once are told in one toast ("South and
West were away: robots took their seats."). A tag clears the moment its
player is back. Opening this page is
coming back: a seat held after a Leave, or marked away, is yours again,
with a **Welcome back. The set goes on.** toast and the board reloaded.
Mid-set the heartbeat keeps going while the tab is hidden, so switching
tabs is not going away (but the turn clock runs either way). While the
backend still has you down as away, a banner says so ("You're away from
Club: a robot takes your seat in 1:12 unless you come back.") until the
mark is taken back. **Leave** mid-set is confirmed more sternly ("Your
seat is kept for 2 minutes: come back before then, or a robot takes it
for the rest of the set. Your time for the set keeps running when it's
your turn."): the backend holds the seat (202), the page goes to
`/tables` with a toast, and the store stops the heartbeat. Not back in
time, a robot takes your seat for the rest of the set and you are sent to
the set's results. Removing a player mid-set says what it costs: a robot
takes the seat of a player who is away, while removing one who is there
ends the set with no winner.

**Leave** (#121, #181) is one small button in the header, whatever the
board is doing, never on the table: its confirmation says what leaving
costs now (nothing between sets; mid-board the board is abandoned; mid-set
the seat is held, above). The result dialog keeps its own **Leave the
table**. Leave and Remove close the review, the profile sheet, a phone's
chat sheet and any other sheet before asking; a failure is toasted and
logged, never silent.

**Players and Remove** (#24, #16, #77, #181, #190). Tapping a player's
name on the table opens their profile sheet. For a manager (`can_manage`:
the moderator or an admin, bb#74) it has **Remove from the table** for
everyone but yourself, confirmed first; an **admin**'s seat only for
another admin, never the moderator (bb#78); while only robots sit at a
table (`unattended_since`), anyone may remove a robot. **Not while the
set is running** (#190, bb#147: a board on, or between the boards of a
set): the button stays but greyed out (`aria-disabled`), and a tap or a
mouse hover shows "They're still playing: you can remove a player once
the set is over." above it instead of asking; it turns normal as soon as
the set is over. An admin still removes mid-set (to stop cheating), and
anyone still removes a robot of an unattended table. A 403, 404 or 409 (a
set that started meanwhile) toasts the backend's reason and reads the
table again; removing the last robot of an unattended table deletes it
and goes back to `/tables`. Nothing on the table itself removes anybody.

What it shows by phase:
- **waiting**: the table itself is the waiting room (below, **Before a
  board**).
- **auction**: your hand (always ♥ ♣ ♦ ♠, red and black alternating), the auction grid, and on your turn the bidding
  box: **two taps plus confirm** (#160). Tap a level (1–7), then a strain
  (♣ ♦ ♥ ♠ NT), and the orange **Bid 2♥** under them sends it; **Pass**,
  **X** and **XX** show **Pass** / **Double** / **Redouble** there and
  need the tap too. Levels with nothing legal left and strains too low at
  the picked level are greyed out; the pick starts over once a call is
  taken or refused. The contract (or "Passed out") is announced when the
  last call arrives. The box's **Alert** button alerts the next call and
  opens "Explain to the opponents (optional)" above its rows, up to 200
  characters (a call can be alerted with nothing written); "Only the
  opponents see this. Your partner doesn't." The next call goes out with
  it; it clears once the call is taken and stays if the call is refused.
  In the grid an alerted call is ringed amber with a "!"; hovering it
  (or a tap) pops up a dark card, "East alerted 2♦", with its explanation,
  or "Alerted, no explanation given."; your own reads "You alerted 2♣".
  A human partner's alerts don't show while the auction lasts; once the
  play starts they do, as "Partner alerted 2♣" (with no Ask). A **robot**
  partner's show at once, during the auction (#203, bb#152), the same
  way and with no Ask, both in the grid and on its last-call chip by the
  plate: playing with a robot, you learn its system as you go. Nothing
  pops up for them; the "!" is enough. Any
  opponent's call, alerted or not, pops up **Ask what it means** until the
  board is over: a robot answers at once in the pop-up; a person gets a
  toast and a sheet to type the answer, which then shows like an
  explanation (closed, the sheet comes back from **Answer** in the call's
  pop-up). Once the auction is over the grid leaves the page: the
  **Auction** button in the table's bottom-left corner is the only way to see it, and asking still
  works there during the play. The pop-up also offers **Ask in the chat**
  (below).
- **play**: in the table's top-left corner, under who is vulnerable, the contract, **5♣ by
  East** (**5♣X**, **5♣XX** when doubled or redoubled), and the tricks
  won, **NS 0 · EW 0**, with no declarer/dummy line (#165, #171, #210), the current trick in the
  centre (#201: each card in front of its seat, stacked in the order they
  were played, the lead at the bottom and the last card on top, whoever
  played it; the cards sit in a pinwheel, the top one a little to the
  left and the bottom one a little to the right, so they barely overlap
  and every rank and suit shows whatever the order; the winning card's
  amber ring is drawn over everything, the card itself left in its place;
  the box is the same size from the first card to the fourth), dummy's cards once the opening lead is made, trumps on the left
  and the colours still alternating (4♠: ♠ ♥ ♣ ♦, 3♦: ♦ ♠ ♥ ♣, NT: ♥ ♣ ♦
  ♠; a robot declarer's cards, for its dummy, the same way). From the second
  trick on, a **Last trick** button sits alone in the table's top-right
  corner (#196, #210; the centre holds only the trick
  in progress and its caption): hovering it with a mouse pops up the last
  trick's four cards below it and to its left (each at its seat, turned
  like the table and tagged N/E/S/W or **You**, spread apart so every rank
  and suit shows, the winner ringed), and moving away hides it; on a phone
  a tap opens it and a tap outside (or Escape) closes it. The trick in
  progress stays in the centre meanwhile. The button is hidden for the 2 s
  the trick just won is still shown in the centre, its place kept.
  You tap a card from your own hand, or from dummy's if you're declarer.
  As declarer, when only one card may follow suit (say dummy holds a
  single card in the suit led), it pulses and plays itself after 3 s, with
  **plays in 3** on the card and the turn clock line counting down too
  ("Your turn from dummy · ♥7 plays in 3"); tapping it plays
  it at once. Never on a lead, and never for a defender: their other cards
  are dimmed, but they tap the one left themselves. Opening the claim dialog or the board review, a claim or any new card on the
  table stops the countdown.
  Anyone but dummy can **Claim** some of the tricks left (or **Concede**
  them) with the small **Claim** button in the table's bottom-right
  corner (#171). It opens a small dialog in the middle of the screen
  (#173, the table still visible around it): the title **Claim** ("Claim
  for North" for a robot declarer's dummy) with an **X** in the corner,
  then a tile per number, four a row, from all the tricks left down to 0,
  each with what it makes of the contract ("4♠ +1", "4♠ −2" in red) and
  your side's score ("+450", "−100"), worked out on the page as a hint
  (the backend's score is final), then one orange button. It opens with
  every remaining trick picked, so the button reads **Claim 7 · 4♠ +1 ·
  +450** at once and one tap claims them all (#137); tapping another tile
  picks it instead (**Claim 5 · 4♠ −1 · −50**); the 0 tile makes it
  **Concede**, which sends 0. A trick finishing while it is open moves
  that default to the new maximum, and keeps a number picked by hand while
  it is still possible (capped to the new maximum otherwise). The X, a tap
  on the backdrop or Escape closes it. How long the others have to answer
  shows once the claim is out, in the claim's own dialog. While a claim
  is pending (#186) no card can be played, the claimer's cards lie face
  up at their seat, and everyone at the table (dummy and a kibitzer too)
  sees a second small dialog in the middle of the screen, over the table,
  which doesn't move when it opens or closes: the title **Claim**, the
  claim in one line ("South claims 9 of 9", "You claim 4 of 5", "East
  concedes all 5") with what it makes of the contract from the claimer's
  side ("4♠ +1", red when it goes down), a ring counting down the 10 s
  ("0:07" inside, red under 4 s; none for a claim without a deadline),
  the claimer's cards on one row in bridge order, who has answered (✓
  accepted, … to answer, "you" for you), then the buttons: **Accept**
  (orange) / **Reject** for the players who still have to answer, at once
  (both of them, neither waits for the other; one reject ends it), and
  **Withdraw** for the claimer, all disabled once the time is up. After
  you accept, the buttons go and "Waiting for West…" shows. The claimer
  and those still to answer can't put it away (it lasts 10 s at most);
  anyone else closes it with its **X**, the backdrop or Escape, for that
  claim only. It closes by itself when the claim goes. A reject or
  withdrawal toasts
  ("South's claim is off. Play on: no claim until the next card.") and
  play goes on; so does a claim nobody answered in time ("Nobody answered:
  the claim is off. Play on: no claim until the next card."). Until the
  next card is played nobody at the table may claim: **Claim** stays,
  grey, as **Claim · locked**; tapping or hovering it pops up "The claim
  was refused: play a card before claiming again.", and it comes back
  with the next card. If the backend's
  update hasn't come 2 s after the deadline, the page rereads the game.
  The last accept finishes the board.
- **finished**: the page is just the table, all four hands face up as
  dealt, and the result opens in a **small dialog** in the middle of the
  screen (#174; the table stays visible around it). It opens by itself
  when the board ends (the last card or an accepted claim, or on coming
  to the page while it is finished), once the other tables' results are
  read or after a second at most, so nothing in it jumps: a row still
  being read holds its place as a grey skeleton line. In it, short:
  - the result: **4♠ by South +1** (**Passed out**), "11 tricks · by
    claim" under it, and your side's score big on the right (**+450**;
    N-S's, tagged "N-S", if you didn't play it);
  - the matchpoints once another table has played the board: **67 %**
    with an amber bar;
  - **Other tables**: up to four tables' contract and result ("4♠ N +1")
    with their N-S score, best first, yours tinted orange, then
    **Compare with other tables** (the board results page) when more
    have played it; hidden while no other table has;
  - one double dummy line once the analysis is ready ("Double dummy: 4♠
    by South makes 10"; nothing while it is pending or on a server
    without the solver);
  - a ring counting down to the next board ("0:12"; it is dealt by
    itself 15 s after the board ended, the backend's `next_board_at`,
    bb#140) beside the orange **Deal next board**, your vote to deal it
    now. Once you voted it reads "Waiting for bob…" (the people still to
    press it); robots always count as having voted, so with three robots
    your press deals at once. Nobody, a manager included, votes for the
    others (#72). Nothing else (#188): no Leave (mid-set it only marks
    you away until a robot takes your seat) and no Review (15 s is no
    time for one); the header's **Leave** and **Last board** do both.

  The X in its corner, the backdrop or Escape close it to look at the
  deal; a **Result · 0:12** pill in the table's top-right corner opens it
  again and keeps the countdown in sight. A new board, leaving the page
  or a confirmation over it closes it; coming back to the page while the
  board is still finished shows it again. If nothing has arrived 2 s
  after the countdown ends, the page rereads the game. If one of the four
  has left or been replaced since, the dialog shows the result with no
  countdown and no vote, and Start in the table's centre deals the
  next board once everyone has pressed it. The header's **Last board**
  reviews the board just played at any time.
- **set over** (after the fourth board, or earlier when it is broken off):
  the set's results go **under the table** (#191), never above it, so the
  table never moves: in the navy card (#162), who won, from your side
  ("You won the set.", "You lost the set.", "Abandoned: no winner."), whom
  a robot replaced and why ("East didn't play in time: a robot took their
  seat."), the boards (their place in the set, contract and declarer,
  result, your side's score and matchpoint %, each opening its review) and
  the set's matchpoints. They stay while the table waits for Start (in the
  table's centre: everyone's Start opens the next set, **Board 1 of 4**)
  and go once its first board is dealt. After the set's fourth board the
  result dialog shows **that board's result** like any other (contract,
  score, other tables, double dummy), with no countdown and no vote, and
  the line "Set 1 is over: its results are under the table." (it waits
  for the set's results first, 1 s at most). A set that ended mid-board
  (a player taken out of it) shows its results under the table once it is
  back to waiting. They update live for all four: the set ending arrives
  with the last card's `PlayingUpdated` (or the `TableUpdated` that broke
  it off), and the page then reads the set again. No time used is shown
  (#191): the set clock lives on the plates while the set runs.

**Board chat** (#102): from the first deal on, the board's chat is on
show beside the table on a screen 1100 px wide or more (Daylight's look,
#163: the others' messages grey, yours on the right in a navy tint, a
segmented **Table / Opponents** switch over the line to write) (#153: the board
stays centred in the room left of the chat, menu pinned or not, and
doesn't move at all where it already clears the chat; #114). The header's
**Chat** button (with an orange badge counting the others' messages since you
last looked, while the chat isn't on show) collapses it, giving the table
its room back, and brings it back; the choice is kept in the browser
(`bridge.chatOpen`), so the next board, a page change or a reload shows it
the way you left it. On a phone the chat would cover the cards, so it
starts closed and the button opens it as a half-height sheet (the page
stays usable above it, and scrolls the bidding box and your hand clear of
it). Leaving the page hides it; coming back shows it as you left it. Each message
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
finished, **Last board** (header) opens the board review in a dialog
over the game, at any phase (#187: centred, 90 % of the screen's height
with 5 % free above and below at every size, the phone included, 16 px
corners, the page dimmed around it; up to 880 px wide, below 768 px 8 px
of backdrop each side; the header stays put and the review scrolls inside;
Close, the backdrop or Escape close it): the same replay and Export as
[Board review](#board-review--playingsid), without leaving the table. It
opens on the latest finished board, with a switcher (**Board 1**,
**Board 2** …, each board's place in its set, #189) for the set's other
finished boards; on a set's first board it offers the previous set's
last. Its title is the board shown, **Board 2 review** ("Board review"
for a board outside any set); never the board's number in the database. The game goes on underneath; its header
holds only the title, Export and Close (#211: no turn bar, even when the
table waits for you; the turn line under the table, the Your table button
and the tab title say so). A forced card doesn't
play itself while it is open, and leaving the page closes it. It fits a
360 px screen.

### Before a board: the waiting table (#181)

Whenever the next board waits for Start (no board yet, one abandoned when
somebody left, a finished one whose four players aren't all still in
their seats, or a set over), the game table shows it on the table itself:

- **The seats** are the table's own: the four plates, a robot's icon,
  away tags, and a green tick on each seat that pressed Start (robots
  always have).
- **The centre**: **Ready to play?** (or **Waiting for the others…**
  once you pressed), what is missing ("Waiting for a fourth player, and
  for East (bob) to press Start."), and the orange **Start** (or
  **Cancel**). Everyone presses their own, the manager included; the last
  Start deals the board right there. **The Start timer** (bb#142): once
  the table is full, every seat but one is ready and another person has
  pressed, the one left has 15 s: **Press Start · 0:12** in orange (red
  under 5 s) for them, **Waiting for East · 0:12** for the others. Not
  pressed in time, their seat is freed: they are told "You didn't press
  Start in time: your seat is free for someone else." and go back to
  Tables (the backend's `UnseatedFromTable`, or the `TableUpdated` that
  frees the seat, whichever comes first).
- **An empty seat** is a dashed **Empty · West** button: tapping it
  opens a small menu right at that seat, pointing at it (#192: below
  North, above South, to the inside of West and East, never off the
  screen, laid over the table so nothing moves): "West is free", then
  **Sit here** (**Move here** when you sit here already; moving off
  another table asks first) and, for a manager, **Seat a player…** (a
  search over all users, robots never listed) and **Add robot**. A tap
  outside, Escape or a pick closes it, as does the seat being taken
  meanwhile; tapping another empty seat moves it there. A refusal is
  toasted and the table read again.
- **The time for a set** (#143, bb#131) sits in the table's top-right
  corner while no set runs: a manager's **gear** ("⚙ 16 min") opens a
  small **Table settings** dialog with the 8 / 12 / 16 / 20 minutes
  picker, a change toasted ("Each player now has 8 minutes for a set."),
  a refusal (409 once a set has started, 403) toasted with the backend's
  reason, the table read again and the picker put back. Everyone else
  reads **16 min** there. Changing it takes back every Start (bb#142):
  whoever had pressed is told "The set time changed to 8 min: press Start
  again." and their tick goes. Once the set runs the corner has the
  contract again.

### Watching without a seat (#182)

A **kibitzer** watches the table without a seat: from a card's **Watch**
on Tables, the **Watch** button here when not seated, or after the Start
timer freed their seat at a table that allows kibitzers ("You didn't
press Start in time: you're watching the table now.": the page stays).
It is the same table, read-only:

- **The table** is drawn from South's side (nobody is "you"), with the
  plates, the set clocks and the away tags as usual.
- **The auction**: in the centre on a wide screen, under the table
  otherwise, then behind the **Auction** button. An alerted call shows
  its "!", but its pop-up says "Alerted. What it means shows once the
  board is over.": the backend keeps the explanation from kibitzers
  until then. No **Ask**.
- **The play**: dummy at its seat once the opening lead is made (South's
  dummy across the bottom), the trick, the vulnerability and the contract
  in the corners as for a player (the contract under the vulnerability top
  left, **Last trick** top right), a pending claim's cards and its
  dialog, without buttons (the **X** closes it).
- **The end**: the result dialog, without the vote (no **Deal next
  board**, no **Review**: a kibitzer may only review boards they played).
- **Not shown**: no hand of your own, no bidding box, no Claim, no chat
  (no header **Chat** button), nothing about your turn (the turn clock
  line's "Waiting for East" stays).
- **The header**: a **Watching** pill and **Stop watching** (back to
  Tables).
- **Sitting down**: between sets an empty seat is a button, **Sit here ·
  West**, which ends watching and makes you a player. Mid-set, no Sit.
- **Sent away**: a manager turning kibitzers off tells you "This table
  no longer allows kibitzers." and takes you to Tables; so does a place
  dropped as idle ("You stopped watching the table after being
  inactive.") or the table going ("The table you watched is gone.").
  A reload keeps watching: the board answering without a seat says so.

**Allow kibitzers** (managers, between sets): the gear's **Table
settings** dialog has an **Allow kibitzers** switch under the time;
flipping it is sent at once ("Kibitzers are no longer allowed here.",
"Kibitzers may watch this table."), a refusal toasted, the table read
again and the switch put back. Turning it off sends everyone watching
back to the lobby; it takes nobody's Start back. The corner says
**Kibitzers allowed** or **No kibitzers** under the time, for everyone.

**Not seated here** (a link, a table's name on Tables): the board is only
for the four players and the table's kibitzers (403), but the table shows with its plates and
free seats ("You don't sit at this table. Take a free seat to play."),
"You sit at Home. Taking a seat here moves you." when you sit elsewhere,
and while only robots sit there "Robots only — sit down to take over.
You'll manage the table, and it is deleted 10 minutes after the last
player left if nobody does." Sitting down opens the board to you; the
first person to sit at an unattended table becomes its moderator. Where
the table allows it (and you sit nowhere), **Watch** opens its board in
watching mode instead.

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
| `game.next()` (**Deal next board**, the result dialog's vote, optional) | `POST /tables/{id}/playing/next` |
| `tables.start()`, `tables.cancelStart()` | `POST /tables/{id}/start`, `DELETE /tables/{id}/start`; the Start that deals answers with the new board, so it is drawn without another read |
| `tables.join()` (an empty seat's Sit here / Move here) | `POST /tables/{id}/seats` (then `GET /tables` after a move off another table, and the board read again) |
| `tables.seatRobot()`, `tables.seatUser()` (managers, an empty seat's menu, #117, #192) | `POST /tables/{id}/seats/robots`, `GET /users?search=` + `POST /tables/{id}/seats/users` (picking yourself is `tables.join()`, `POST /tables/{id}/seats`); a refusal toasts and rereads the table |
| `tables.removePlayer()` (the profile sheet's Remove) | `DELETE /tables/{id}/seats/{user}` |
| `tables.updateSettings()` (the gear's dialog) | `PATCH /tables/{id}` (`set_minutes` or `allow_kibitzers`) |
| `tables.watch()` (**Watch** when not seated), `tables.stopWatching()` (**Stop watching**) | `POST /tables/{id}/kibitzers`, `DELETE /tables/{id}/kibitzers` |
| `tables.resumeWatching()` (the board answered without a seat: a reload while watching) | none: follows `private-table.{id}` and the heartbeat again |
| `tables.findSeat()` (not seated here) | `GET /tables`, to know where you sit |
| `game.load()` 2 s after a claim's or the next board's deadline with no update | `GET /tables/{id}/playing` |
| `history.loadSet()` (after each finished board, when the set ends, and on entry mid-set) | `GET /sets/{id}` |
| `history.loadReview()` (the board review) | `GET /playings/{id}`, once per board per session (again while its double dummy analysis is pending) |
| `history.loadDoubleDummy()` (once a board is finished; once more 5 s later if pending) | `GET /boards/{id}/double-dummy` |
| `history.loadResults()` (once a board is finished: the result dialog's other tables) | `GET /boards/{id}/results`; failures are quiet |
| `history.loadHistory()` (on entry, only when no board to review is known but one may have been finished here) | `GET /api/user/playings` |
| `tables.openTable()` on entry, `tables.loadTable()` on pull to refresh, Refresh (offline only) or a 409 | `GET /tables/{id}`, skipped on entry when the store already follows the table (after Create or a join) |
| `tables.leave()` | `DELETE /tables/{id}/seats` (202 mid-set: the seat is held) |
| `tables.comeBack()` on entry | `POST /tables/{id}/heartbeat` and `GET /tables/{id}`, only when your seat was held or away |
| channels | `private-table.{id}`: `TableUpdated` (seats, away marks, a robot taking a seat over), `PlayingUpdated` (with `turn_deadline`); `private-App.Models.User.{me}`: `HandDealt`, `DeclarerHandShown` (a robot declarer's cards, when you play them), `CallAlerted` (an opponent's alert or answer, a robot partner's alert; in the play, anyone's answer), `CallQuestioned` (a question about your call), `AuctionAlertsShown` (partner's alerts, once the auction is over), `BoardMessageSent` (a chat message you may read), `UnseatedFromTable` (the Start timer freed your seat, maybe leaving you watching; kibitzers turned off). A kibitzer gets only the table channel and `UnseatedFromTable` |

A 409 on a call, card, claim or next board toasts the backend's message and
reloads (after a set's last board, the vote 409s: "The set is over: press Start
for a new one.", though the page shows Start instead by then). A `TableUpdated` whose `board_id` goes back to null mid-board means
a player left and the board was abandoned: toast, back to waiting (and to
Start once the table is full again).

Backend: bb#18 (deal a board), bb#73 (only after everyone's Start), bb#36 (game state),
bb#37 (auction), bb#56 (`GET /bids`), bb#38 (card play), bb#39 (scoring),
bb#40 (next board; bb#74 dropped its `everyone`; bb#97 deals it by itself), bb#43 (results), bb#59 (claims), bb#96 (claims expire), bb#115 (claims answered at once, the claim lock),
bb#75 (sets of four boards), bb#76 (away mid-set), bb#120 (the turn clock, a robot taking the seat of a player who walks out), bb#100 (alerts), bb#124 (partner's alerts after the auction), bb#152 (a robot's alerts to its partner at once), bb#101 (board chat),
bb#10 and bb#11 (seat others, kick or quit), bb#25 (moves), bb#44 (user
search), bb#45 (`can_manage`), bb#65 (robots, unattended tables), bb#78
(only an admin removes an admin), bb#131 (the set clock, `PATCH
/tables/{id}`), bb#142 (the Start timer, a set time change revoking
Start), bb#143 (kibitzers).

## My boards — `/history`

**Logged in**, menu item **My boards**. Built by #30; grouped by set by #73; Daylight's colours (a set's header navy-tinted, scores green or red) by #163.

Your finished boards, newest first (20 a page, paged in as you scroll),
grouped by the set they were dealt in. Each set's header reads **Set 3 ·
table 5**, how many of its boards are listed ("2 of 4 boards") and, if the
set's results have been read (its page, or the play page) and another
table has played its boards, your matchpoints over it ("62 %"); never a
summed score (#100). It opens the [set's results](#set-results--setsid). Under
it, each board: its place in the set ("Board 2", #189; plain "Board"
outside a set, never the board's number in the database), contract and
result in table notation
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
its boards** (403 otherwise). Built by #73; Daylight's colours by #163. Reached from a set's header in My
boards (yours or another player's); not in the menu. The backend has
`GET /sets/{id}`, so the set has a page of its own rather than only showing
inline. It works the same after the table is gone, and while the set is
still going on (with the boards finished so far).

The table and when the set finished (or started), the two pairs, and the
same set view as on the play page: who won (from your side if you played
it, else N-S's, also when a robot finished it for you), whom a robot
replaced and why, each board ("Board 1"…"Board 4", its place in the set,
#189) opening its review (contract in table notation, your side's score and matchpoints), and the set's
matchpoints for your side ("62 %", with "5 of 8") instead of a summed
score, or "No other table has played these boards yet." (#100). No time
used (#191). A 403 or 404 shows as a reason on the page.

| Calls | Endpoint |
|---|---|
| `history.loadSet()` | `GET /sets/{id}` |

Backend: bb#75.

## Board results — `/boards/:id/results`

**Logged in, and only after you finished that board** (403 otherwise).
Built by #30; Daylight's colours (your tables navy-tinted) by #163. Reached from a board's review or the result dialog's **Compare with other tables**.
Titled **Board results** (#189): a board can be played at several tables,
in a different place in each set, so no number.

The same board at every table, best N-S score first, each with its
contract, declarer, score and matchpoints. The tables you sat at are
highlighted with your side's matchpoint percentage. At the top, who is
vulnerable as a red/green chip ("Vulnerable: Both (you too)", #151) and
who dealt. Above the list, the
board's double dummy table (#119): the tricks each declarer (N E S W) makes
in each strain (♣ ♦ ♥ ♠ NT) with every card in view and best play on both
sides, your contract marked, so every result can be held up against what
was possible ("being worked out…" while the backend solves it, "isn't set
up on this server" on a server without the solver). Tapping a
row opens that table's [review](#board-review--playingsid). A 403 or 404
shows as a reason on the page, not as an error.

| Calls | Endpoint |
|---|---|
| `history.loadResults()` | `GET /boards/{id}/results` |
| `history.loadDoubleDummy()` (after the results; once more 5 s later if pending) | `GET /boards/{id}/double-dummy` |

Backend: bb#43, bb#114 (double dummy).

## Board review — `/playings/:id`

**Logged in, and only after you finished that board** (403 otherwise; 404
for an unknown or unfinished playing). Built by #48; Daylight's colours by #163. Reached from a history
entry (yours or another player's) or a row of Board results; not in the
menu. The play page shows the same review in a sheet (#97: `BoardReview`
and `useBoardExport` serve both). It works the same after the table is gone.

Titled **Board 2 of 4 review**, the board's place in its set (the
review's `set`, bb#146; #189), or **Board review** for a board outside any
set; never the board's number in the database.

One table's playing of a board, replayed, with the board's details in
the table's corners as on the play page (#180; nothing above the table):
who is vulnerable top left (#151; "(you)" only if you played it), the
contract top right ("4♠X by South", or "Passed out") with the tricks each
side has won at the step shown under it ("NS 3 · EW 2"), and the four
hands face up (you at the bottom if you played it, otherwise South).
Before the opening lead the middle of the table holds the **auction**,
with every alert of the board (public once it is over) marked and popped
up as on the play page, and the bottom-right corner a small **double
dummy** grid (declarers N E S W down, ♣ ♦ ♥ ♠ NT across, this contract's
cell marked), only once the backend has solved it, and the **opening
leader's cards** (declarer's left, wherever they sit) each carry a small
pill right after the rank (#212): the tricks the **defence** makes double
dummy if that card is led (13 less declarer's), green for the best leads,
the lead made ringed amber, each said in full to a screen reader ("King
of spades: the defence makes 4, a best lead"). That hand is drawn a step
larger while the pills show; on a narrow table, at a side seat, its suits
lie two by two so the middle keeps its room. From the first card
the middle shows the trick instead, the grid and the pills go; back at
the start they return. The table keeps the height it had before the lead,
so the stepper never moves. The middle keeps one height for both, and the grid's corner
keeps its room (beside your hand, or on a narrow phone in a row of its own
under it), so nothing moves. A stepper moves card by card or a trick at a time (start, previous
trick, previous card, next card, next trick, end); the hands lose their
cards as they go but keep the room they took as dealt, so the buttons stay
in the same place at every step (#59). The line saying where you are
(trick and card) sits under the buttons. The result panel shows once the
replay reaches the end, and **Results** (header) / **Results at every
table** go back to the board's results. The page is as wide as the play
page (832 px at most), so the table reads the same.

Under the stepper, the result (at the end), then the **opening lead** in
words (#119, #212), once the double dummy analysis is ready, counted for
the defence like the pills ("Your lead ♠K: the defence can make 3. Best
was ♥2: 4."), and the board's whole chat (#102), partner's messages to the
opponents included, since the board is over. While the backend is still
solving the board, or on a server without the solver, the review says
nothing about it (the corner stays empty); a pending one is read once
more 5 s later and appears if ready. A passed-out board has only the deal,
its auction in the middle for good, the result and the double dummy grid;
a board that ended by a claim stops where the claim was made.

Boards finished before the backend kept their calls and cards (before
bb#60) say "The auction and play of this board weren't recorded" above
the table and show only the deal, the contract and the result (the
middle of the table keeps the board's dealer and vulnerability).

**Export** (header, #71) opens a menu to take the board out of the app:

- **Copy as text**: a plain summary for a chat: board ("Board 2 of 4",
  its place in the set, #189), dealer and
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
  of the board (no app menu or header): "Board 2 of 4", the board line (dealer and
  "Vulnerable: E-W (you)" in plain text, black and white) and result, the
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

**Logged in.** Built by #24; "Boards played" by #30; bans by #75; stats by #131; Daylight's colours by #163. Reached from the
profile sheet (tap a seated player's name on Tables or Play,
then **Full profile**; a robot's sheet has no such link).

A player's public profile (name, username with the **Admin** badge for an
admin (#77), description, never the email), their **stats** and their
finished boards, paged and grouped by set like My boards (each opens its
review).

**Stats** (#131), under the description, read again on every visit and
on Refresh, never for a robot:
- **Sets**: "12 played · 7 won (58 %) · avg 54.2 %": sets completed with
  the player still in their seat, those their side won, and their
  average matchpoints over the sets another table has played.
- **Boards**: "48 played · 31 won (65 %) · avg 56.0 %", a board won with
  more than half the matchpoints; "40 compared with other tables" when
  some boards have nothing to compare with yet (they count only in
  played).
- **Left early**: "2 abandoned (8 %)", the sets they walked out on (a
  robot took their seat, or the set ended as they left) out of all their
  sets, with why ("1 out of time · 1 moved table").

"—" stands for nothing to average yet, and a line under them explains
what won means. While they load a skeleton stands in; a failed read says
"Couldn't load the stats." with **Retry**, and the rest of the page
stays.

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
| `users.loadStats(id)` (`PlayerStats`; your own profile `loadStats(null)`) | `GET /users/{id}/stats` (yours: `GET /api/user/stats`) |
| `history.loadHistory(id)`, `history.loadMore(id)` | `GET /users/{id}/playings?page=N` |
| `users.ban()` (admins) | `POST /users/{id}/ban` |
| `users.liftBan()` (admins) | `DELETE /users/{id}/ban` |

Backend: bb#21 (public profiles), bb#43 (other users' boards), bb#77 (bans), bb#121 (stats).

## Shared pieces

| Piece | Where | Calls |
|---|---|---|
| `AppHeader` | every page | none (reads the auth store; **Your table** from the tables store's `myTable` via `useYourTable`; the menu button collapses the pinned menu; `BanBanner` under it while you are banned; an optional second line under the title, the play page's **Board 2 of 4 · Set 3**, #171) |
| `BanNotice` | the app shell | none (shows `auth.banNotice` after `UserBanned`, goes to Login) |
| `BanUserForm` | User profile, profile sheet (admins) | `users.ban()` → `POST /users/{id}/ban` |
| `AppMenu` | the app shell | none (reads the auth store; **Your table** first while seated, via `useYourTable`) |
| `BoardReview` | Board review, Play (`BoardReviewModal`) | none (given the review from `history.loadReview`) |
| `PlayerProfileSheet` | Tables, Play, Board review; headed by the player's avatar (#163) | `users.load()` → `GET /users/{id}`; one line of stats ("48 boards · 65 % won · avg 56.0 %", none for a robot) via `PlayerStats` → `GET /users/{id}/stats`; for a robot instead, **How robots bid** (SAYC-style, 15–17 1NT, Stayman and transfers…, and that its special calls are alerted to its partner too: static text in `utils/robots.ts`, #203); **Ban** for admins (`BanUserForm`); at the game table a manager's **Remove from the table** (`removable`, the page sends it, #181), greyed out mid-set with the reason in a pop-up (`removeBlocked`, #190) |
| `PlayerStats` | User profile, Account, profile sheet (one line) | `users.loadStats()` → `GET /users/{id}/stats` or `GET /api/user/stats` (#131) |
| `PlayerAvatar` | profile sheet, each search result (#163) | none |
| `StartBox` | Play (the table's centre while the next board waits for Start, #181): the waiting line, **Start** / **Cancel**, the Start timer's countdown | none (the page sends Start; reads `ready` / `start_deadline` from the table) |
| `TableSettingsDialog` | Play (the gear in the table's corner, a manager's, between sets) | none (the page sends `tables.updateSettings()` → `PATCH /tables/{id}`) |
| `RobotBadge` | profile sheet | none (`is_robot` on the user; the plates show a robot's icon, the lobby's compass a blue seat) |
| `AdminBadge` | Play (every plate), profile sheet, User profile | none (`is_admin` on the user, #77) |
| `SeatMenu` | Play (an empty seat tapped, #192): Sit here / Move here, a manager's Seat a player… and Add robot | none (the page sits, seats or adds a robot) |
| `SeatPlayerSheet` | Play (managers, an empty seat's menu) | `useUserSearch` → `GET /users?search=` (300 ms debounce, 2 characters minimum) |
| `HistoryList` | My boards, User profile | `history.loadHistory` / `loadMore` |
| `SetResultsPanel` | Play (set over, under the table), Set results | none (given the set from `history.loadSet`) |
| `SetStrip` | Play (finished board), Tables and Home (Your table) | none (the set's tiles, from `history.sets`) |
| `YourTableHero` | Tables, Home | `history.loadSet()` → `GET /sets/{id}` once a board of the running set is finished |
| `TableCard` | Tables | none (one open table with its mini compass) |
| `YourForm`, `RecentBoards` | Tables, Home | `users.loadStats(null)` → `GET /api/user/stats`; `history.loadHistory(null)` → `GET /api/user/playings` |
| `AwayNotice` | Play (one line while others are away, no countdown); Play, Tables, Home (your held seat, counting down); an orange-tint banner (#163) | none (reads `away_since` / `replace_at` from the table) |
| `AwaySeatTag` | Play (`BridgeTable`): an away seat's clock | none (`replace_at` via `useAwayTags`) |
| route progress bar, boot bar, toasts | the app shell | none (#18) |
