<template>
  <ion-header>
    <ion-toolbar :class="{ 'with-table': !!tableTarget }">
      <ion-buttons slot="start">
        <!-- Collapses and brings back the menu pinned beside the page (from
             md up), or slides it in on a phone (src/utils/menu.ts). -->
        <ion-button class="menu-toggle" aria-label="Menu" @click="toggleMenu">
          <ion-icon slot="icon-only" :icon="menuOutline" />
        </ion-button>
        <!-- The table the user sits at, one tap from every page: its game
             once a board is dealt, else its own page (useYourTable). -->
        <ion-button
          v-if="tableTarget"
          class="table-shortcut"
          :class="{ 'at-table': atTable }"
          :fill="atTable ? 'solid' : 'outline'"
          size="small"
          :router-link="atTarget ? undefined : tableTarget"
          router-direction="root"
          :aria-label="tableAria"
          :aria-current="atTarget ? 'page' : undefined"
          :title="tableAria"
        >
          <ion-icon slot="start" :icon="gridOutline" />
          <span class="table-shortcut-name">{{ tableLabel }}</span>
          <span
            v-if="tableStatus"
            class="status-dot"
            :class="`status-${tableStatus}`"
            aria-hidden="true"
          />
        </ion-button>
      </ion-buttons>
      <ion-title>{{ title }}</ion-title>
      <ion-buttons slot="end">
        <slot name="end" />
        <!-- Header account action, only once there is somebody logged in. -->
        <ion-button v-if="auth.isAuthenticated" router-link="/account" aria-label="Account">
          <ion-icon slot="start" :icon="personCircleOutline" />
          <span class="account-label">Account</span>
        </ion-button>
      </ion-buttons>
    </ion-toolbar>
    <BanBanner />
  </ion-header>
</template>

<script setup lang="ts">
import {
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonTitle,
} from '@ionic/vue';
import { gridOutline, menuOutline, personCircleOutline } from 'ionicons/icons';
import BanBanner from '@/components/BanBanner.vue';
import { useYourTable } from '@/composables/useYourTable';
import { useAuthStore } from '@/stores/auth';
import { toggleMenu } from '@/utils/menu';

defineProps<{
  title: string;
}>();

const auth = useAuthStore();
const {
  target: tableTarget,
  current: atTarget,
  atTable,
  label: tableLabel,
  status: tableStatus,
  ariaLabel: tableAria,
} = useYourTable();
</script>

<style scoped>
.table-shortcut {
  --border-radius: 16px;
  margin-inline-start: 4px;
  text-transform: none;
  font-weight: 600;
}

.table-shortcut-name {
  max-width: 10em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* What the table waits for: a board on (green), our turn (blue), our seat
   away (amber). */
.status-dot {
  width: 8px;
  height: 8px;
  margin-inline-start: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-board {
  background: var(--ion-color-success, #2dd36f);
}

.status-turn {
  background: var(--ion-color-tertiary, #6030ff);
  box-shadow: 0 0 0 2px rgba(var(--ion-color-tertiary-rgb, 96, 48, 255), 0.3);
}

.status-away {
  background: var(--ion-color-warning, #ffc409);
}

/* iOS centres the title over the whole toolbar, where the table's button
   would cover it: next to the buttons instead, as on Android and the web. */
.with-table ion-title.ios {
  position: static;
  padding-inline: 4px;
  text-align: start;
}

/* A phone has no room for both labels: the title keeps its place, Account
   becomes its icon (still named for a screen reader). */
@media (max-width: 575px) {
  .with-table .account-label {
    display: none;
  }

  .table-shortcut-name {
    max-width: 6.5em;
  }
}
</style>
