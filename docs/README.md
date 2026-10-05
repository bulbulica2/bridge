# Bridge Frontend Docs

[![CI](https://github.com/bulbulica2/bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/bulbulica2/bridge/actions/workflows/ci.yml)

Living documentation for the `bridge` single-page app (SPA): the Ionic Vue 3
client that players use to log in, sit at a table, bid, play and compare
their results. It talks to the `bridge_backend` API over HTTP (Sanctum
session cookies) and gets live table updates over websockets (Laravel
Reverb).

Source repo: https://github.com/bulbulica2/bridge
Stack: Vue 3.5, Ionic 8, Vite 5, TypeScript, Pinia, axios, Laravel Echo,
Capacitor 7 (for native builds, not set up yet), Vitest and Cypress.

Files here:
- [`RUNNING.md`](RUNNING.md): install, `.env`, the dev server on port 3000
  (and why), running it next to the backend, and the tests. **Start here.**
- [`ARCHITECTURE.md`](ARCHITECTURE.md): how the code is laid out, the
  routes and their guard, the stores and services, error handling, loading
  feedback and realtime.
- [`SCREENS.md`](SCREENS.md): every page, what it shows, which store actions
  and endpoints it calls, and which backend issues it depends on.
- [`GAME-RULES.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/GAME-RULES.md)
  (in the backend repo): what contract bridge is, if you don't know the game.

The backend defines the contract, so these files link to
[the backend's docs](https://github.com/bulbulica2/bridge_backend/blob/main/docs/README.md)
for endpoint shapes
([`API.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/API.md))
and the cookie/CORS flow
([`AUTH.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/AUTH.md))
instead of repeating them. How the robot players bid and play is in
[`ROBOTS.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/ROBOTS.md).

> These describe the code as it is, not as planned. Status accurate as of
> branch `bulbulica2/77-player-stats` (after
> #131, a player's **stats** (sets and boards played, won and their
> average matchpoints, sets left early) on their profile, your own on the
> Account page, and one line in the profile sheet; after
> #130, the player on turn has a minute: the play page counts it down
> ("Your turn · 0:42", red in the last 15 s; "Waiting for East · 0:42"
> for the others), the tab's title pings while hidden, and running out
> hands the seat to a robot for the rest of the set (no set is forfeited
> any more), told to the table and on Home; after
> #136, the cards are twice as large by default, with a **Card size**
> setting on the Account page (Normal / Large / Extra large), every card in
> your hand at least 44 px to tap, and the hand wrapping two suits a row
> on a phone; after
> #137, the claim sheet opens with every remaining trick picked, so one
> tap claims them all; after
> #133, the play page no longer jumps from card to card: every seat keeps
> room for the turn label, the status line keeps two lines, and the
> trick's foot keeps its height with or without **Last trick**; after
> #132, **Create table** always opens the new table's page, with or
> without robots, and seats you South; after
> #134, the side menu is 320 px wide and its **Your table** entry stays on
> one row whatever its status badge says; after
> #120, both players who must answer a claim get Accept / Reject at once,
> and a refused claim (rejected, withdrawn or expired) keeps Claim
> disabled for everyone until the next card; after
> #119, a finished board's double dummy table and opening-lead analysis
> on the review, the table on the results page and one line under the
> result at the table; after
> #121, Leave and Remove work once a set is over: the play page's Start
> box has them, the Tables page says where you sit with a Leave, and a
> failed confirmation is toasted and logged; after
> #118, your own hand always reads ♥ ♣ ♦ ♠ and dummy's (or a robot
> declarer's) cards trumps first; after
> #116, only the away player the board waits for had a forfeit
> countdown (replaced by the turn clock in #130); after
> #115, the board chat is for the whole table during the board too,
> with **Opponents** for what partner mustn't read; after
> #114, the board stays centred beside the open chat; after
> #102, each board has a chat: to the opponents only while it is bid or
> played, to the whole table between boards, with **Ask in the chat** on
> an opponent's call and the whole chat in the board's review; see
> [`SCREENS.md`](SCREENS.md#play--tablesidplay); after
> #101, players alert their calls for the opponents and may ask about the
> opponents' calls; see [`SCREENS.md`](SCREENS.md#play--tablesidplay); after
> #98, a set's next board is dealt by itself 10 s after a board ends,
> counted down on the play page, with an optional **Deal now**; see
> [`SCREENS.md`](SCREENS.md#play--tablesidplay); after
> #96, a claim nobody answers within 10 s is off, with a countdown on
> everyone's screen; see
> [`SCREENS.md`](SCREENS.md#play--tablesidplay); after
> #97, the play page reviews and exports the table's finished boards in a
> sheet while the game goes on; see
> [`SCREENS.md`](SCREENS.md#play--tablesidplay); after
> #104, live game updates arrive compact, cards and calls as ids, and the
> app expands them; see
> [`ARCHITECTURE.md`](ARCHITECTURE.md#realtime); after #95, when your robot
> partner declares you play both its hand and yours; see
> [`SCREENS.md`](SCREENS.md#play--tablesidplay); after #91, unit tests cover 98.8 % of the app's lines,
> and CI fails any PR that leaves a file under 95 %; see
> [`RUNNING.md`](RUNNING.md#code-coverage); after #75, an admin can ban a
> player for some days, and a banned player is thrown out at once and sees
> why; see [`ARCHITECTURE.md`](ARCHITECTURE.md#bans)).
> They live next to the code, so a PR that changes a route, store, service,
> env var or backend dependency updates them in the same diff; the
> frontend's `CLAUDE.md` tells Claude to do so. If you change the frontend
> by hand, update them yourself or ask Claude to "refresh docs/".
