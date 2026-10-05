<template>
  <ion-page>
    <AppHeader :title="data ? `Board ${data.board.number}` : 'Board results'" />
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="board-results">
        <!-- A board you haven't finished: the backend won't show it, since
             you might still be dealt it. -->
        <div v-if="gone" class="gone">
          <p>{{ gone }}</p>
          <ion-button router-link="/history" router-direction="back">My boards</ion-button>
        </div>

        <!-- Nothing to show yet: a big spinner where the results will be. -->
        <div v-else-if="loading && !data" class="loading" aria-busy="true">
          <ion-spinner name="crescent" />
          <p>Loading results…</p>
        </div>

        <ion-text v-if="!gone && loadError" color="danger">
          <p class="error">{{ loadError }}</p>
        </ion-text>

        <template v-if="!gone && data">
          <div v-if="loading" class="refreshing">
            <ion-spinner name="crescent" />
            <span>Refreshing…</span>
          </div>

          <p class="board-info">
            Dealer {{ SEAT_NAMES[data.board.dealer] }} · {{ vulnerabilityLabel(data.board.vulnerable) }}
          </p>

          <!-- The viewer's own result(s) on this board, as a matchpoint %. -->
          <section v-for="row in mine" :key="row.result.playing_id" class="summary">
            <template v-if="row.percent !== null">
              <span class="summary-label">Your result</span>
              <span class="summary-value">{{ row.percent }}%</span>
              <span class="summary-detail">
                {{ row.matchpoints }} of {{ data.top }} matchpoints ·
                {{ SIDE_LABELS[row.side] }} {{ formatScore(scoreFor(row.result.score_ns, row.side)) }}
              </span>
            </template>
            <template v-else>
              <span class="summary-label">Your result</span>
              <span class="summary-detail">
                No other table has finished this board yet, so there's nothing to compare
                with. Check back later.
              </span>
            </template>
          </section>

          <!-- What was possible on this deal, to hold every result up
               against: the viewer's own contract marked. -->
          <DoubleDummyTable
            :analysis="doubleDummy.analysis.value"
            :highlight="myContract"
            highlight-note="Your contract"
          />

          <p class="count">
            {{ data.results.length }} table{{ data.results.length === 1 ? '' : 's' }} played it,
            best N-S score first. Matchpoints: 2 for each table you beat, 1 for each tie.
          </p>

          <ion-list class="results" lines="none">
            <!-- Each row opens that table's playing, to replay it. -->
            <ion-item
              v-for="result in data.results"
              :key="result.playing_id"
              button
              detail
              :router-link="`/playings/${result.playing_id}`"
              class="result-item"
              :class="{ mine: isMine(result) }"
            >
              <div class="result">
                <div class="result-main">
                  <p class="result-table">
                    {{ result.table_id !== null ? `Table ${result.table_id}` : 'Table closed' }}
                    <ion-badge v-if="isMine(result)" color="primary">You</ion-badge>
                  </p>
                  <p class="result-contract">
                    <template v-if="result.contract && result.declarer">
                      <CallLabel :bid="result.contract" />{{ doubledMark(result.doubled) }}
                      by {{ result.declarer }} {{ madeSuffix(result.made_by)
                      }}<template v-if="result.made_by !== null">
                        · {{ result.tricks_won }} tricks</template
                      >
                    </template>
                    <template v-else>Passed out</template>
                  </p>
                  <p class="result-players">
                    <span>N-S {{ pair(result, 'N', 'S') }}</span>
                    <span>E-W {{ pair(result, 'E', 'W') }}</span>
                  </p>
                </div>
                <div class="result-figures">
                  <span class="result-score">N-S {{ formatScore(result.score_ns) }}</span>
                  <span class="result-mp" :aria-label="mpLabel(result)">
                    MP {{ result.matchpoints.ns }} / {{ result.matchpoints.ew }}
                  </span>
                </div>
              </div>
            </ion-item>
          </ion-list>

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
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonBadge,
  IonButton,
  IonItem,
  IonList,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonSpinner,
  onIonViewWillEnter,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import CallLabel from '@/components/CallLabel.vue';
