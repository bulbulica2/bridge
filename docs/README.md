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
> branch `bulbulica2/70-one-forfeit-clock-at-a-time` (after
> #116, only the away player the board waits for has a forfeit
> countdown, the others are shown away with no clock; after
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
