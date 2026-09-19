# Backend facts, runtime verification & troubleshooting

## How the frontend talks to bridge_backend

- Laravel 11 + **Sanctum SPA (cookie/session) auth**, not bearer tokens.
- Flow: `GET /sanctum/csrf-cookie` → sets `XSRF-TOKEN` cookie → state-changing
  request with `X-XSRF-TOKEN` header (axios does this via `withXSRFToken: true`)
  → session cookie authenticates later calls. `GET /api/user` = "who am I".
- Auth routes (`routes/auth.php`) live at the root, not under `/api`:
  `/login`, `/register`, `/forgot-password`, `/reset-password`, `/logout`.
  `/login` and `/register` return **204** with no body.
- Validation failures: **422** `{"message": "...", "errors": {"field": ["..."]}}`.
  Unauthenticated: **401** `{"message": "Unauthenticated."}`.
- CORS (`config/cors.php`): `allowed_origins = FRONTEND_URL` (`http://localhost:3000`),
  `supports_credentials = true`. That's why Vite runs on port 3000 with `strictPort`.
- `.env` → `VITE_API_BASE_URL=http://localhost:8000`. Keep `localhost`, not
  `127.0.0.1`: cookies are scoped by host (not port), so the SPA on
  `localhost:3000` can only read the XSRF cookie if the API is also `localhost`.
- New env vars need a type in `src/env.d.ts`.
- Seeded user: `email@email.com` / `pass` (`database/seeders/game/UserSeeder.php`)
  — **but the dev DB is shared and gets rebuilt**, so that login can answer 422
  "These credentials do not match our records." Check with
  `timeout 20 /c/xampp/mysql/bin/mysql.exe -u root -e "SELECT id,username,email FROM bridge.users LIMIT 10;"`;
  if the seed users are gone, `POST /register` a throwaway user
  (`password123` / `password_confirmation`) and verify with that instead of
  re-seeding, which would wipe other sessions' data.

## Game endpoints (tables)

- They live at the **root**, not under `/api`: `/tables`, `/tables/{id}/seats`.
  Only `/api/user` is under `/api`. They're `auth` (session) routes, so an
  anonymous call gets `401 {"message": "Unauthenticated."}` — which is what an
  auth-required page keys its redirect on.
- Every game response is an envelope: `{"status": 200, "message": "...", "data": ...}`.
  The service unwraps `data.data`; the frontend `Table` type is the inner object.
- `GET /tables` is newest first, each table carrying `seats` (with `seats.user`)
  and `free_seats` (the unoccupied ones in `N, E, S, W` order). Only occupied
  seats appear in `seats`, so the view builds the four-seat row itself.
- `POST /tables` (201, `name` optional, `seat` defaults to `N`) seats the creator.
  `POST /tables/{id}/seats` (201, `seat` required) takes a free seat. Both answer
  with the same full table object, which is what lets the list update in place.
- **409s carry the reason in `message`**, in the same envelope, e.g.
  "You are already seated at a table." (a user holds exactly one seat across all
  tables), "You are already seated at a table. Leave it before creating another.",
  "You already have 3 active tables.", "Seat E is already taken.". Showing
  `message` verbatim is the right behavior; they're user-facing sentences.
- Bad `seat` values are a normal Laravel `422 {message, errors}`
  ("The selected seat is invalid."), not the envelope.
- A table exists only while someone sits at it: `DELETE /tables/{id}/seats`
  frees the user and deletes the table when the last player leaves — which is
  also how to **clean up after verifying** on the shared dev DB.

## Proving a backend flow works

Use the Bash tool with `curl`, **one request at a time**. `php artisan serve` is
single-threaded on Windows, so parallel or keep-alive clients (PowerShell's
`Invoke-WebRequest` sessions) can block it. Hit `127.0.0.1:8000` directly;
`localhost` tries `::1` first, which the server doesn't listen on.

