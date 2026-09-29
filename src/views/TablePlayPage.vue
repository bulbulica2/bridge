<template>
  <ion-page>
    <AppHeader :title="headerTitle">
      <template #end>
        <ion-button
          v-if="tableId"
          :router-link="`/tables/${tableId}`"
          router-direction="back"
        >
          Table
        </ion-button>
      </template>
    </AppHeader>
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="play">
        <div v-if="notFound" class="gone">
          <p>This table no longer exists.</p>
          <ion-button router-link="/tables" router-direction="back">Back to tables</ion-button>
        </div>

        <!-- 403: only the four players seated here may see the board. -->
        <div v-else-if="notSeated" class="gone">
          <p>You don't sit at this table, so you can't see its board.</p>
          <ion-button :router-link="`/tables/${tableId}`" router-direction="back">
            Go to the table
          </ion-button>
        </div>

        <div v-else-if="loading && !playing" class="loading" aria-busy="true">
          <ion-spinner name="crescent" />
          <p>Loading the board…</p>
        </div>

        <ion-text v-if="!notFound && !notSeated && loadError" color="danger">
          <p class="error">{{ loadError }}</p>
        </ion-text>

        <template v-if="!notFound && !notSeated && playing">
          <div v-if="loading" class="refreshing">
            <ion-spinner name="crescent" />
            <span>Refreshing…</span>
          </div>

          <BridgeTable
            :players="players"
            :my-seat="mySeat"
            :board="playing.board"
            :turn="playing.turn"
            @select="player = $event"
          >
            <p class="waiting-title">Waiting for 4 players</p>
            <p class="waiting-count">{{ seatedCount }} of 4 seated</p>
          </BridgeTable>

          <p v-if="status" class="status" :class="{ 'status-mine': myTurn }">{{ status }}</p>

          <section v-if="playing.phase !== 'waiting'" class="my-hand">
            <HandView v-if="playing.hand" :cards="playing.hand" />
            <div v-else class="dealing">
              <ion-spinner name="dots" />
              <span>Dealing…</span>
            </div>
          </section>

          <ion-button
            expand="block"
            fill="outline"
            class="refresh"
            :disabled="loading"
            @click="load()"
          >
            Refresh
          </ion-button>
        </template>
      </div>

      <PlayerProfileSheet :player="player" @close="player = null" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonButton,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonSpinner,
  onIonViewWillEnter,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import BridgeTable from '@/components/BridgeTable.vue';
import HandView from '@/components/HandView.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useTablesStore } from '@/stores/tables';
import { seatsOf } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { errorMessage, statusOf } from '@/utils/errors';

const route = useRoute();
const ionRouter = useIonRouter();
const auth = useAuthStore();
const game = useGameStore();
const tablesStore = useTablesStore();

const tableId = ref(0);
const loading = ref(false);
const loadError = ref('');
const notFound = ref(false);
const notSeated = ref(false);
const player = ref<PublicUser | null>(null);

const me = computed(() => auth.user?.id ?? null);

// The game store holds one table's board; only trust it for this route's table.
const playing = computed(() => (game.tableId === tableId.value ? game.playing : null));

const table = computed(() => {
  if (tablesStore.currentTable?.id === tableId.value) {
    return tablesStore.currentTable;
  }
  return tablesStore.tables.find((t) => t.id === tableId.value) ?? null;
});

// Once a board is dealt the playing's own seat snapshot names the players;
// while waiting there is none, so the table's seats do.
const players = computed<Partial<Record<Seat, PublicUser | null>>>(() => {
  if (playing.value?.players) {
    return playing.value.players;
  }
  return Object.fromEntries(
    (table.value ? seatsOf(table.value) : []).map(({ seat, user }) => [seat, user]),
  );
});

const mySeat = computed<Seat | null>(() => {
  if (playing.value?.my_seat) {
    return playing.value.my_seat;
  }
  const entry = Object.entries(players.value).find(([, user]) => user?.id === me.value);
  return (entry?.[0] as Seat | undefined) ?? null;
});

