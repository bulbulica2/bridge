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
- Seeded user: `email@email.com` / `pass` (`database/seeders/game/UserSeeder.php`).

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
page will display). Checking CORS alone:
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
