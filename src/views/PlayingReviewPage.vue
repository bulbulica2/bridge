<template>
  <ion-page>
    <AppHeader :title="review?.board ? `Board ${review.board.number} review` : 'Board review'">
      <template #end>
        <ion-button v-if="review && !gone" aria-haspopup="menu" @click="exportOpen = true">
          <ion-icon slot="start" :icon="shareOutline" />
          Export
        </ion-button>
        <ion-button
          v-if="review?.board"
          :router-link="`/boards/${review.board.id}/results`"
          router-direction="back"
        >
          Results
        </ion-button>
      </template>
    </AppHeader>
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="review">
        <!-- A board you haven't finished (403), or no finished playing by
             that id (404): nothing to replay. -->
        <div v-if="gone" class="gone">
          <p>{{ gone }}</p>
          <ion-button router-link="/history" router-direction="back">My boards</ion-button>
        </div>

        <div v-else-if="loading && !review" class="loading" aria-busy="true">
          <ion-spinner name="crescent" />
          <p>Loading the board…</p>
        </div>

        <div v-if="!gone && loadError" class="load-error">
          <ion-text color="danger">
            <p>{{ loadError }}</p>
          </ion-text>
          <ion-button size="small" fill="outline" :disabled="loading" @click="load()">
            Try again
          </ion-button>
        </div>

        <template v-if="!gone && review">
          <!-- The contract, and the tricks each side has won at this step. -->
          <section class="outcome">
            <template v-if="review.contract">
              <p class="outcome-title">
                <CallLabel :bid="review.contract.bid" />{{ doubledSuffix(review.contract.doubled) }}
                by {{ SEAT_NAMES[review.contract.declarer] }}
              </p>
              <p class="outcome-detail">
                Declarer {{ who(review.contract.declarer) }} · Dummy {{ who(review.contract.dummy) }}
              </p>
              <p v-if="total > 0" class="tricks-won">
                <span>NS {{ at.tricksWon.ns }}</span>
                <span aria-hidden="true">·</span>
                <span>EW {{ at.tricksWon.ew }}</span>
              </p>
            </template>
            <p v-else class="outcome-title">Passed out</p>
          </section>

          <p v-if="!recorded" class="unrecorded">
            The auction and play of this board weren't recorded.
          </p>

          <BridgeTable
            :players="review.players"
            :my-seat="mySeat"
            :board="review.board"
            :turn="null"
            :deal="total > 0 ? at.hands : review.deal"
            :replay="total > 0"
            :reserve="total > 0 ? review.deal : null"
            @select="player = $event"
          >
            <template v-if="total > 0" #centre>
              <TrickArea :cards="at.trick" :my-seat="mySeat" :winner="at.winner" />
              <p class="trick-caption">{{ stepCaption(at) }}</p>
            </template>
          </BridgeTable>

          <!-- Card by card, or a whole trick at a time. The hands keep their
               dealt height (reserve), and the position line, which may wrap
               on a phone, sits under the buttons: nothing above them changes
               size from step to step, so they stay put. -->
          <section v-if="total > 0" class="stepper" aria-label="Replay">
            <div class="controls">
              <ion-button
                fill="clear"
                aria-label="Before the opening lead"
                :disabled="step === 0"
                @click="go(0)"
              >
                <ion-icon slot="icon-only" :icon="playSkipBack" />
              </ion-button>
              <ion-button
                fill="clear"
                aria-label="Previous trick"
                :disabled="step === 0"
                @click="go(previousTrickStep(step))"
              >
                <ion-icon slot="icon-only" :icon="playBack" />
              </ion-button>
              <ion-button
                fill="clear"
                aria-label="Previous card"
                :disabled="step === 0"
                @click="go(step - 1)"
              >
                <ion-icon slot="icon-only" :icon="chevronBack" />
              </ion-button>
              <ion-button
                fill="clear"
                aria-label="Next card"
                :disabled="step === total"
                @click="go(step + 1)"
              >
                <ion-icon slot="icon-only" :icon="chevronForward" />
              </ion-button>
              <ion-button
                fill="clear"
                aria-label="Next trick"
                :disabled="step === total"
                @click="go(nextTrickStep(step, total))"
              >
                <ion-icon slot="icon-only" :icon="playForward" />
              </ion-button>
              <ion-button
                fill="clear"
                aria-label="End of the play"
                :disabled="step === total"
                @click="go(total)"
              >
                <ion-icon slot="icon-only" :icon="playSkipForward" />
              </ion-button>
            </div>
            <p class="position" aria-live="polite">{{ position }}</p>
          </section>

          <!-- The score once the replay reaches the end (at once when there
               is no play to step through). -->
          <BoardResultPanel
            v-if="review.result && step === total"
            :result="review.result"
            :my-seat="mySeat"
          />

          <AuctionHistory
            v-if="recorded && review.auction"
            :auction="review.auction"
            :board="review.board"
            :my-seat="mySeat"
            :turn="null"
            :players="review.players"
          />

          <ion-button
            v-if="review.board"
            expand="block"
            fill="outline"
            class="results-link"
            :router-link="`/boards/${review.board.id}/results`"
            router-direction="back"
          >
            Results at every table
          </ion-button>
        </template>
      </div>

      <PlayerProfileSheet :player="player" @close="player = null" />

      <!-- Taking the board out of the app (src/utils/export.ts). Files and
           printing need a browser; a native shell only copies. -->
      <ion-action-sheet
        :is-open="exportOpen"
        header="Export board"
        :buttons="exportButtons"
        @did-dismiss="exportOpen = false"
      />
    </ion-content>

    <!-- Only while the print dialog is up (src/theme/print.css). -->
    <Teleport to="body">
      <BoardPrintout v-if="printing && review" :review="review" :extras="extras" />
    </Teleport>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  IonActionSheet,
  onIonViewWillEnter,
  onIonViewWillLeave,
  useIonRouter,
} from '@ionic/vue';
import {
  chevronBack,
  chevronForward,
  playBack,
  playForward,
  playSkipBack,
  playSkipForward,
  shareOutline,
} from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import AppHeader from '@/components/AppHeader.vue';
import AuctionHistory from '@/components/AuctionHistory.vue';
import BoardResultPanel from '@/components/BoardResultPanel.vue';
import BoardPrintout from '@/components/BoardPrintout.vue';
import BridgeTable from '@/components/BridgeTable.vue';
import CallLabel from '@/components/CallLabel.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import TrickArea from '@/components/TrickArea.vue';
import { useAuthStore } from '@/stores/auth';
import { useHistoryStore } from '@/stores/history';
import type { PlayingReview } from '@/services/history';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES, doubledSuffix } from '@/utils/auction';
import { copyText, downloadFile } from '@/utils/download';
import { errorMessage, statusOf } from '@/utils/errors';
import { boardJson, boardPbn, boardText, exportFileName } from '@/utils/export';
import type { ExportExtras } from '@/utils/export';
import { seatOfUser } from '@/utils/result';
import {
  clampStep,
  isRecorded,
  nextTrickStep,
  playedCards,
  previousTrickStep,
  reviewAt,
  stepCaption,
} from '@/utils/review';
import { showToast } from '@/utils/toast';

