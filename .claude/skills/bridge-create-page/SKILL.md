---
name: bridge-create-page
description: End-to-end workflow for adding a new page to the bridge Ionic Vue frontend. It covers reading the GitHub issue and bridge_docs, building the view, route, menu entry and (when the page talks to bridge_backend) axios service + Pinia store + unit test, then verifying, committing, opening the PR and launching the app so the user can see it. Use this whenever the user wants a new page, screen or view in the bridge app (Create account, Reset password, Account, Tables, a settings screen), picks up a page-type issue or branch like "5-create-account-page", or says "you know what to do" on such a branch, even if they never say "page" explicitly.
---

# Create a page in the bridge frontend

This captures how the Login page (issue #4, PR #10) was built so every new page
comes out the same way: same file layout, same conventions, same verification,
same hand-off (PR opened + app running).

Templates live in `assets/` next to this file. Supporting knowledge lives in
`references/`:
- `references/components.md`: the Ionic/Vue components and helpers this app
  uses and how to use them correctly. Read it before building the view.
- `references/backend-and-verification.md`: backend facts, how to prove a
  backend flow works, and troubleshooting. Read it before wiring any request to
  bridge_backend or when something hangs or fails at runtime.

**This skill is a living document.** It started from a single page (Login) and is
meant to get smarter every time it's used. Step 8 (improve the skill) is part of
the job, not optional. A page isn't finished until the skill has learned from it.

## 0. Work efficiently

Most steps below contain several independent reads, checks or commands (reading
docs + source, build + lint + tests, starting backend + dev server). Issue those
in parallel in one response; only serialize when one result feeds the next.
Give the user a one-line progress note between phases so they're never left
wondering what's happening.

## 1. Understand what the page is

- The branch name encodes the issue: `N-some-slug` → `gh issue view N`. The
  issue body usually names the view file, the route path, guest-only /
  auth-required rules, which store/service to use, and dependencies.
- Check dependencies with `gh issue list --state all` and `gh pr list --state all`.
  If a dependency is merged but this branch predates it, `git fetch origin` and
  `git merge --ff-only origin/main` (or a normal merge if it can't fast-forward).
  Branches are often cut before their dependencies land, which is why this matters.
- **Fetch and merge `origin/main` again right before pushing.** Sibling branches
  are often built in parallel sessions and can land mid-run: on the issue #7 run,
  #6 merged while the page was being built and conflicted in `src/router/index.ts`,
  `src/stores/auth.ts`, the auth store spec, `CLAUDE.md` and this skill. Resolve by
  keeping **both** sides (both routes, both sets of store actions and tests), then
  re-run build + lint + tests before the PR.
- Don't use bare `git stash`; the stash is shared across worktrees.
- If the issue leaves a real product decision open (e.g. where to redirect after
  success when no page exists yet), pick the least surprising option, follow
  what sibling issues imply, and mention it in the PR, rather than stopping to ask.

## 2. Read before writing

Read in parallel:
- `CLAUDE.md` (architecture, conventions, port, test commands).
- `src/router/index.ts`, `src/components/AppMenu.vue`, `src/components/AppHeader.vue`,
  an existing view (e.g. `src/views/LoginPage.vue`), `src/main.ts`.
- If the page calls the backend: `C:\xampp\htdocs\bridge_docs\backend\API.md` /
  `AUTH.md` / `DATA-MODEL.md`, **and** the real source in
  `C:\xampp\htdocs\bridge_backend` (`routes/*.php`, the controller, its
  `FormRequest` rules). The docs are maintained separately and can lag, and the
  controller is the truth for field names, status codes (e.g. 204 No Content)
  and validation messages.
  The local backend checkout can lag `origin/main` too: after `git fetch`,
  compare with `git -C C:\xampp\htdocs\bridge_backend log -1 origin/main`. If docs and
  local code disagree, origin/main decides. Build against it and tell the user the
  local backend needs pulling. Don't pull it yourself, because migrations touch the shared DB.
- Existing `src/services/*.ts` and `src/stores/*.ts`, so you extend them rather
  than duplicate them (e.g. registration belongs in `services/auth.ts` +
  `stores/auth.ts`, not a new auth module).

## 3. Build the page

### View: `src/views/<Name>Page.vue`
- Plain page: start from `assets/PageTemplate.vue`.
- Form / backend page: start from `assets/FormPageTemplate.vue` (the Login page
  pattern: stacked Ionic inputs, submit button with spinner, danger-colored error
  text, secondary `router-link` buttons, content centered horizontally **and
  vertically**; the user explicitly asked for that centering and approved it).
- List page (a collection + a create modal + per-row actions): start from
  `assets/ListPageTemplate.vue` (the Tables page pattern: load on
  `onIonViewWillEnter`, spinner / error / empty-state / list branches,
  pull-to-refresh, an `ion-modal` for creation, toast for row-action failures).
  List pages are **not** vertically centered — that preference is about forms;
  a list starts at the top and only caps its width (`max-width` + `margin: 0 auto`).
- Detail page (one record behind a route param, e.g. `/tables/:id`): start from
  `assets/DetailPageTemplate.vue` (the Table detail pattern: read the id in
  `onIonViewWillEnter`, derive the record by comparing ids against the store's
  `current…`, four branches loading / gone / error / content, `alertController`
  before anything destructive, and a Refresh button next to the refresher
  because pull-to-refresh is unusable with a mouse). Width-capped like a list.
- Conventions: `<script setup lang="ts">`, import every Ionic component you use
  from `@ionic/vue` explicitly, wrap in `<ion-page>` with `<AppHeader title="…" />`,
  navigate programmatically with `useIonRouter().navigate(path, 'root', 'replace')`.

### Route: `src/router/index.ts`
Add a lazy-loaded entry: `{ path: '/foo', component: () => import('@/views/FooPage.vue') }`.
If the page is guest-only / auth-required, add `meta: { guestOnly: true }` or
`meta: { requiresAuth: true }` — nothing else. The app-wide `router.beforeEach`
guard (added in issue #7) already enforces both: `requiresAuth` → `/login`,
`guestOnly` → `/account`. Declare any new meta key in the `RouteMeta`
augmentation at the top of the same file so `to.meta.x` stays typed.
The guard awaits `authStore.loadSession()`, which calls `GET /api/user` once per
page load, so a reload straight onto an auth-only page keeps a valid Sanctum
session instead of bouncing to `/login`. Don't add per-page
`onIonViewWillEnter` redirects for auth any more. A `401` coming back **while
the page is open** is a different case — the session expired after the guard let
the user in — and belongs where the request is made (`TablesPage.vue` redirects
to `/login` there).
**One page can own more than one route.** If the backend emails or links to a
URL the issue didn't name, add that route too and point it at the same view,
switching stages on a route param (ResetPasswordPage.vue serves both
`/reset-password` and `/password-reset/:token`). Check for such URLs before
designing the page — grep the backend for `createUrlUsing` / notification
classes — otherwise the feature looks done but the emailed link 404s.

### Menu: `src/components/AppMenu.vue`
Add an `ion-item` only if the page belongs in the side menu. Pages reached from
another page's button (Create account, Reset password) are **not** menu items.
The menu is auth-aware (Login while logged out, Tables once logged in), so put a
new item in the branch it belongs to, guarded by `auth.isAuthenticated`.

### Auth-aware shell
`AppHeader.vue` and `AppMenu.vue` both call `useAuthStore()`, which means **any**
unit test that mounts a page now needs `setActivePinia(createPinia())` in
`beforeEach` — otherwise it fails with "getActivePinia() was called but there was
no active Pinia" (this bit `tests/unit/example.spec.ts`). The header renders the
"Account" button itself when logged in; the `end` slot stays free for per-page
actions and is rendered before it.

### Removing a stopgap the issue supersedes
When the issue introduces the real mechanism, delete the placeholders earlier
pages left behind, in the same PR: issue #7's router guard replaced the
`onIonViewWillEnter` guest-only redirects in `CreateAccountPage.vue` and
`ResetPasswordPage.vue`. Grep for the note the earlier page left
(`grep -rn "issue #7" src/`) — each page's stopgap comment names its owner.

### Backend wiring (only if the page calls the API)
- **Service** (`src/services/<domain>.ts`, see `assets/service-template.ts`): thin
  functions over the shared axios instance `@/services/http`. Never create another
  axios instance; `http.ts` already carries `withCredentials`, `withXSRFToken`
  and `Accept: application/json`, which Sanctum needs. For state-changing
  requests on a fresh session, call `GET /sanctum/csrf-cookie` first.
- **Store** (`src/stores/<domain>.ts`, see `assets/store-template.ts`): Pinia
  setup-style store holding the state; views call the store, not the service.
- **Errors**: reuse the Login page's error-message helper shape. Laravel returns
  422 `{message, errors: {field: [msg]}}`; no `response` means the server is
  unreachable.
- **Unit test** (`tests/unit/<domain>Store.spec.ts`, see `assets/store.spec-template.ts`):
  mock the service with `vi.mock`, and cover success and failure.
  `vi.clearAllMocks()` clears calls but **not** implementations, so a
  `mockRejectedValue` set in one test still applies in the next one. Don't set a
  test's fixture up by calling an action an earlier test made reject (e.g. reusing
  `login()` to get a logged-in store); seed the state through the action you're
  actually testing around, or re-mock explicitly.

### Links to pages that don't exist yet
Link to the route the owning issue names (e.g. `/create-account`), but don't
create that page; it belongs to its own issue. Say so in the PR.

### Docs
If you add a new architectural piece (new store/service domain, route meta, env
var), update `CLAUDE.md` in the same commit.

## 4. Verify

Run in parallel: `npm run build` (vue-tsc + vite), `npm run lint`, `npx vitest run`.
Run `npm install` first if `node_modules` is missing (fresh worktrees don't have it)
**or if Vite reports a dependency it "could not resolve"** — a `node_modules` that
exists can still be stale after the lockfile changes, and `pinia`/`axios` went
missing exactly that way. Fix anything that fails before committing. Don't commit red.

## 5. Commit, push, PR

- Default order: commit locally, launch (step 6), then push + PR. But on the last
  two runs the user asked to go straight to the PR, so when they say "commit and
  push", "do it now" or anything similar, do the whole flow — commit, push,
  create the PR — and show them the running page afterwards. Only hold the commit
  back if they ask to review first. Either way, ask before doing something that
  affects another session (e.g. taking over port 3000).
  **Exception — if they say up front to "go to the PR" / "take it all the way",
  don't pause for review**: verify, commit, push and open the PR in one run, then
  launch the app and report. Asking again after they've said that is the friction
  they were removing.
- Commit message style (the user's rule, also in CLAUDE.md "Git workflow"):
  first line is the branch name, a space, then a short summary, e.g.
  `5-create-account-page Add Create Account page`, then a bullet body,
  `Closes #N` if it's the issue's main commit, and the Co-Authored-By trailer
  from the session's attribution instructions.
- `git push origin <branch>`.
- **Write the PR body to a file in the scratchpad and use
  `gh pr create --base main --head <branch> --title "<issue title>" --body-file <file>`.**
  Passing a long `--body` from Windows PowerShell 5.1 splits it on quotes and
  gh fails with "unknown arguments".
- PR body: `Closes #N`, a Summary of what each file does, anything deferred to
  other issues, and a Test plan with checked items for what you actually ran and
  unchecked ones for manual checks.
- Follow-up tweaks the user asks for later go in new small commits on the same
  branch, pushed to the same PR.

## 6. Launch the app so the user can see it

- **MySQL first.** XAMPP's MySQL is not registered as a Windows service here, so
  nothing starts it for you: `C:\xampp\mysql\bin\mysqld.exe --defaults-file=C:\xampp\mysql\bin\my.ini --standalone`
  in the background. `SESSION_DRIVER=database`, so without it every backend
  request 500s on `select * from sessions` and the SPA looks broken for a reason
  that has nothing to do with the page. Check with `Get-Process mysqld`.
- Backend, in the background: `C:\xampp\php\php.exe artisan serve --port=8000`
  from `C:\xampp\htdocs\bridge_backend` (use `php` if it's on PATH).
- Frontend, in the background: `npm run dev` → http://localhost:3000 (fixed port,
  `strictPort`, because backend CORS only allows `localhost:3000`).
  **One dev server per machine**: sibling worktrees (`workspaces/bridge/<branch>`)
  share ports 3000 and 8000. Check with
  `Get-NetTCPConnection -State Listen -LocalPort 3000,8000` and
  `Get-CimInstance Win32_Process -Filter "ProcessId = <pid>" | Select CommandLine`
  — the command line says which worktree owns it. A backend already on 8000 is
  fine to reuse; a Vite owned by **another** worktree is a parallel session's dev
  server, so ask the user before stopping it instead of killing it.
- Open the new page for them: `Start-Process http://localhost:3000/<route>`.
- If the page hits the backend, prove the real flow works with sequential
  `curl` calls (details and a ready script in the reference file). Seeded login:
  `email@email.com` / `pass`.

## 7. Report

Keep it short: PR link, what's on the page, what was verified (build/lint/tests,
real backend responses), what's still running in the background, anything
blocked (with the exact cause and the fix you need from the user), and what you
changed in this skill in step 8.

## 8. Improve this skill (every time)

After the page is done, including any follow-up tweaks the user asked for in
the same session, update this skill so the next page is faster and closer to
what the user wants. Future runs only know what's written here, so anything
learned and not written down is lost.

Look back over the session and fold in:
- **Components**: every Ionic/Vue component, prop, slot, event or composable
  you used for the first time, or used in a new way, goes into
  `references/components.md`, with a minimal snippet and any gotcha you hit.
- **User corrections & preferences**: anything the user asked to change (layout,
  wording, flow, how you report) becomes a convention in the relevant step or
  template, with the reason, so they never have to ask twice. Example: the
  vertical centering on form pages came from exactly this.
- **Backend knowledge**: new endpoints, response shapes, seeded data, or failures
  and their fixes go into `references/backend-and-verification.md`.
- **Workflow friction**: a command that failed, a step that was missing or in the
  wrong order, something you had to rediscover goes into the steps above.
- **Templates**: if the page you built is a better or new starting point (a list
  page, a detail page, a page with a modal), update `assets/` or add a new
  template and reference it in step 3.

Keep it lean: edit existing sections instead of appending duplicates, remove
advice that turned out wrong, and explain *why* for each rule. Keep SKILL.md
under ~500 lines by moving detail into `references/`. Then add one line to the
history below, and commit the skill changes on the page's branch (a separate
`N-slug - update bridge-create-page skill` commit) so they ship with that PR.

## Skill history

- Issue #4 (Login form, PR #10): initial version. Captured form page pattern,
  Sanctum auth service/store, port-3000 CORS fix, vertical centering preference,
  `--body-file` PR creation, MySQL-hang troubleshooting.
- Issue #5 (Create account): register flow added to the existing auth service and
  store, page-level guest-only redirect, note on the local backend lagging origin/main,
  and the user reviews the page before push/PR.
  Commit messages now start with the full branch name (user's rule, 5-create-account-page).
- Issue #6 (Reset password): first page serving two routes (request stage +
  emailed-token stage), driven by `useRoute()` params/query. Learned that the
  backend's reset link targets the SPA, that `MAIL_MAILER=log` puts the token in
  `laravel.log`, and that the local DB may hold zero users (register a throwaway
  one via the API instead of seeding the shared DB). Verified a multi-step flow
  by its effect (old password stops working). User asked to go straight to the PR.
- Issue #7 (Account header, PR #13): `/account` page with logout, the app-wide
  `requiresAuth`/`guestOnly` guard plus `loadSession()` session restore, auth-aware
  header and menu. Learned: mounting any page in a test now needs an active Pinia,
  `vi.clearAllMocks()` keeps mock implementations, and port 3000 can be held by
  another worktree's dev server driven by a parallel session. Branches cut before
  their siblings land: merge `origin/main` again right before pushing (#6 landed
  mid-session and conflicted in the router, auth store, tests, CLAUDE.md and this
  file). User again asked to go straight to the PR.
- Issue #15 (Table detail page): first **detail** page —
  `assets/DetailPageTemplate.vue`, the compass grid, `alertController`, the
  `AppHeader` `end` slot's first real use, and an "Open" button per row instead
  of a tappable row (the row's seat buttons would swallow the taps). Learned:
  `GET /tables/{id}` 404s with a raw Laravel body, leaving can delete the table
  (`{table_deleted: true}`) and hands `moderated_by` on, `is_admin` is hidden so
  manager status is only a hint, and the per-page `errorMessage` copies were
  extracted to `src/utils/errors.ts` + `statusOf` once one page had to branch on
  the status. Also: the Bash tool resets cwd between calls (keep cookie jars in
  the scratchpad), never `sed`-scrape a nested `"id"`, and truncate debug error
  bodies. Issue numbering shares a counter with PRs, so the next issue was #15,
  not #9 — read the number back from `gh issue create` before naming the branch.
- Issue #8 (Tables page, PR #14): first list page — `assets/ListPageTemplate.vue`, the game
  endpoints' `{status, message, data}` envelope, a pre-guard 401 redirect (now
  superseded by #7's `requiresAuth`), auth-gated menu item, modal/refresher/toast notes,
  and verifying against a dev DB whose seed users are gone (register a throwaway user
  and clean up after).
