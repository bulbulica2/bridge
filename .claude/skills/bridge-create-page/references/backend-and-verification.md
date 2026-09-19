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
  , **but the local DB is often not seeded at all** (`User::count()` returned 0
  on the issue #6 run, so every login/forgot-password 422s with "we can't find a
  user"). Check with
  `php artisan tinker --execute="echo App\Models\User::count();"`.
  Don't run the seeder to fix it: migrations/seeders touch the shared XAMPP DB.
  Instead create a throwaway user through the API (`POST /register`), which is
  what the SPA does anyway and leaves the rest of the data alone.
  The DB is shared with every other worktree and parallel session, so it can also
  change **mid-run**: on the issue #7 run `users` held exactly one row created by
  another session minutes earlier, and the seeded admin was gone. Don't trust a
  user you verified earlier in the same session; re-register if a login 422s.
- **Password reset links go to the frontend, not the backend.**
  `AppServiceProvider::boot` calls `ResetPassword::createUrlUsing` to build
  `<FRONTEND_URL>/password-reset/<token>?email=<email>`, i.e.
  `http://localhost:3000/password-reset/...`. Any page completing a reset must
  own that route (token as a path param, email as a query param).
- `MAIL_MAILER=log`, so no mail is sent: the rendered email, **including the
  reset link and its token**, lands in `bridge_backend/storage/logs/laravel.log`.
  Grab the newest link with
  `grep -o '[^ "<]*password-reset[^ "<]*' storage/logs/laravel.log | tail -1`.

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
our records"), plus replaying the spent token (422). Checking CORS alone:
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

**Port 3000 already in use.** `strictPort` makes Vite fail instead of silently
switching ports (which would break CORS). Find the owner with
`Get-NetTCPConnection -State Listen -LocalPort 3000` and stop the stale dev server.

**`gh pr create` fails with "unknown arguments".** PowerShell 5.1 mangled a
quoted `--body`; use `--body-file`.

**Git warns "LF will be replaced by CRLF".** Harmless on this Windows setup.