const route = useRoute();
const ionRouter = useIonRouter();
const auth = useAuthStore();
const store = useHistoryStore();

const playingId = ref(0);
const loading = ref(false);
const loadError = ref('');
// Why there is nothing to show (403, 404, a bad id), or ''.
const gone = ref('');
const player = ref<PublicUser | null>(null);
// How many cards have been played at the point shown.
const step = ref(0);

const review = computed(() => store.reviews[playingId.value] ?? null);

const recorded = computed(() => !!review.value && isRecorded(review.value));

const total = computed(() => (review.value ? playedCards(review.value).length : 0));

const at = computed(() => reviewAt(review.value!, step.value));

// The viewer's seat if they played this board here; otherwise South is at
// the bottom, as for anyone without a seat.
const mySeat = computed<Seat | null>(() =>
  review.value ? seatOfUser(review.value.players, auth.user?.id) : null,
);

// "Trick 3 of 13 · card 2 of 4" (fewer tricks when a claim ended the play).
const position = computed(() => {
  const { trickNumber, trick } = at.value;
  if (trickNumber === null) {
    return 'Before the opening lead';
  }
  const tricks = Math.ceil(total.value / 4);
  const ended = step.value === total.value && review.value?.result?.claimed ? ' · the rest by claim' : '';
  return `Trick ${trickNumber} of ${tricks} · card ${trick.length} of 4${ended}`;
});

