# Running the frontend locally

_Last verified: branch `bulbulica2/38-robots`._

Requirements: Node.js 18 or newer (Vite 5 needs it; 23 works) with npm, and
a running `bridge_backend` (see [Running it with the backend](#running-it-with-the-backend)).
`node_modules/` isn't committed; `npm install` builds it from
`package-lock.json`.

```bash
git clone https://github.com/bulbulica2/bridge.git
cd bridge

# first time / after pulling dependency changes
npm install

# start the dev server (hot reload)
npm run dev
```

Then open **http://localhost:3000**. Nothing else to configure: `.env` is
committed with working local values (see below).

If Vite later reports a dependency it "could not resolve" after a pull, run
`npm install` again: an existing `node_modules` can be stale against a
changed lockfile.

## `.env`

`.env` is committed on purpose, because it holds no secrets (the Reverb
**key** is public; the secret stays in the backend's `.env`). For a local
override, create `.env.local` (gitignored) with just the keys you change.
Vite reads these at startup, so restart `npm run dev` after editing them.

| Key | Local value | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | where `bridge_backend` answers. **Keep it on `localhost`, not `127.0.0.1`**: cookies are scoped by host, not port, so the session and XSRF cookies the backend sets only reach the SPA on `localhost:3000` if the API is on `localhost` too. |
| `VITE_REVERB_APP_KEY` | `bridge-local-key` | must equal `REVERB_APP_KEY` in the backend's `.env` |
| `VITE_REVERB_HOST` | `localhost` | must equal `REVERB_HOST` |
| `VITE_REVERB_PORT` | `8080` | must equal `REVERB_PORT` |
| `VITE_REVERB_SCHEME` | `http` | `https` switches the socket to `wss://` (`forceTLS`) |

The Reverb keys came with live table updates (#21); see
[backend `RUNNING.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/RUNNING.md#realtime-reverb) for the
backend side.

## Why port 3000

`vite.config.ts` pins the dev server to port 3000 with `strictPort: true`,
so it **fails** instead of moving to 3001 when the port is taken. That's
deliberate:
- the backend's CORS `allowed_origins` is `FRONTEND_URL`, which defaults to
  `http://localhost:3000`;
- `localhost:3000` is one of Sanctum's stateful domains, the hosts that get
  session cookies instead of token auth
  ([backend `AUTH.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/AUTH.md#flow-for-a-frontend-spa)).

On any other origin every request fails CORS or comes back 401. If port
3000 is taken, find out who holds it (on Windows:
`Get-NetTCPConnection -State Listen -LocalPort 3000`) and stop that process
rather than changing the port.

The same applies to `npm run preview` (the production build, served on
Vite's preview port 4173): the backend refuses it unless you add that
origin to its CORS and Sanctum config.

## Running it with the backend

The SPA is useless without the API: even Home asks the backend whether you
are logged in. Start, each in its own terminal (details in
[backend `RUNNING.md`](https://github.com/bulbulica2/bridge_backend/blob/main/docs/RUNNING.md)):

| Process | Where | Command | Needed for |
|---|---|---|---|
| MySQL | XAMPP | XAMPP control panel, or `C:\xampp\mysql\bin\mysqld.exe --defaults-file=C:\xampp\mysql\bin\my.ini --standalone` | everything: the backend keeps sessions in the DB, so without MySQL every request 500s |
| API | `bridge_backend` | `php artisan serve` (port 8000) | everything |
| Websocket server | `bridge_backend` | `php artisan reverb:start` (port 8080) | live updates |
| Queue worker | `bridge_backend` | `php artisan queue:work --sleep=0.1` | live updates (broadcasts are queued) and robots (every robot move is a queued job) |
| Scheduler | `bridge_backend` | `php artisan schedule:work` | freeing idle seats (optional) |
| SPA | `bridge` | `npm run dev` (port 3000) | the app |

Without Reverb and the queue worker the app still works, but each browser
only sees its own actions: other players' seats, calls and cards show up on
the next reload or Refresh. A four-player game is painful that way. Robots
need the queue worker even more: without it they never move, and a table
waits on them forever (their moves all run once a worker starts).

Log in with the seeded admin, `email@email.com` / `pass` (the other seeded
users have the password `password`), or create an account from the Login
page. After `php artisan migrate:fresh --seed` the admin is seated and it
is their turn to call at the `Your call` table; see the backend's
[Seeded data](https://github.com/bulbulica2/bridge_backend/blob/main/docs/RUNNING.md#seeded-data).

To play a whole board alone, create a table with **Play with robots** (on
by default): robots take the other three seats and the board is dealt at
once. To play against other people locally you need one session each: use
separate browser profiles (or one normal and private windows of different
browsers), since the session cookie is per browser profile.

After pulling a backend change that edits an existing migration (as the
robots did, adding `users.is_robot` and `tables.unattended_since`), run
`php artisan migrate:fresh --seed` on the backend; a plain `migrate` won't
see it.

## Commands

```bash
npm run dev          # dev server on http://localhost:3000, hot reload
npm run build        # type-check (vue-tsc), then production build to dist/
npm run preview      # serve dist/ (see the port note above)
npm run lint         # eslint .
npm run test:unit    # Vitest in watch mode
npm run test:e2e     # Cypress, headless
```

## Tests

**Unit tests** (Vitest, jsdom) live in `tests/unit/` and need neither the
backend nor the dev server: they mock the services or `@/services/http`.

```bash
npx vitest run                              # the whole suite once
npx vitest run tests/unit/gameStore.spec.ts # one file
npx vitest run -t "ignores updates for another table"  # by test name
```

`npm run test:unit` starts Vitest in watch mode, which reruns on every
save; use `npx vitest run` for a single pass (as CI would).

**End-to-end tests** (Cypress) live in `tests/e2e/`. They drive a real
browser against `baseUrl: http://localhost:3000` (`cypress.config.ts`), so
start `npm run dev` and the backend first.

```bash
npm run test:e2e                                      # all specs, headless
npx cypress open                                      # interactive runner
npx cypress run --spec "tests/e2e/specs/test.cy.ts"   # one spec
```

Right now the only spec is the Ionic starter's `test.cy.ts`; real flows
(sign up, login, tables, a scripted board) are issue #34.

## Native builds (Capacitor)

`capacitor.config.ts` declares `webDir: 'dist'`, so native apps are built
from the production build, not the dev server: `npm run build`, then
`npx cap sync`. No `android/` or `ios/` project has been added yet, and the
app id is still the starter's `io.ionic.starter`.

Smoke test, once everything runs: http://localhost:3000 shows Home, and
logging in as the admin lands on Account with a welcome toast.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the code is organised and
[`SCREENS.md`](SCREENS.md) for what each page does.
