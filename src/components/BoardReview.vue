<template>
  <!-- One finished playing replayed (GET /playings/{playing}): the contract,
       the deal on the table, the card-by-card stepper, the result at its
       last step, what was possible double dummy and the auction. The review
       page and the play page's review modal both show it; `step` (cards played) is all it holds, and a new
       playing starts again before the opening lead. -->
  <div class="board-review">
    <!-- Who is vulnerable, in words, top left above the table (#151). -->
    <div v-if="review.board" class="board-bar">
      <VulnerabilityLabel :vulnerable="review.board.vulnerable" :my-seat="mySeat" />
    </div>

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
      @select="emit('select', $event)"
    >
      <template v-if="total > 0" #centre>
        <TrickArea :cards="at.trick" :my-seat="mySeat" :winner="at.winner" />
        <p class="trick-caption">{{ stepCaption(at) }}</p>
      </template>
    </BridgeTable>

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
      :extras="extras"
    />

    <!-- What was possible (bb#114): the double dummy table with this
         contract marked, and how good each opening lead was. The backend
         solves them in its queue; while it hasn't, a note, and the
         playing is read once more. -->
    <DoubleDummyTable :analysis="doubleDummy" :highlight="played" />
    <LeadAnalysis
      v-if="leads && review.contract"
      :leads="leads"
      :leader="nextSeat(review.contract.declarer)"
      :lead="openingLead(review)"
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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
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
import LeadAnalysis from '@/components/LeadAnalysis.vue';
import TrickArea from '@/components/TrickArea.vue';
import VulnerabilityLabel from '@/components/VulnerabilityLabel.vue';
import { DOUBLE_DUMMY_REREAD_MS } from '@/composables/useDoubleDummy';
import { useAuthStore } from '@/stores/auth';
import { useHistoryStore } from '@/stores/history';
import type { PlayingReview } from '@/services/history';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES, doubledSuffix } from '@/utils/auction';
import { nextSeat, openingLead } from '@/utils/export';
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

const doubleDummy = computed(() => props.review.double_dummy ?? null);

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

// Still being solved: read the playing once more a little later (the
// history store asks again for a pending one), never in a loop.
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

// "North (ann)", or "North (you)".
function who(seat: Seat): string {
  if (seat === mySeat.value) {
    return `${SEAT_NAMES[seat]} (you)`;
  }
  const user = props.review.players[seat];
  return user ? `${SEAT_NAMES[seat]} (${user.username})` : SEAT_NAMES[seat];
}

function go(to: number) {
  step.value = clampStep(to, total.value);
}
</script>

<style scoped>
.review-chat {
  margin: 16px 0;
}

.review-chat-title {
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 700;
}

.board-bar {
  margin: 0 0 8px;
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
</style>