// "North (ann)", or "North (you)".
function who(seat: Seat): string {
  if (seat === mySeat.value) {
    return `${SEAT_NAMES[seat]} (you)`;
  }
  const user = review.value?.players[seat];
  return user ? `${SEAT_NAMES[seat]} (${user.username})` : SEAT_NAMES[seat];
}

const exportOpen = ref(false);
const printing = ref(false);
const native = Capacitor.isNativePlatform();

// This playing's matchpoints, when the board's results are already loaded
// (the results page was visited): exports carry them, the page doesn't ask.
const extras = computed<ExportExtras>(() => {
  const board = review.value?.board;
  const results = board ? store.results[board.id] : undefined;
  const row = results?.results.find((r) => r.playing_id === playingId.value);
  return row ? { matchpoints: row.matchpoints, top: results!.top } : {};
});

const exportButtons = computed(() => [
  { text: 'Copy as text', handler: copyAsText },
  ...(native
    ? []
    : [
        { text: 'Download .txt', handler: () => download('txt') },
        { text: 'Download .pbn', handler: () => download('pbn') },
        { text: 'Download .json', handler: () => download('json') },
        { text: 'Print / Save as PDF', handler: print },
      ]),
  { text: 'Cancel', role: 'cancel' },
]);

async function copyAsText() {
  const board = review.value;
  if (!board) {
    return;
  }
  try {
    await copyText(boardText(board, extras.value));
    await showToast(`Board ${board.board?.number ?? ''} copied as text.`, 'success');
  } catch {
    await showToast('Could not copy to the clipboard. Try Download .txt instead.', 'danger');
  }
}

const FORMATS = {
  txt: { type: 'text/plain;charset=utf-8', write: (r: PlayingReview) => boardText(r, extras.value) },
  pbn: { type: 'text/plain;charset=utf-8', write: boardPbn },
  json: { type: 'application/json', write: boardJson },
};

function download(format: keyof typeof FORMATS) {
  const board = review.value;
  if (board) {
    downloadFile(exportFileName(board, format), FORMATS[format].write(board), FORMATS[format].type);
  }
}

// The printout exists only while the print dialog is up: shown, printed,
// then dropped on `afterprint` (window.print() doesn't block everywhere).
async function print() {
  printing.value = true;
  document.body.classList.add('printing-board');
  await nextTick();
  window.addEventListener('afterprint', stopPrinting, { once: true });
  window.print();
}

function stopPrinting() {
  printing.value = false;
  document.body.classList.remove('printing-board');
}

onIonViewWillLeave(() => {
  exportOpen.value = false;
  window.removeEventListener('afterprint', stopPrinting);
  stopPrinting();
});

function go(to: number) {
  step.value = clampStep(to, total.value);
}

// Ionic keeps the page alive, so read the param on every entry: opening
// another playing must not reuse the old id or step.
onIonViewWillEnter(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  step.value = 0;
  if (!raw || !Number.isInteger(id) || id <= 0) {
    playingId.value = 0;
    gone.value = "This board doesn't exist.";
    return;
  }
  playingId.value = id;
  gone.value = '';
  load();
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await store.loadReview(playingId.value);
  } catch (e) {
    const status = statusOf(e);
    // A 401 here means the session expired after the router guard let us in.
    if (status === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
    } else if (status === 403) {
      gone.value =
        'You can review a board once you have finished it yourself, since you might still be dealt it.';
    } else if (status === 404) {
      gone.value = "This board doesn't exist or isn't finished yet.";
    } else {
      loadError.value = errorMessage(e, 'Could not load the board. Please try again.');
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
/* As wide as the play page: the same table. */
.review {
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

.gone {
  padding: 32px 0;
  text-align: center;
}

.load-error {
  margin: 16px 0;
  text-align: center;
}

.outcome {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.08);
  text-align: center;
}

.outcome p {
  margin: 0;
}

.outcome-title {
  font-size: 1.15rem;
  font-weight: 700;
}

.outcome .outcome-detail {
  margin-top: 4px;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.outcome .tricks-won {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 6px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.unrecorded {
  margin: 0 0 12px;
  text-align: center;
  color: var(--ion-color-medium);
}

.trick-caption {
  margin-top: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ion-color-medium);
}

.stepper {
  margin: 12px 0;
  text-align: center;
}

.position {
  margin: 0;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  color: var(--ion-color-medium);
}

.controls {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
}

.results-link {
  margin-top: 12px;
}
</style>
