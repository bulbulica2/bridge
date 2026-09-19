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
  with per-cell buttons must not be a button itself.
- Always render a fixed set of slots (e.g. the four seats `N, E, S, W`) from a
  helper that maps the constant order onto the data, so rows line up even when
  the backend only sends the occupied ones.
- Branch the body explicitly: loading spinner → error text → empty state → list.
  The empty state is a sentence telling the user what to do next
  ("No tables yet. Create the first one.").

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

### `useIonRouter()`
Programmatic navigation that keeps Ionic's page stack/animations in sync:
```ts
const ionRouter = useIonRouter();
ionRouter.navigate('/home', 'root', 'replace'); // after login: no back to form
```
Prefer it over `useRouter().push` inside Ionic pages.

### `onIonViewWillEnter`
Ionic keeps visited pages alive in the stack, so `onMounted` runs only once.
Use `onIonViewWillEnter` (from `@ionic/vue`) for checks that must run every time
the page is shown, e.g. the guest-only redirect in `CreateAccountPage.vue`.

## Feedback

- Error text: `<ion-text v-if="error" color="danger"><p class="error">{{ error }}</p></ion-text>`.
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
  `vi.mock('@/services/…')`. When the view also imports a **value** from that
  service (a constant such as `SEATS`, not just types), mock with
  `vi.mock('@/services/x', async (importOriginal) => ({ ...(await importOriginal<typeof x>()), fn: vi.fn() }))`
  so the constant survives while the calls are stubbed.
- Mutate list state by replacing the array (`items.value = [item, ...items.value]`,
  `items.value.map(...)`) rather than by splicing in place: the reactivity is the
  same and the store action reads as "what the list becomes".
- A store action that talks to the backend should let the error propagate; the
  view decides between inline text, a toast and a redirect.
