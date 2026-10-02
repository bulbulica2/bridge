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
> branch `bulbulica2/57-ci-tests-on-pr` (after #87, every PR to `main` runs
> lint, unit tests, the build and a guest e2e smoke test on GitHub Actions;
> see [`RUNNING.md`](RUNNING.md#continuous-integration)).
> They live next to the code, so a PR that changes a route, store, service,
> env var or backend dependency updates them in the same diff; the
> frontend's `CLAUDE.md` tells Claude to do so. If you change the frontend
> by hand, update them yourself or ask Claude to "refresh docs/".
