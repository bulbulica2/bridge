# Components & helpers used in the bridge frontend

A growing guide. Every page built with this skill adds what it learned
(see SKILL.md step 8). Stack: Ionic Vue 8 (`@ionic/vue` 8.4), Vue 3.5
`<script setup lang="ts">`, Pinia, axios, Vite 5.

## Contents
- [General rules](#general-rules)
- [Layout: ion-page, ion-content, AppHeader](#layout)
- [Forms: ion-list, ion-item, ion-input](#forms)
- [Buttons & navigation: ion-button, useIonRouter](#buttons--navigation)
- [Lists & rows: ion-list, ion-item rows](#lists--rows)
- [Modals: ion-modal](#modals)
- [Feedback: ion-text, ion-spinner, toastController, ion-refresher](#feedback)
- [App shell: AppMenu, ion-menu](#app-shell)
- [State: Pinia stores](#state)

## General rules

- **Import every Ionic component explicitly** from `@ionic/vue` in the page's
  `<script setup>`. The app doesn't register them globally, so a missing
  import renders as an unknown element with no error in the build.
- Use Ionic components (not raw `<input>`/`<button>`) so pages look native on
  iOS/Android and follow the dark-mode palette (`dark.system.css`).
- Utility classes from Ionic CSS are available: `ion-padding`, `ion-text-center`,
  `ion-margin-top`, flex utils, etc.

## Layout

### `ion-page` + `ion-content` + `AppHeader`
Every routed view's root. `ion-page` is required for Ionic's page transitions
and router outlet to work.

```vue
<ion-page>
  <AppHeader title="Login" />
  <ion-content :fullscreen="true" class="ion-padding">
    <div class="form-page">…</div>
  </ion-content>
</ion-page>
```

- `AppHeader` (`src/components/AppHeader.vue`) = toolbar with the menu button,
  `title` prop, and an `end` slot for header actions:
  `<AppHeader title="X"><template #end><ion-button>…</ion-button></template></AppHeader>`.
  The header also renders its own "Account" button (→ `/account`) whenever the
  auth store says somebody is logged in, after the slot content. A shared action
  that belongs on every page goes **in** the header behind `v-if`, not in each page.
- **Centering content (user preference for form pages)**: inside `ion-content`,
  a wrapper with `display:flex; flex-direction:column; justify-content:center;
  min-height:100%; max-width:420px; margin:0 auto`. `min-height` (not `height`)
  keeps it scrollable when the keyboard or a small screen makes content taller.

## Forms

### `ion-list` / `ion-item` / `ion-input`
```vue
<form @submit.prevent="submit">
  <ion-list>
    <ion-item>
      <ion-input v-model="email" type="email" label="Email"
                 label-placement="stacked" autocomplete="email" required />
    </ion-item>
  </ion-list>
</form>
```
- `v-model` works directly on `ion-input` in @ionic/vue.
- Use the `label` + `label-placement="stacked"` props (Ionic 7+ modern syntax),
  not a separate `<ion-label>` inside the item.
- Set `type` and `autocomplete` (`email`, `current-password`, `new-password`,
  `username`) so browsers and password managers behave.
- Wrap in a real `<form @submit.prevent>` so Enter submits.

## Lists & rows

A collection renders as `ion-list` + one `ion-item` per row. Put the row's own
markup in a plain `<div>` inside the item (not inside `ion-label`) when the row
contains buttons: `ion-label` is for text, and nesting interactive elements in
it fights the item's own layout.

```vue
<ion-list>
  <ion-item v-for="table in tables" :key="table.id" lines="full">
    <div class="table-row">
      <h2 class="table-title">#{{ table.id }} {{ table.name || 'Unnamed table' }}</h2>
      <div class="seats">…</div>
    </div>
  </ion-item>
</ion-list>
```

- Give that div `width: 100%`; an `ion-item` child doesn't stretch by itself.
- Don't add `button` to the `ion-item` unless the whole row navigates; a row
  with per-cell buttons must not be a button itself. To open a row's detail
  page, give it its own link instead — nesting a button inside a button
  swallows the inner taps:
  ```vue
  <ion-button fill="clear" size="small"
              :router-link="`/tables/${table.id}`" router-direction="forward">
    Open <ion-icon slot="end" :icon="chevronForwardOutline" />
  </ion-button>
  ```
  `router-direction="forward"` (and `"back"` on the way out) keeps Ionic's page
  stack and its transition animation right.
- Always render a fixed set of slots (e.g. the four seats `N, E, S, W`) from a
  helper that maps the constant order onto the data, so rows line up even when
  the backend only sends the occupied ones.
- Branch the body explicitly: loading spinner → error text → empty state → list.
  The empty state is a sentence telling the user what to do next
  ("No tables yet. Create the first one.").

## Detail pages

A page addressed by a route param (`/tables/:id`) reads the id in
`onIonViewWillEnter`, not at setup — Ionic keeps the page alive, so arriving at
a different record would otherwise reuse the previous id. Two rules that are
easy to get wrong:

- **Derive the record by id, don't read the store's `current…` directly.**
  ```ts
  const table = computed(() =>
    store.currentTable && store.currentTable.id === tableId.value ? store.currentTable : null);
  ```
  Without the id check, moving from one record to another flashes the old one
  while the new request is in flight.
- **Give a deleted record its own branch**, separate from the error branch:
  loading → gone → error → content. A backend that deletes records (a table
  with nobody at it) makes 404 a normal end of life, and Laravel's 404 body is
  a raw `No query results for model [App\Models\Table] 9` — never show it.
  A non-numeric param goes to the same branch without firing a request.

### Laying out a fixed arrangement (the bridge compass)
Four seats around a middle cell, rather than a row, is a 3×3 grid with explicit
placement — it keeps N/E/S/W where a bridge player expects them at any width:

```css
.compass { display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 12px; }
.seat-n { grid-column: 2; grid-row: 1; }
.seat-w { grid-column: 1; grid-row: 2; }
.table-info { grid-column: 2; grid-row: 2; }
.seat-e { grid-column: 3; grid-row: 2; }
.seat-s { grid-column: 2; grid-row: 3; }
```
Use `var(--ion-color-step-150, …)` / `var(--ion-color-light, …)` for borders and
fills so the cells follow the dark palette instead of hardcoding grey.

## Modals

### `ion-modal`
Inline modal driven by a ref; it brings its own header and content.

```vue
<ion-modal :is-open="createOpen" @did-dismiss="closeCreate">
  <ion-header>
    <ion-toolbar>
      <ion-title>Create table</ion-title>
      <ion-buttons slot="end"><ion-button @click="closeCreate">Cancel</ion-button></ion-buttons>
    </ion-toolbar>
  </ion-header>
  <ion-content class="ion-padding">
    <form @submit.prevent="submitCreate">…</form>
  </ion-content>
</ion-modal>
```

- Use `@did-dismiss` (not only the Cancel handler) to reset state: the user can
  also dismiss by swiping or with Esc, and `:is-open` must be set back to false
  or the modal can't reopen.
- Reset the form fields **and** the error in that one handler, so reopening
  never shows the previous attempt's message.
- The modal has its own `ion-content`, so the page's scroll position is kept.

## Buttons & navigation

### `ion-button`
- Submit: `<ion-button type="submit" expand="block" :disabled="submitting">`.
  Ionic 8 supports `type="submit"` inside a native `<form>`.
- Secondary / link-style: `fill="clear"`.
- Navigate on click without JS: `router-link="/create-account"`
  (optionally `router-direction="root"`).

### `ion-icon`
Icons come from the `ionicons` package as imported strings, not names:

```vue
<ion-icon :icon="personCircleOutline" slot="start" />
```
```ts
import { IonIcon } from '@ionic/vue';
import { personCircleOutline } from 'ionicons/icons';
```
- `slot="start"` / `slot="end"` places it inside an `ion-button` next to the label.
- Size it with CSS `font-size` (e.g. `.avatar { font-size: 72px; }`), not width/height.

### `useIonRouter()`
Programmatic navigation that keeps Ionic's page stack/animations in sync:
```ts
const ionRouter = useIonRouter();
ionRouter.navigate('/home', 'root', 'replace'); // after login: no back to form
```
Prefer it over `useRouter().push` inside Ionic pages.

### `useRoute()` — reading path params and query strings
For a page whose content depends on the URL (e.g. the reset link
`/password-reset/:token?email=...`), read the route with vue-router's
`useRoute()` and derive state with `computed`, so one component can serve two
routes:

```ts
import { useRoute } from 'vue-router';
const route = useRoute();
const token = computed(() => (route.params.token as string | undefined) ?? '');
const hasToken = computed(() => token.value !== '');   // picks the stage to render
```
- `route.params.x` is typed `string | string[]`, so cast/normalize before use or
  `vue-tsc` fails the build.
- Read `route.query` in `onIonViewWillEnter`, not at setup time: Ionic keeps the
  page alive, so setup won't re-run when the user arrives with a different link.

### `onIonViewWillEnter`
Ionic keeps visited pages alive in the stack, so `onMounted` runs only once.
Use `onIonViewWillEnter` (from `@ionic/vue`) for work that must run every time
the page is shown, e.g. reading `route.query` in `ResetPasswordPage.vue`.
Auth redirects are **not** such a case any more: the router guard owns them.

### Read-only detail rows
For showing values rather than editing them (the Account page), keep `ion-list` /
`ion-item` but put a label/value pair in `ion-label` instead of an input:

```vue
<ion-list inset>
  <ion-item>
    <ion-label>
      <p>Email</p>
      <h2>{{ auth.user?.email }}</h2>
    </ion-label>
  </ion-item>
</ion-list>
```
- `inset` gives the list rounded, inset cards — reads as a panel, not a form.
- `ion-label` truncates by default; add `white-space: normal` on the value for
  free text (a description) that must wrap.
- Values from the store can be null for a tick, so use `?.` in the template.

## Feedback

- Error text: `<ion-text v-if="error" color="danger"><p class="error">{{ error }}</p></ion-text>`.
- Success text: the same with `color="success"`. Use it when the backend returns
  a human-readable `status` (the password endpoints do) and the user stays on
  the page instead of being redirected.
- **Don't write an error helper per page.** `src/utils/errors.ts` owns both:
  `errorMessage(e, fallback)` for the sentence to show and `statusOf(e)` for the
  status to branch on. (It used to be copy-pasted into every view; issue #15
  extracted it once the detail page needed to tell 401/404/409 apart.)
  ```ts
  import { errorMessage, statusOf } from '@/utils/errors';
  if (statusOf(e) === 401) { ionRouter.navigate('/login', 'root', 'replace'); return; }
  error.value = errorMessage(e, 'Could not do the thing. Please try again.');
  ```
- Loading inside a button: `<ion-spinner v-if="submitting" name="crescent" />`
  with the label in `v-else`, plus `:disabled="submitting"` to stop double submits.
  For per-row buttons, key the "busy" state by row + action
  (`joining.value === `${tableId}-${seat}``) so only the clicked one spins.

### `toastController`
For failures that aren't attached to a form field — a row action on data that
may be stale (someone took the seat first):

```ts
import { toastController } from '@ionic/vue';
const toast = await toastController.create({
  message, duration: 4000, color: 'danger', position: 'bottom',
});
await toast.present();
```
Inline `ion-text` stays the rule inside forms and modals; a toast is for the
list itself, which has no obvious place to put the message.

### `alertController` (confirm before something destructive)
For an action the user can't undo — leaving a seat, which may delete the table:

```ts
import { alertController } from '@ionic/vue';
const alert = await alertController.create({
  header: 'Leave this table?',
  message: 'Your seat will be freed. If nobody is left, the table is deleted.',
  buttons: [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Leave', role: 'destructive' },
  ],
});
await alert.present();
const { role } = await alert.onDidDismiss();
if (role !== 'destructive') return;
```
- The answer comes from `onDidDismiss()`, **not** from a button handler; check
  `role`, because a backdrop tap or Esc also resolves it (with `'backdrop'`).
- `role: 'destructive'` colors the button on iOS; it carries no behavior, so the
  `role !== 'destructive'` guard is what actually stops the action.

### `ion-refresher` (pull to refresh)
```vue
<ion-refresher slot="fixed" @ionRefresh="refresh($event)">
  <ion-refresher-content />
</ion-refresher>
```
```ts
async function refresh(event: CustomEvent) {
  await load();
  (event.target as HTMLIonRefresherElement).complete();
}
```
- `slot="fixed"` is required, and the refresher must be a direct child of
  `ion-content`.
- Always `complete()`, including after a failed load, or the spinner never
  retracts. Type the handler's argument as `CustomEvent` and cast `event.target`;
  `vue-tsc` rejects the bare `RefresherCustomEvent` import path.

## App shell

- `App.vue`: `<ion-app><AppMenu /><ion-router-outlet id="main-content" /></ion-app>`.
- `AppMenu.vue`: `<ion-menu content-id="main-content" type="overlay">`. `content-id`
  must match the outlet id. Items:
  `<ion-menu-toggle auto-hide="false"><ion-item button router-link="/home" router-direction="root">…`.
  `ion-menu-toggle` closes the menu when an item is tapped.

## State

- Setup-style Pinia stores in `src/stores/` (`defineStore('auth', () => {…})`);
  installed in `main.ts` with `.use(createPinia())`.
- Views call store actions; stores call `src/services/*`; services use the shared
  axios instance `src/services/http.ts`.
- In unit tests: `setActivePinia(createPinia())` in `beforeEach` and
  `vi.mock('@/services/…')`. The Pinia part is needed even for a plain page
  mount, because `AppHeader`/`AppMenu` call `useAuthStore()`. When the view also
  imports a **value** from that service (a constant such as `SEATS`, not just
  types), mock with
  `vi.mock('@/services/x', async (importOriginal) => ({ ...(await importOriginal<typeof x>()), fn: vi.fn() }))`
  so the constant survives while the calls are stubbed.
- `vi.clearAllMocks()` clears calls but keeps implementations, so a
  `mockRejectedValue` set in one test leaks into the next.
- Mutate list state by replacing the array (`items.value = [item, ...items.value]`,
  `items.value.map(...)`) rather than by splicing in place: the reactivity is the
  same and the store action reads as "what the list becomes".
- A store action that talks to the backend should let the error propagate; the
  view decides between inline text, a toast and a redirect.

### Auth state across a reload
The store is memory-only while the Sanctum session is a cookie, so
`useAuthStore().loadSession()` fetches `GET /api/user` once per page load and
caches the in-flight promise; `router.beforeEach` awaits it before applying
`requiresAuth`/`guestOnly`. Views never need to check auth themselves — read
`auth.isAuthenticated` only to *show* or *hide* things. `logout()` clears the
local user in a `finally`, so a failed request still leaves the SPA logged out.
