<template>
  <!-- A claim waiting for its answers, in a small dialog in the middle of
       the screen (#186), over the table, which never moves for it: what is
       claimed and what it makes of the contract, a ring counting down to
       `expires_at`, the claimer's cards (also face up at their seat on the
       table), who has accepted, and what the viewer can do about it
       (Accept / Reject, Withdraw for the claimer). A robot declarer's dummy
       claims and answers for declarer's seat (`actsFor`). Silence rejects
       the claim at `expires_at`: the buttons go once it has run out (a late
       answer only gets a 409). Those with something to do can't put it
       away (it lasts 10 s at most); anyone else closes it with the X, the
       backdrop or Escape. The parent owns whether it is open, and closes it
       when the claim goes. -->
  <ion-modal
    :is-open="open"
    class="claim-answer-dialog"
    aria-labelledby="claim-answer-title"
    :backdrop-dismiss="!mustAct"
    @did-dismiss="dismissed"
  >
    <div v-if="shown && held" class="claim-answer">
      <header class="claim-answer-head">
        <h2 id="claim-answer-title" class="claim-answer-title">
          Claim<template v-if="forSeat"> for {{ SEAT_NAMES[forSeat] }}</template>
        </h2>
        <ion-button
          v-if="!mustAct"
          fill="clear"
          size="small"
          class="claim-answer-close"
          aria-label="Close"
          @click="emit('close')"
        >
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </header>

      <div class="claim-answer-summary">
        <div class="claim-answer-what">
          <p class="claim-answer-text">{{ claimText(claim!, remaining, mySeat, ownSeat) }}</p>
          <p v-if="outcome" class="claim-answer-outcome" :class="{ down: outcome.down }">{{ outcome.result }}</p>
        </div>
        <div
          v-if="seconds !== null"
          class="claim-ring"
          :class="{ 'claim-ring-urgent': urgent }"
          :style="{ '--ring-fill': `${ringPercent}%` }"
          role="timer"
          :aria-label="`Time left to answer: ${formatClock(seconds)}`"
        >
          <span class="claim-ring-face bridge-number">{{ formatClock(seconds) }}</span>
        </div>
      </div>

      <HandView
        class="claim-answer-hand"
        :cards="claim!.hand"
        :order="SUITS"
        :label="`${SEAT_NAMES[claim!.seat]}'s cards`"
        single-row
      />

      <ul class="claim-answers" aria-live="polite">
        <li
          v-for="seat in answerers"
          :key="seat"
          :class="{ 'is-accepted': claim!.accepted.includes(seat) }"
          :data-seat="seat"
        >
          <span class="claim-answer-mark" aria-hidden="true">{{ claim!.accepted.includes(seat) ? '✓' : '…' }}</span>
          {{ SEAT_NAMES[seat] }}
          <span class="claim-answer-who">{{ isMine(seat) ? 'you' : (players[seat]?.username ?? '') }}</span>
          <span class="sr-only">{{ claim!.accepted.includes(seat) ? ' accepted' : ' to answer' }}</span>
        </li>
      </ul>

      <div v-if="action === 'answer'" class="claim-buttons">
        <ion-button color="action" class="accept" :disabled="busy || expired" @click="emit('accept')">
          Accept
        </ion-button>
        <ion-button fill="outline" class="reject" :disabled="busy || expired" @click="emit('reject')">
          Reject
        </ion-button>
      </div>
      <div v-else-if="action === 'withdraw'" class="claim-buttons">
        <ion-button fill="outline" class="withdraw" :disabled="busy || expired" @click="emit('withdraw')">
          Withdraw
        </ion-button>
      </div>
      <p v-if="waitingText && action !== 'answer'" class="claim-answer-waiting">{{ waitingText }}</p>
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonButton, IonIcon, IonModal } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import HandView from '@/components/HandView.vue';
import { useNow } from '@/composables/useNow';
import type { Claim, PublicPlaying } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES } from '@/utils/auction';
import { formatClock } from '@/utils/away';
import { SUITS } from '@/utils/cards';
import {
  CLAIM_SECONDS,
  CLAIM_URGENT_SECONDS,
  claimAction,
  claimAnswerers,
  claimExpired,
  claimOutcome,
  claimSecondsLeft,
  claimText,
  claimWaitingText,
  tricksLeft,
} from '@/utils/claim';

type ClaimState = PublicPlaying & { claim: Claim };

const props = withDefaults(
  defineProps<{
    open: boolean;
    // The board with its pending claim; null once the claim has gone (the
    // dialog then shows the last one while it closes).
    state: ClaimState | null;
    mySeat: Seat | null;
    // The seat the viewer claims and answers for, when not their own: a
    // robot declarer's, whose game its dummy plays (claimSeatOf).
    actsFor?: Seat | null;
    players: Partial<Record<Seat, PublicUser | null>>;
    // An answer or a withdrawal is on its way.
    busy?: boolean;
  }>(),
  { actsFor: null, busy: false },
);

