# Components & helpers used in the bridge frontend

A growing guide. Every page built with this skill adds what it learned
(see SKILL.md step 8). Stack: Ionic Vue 8 (`@ionic/vue` 8.4), Vue 3.5
`<script setup lang="ts">`, Pinia, axios, Vite 5.

## Contents
- [General rules](#general-rules)
- [Layout: ion-page, ion-content, AppHeader](#layout)
- [Forms: ion-list, ion-item, ion-input](#forms)
- [Buttons & navigation: ion-button, useIonRouter](#buttons--navigation)
- [Feedback: ion-text, ion-spinner](#feedback)
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
- One `errorMessage(e, fallback)` helper per page, with the fallback passed in,
  covers several submit handlers without duplicating the 422 parsing.
- Loading inside a button: `<ion-spinner v-if="submitting" name="crescent" />`
  with the label in `v-else`, plus `:disabled="submitting"` to stop double submits.

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
  `vi.mock('@/services/…')`. Needed even for a plain page mount, because
  `AppHeader`/`AppMenu` call `useAuthStore()`.
- `vi.clearAllMocks()` clears calls but keeps implementations, so a
  `mockRejectedValue` set in one test leaks into the next.

### Auth state across a reload
The store is memory-only while the Sanctum session is a cookie, so
`useAuthStore().loadSession()` fetches `GET /api/user` once per page load and
caches the in-flight promise; `router.beforeEach` awaits it before applying
`requiresAuth`/`guestOnly`. Views never need to check auth themselves — read
`auth.isAuthenticated` only to *show* or *hide* things. `logout()` clears the
local user in a `finally`, so a failed request still leaves the SPA logged out.