```bash
cd "$(mktemp -d)"; B=http://127.0.0.1:8000
H=(-H "Origin: http://localhost:3000" -H "Referer: http://localhost:3000/" -H "Accept: application/json" --max-time 15)
echo "ping: $(curl -s -w ' HTTP %{http_code}' --max-time 8 $B/)"      # {"Laravel":"11.x"} HTTP 200
curl -s -o /dev/null -c jar "${H[@]}" $B/sanctum/csrf-cookie
X=$(awk '$6=="XSRF-TOKEN"{print $7}' jar | sed 's/%3D/=/g;s/%2F/\//g;s/%2B/+/g')
# change path + JSON body for the endpoint under test:
curl -s -w ' HTTP %{http_code}\n' -c jar -b jar "${H[@]}" -H "X-XSRF-TOKEN: $X" \
  -H 'Content-Type: application/json' -d '{"email":"email@email.com","password":"pass"}' $B/login
curl -s -w ' HTTP %{http_code}\n' -b jar "${H[@]}" $B/api/user
```

Check both the happy path and one failure (bad input → 422 with the message the
page will display). For a flow that involves two people (one creates a table,
another joins it), register two users and keep **one cookie jar per user**
(`-c jarA -b jarA`), switching jars instead of logging in and out. Re-read the
XSRF token from the jar before every state-changing call; a stale or missing
`X-XSRF-TOKEN` is `419 "CSRF token mismatch."`, not a 401. Checking CORS alone:
`curl -si -H "Origin: http://localhost:3000" http://127.0.0.1:8000/sanctum/csrf-cookie`
should show `Access-Control-Allow-Origin: http://localhost:3000` and
`Access-Control-Allow-Credentials: true`.

## Troubleshooting

**Requests hang / curl returns `HTTP 000`, nothing new in the `artisan serve` log.**
1. `Get-NetTCPConnection -LocalPort 8000`: many `CloseWait` rows on the php
   process means the server accepted connections but is stuck inside a request.
2. The `/` route doesn't touch the DB; sessions and cache do
   (`SESSION_DRIVER=database`, `CACHE_STORE=database`). If `/` answered once but
   CSRF/login hang, suspect MySQL:
   ```bash
   timeout 15 /c/xampp/mysql/bin/mysql.exe -u root --connect-timeout=5 \
     -e "SHOW FULL PROCESSLIST; SELECT COUNT(*) FROM bridge.users;"
   ```
   Queries sitting for hundreds of seconds (e.g. `delete from cache`, `select * from sessions`),
   an "InnoDB shutdown handler" thread, or a timeout on a trivial count = InnoDB is wedged.
3. Fix: MySQL must be restarted from the XAMPP Control Panel. **Ask the user**
   before doing it; other local projects share that MySQL server. Then restart
   `artisan serve` (kill whatever owns port 8000 first) and re-run the checks.

**Backend not running / connection refused.** Start it (see SKILL.md step 6).
First-time DB setup is in `bridge_docs/backend/RUNNING.md`
(`php artisan migrate --seed`; after migration edits, `migrate:fresh --seed`).

**Port 3000/8000 already in use by another worktree.** Each branch worktree
under `workspaces/bridge/` is a separate checkout but they share the machine's
ports. `Get-CimInstance Win32_Process -Filter "ProcessId = <pid>" | Select CommandLine`
shows which worktree a `node`/`php` process belongs to. Reuse a backend that's
already on 8000 (it serves the same `bridge_backend` checkout); for a Vite owned
by another worktree, ask the user before stopping it — that's another session's
running app.

**Port 3000 already in use.** `strictPort` makes Vite fail instead of silently
switching ports (which would break CORS). Find the owner with
`Get-NetTCPConnection -State Listen -LocalPort 3000` and stop the stale dev server.

**`gh pr create` fails with "unknown arguments".** PowerShell 5.1 mangled a
quoted `--body`; use `--body-file`.

**Git warns "LF will be replaced by CRLF".** Harmless on this Windows setup.