const emit = defineEmits<{ accept: []; reject: []; withdraw: []; close: [] }>();

// The content stays until the dialog has finished closing, so it never
// empties while it animates out: the last claim shown is held for it.
const shown = ref(props.open);
const held = ref<ClaimState | null>(props.state);
watch(
  () => props.open,
  (open) => {
    if (open) {
      shown.value = true;
    }
  },
);
watch(
  () => props.state,
  (state) => {
    if (state) {
      held.value = state;
    }
  },
);

// Closed by the backdrop or Escape while the parent still had it open: tell
// it. Closed by the parent (the claim gone, the page left), nothing to say.
function dismissed() {
  shown.value = false;
  if (props.open) {
    emit('close');
  }
}

const claim = computed(() => held.value?.claim ?? null);
const remaining = computed(() => (held.value ? tricksLeft(held.value) : 0));
const answerers = computed(() => (held.value ? claimAnswerers(held.value) : []));
const ownSeat = computed(() => props.actsFor ?? props.mySeat);
const action = computed(() => (held.value ? claimAction(held.value, ownSeat.value) : null));
// The claimer and an answerer still to answer keep it open: it is theirs.
const mustAct = computed(() => action.value !== null);
// "Claim for North": the viewer claimed for a robot declarer's seat.
const forSeat = computed(() =>
  claim.value && ownSeat.value !== props.mySeat && claim.value.seat === ownSeat.value ? ownSeat.value : null,
);

// "4♠ +1", from the claimer's side.
const outcome = computed(() =>
  held.value && claim.value ? claimOutcome(held.value, claim.value.seat, claim.value.tricks) : null,
);

const waitingText = computed(() => (held.value ? claimWaitingText(held.value) : null));

// The ring only redraws the countdown; the deadline is the claim's own.
const now = useNow(() => props.open && !!claim.value?.expires_at);
const seconds = computed(() => (claim.value ? claimSecondsLeft(claim.value, now.value) : null));
const expired = computed(() => !!claim.value && claimExpired(claim.value, now.value));
const urgent = computed(() => seconds.value !== null && seconds.value < CLAIM_URGENT_SECONDS);
const ringPercent = computed(() => Math.min(100, Math.round(((seconds.value ?? 0) / CLAIM_SECONDS) * 100)));

function isMine(seat: Seat): boolean {
  return seat === props.mySeat || seat === ownSeat.value;
}
</script>

<style scoped>
/* Centred, as tall as its content (ClaimSheet's dialog, #173). */
ion-modal.claim-answer-dialog {
  --width: min(400px, calc(100vw - 32px));
  --height: auto;
  --border-radius: 16px;
  --box-shadow: 0 12px 40px var(--bridge-shadow-strong);
  /* Ionic shows no backdrop behind a phone's (full-screen) modal. */
  --backdrop-opacity: var(--ion-backdrop-opacity, 0.4);
}

.claim-answer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 16px 16px;
  background: var(--bridge-surface);
  color: var(--bridge-ink);
}

.claim-answer p {
  margin: 0;
}

/* The title's row keeps the X's height, so it reads the same without it. */
.claim-answer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  margin-right: -10px;
}

.claim-answer-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
}

/* A 44 px tap area in the corner. */
.claim-answer-close {
  flex: none;
  width: 44px;
  height: 44px;
  margin: 0;
  --color: var(--bridge-muted);
}

.claim-answer-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.claim-answer-what {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.claim-answer-text {
  font-size: 1.05rem;
  font-weight: 700;
}

.claim-answer-outcome {
  font-family: var(--bridge-font-numbers);
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--bridge-pass-text);
}

.claim-answer-outcome.down {
  color: var(--bridge-error);
}

/* The countdown ring (the result dialog's vote ring): the action colour
   empties clockwise over the claim's 10 s, red at the end. */
.claim-ring {
  --ring-colour: var(--bridge-action);
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: conic-gradient(var(--ring-colour) 0 var(--ring-fill), var(--bridge-line) var(--ring-fill) 100%);
}

.claim-ring-urgent {
  --ring-colour: var(--bridge-error);
}

.claim-ring-face {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bridge-surface);
  font-size: 0.9375rem;
}

.claim-ring-urgent .claim-ring-face {
  color: var(--bridge-error);
}

/* The claimer's cards on one row, sized to the dialog (handRow.ts). */
.claim-answer-hand {
  width: 100%;
}

.claim-answers {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.875rem;
  color: var(--bridge-muted);
}

.claim-answer-mark {
  display: inline-block;
  width: 1em;
}

.claim-answer-who {
  font-weight: 400;
}

.claim-answers .is-accepted {
  font-weight: 700;
  color: var(--bridge-pass-text);
}

/* Two equal buttons: the orange one agrees, the outline one says no. */
.claim-buttons {
  display: flex;
  gap: 8px;
}

.claim-buttons ion-button {
  flex: 1;
  margin: 0;
}

.claim-answer-waiting {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--bridge-muted);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