import DoubleDummyTable from '@/components/DoubleDummyTable.vue';
import { useDoubleDummy } from '@/composables/useDoubleDummy';
import { useAuthStore } from '@/stores/auth';
import { useHistoryStore } from '@/stores/history';
import type { BoardResultRow } from '@/services/history';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { vulnerabilityLabel } from '@/utils/cards';
import { errorMessage, statusOf } from '@/utils/errors';
import {
  SIDE_LABELS,
  doubledMark,
  formatScore,
  madeSuffix,
  matchpointPercent,
  scoreFor,
  seatOfUser,
  sideOf,
} from '@/utils/result';

const route = useRoute();
const ionRouter = useIonRouter();
const auth = useAuthStore();
const store = useHistoryStore();

const boardId = ref(0);
const loading = ref(false);
const loadError = ref('');
// Why there is nothing to show (403, 404, a bad id), or ''.
const gone = ref('');

const data = computed(() => store.results[boardId.value] ?? null);

// The board's double dummy table, read after its results (both refuse a
// board the viewer hasn't finished, and the local backend answers one
// request at a time).
const doubleDummy = useDoubleDummy(() => boardId.value || null);

// The viewer's contract on this board, marked in that table.
const myContract = computed(() => {
  const result = mine.value.find((m) => m.result.declarer && m.result.contract?.strain)?.result;
  return result ? { declarer: result.declarer!, strain: result.contract!.strain! } : null;
});

// Where the viewer sat on each playing of the board (normally one).
const mine = computed(() => {
  const board = data.value;
  if (!board) {
    return [];
  }
  return board.results.flatMap((result) => {
    const seat = seatOfUser(result.players, auth.user?.id);
    if (!seat) {
      return [];
    }
    const side = sideOf(seat);
    const matchpoints = result.matchpoints[side];
    return [{ result, side, matchpoints, percent: matchpointPercent(matchpoints, board.top) }];
  });
});

function isMine(result: BoardResultRow): boolean {
  return seatOfUser(result.players, auth.user?.id) !== null;
}

function pair(result: BoardResultRow, a: Seat, b: Seat): string {
  const name = (seat: Seat) => result.players[seat]?.username ?? '—';
  return `${name(a)} & ${name(b)}`;
}

function mpLabel(result: BoardResultRow): string {
  return `Matchpoints: N-S ${result.matchpoints.ns}, E-W ${result.matchpoints.ew}`;
}

// Ionic keeps the page alive, so read the param on every entry: opening
// another board must not reuse the old id.
onIonViewWillEnter(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    boardId.value = 0;
    gone.value = "This board doesn't exist.";
    return;
  }
  boardId.value = id;
  gone.value = '';
  load();
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await store.loadResults(boardId.value);
    doubleDummy.load();
  } catch (e) {
    const status = statusOf(e);
    // A 401 here means the session expired after the router guard let us in.
    if (status === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
    } else if (status === 403) {
      gone.value =
        "You can see a board's results once you have finished it yourself, since you might still be dealt it.";
    } else if (status === 404) {
      gone.value = "This board doesn't exist.";
    } else {
      loadError.value = errorMessage(e, 'Could not load the results. Please try again.');
    }
  } finally {
    loading.value = false;
  }
}

async function refresh(event: CustomEvent) {
  if (boardId.value && !gone.value) {
    await load();
  }
  (event.target as HTMLIonRefresherElement).complete();
}
</script>

<style scoped>
.board-results {
  max-width: 640px;
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

.refreshing {
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

.board-info {
  margin: 0 0 12px;
  text-align: center;
  color: var(--ion-color-medium);
}

.summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin: 0 0 12px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.08);
  text-align: center;
}

.summary-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--ion-color-medium);
}

.summary-value {
  font-size: 2rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.summary-detail {
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.count {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.results {
  padding: 0;
  background: transparent;
}

.result-item {
  --background: transparent;
  margin-bottom: 8px;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 8px;
}

/* The viewer's table stands out. */
.result-item.mine {
  --background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.1);
  border-color: var(--ion-color-primary);
}

.result {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 0;
}

.result-main {
  flex: 1;
  min-width: 0;
}

.result p {
  margin: 0;
}

.result-table {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.result-contract {
  margin-top: 2px;
}

.result .result-players {
  display: flex;
  flex-wrap: wrap;
  gap: 0 12px;
  margin-top: 2px;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
  overflow-wrap: anywhere;
}

.result-figures {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.result-score {
  font-weight: 700;
}

.result-mp {
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.refresh {
  margin-top: 8px;
}
</style>
