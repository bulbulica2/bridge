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
            <ion-label>
              <p class="menu-table-heading">Your table</p>
              <h2>{{ tableLabel }}</h2>
            </ion-label>
            <ion-badge v-if="tableStatus" slot="end" :color="STATUS_COLORS[tableStatus]">
              {{ tableStatusText }}
            </ion-badge>
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
import type { YourTableStatus } from '@/composables/useYourTable';
import { useAuthStore } from '@/stores/auth';

const STATUS_COLORS: Record<Exclude<YourTableStatus, null>, string> = {
  away: 'warning',
  turn: 'tertiary',
  board: 'success',
};

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
/* The page on screen. */
ion-item.current {
  --background: rgba(var(--ion-color-primary-rgb, 56, 128, 255), 0.12);
  --color: var(--ion-color-primary, #3880ff);
  font-weight: 600;
}

.menu-table-heading {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.7rem;
}

.menu-table h2 {
  font-weight: 600;
}
</style>
