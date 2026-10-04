# Running the frontend locally

_Last verified: branch `bulbulica2/62-auto-next-board`._

Requirements: Node.js 18 or newer (Vite 5 needs it; 23 works) with npm
(`.nvmrc` names 22, the LTS that CI uses; `nvm use` picks it up), and
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
| API | `bridge_backend` | `php artisan serve --host=localhost` (port 8000; see [Local speed](#local-speed) for the `--host`) | everything |
| Websocket server | `bridge_backend` | `php artisan reverb:start` (port 8080) | live updates |
| Queue worker | `bridge_backend` | `php artisan queue:work --sleep=0.1` | live updates (broadcasts are queued), robots (every robot move is a queued job), and a set's next board being dealt by itself 10 s after a board ends (bb#97; without it the table stays on the finished board until everyone presses **Deal now**) |
| Scheduler | `bridge_backend` | `php artisan schedule:work` | freeing idle seats, and mid-set marking a quiet player away and forfeiting their side's set after 3 minutes (`tables:check-away`, every 10 s). Without it nobody is ever shown away, and a Leave mid-set holds the seat for good |
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


## Local speed

On Windows, `php artisan serve` is PHP's built-in web server, and three things
about it decide how fast the app feels locally. Measured on this machine
(Windows 11, PHP 8.2, #55), timing "Create table" with robots up to the
answer the game page draws from:

| Backend started with | Create → dealt board |
|---|---|
| `php artisan serve` | ~850 ms |
| `php artisan serve --host=localhost` | ~430 ms |

- **Start it with `--host=localhost`.** Plain `php artisan serve` listens
  on `127.0.0.1` only, but the SPA calls `http://localhost:8000` (it has
  to, for the cookies; see [Why port 3000](#why-port-3000)). Windows
  resolves `localhost` to IPv6 `::1` first, finds nothing listening there,
  and the browser falls back to IPv4 after a 200–300 ms delay. The built-in
  server closes every connection after one answer, so **every request**
  pays that delay (a request measured ~140 ms through `127.0.0.1` and
  ~350 ms through `localhost`). `--host=localhost` listens on `::1`, which
  is the address `localhost` tries first, so the delay is gone. Keep using
  `localhost` everywhere then: `http://127.0.0.1:8000` no longer answers.
- **Requests run one at a time.** The built-in server answers one request
  before it reads the next, so requests the SPA sends together still queue.
  `PHP_CLI_SERVER_WORKERS=4` would let it answer four at once, but only on
  macOS/Linux: PHP can't fork on Windows, and there it changed nothing
  (four parallel requests took ~520 ms either way, four times one). This is
  why the game page waits only for the board on the way in (see
  [ARCHITECTURE.md](ARCHITECTURE.md), Table pages).
- **`DEBUGBAR_ENABLED=false` makes no measurable difference** for the API
  (~150 ms per request either way): the debugbar only renders into HTML
  pages, and the JSON endpoints the SPA calls stay as cheap as without it.
  Leave it as you like.

One backend cost is not about the server: `POST /tables` with robots
spends about 165 ms per robot it has to **create** (it hashes a password
for each one, with bcrypt at `BCRYPT_ROUNDS=12`). Robots are reused once
idle, but a table only robots keep stays theirs for 10 minutes, so
creating robot tables one after another locally creates three robots each
time and adds ~0.5 s to Create. That is a backend fix, not something the
SPA can avoid.

## Commands

```bash
npm run dev          # dev server on http://localhost:3000, hot reload
npm run build        # type-check (vue-tsc), then production build to dist/
npm run preview      # serve dist/ (see the port note above)
npm run lint         # eslint .
npm run test:unit    # Vitest in watch mode
npm run test:unit:ci # Vitest, one pass
npm run test:coverage # Vitest, one pass with coverage and its 95 % rule (what CI runs)
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
save; `npm run test:unit:ci` (`vitest run`) is a single pass.

### Code coverage

`npm run test:coverage` runs the suite once with V8 coverage (#91) and
fails if the app slips under **the 95 % rule**:

- **Every file** under `src/` keeps at least **95 % of its lines** covered
  (`scripts/coverage-check.mjs`). A new page, store or util ships with the
  tests that cover it, and touching a file never leaves it under the line.
- **The whole app** keeps 95 % of lines, statements and functions, and 90 %
  of branches (the thresholds in `vite.config.ts`). Branches count every
  `v-if` and `?.` a Vue template compiles to, which is why their bar is
  lower; raise it as tests catch up, never lower it.

It prints a table per file, then the totals; `coverage/index.html` (git
ignored) is the browsable report, with the uncovered lines highlighted.
Every file under `src/` is counted, whether a test imports it or not, except
`src/main.ts` (it only mounts the app) and `.d.ts` files.

As of #91: 98.8 % of lines, 95.7 % of functions and 91.5 % of branches, every
file at 95 % of lines or more (from 86.7 % / 75.1 % / 88.0 % before it).

**End-to-end tests** (Cypress) live in `tests/e2e/`. They drive a real
browser against `baseUrl: http://localhost:3000` (`cypress.config.ts`), so
start `npm run dev` first.

```bash
npm run test:e2e                                      # all specs, headless
npx cypress open                                      # interactive runner
npx cypress run --spec "tests/e2e/specs/home.cy.ts"   # one spec
```

Right now the only spec is `home.cy.ts`, a smoke test of what a guest sees
on `/` (redirect to `/home`, the intro, Log in and Create account, Log in
reaching `/login`). It stubs `GET /api/user` as 401, so it needs **no
backend**. Flows behind a login (tables, a scripted board) are issue #34.

## Continuous integration

Every pull request against `main` (when opened, reopened, and on every push
to it), every push to `main` and a manual run (Actions → CI → Run workflow)
start the **CI** workflow, `.github/workflows/ci.yml`. It runs four jobs in
parallel on Ubuntu, each a check of its own on the PR:

| Check | What it runs | Reproduce locally |
|---|---|---|
| `lint` | ESLint | `npm run lint` |
| `unit` | Vitest, one pass with coverage and the 95 % rule | `npm run test:coverage` |
| `build` | `vue-tsc` type-check + `vite build` | `npm run build` |
| `e2e` | builds, serves `dist/` on port 3000, runs Cypress | `npm run build`, then `npx vite preview --port 3000 --strictPort` and, in another terminal, `npm run test:e2e` |

- **Node** comes from `.nvmrc` (22). Every job installs with `npm ci`, so a
  `package-lock.json` out of step with `package.json` fails it: commit the
  lockfile.
- **No backend, no secrets.** The committed `.env` is all the build needs,
  unit tests mock the API, and the e2e spec is a guest-only smoke test that
  stubs the session check. Anything needing a login isn't run in CI yet.
- **e2e uses `vite preview`, not `npm run dev`**: the dev server compiles
  each module on first request, which can outlast Cypress's 4 s timeout on
  a cold runner; preview serves the built bundle (and `index.html` for any
  SPA route).
- **Coverage**: the `unit` job writes the totals (and any file under 95 %
  of its lines) to the run's **Summary** page and uploads the HTML report as
  `coverage-report` under **Artifacts**, pass or fail.
- **A failed e2e run** uploads Cypress's screenshots: open the run (the
  check's **Details**, then **Summary**) and download
  `cypress-screenshots` under **Artifacts**.
- A new push to the same PR cancels the run still going for the old one.
- **Case matters on CI.** Ubuntu's file system is case-sensitive and
  Windows' isn't, so an import like `@/components/appHeader.vue` for
  `AppHeader.vue` passes locally and fails `unit`/`build` there: fix the
  import.
- The build's "Some chunks are larger than 500 kB" is a warning and doesn't
  fail `build`.

The four check names are what `main`'s branch protection requires, so
renaming a job means updating that rule too.

## Native builds (Capacitor)

`capacitor.config.ts` declares `webDir: 'dist'`, so native apps are built
from the production build, not the dev server: `npm run build`, then
`npx cap sync`. No `android/` or `ios/` project has been added yet, and the
app id is still the starter's `io.ionic.starter`.

Smoke test, once everything runs: http://localhost:3000 shows Home, and
logging in as the admin lands on Account with a welcome toast.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the code is organised and
[`SCREENS.md`](SCREENS.md) for what each page does.