const seatedCount = computed(() => Object.values(players.value).filter(Boolean).length);

// acting_user_id is who must act for `turn`: declarer on dummy's turn.
const myTurn = computed(
  () => !!playing.value?.acting_user_id && playing.value.acting_user_id === me.value,
);

const status = computed(() => {
  const state = playing.value;
  if (!state || state.phase === 'waiting') {
    return '';
  }
  if (state.phase === 'finished') {
    return 'The board is finished.';
  }
  const stage = state.phase === 'auction' ? 'Auction' : 'Play';
  if (myTurn.value) {
    return state.turn && state.turn !== mySeat.value
      ? `${stage}: your turn, playing dummy's cards (${state.turn}).`
      : `${stage}: your turn.`;
  }
  const actor = Object.values(state.players ?? {}).find((u) => u.id === state.acting_user_id);
  return actor ? `${stage}: waiting for ${actor.username}.` : `${stage}.`;
});

const headerTitle = computed(() => {
  const board = playing.value?.board;
  const name = table.value?.name || (tableId.value ? `Table #${tableId.value}` : 'Table');
  return board ? `${name} · Board ${board.number}` : name;
});

onIonViewWillEnter(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    tableId.value = 0;
    notFound.value = true;
    return;
  }
  tableId.value = id;
  notFound.value = false;
  notSeated.value = false;
  load();
});

// Kicked (the tables store has already said so in a toast): nothing to see.
watch(
  () => tablesStore.kickedFrom,
  (kicked) => {
    if (kicked !== null && kicked === tableId.value) {
      tablesStore.kickedFrom = null;
      ionRouter.navigate('/tables', 'back', 'replace');
    }
  },
);

// A new board on the table the events haven't described yet (the fourth
// seat taken, or the next board): read it rather than wait.
watch(
  () => table.value?.board_id,
  (boardId) => {
    const shown = playing.value?.board?.id ?? null;
    if (boardId && boardId !== shown && !loading.value) {
      load();
    }
  },
);

// Both the table (seats, live channel) and its board; either alone would
// leave the page half drawn. The playing snapshot also rebuilds everything
// after a reload.
async function load() {
  if (!tableId.value) {
    return;
  }
  loading.value = true;
  loadError.value = '';
  try {
    await Promise.all([tablesStore.loadTable(tableId.value), game.load(tableId.value)]);
  } catch (e) {
    const status = statusOf(e);
    if (status === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
    } else if (status === 404) {
      tablesStore.forget(tableId.value);
      notFound.value = true;
    } else if (status === 403) {
      notSeated.value = true;
    } else {
      loadError.value = errorMessage(e, 'Could not load the board. Please try again.');
    }
  } finally {
    loading.value = false;
  }
}

async function refresh(event: CustomEvent) {
  await load();
  (event.target as HTMLIonRefresherElement).complete();
}
</script>

<style scoped>
/* Wide enough for 13 overlapping cards on one line, capped like the detail page. */
.play {
  max-width: 520px;
  margin: 0 auto;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--ion-color-medium);
}

.loading ion-spinner {
  width: 48px;
  height: 48px;
}

.loading p {
  margin: 0;
}

.refreshing,
.dealing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 0 12px;
  color: var(--ion-color-medium);
  font-size: 0.9rem;
}

.refreshing ion-spinner {
  width: 18px;
  height: 18px;
}

.gone {
  padding: 32px 0;
  text-align: center;
}

.error {
  margin: 16px 0;
}

.waiting-title {
  font-weight: 600;
}

.waiting-count {
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.status {
  margin: 16px 0;
  text-align: center;
  color: var(--ion-color-medium);
}

.status-mine {
  font-weight: 600;
  color: var(--ion-color-warning-shade, #e0ac08);
}

.my-hand {
  margin: 8px 0 16px;
}

.refresh {
  margin-top: 8px;
}
</style>
