<template>
  <!-- Pinned beside the page from md up (App.vue's split pane), where a pick
       leaves it open: ion-menu-toggle only closes the slide-in overlay. -->
  <ion-menu content-id="main-content" type="overlay">
    <ion-header>
      <ion-toolbar>
        <ion-title>Menu</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list>
        <ion-menu-toggle auto-hide="false">
          <!-- The table the user sits at, first while seated (useYourTable). -->
          <ion-item
            v-if="tableTarget"
            button
            class="menu-table"
            :class="{ current: atTable }"
            :router-link="tableTarget"
            router-direction="root"
            :aria-current="atTarget ? 'page' : undefined"
          >
            <ion-icon slot="start" :icon="gridOutline" aria-hidden="true" />
            <ion-label class="menu-table-label">
              <p class="menu-table-heading">Your table</p>
              <h2 :title="tableLabel">{{ tableLabel }}</h2>
            </ion-label>
            <!-- As wide as the longest status whatever it says now (or with
                 none), so the label keeps its width when the turn moves. -->
            <div slot="end" class="menu-table-status">
              <ion-badge
                v-if="tableStatus"
                class="menu-table-badge"
                :color="STATUS_COLORS[tableStatus]"
              >
                {{ tableStatusText }}
              </ion-badge>
              <ion-badge class="menu-table-sizer" aria-hidden="true">{{ LONGEST_STATUS }}</ion-badge>
            </div>
          </ion-item>
          <ion-item
            v-for="link in links"
            :key="link.path"
            button
            :class="{ current: path === link.path }"
            :router-link="link.path"
            router-direction="root"
            :aria-current="path === link.path ? 'page' : undefined"
          >
            <ion-label>{{ link.label }}</ion-label>
          </ion-item>
        </ion-menu-toggle>
      </ion-list>
    </ion-content>
  </ion-menu>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { routeLocationKey } from 'vue-router';
import {
  IonMenu,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonBadge,
  IonMenuToggle,
} from '@ionic/vue';
import { gridOutline } from 'ionicons/icons';
import { useYourTable } from '@/composables/useYourTable';
import { STATUS_TEXT } from '@/composables/useYourTable';
import type { YourTableStatus } from '@/composables/useYourTable';
import { useAuthStore } from '@/stores/auth';

const STATUS_COLORS: Record<Exclude<YourTableStatus, null>, string> = {
  away: 'warning',
  turn: 'tertiary',
  board: 'success',
};

// "Board in progress": the width the status keeps for every status.
const LONGEST_STATUS = Object.values(STATUS_TEXT).reduce((a, b) => (b.length > a.length ? b : a));

const auth = useAuthStore();
const {
  target: tableTarget,
  current: atTarget,
  atTable,
  label: tableLabel,
  status: tableStatus,
  statusText: tableStatusText,
} = useYourTable();

// Without a router (some tests) no entry is the current page.
const route = inject(routeLocationKey, null);
const path = computed(() => route?.path ?? '');

// Login while logged out, Tables and My boards once logged in.
const links = computed(() => [
  { path: '/home', label: 'Home' },
  ...(auth.isAuthenticated
    ? [
        { path: '/tables', label: 'Tables' },
        { path: '/history', label: 'My boards' },
      ]
    : [{ path: '/login', label: 'Login' }]),
]);
</script>

<style scoped>
/* The slide-in overlay below md as wide as the pinned menu (App.vue), but
   leaving a strip of the page to tap on a narrow phone. Set on the part,
   since Ionic sets its own 264 px there up to 340 px. */
ion-menu::part(container) {
  --width: 320px;
  --max-width: calc(100vw - 40px);
}

/* The page on screen. */
ion-item.current {
  --background: var(--bridge-navy-tint);
  --color: var(--bridge-navy-tint-text);
  font-weight: 600;
}

/* Room for the icon next to the label and its status (App.vue widens the
   menu for them): Ionic's 32 px after a start icon would take it. */
.menu-table ion-icon[slot='start'] {
  margin-inline-end: 16px;
}

/* One line each, whatever the status: a long table name ends in an
   ellipsis, the whole name in its title. */
.menu-table-label {
  min-width: 0;
}

.menu-table-label p,
.menu-table-label h2 {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-table-heading {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.7rem;
}

.menu-table h2 {
  font-weight: 600;
}

/* The badge and an invisible copy of the longest one share one cell, so
   the cell is as wide as that copy and the badge sits at its end. */
.menu-table-status {
  display: grid;
  justify-items: end;
  flex-shrink: 0;
  margin-inline-start: 8px;
}

.menu-table-status ion-badge {
  grid-area: 1 / 1;
  white-space: nowrap;
}

.menu-table-sizer {
  visibility: hidden;
}
</style>
