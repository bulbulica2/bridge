<template>
  <!-- One finished playing replayed (GET /playings/{playing}): the deal on
       the table with the board's details in its corners, as the play page
       has them (#171, #180), the card-by-card stepper, then the result at
       its last step, the opening lead's analysis and the chat. Before the
       opening lead, once the board is solved, each of the leader's cards
       carries the tricks the defence makes after it (#212). The review
       page and the play page's review modal both show it; `step` (cards
       played) is all it holds, and a new playing starts again before the
       opening lead. -->
  <div class="board-review">
    <p v-if="!recorded" class="unrecorded">
      The auction and play of this board weren't recorded.
    </p>

    <div ref="tableBox" class="review-table">
      <BridgeTable
        :players="review.players"
        :my-seat="mySeat"
        :board="review.board"
        :board-label="review.set ? boardInSetText(review.set) : null"
        :turn="null"
        :deal="total > 0 ? at.hands : review.deal"
        :replay="total > 0"
        :reserve="total > 0 ? review.deal : null"
        :lead-marks="step === 0 ? marks : null"
        bottom-right-room
        @select="emit('select', $event)"
      >
        <!-- Who is vulnerable, in words (#151), top left. -->
        <template v-if="review.board" #top-left>
          <VulnerabilityLabel
            class="corner-vul"
            compact
            :vulnerable="review.board.vulnerable"
            :my-seat="mySeat"
          />
        </template>
        <!-- The contract, and the tricks each side has won at this step. -->
        <template #top-right>
          <div class="corner-contract">
            <template v-if="review.contract">
              <p class="contract-line">
                <CallLabel :bid="review.contract.bid" />{{ doubledMark(review.contract.doubled) }}
                by {{ SEAT_NAMES[review.contract.declarer] }}
              </p>
              <p v-if="total > 0" class="tricks-won">
                <span>NS {{ at.tricksWon.ns }}</span>
                <span aria-hidden="true">·</span>
                <span>EW {{ at.tricksWon.ew }}</span>
              </p>
            </template>
            <p v-else class="contract-line">Passed out</p>
          </div>
        </template>
        <!-- What was possible double dummy (bb#114), small, with this
             contract marked: only once the backend has solved it, and only
             before the opening lead. From the first card on it keeps its
             room unseen, in case the table gave it a row of its own (a
             narrow phone), so nothing below moves. -->
        <template v-if="ddReady" #bottom-right>
          <DoubleDummyTable
            compact
            :analysis="doubleDummy"
            :highlight="played"
            :class="{ 'layer-off': step > 0 }"
            :aria-hidden="step > 0 ? 'true' : undefined"
          />
        </template>

        <!-- Before the opening lead, the auction; from the first card, the
             trick. Both lie in the same cell, the one not shown kept unseen,
             so the centre is as tall as the taller at every step and the
             stepper below never moves (#133). A passed-out board keeps its
             auction; an unrecorded one has neither (the board's details). -->
        <template v-if="auction || total > 0" #centre>
          <div class="review-centre">
            <div
              v-if="auction"
              class="centre-layer review-auction"
              :class="{ 'layer-off': step > 0 }"
              :inert="step > 0"
              :aria-hidden="step > 0 ? 'true' : undefined"
            >
              <AuctionHistory
                :auction="auction"
                :board="review.board"
                :my-seat="mySeat"
                :turn="null"
                :players="review.players"
              />
            </div>
            <div
              v-if="total > 0"
              class="centre-layer review-trick"
              :class="{ 'layer-off': auction && step === 0 }"
              :aria-hidden="auction && step === 0 ? 'true' : undefined"
            >
              <TrickArea :cards="at.trick" :my-seat="mySeat" :winner="at.winner" />
              <p class="trick-caption">{{ stepCaption(at) }}</p>
            </div>
          </div>
        </template>
      </BridgeTable>
    </div>

    <!-- Card by card, or a whole trick at a time. The hands keep their
         dealt height (reserve), and the position line, which may wrap on a
         phone, sits under the buttons: nothing above them changes size from
         step to step, so they stay put. -->
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

    <!-- The score once the replay reaches the end (at once when there is no
         play to step through), with the matchpoints when already read. -->
    <BoardResultPanel
      v-if="review.result && step === total"
      :result="review.result"
      :my-seat="mySeat"
      :players="review.players"
      :extras="extras"
    />

    <!-- How good the opening lead was, in words, once the backend has
         solved the board (never on a passed-out one): the figures are on
         the leader's cards before the lead. -->
    <p v-if="leadText" class="lead-summary">{{ leadText }}</p>

    <!-- The board's chat, all of it: public once the board is over. -->
    <section v-if="messages.length > 0" class="review-chat" aria-label="Chat">
      <h3 class="review-chat-title">Chat</h3>
      <ChatMessageList
        :messages="messages"
        :players="review.players"
        :auction="review.auction"
        :me="auth.user?.id ?? null"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { IonButton, IonIcon } from '@ionic/vue';
import {
  chevronBack,
  chevronForward,
  playBack,
  playForward,
  playSkipBack,
  playSkipForward,
} from 'ionicons/icons';
import AuctionHistory from '@/components/AuctionHistory.vue';
import BoardResultPanel from '@/components/BoardResultPanel.vue';
import BridgeTable from '@/components/BridgeTable.vue';
import CallLabel from '@/components/CallLabel.vue';
import ChatMessageList from '@/components/ChatMessageList.vue';
import DoubleDummyTable from '@/components/DoubleDummyTable.vue';
import TrickArea from '@/components/TrickArea.vue';
import VulnerabilityLabel from '@/components/VulnerabilityLabel.vue';
import { DOUBLE_DUMMY_REREAD_MS } from '@/composables/useDoubleDummy';
import { useAuthStore } from '@/stores/auth';
import { useHistoryStore } from '@/stores/history';
import type { PlayingReview } from '@/services/history';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES } from '@/utils/auction';
import { cardSize } from '@/utils/cardSize';
import { leadMarks, leadSummary } from '@/utils/doubleDummy';
import { nextSeat, openingLead } from '@/utils/export';
import type { ExportExtras } from '@/utils/export';
import { doubledMark, seatOfUser } from '@/utils/result';
import { boardInSetText } from '@/utils/sets';
import {
  clampStep,
  isRecorded,
  nextTrickStep,
  playedCards,
  previousTrickStep,
  reviewAt,
  stepCaption,
} from '@/utils/review';

const props = withDefaults(
  defineProps<{
    review: PlayingReview;
    // Its matchpoints, when already read (useBoardExport's `extras`).
    extras?: ExportExtras;
  }>(),
  { extras: () => ({}) },
);

const emit = defineEmits<{ select: [player: PublicUser] }>();

const auth = useAuthStore();
const history = useHistoryStore();

// How many cards have been played at the point shown.
const step = ref(0);

// Another playing: back before the opening lead.
watch(
  () => props.review.playing_id,
  () => {
    step.value = 0;
  },
);

const recorded = computed(() => isRecorded(props.review));

const total = computed(() => playedCards(props.review).length);

const messages = computed(() => props.review.messages ?? []);

const at = computed(() => reviewAt(props.review, step.value));

// The viewer's seat if they played this board; otherwise South is at the
// bottom, as for anyone without a seat.
const mySeat = computed<Seat | null>(() => seatOfUser(props.review.players, auth.user?.id));

// "Trick 3 of 13 · card 2 of 4" (fewer tricks when a claim ended the play).
const position = computed(() => {
  const { trickNumber, trick } = at.value;
  if (trickNumber === null) {
    return 'Before the opening lead';
  }
  const tricks = Math.ceil(total.value / 4);
  const ended = step.value === total.value && props.review.result?.claimed ? ' · the rest by claim' : '';
  return `Trick ${trickNumber} of ${tricks} · card ${trick.length} of 4${ended}`;
});

// The auction, when recorded (a playing finished before bb#60 has none).
const auction = computed(() => (recorded.value && props.review.auction?.length ? props.review.auction : null));

const doubleDummy = computed(() => props.review.double_dummy ?? null);

// The grid shows only once solved: pending or unavailable, nothing.
const ddReady = computed(() => doubleDummy.value?.status === 'ready' && !!doubleDummy.value.table);

// The contract's cell in the double dummy table.
const played = computed(() => {
  const contract = props.review.contract;
  return contract?.bid.strain ? { declarer: contract.declarer, strain: contract.bid.strain } : null;
});

// Every possible opening lead with its tricks, once solved (never on a
// passed-out board).
const leads = computed(() => {
  const analysis = doubleDummy.value;
  return analysis?.status === 'ready' && analysis.leads?.length ? analysis.leads : null;
});

// The opening leader's cards' pills, before the lead: the defence's tricks
// after each (#212).
const marks = computed(() => {
  const contract = props.review.contract;
  return leads.value && contract
    ? { seat: nextSeat(contract.declarer), marks: leadMarks(leads.value, openingLead(props.review)) }
    : null;
});

// The same in words, counted for the defence like the pills.
const leadText = computed(() =>
  marks.value ? leadSummary(leads.value!, openingLead(props.review), mySeat.value, 'defence') : null,
);

// The leader's hand is a step larger while its pills show: leaving the
// step before the lead, the table keeps the height it had there (measured
// before the DOM changes), so the stepper below stays put. Back before the
// lead (another playing goes there too), another card size or a resized
// window lets it go.
const tableBox = ref<HTMLElement | null>(null);

function letGo() {
  if (tableBox.value) {
    tableBox.value.style.minHeight = '';
  }
}

watch(
  step,
  (now, before) => {
    if (now === 0) {
      letGo();
    } else if (before === 0 && marks.value && tableBox.value) {
      tableBox.value.style.minHeight = `${tableBox.value.getBoundingClientRect().height}px`;
    }
  },
  { flush: 'pre' },
);
watch(cardSize, letGo);

// Only a new width: a phone's address bar showing or hiding as the page
// scrolls resizes the window's height alone.
let windowWidth = 0;
function onResize() {
  if (window.innerWidth !== windowWidth) {
    windowWidth = window.innerWidth;
    letGo();
  }
}
onMounted(() => {
  windowWidth = window.innerWidth;
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

// Still being solved: read the playing once more a little later (the
// history store asks again for a pending one), never in a loop; the grid
// appears if it is ready by then.
let rereadFor: number | null = null;
let rereadTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => (doubleDummy.value?.status === 'pending' ? props.review.playing_id : null),
  (id) => {
    if (id === null || id === rereadFor) {
      return;
    }
    rereadFor = id;
    stopReread();
    rereadTimer = setTimeout(() => {
      rereadTimer = null;
      history.loadReview(id).catch(() => {});
    }, DOUBLE_DUMMY_REREAD_MS);
  },
  { immediate: true },
);

function stopReread() {
  if (rereadTimer) {
    clearTimeout(rereadTimer);
    rereadTimer = null;
  }
}

onBeforeUnmount(stopReread);

function go(to: number) {
  step.value = clampStep(to, total.value);
}
</script>

<style scoped>
.review-chat {
  margin: 16px 0;
}

/* The table fills the height held for it (see `tableBox`). */
.review-table {
  display: flex;
  flex-direction: column;
}

.review-table :deep(.bridge-table) {
  flex: 1 0 auto;
}

.lead-summary {
  margin: 12px 0;
  font-weight: 600;
  text-align: center;
}

.review-chat-title {
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 700;
}

.unrecorded {
  margin: 0 0 12px;
  text-align: center;
  color: var(--ion-color-medium);
}

/* The auction and the trick in one cell (see the template). */
.review-centre {
  display: grid;
  width: 100%;
}

.centre-layer {
  grid-area: 1 / 1;
  align-self: center;
  min-width: 0;
}

.review-auction {
  color: var(--bridge-ink);
  text-align: left;
}

.review-auction :deep(.auction) {
  margin: 0;
}

.review-auction :deep(.empty) {
  color: var(--bridge-muted);
}

/* A phone's centre, between two hands, is narrow: the grid packs closer,
   smaller chips and the seats without their players' names, so four
   columns of calls fit. */
@container (max-width: 259px) {
  .review-auction :deep(.auction) {
    padding: 4px;
  }

  .review-auction :deep(table) {
    border-spacing: 2px;
  }

  .review-auction :deep(.player) {
    display: none;
  }

  .review-auction :deep(th.mine .seat::after) {
    content: none;
  }

  .review-auction :deep(td) {
    height: 26px;
  }

  .review-auction :deep(.chip) {
    min-width: 0;
    height: 24px;
    padding: 0 3px;
    border-radius: 6px;
    font-size: 0.8125rem;
  }

  .review-auction :deep(.mark) {
    width: 14px;
    height: 14px;
    margin-left: 0;
  }
}

.layer-off {
  visibility: hidden;
}

/* The contract and the tricks, top right: white on the navy, as on the
   play page. */
.corner-contract {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  color: var(--bridge-on-table);
  font-size: 0.875rem;
  line-height: 1.2;
  text-align: right;
}

.corner-contract p {
  margin: 0;
}

.contract-line {
  font-weight: 700;
}

/* Hearts and diamonds stay readable on the navy. */
.contract-line :deep(.call.red) {
  color: var(--bridge-on-table-bad);
}

.corner-contract .tricks-won {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0 6px;
  font-family: var(--bridge-font-numbers);
  font-size: 0.9375rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
</style>
