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
- The two password-reset routes answer **200** `{"status": "<human message>"}`
  (not 204 like login/register), so the page can show the backend's own wording:
  - `POST /forgot-password` `{email}` -> "We have emailed your password reset link."
    Unknown address -> 422 `errors.email` "We can't find a user with that email address."
  - `POST /reset-password` `{token, email, password, password_confirmation}` ->
    "Your password has been reset." A spent or wrong token -> 422 `errors.email`
    "This password reset token is invalid."; a bad confirmation -> 422
    `errors.password`. The reset does **not** log the user in, so send them to `/login`.
- CORS (`config/cors.php`): `allowed_origins = FRONTEND_URL` (`http://localhost:3000`),
  `supports_credentials = true`. That's why Vite runs on port 3000 with `strictPort`.
- `.env` → `VITE_API_BASE_URL=http://localhost:8000`. Keep `localhost`, not
  `127.0.0.1`: cookies are scoped by host (not port), so the SPA on
  `localhost:3000` can only read the XSRF cookie if the API is also `localhost`.
- New env vars need a type in `src/env.d.ts`.
- Seeded user: `email@email.com` / `pass` (`database/seeders/game/UserSeeder.php`)
  — **but don't trust it**: the dev DB is shared with every other worktree and
  parallel session, gets rebuilt, and can change **mid-run** (the issue #6 run
  found `User::count()` 0; the issue #7 run found a single row another session
  had created minutes earlier, with the seeded admin gone). A missing user makes
  login/forgot-password answer 422 ("These credentials do not match our records."
  / "we can't find a user"). Check with
  `php artisan tinker --execute="echo App\Models\User::count();"` or
  `timeout 20 /c/xampp/mysql/bin/mysql.exe -u root -e "SELECT id,username,email FROM bridge.users LIMIT 10;"`.
  Don't re-run the seeder — migrations/seeders touch the shared XAMPP DB and
  would wipe other sessions' data. Instead `POST /register` a throwaway user
  (`password123` / `password_confirmation`), which is what the SPA does anyway,
  and re-register if a login you made earlier in the same session starts 422ing.
- **Password reset links go to the frontend, not the backend.**
  `AppServiceProvider::boot` calls `ResetPassword::createUrlUsing` to build
  `<FRONTEND_URL>/password-reset/<token>?email=<email>`, i.e.
  `http://localhost:3000/password-reset/...`. Any page completing a reset must
  own that route (token as a path param, email as a query param).
- `MAIL_MAILER=log`, so no mail is sent: the rendered email, **including the
  reset link and its token**, lands in `bridge_backend/storage/logs/laravel.log`.
  Grab the newest link with
  `grep -o '[^ "<]*password-reset[^ "<]*' storage/logs/laravel.log | tail -1`.

## Game endpoints (tables)

- They live at the **root**, not under `/api`: `/tables`, `/tables/{id}/seats`.
  Only `/api/user` is under `/api`. They're `auth` (session) routes, so an
  anonymous call gets `401 {"message": "Unauthenticated."}`.
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
- `GET /tables/{id}` returns one table in the same envelope and shape as the
  list. An unknown or already-deleted id is a **plain Laravel 404**
  (`{"message": "No query results for model [App\\Models\\Table] 9", "exception": …}`),
  not the envelope — so a page must supply its own "no longer exists" wording
  instead of echoing `message` like it does for a 409.
- A table exists only while someone sits at it: `DELETE /tables/{id}/seats`
  frees the user and deletes the table when the last player leaves — which is
  also how to **clean up after verifying** on the shared dev DB. All verified
  against the running backend on the issue #15 run:
  - someone else still seated → **200** with the full table, `message`
    "You left the table.", and `moderated_by` **handed to the earliest-joined
    remaining player** (seen going 318 → 319), so manager status changes under
    an open page;
  - last player out → **200** whose `data` is `{"table_deleted": true}`
    **instead of a table**, message "… Nobody was left, so the table was
    deleted."; the id 404s from then on, so don't re-fetch it;
  - not seated but the table still exists → **409** "You are not seated at this
    table.". Note the asymmetry: `DELETE /tables/{id}/seats/{user}` answers
    **404** for that same condition, because there the seat is named in the URL.
- `is_admin` is **hidden from `GET /api/user`**, so the SPA cannot tell whether
  the current user is an admin and cannot fully evaluate `TablePolicy::manage`
  (moderator, or creator while still seated, **or any admin**). Compute manager
  status as a hint for what to render and let a 403 correct it. The clean fix is
  a computed `can_manage` on the backend's `TableResource`.

## Proving a backend flow works

Use the Bash tool with `curl`, **one request at a time**. `php artisan serve` is
single-threaded on Windows, so parallel or keep-alive clients (PowerShell's
`Invoke-WebRequest` sessions) can block it. Hit `127.0.0.1:8000` directly;
`localhost` tries `::1` first, which the server doesn't listen on.

Three things that cost time on the issue #15 run:

- **The Bash tool resets its working directory between calls**, so `cd "$(mktemp -d)"`
  in one call leaves the cookie jar unreachable in the next. Put jars at an
  absolute path in the session scratchpad (`$S/jarA`) and pass `-c "$J" -b "$J"`,
  or keep a whole flow inside one call.
- **Don't scrape ids with `sed`.** `sed -n 's/.*"id":\([0-9]*\).*/\1/p'` is
  greedy and returns the *last* `"id":` in the payload — the nested `user.id`,
  not the table's — so the rest of the flow then probes a table that never
  existed. Parse properly: `python -c "import json;print(json.load(open(r'$S/r.json'))['data']['id'])"`.
- **Always truncate error bodies** (`| head -c 200`, or parse out `message`).
  `APP_DEBUG=true` makes a 404 answer with a full stack trace that is tens of
  thousands of characters.

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

For an auth-state change, verify the **whole session cycle** rather than one
call, because that is what the router guard and `loadSession()` depend on
(each state-changing call needs a fresh `X-XSRF-TOKEN`, so re-read the cookie
between them):

```bash
# register → 204, /api/user → 200, logout → 204, /api/user → 401, login → 204, /api/user → 200
curl -s -w ' HTTP %{http_code}
' -c jar -b jar "${H[@]}" -H "X-XSRF-TOKEN: $X" -X POST $B/logout
curl -s -w ' HTTP %{http_code}
' -b jar "${H[@]}" $B/api/user   # {"message":"Unauthenticated."} HTTP 401
```

Check both the happy path and one failure (bad input → 422 with the message the
page will display). For a multi-step flow verify the *effect*, not just the
final 200: the issue #6 run proved the reset by logging in afterwards with the
new password (204) and with the old one (422, "These credentials do not match
our records"), plus replaying the spent token (422). For a flow that involves
two people (one creates a table, another joins it), register two users and keep
**one cookie jar per user** (`-c jarA -b jarA`), switching jars instead of
logging in and out. Re-read the XSRF token from the jar before every
state-changing call; a stale or missing `X-XSRF-TOKEN` is
`419 "CSRF token mismatch."`, not a 401. Checking CORS alone:
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
