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
          :class="{ 'at-table': atTable, 'turn-pill': tableStatus === 'turn' }"
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
          <!-- Our turn there: the Daylight pill, "Your turn · 0:42". -->
          <span v-if="tableStatus === 'turn'" class="table-shortcut-turn">{{ tableStatusText }}</span>
        </ion-button>
      </ion-buttons>
      <!-- `subtitle`: a second, smaller line under the title (the play
           page's "Board 1 of 4 · Set 3", #171). -->
      <ion-title :class="{ 'with-subtitle': !!subtitle }">
        <template v-if="subtitle">
          <span class="title-main">{{ title }}</span>
          <span class="title-sub">{{ subtitle }}</span>
        </template>
        <template v-else>{{ title }}</template>
      </ion-title>
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

withDefaults(defineProps<{ title: string; subtitle?: string | null }>(), { subtitle: null });

const auth = useAuthStore();
const {
  target: tableTarget,
  current: atTarget,
  atTable,
  label: tableLabel,
  status: tableStatus,
  statusText: tableStatusText,
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
  background: var(--bridge-pass-text);
}

/* Our turn: the shortcut turns into the action-tinted pill, its dot the
   action colour, the turn and its clock beside the name. */
.status-turn {
  background: var(--bridge-action);
}

.table-shortcut.turn-pill {
  --background: var(--bridge-action-tint);
  --border-color: var(--bridge-action-tint);
  --color: var(--bridge-action-text);
}

.table-shortcut-turn {
  margin-inline-start: 6px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.status-away {
  background: var(--bridge-amber);
}

/* The title over its subtitle, each on one line. */
.with-subtitle .title-main,
.with-subtitle .title-sub {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.with-subtitle .title-main {
  line-height: 1.2;
}

.with-subtitle .title-sub {
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--bridge-muted);
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

  /* The turn says more than the name on a phone. */
  .turn-pill .table-shortcut-name {
    display: none;
  }
}
</style>
