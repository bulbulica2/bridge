<template>
  <!-- A bottom sheet for making a claim (Daylight, #161): one tile per
       number of the tricks still to play, from all of them down to 0, each
       with what it makes of the contract and the claimer's side's score;
       every trick left is picked to start with. Then the send button for
       the number picked, or Concede for none. The parent owns whether it is
       open and sends the claim. A robot declarer's dummy claims for
       declarer (`forSeat`); `seat` is the seat claimed for either way. -->
  <ion-modal
    :is-open="open"
    :initial-breakpoint="0.75"
    :breakpoints="[0, 0.75, 1]"
    @did-dismiss="emit('close')"
  >
    <ion-content class="ion-padding claim-content">
      <div class="claim-sheet">
        <h2 class="claim-title">
          Claim tricks<template v-if="forSeat"> for {{ SEAT_NAMES[forSeat] }}</template>
        </h2>
        <p class="claim-summary">{{ summary }}</p>

        <div class="trick-picks" role="group" aria-label="Tricks to claim">
          <button
            v-for="option in options"
            :key="option.tricks"
            type="button"
            class="trick-pick"
            :class="{ picked: tricks === option.tricks, down: option.outcome?.down }"
            :aria-pressed="tricks === option.tricks"
            :data-tricks="option.tricks"
            :disabled="busy"
            @click="pick(option.tricks)"
          >
            <span class="pick-count">{{ option.tricks }}</span>
            <template v-if="option.outcome">
              <span class="pick-result">{{ option.outcome.result }}</span>
              <span class="pick-score">{{ option.outcome.score }}</span>
            </template>
          </button>
        </div>

        <p class="claim-help">
          {{ forSeat ? `${SEAT_NAMES[forSeat]}'s hand` : 'Your hand' }} is shown to everyone while
          the others answer.
        </p>

        <ion-button
          expand="block"
          color="action"
          class="send-claim"
          :disabled="busy || remaining < 1"
          @click="emit('claim', tricks)"
        >
          <ion-spinner v-if="busy" name="crescent" />
          <span v-else>{{ sendLabel }}</span>
        </ion-button>
        <div class="claim-foot">
          <p class="claim-deadline">
            {{ answerers }} get {{ CLAIM_SECONDS }} seconds. No answer counts as no.
          </p>
          <ion-button fill="outline" class="concede" :disabled="busy" @click="emit('claim', 0)">
            Concede
          </ion-button>
        </div>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonModal, IonContent, IonButton, IonSpinner } from '@ionic/vue';
import type { PublicPlaying } from '@/services/game';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { CLAIM_SECONDS, claimAnswerersText, claimOutcome, claimSummary } from '@/utils/claim';

const props = withDefaults(
  defineProps<{
    open: boolean;
    // The tricks still to play: the most that can be claimed.
    remaining: number;
    // The seat claimed for, when not the viewer's own: a robot declarer's,
    // whose game its dummy plays.
    forSeat?: Seat | null;
    // The board and the seat claiming (claimSeatOf), for each number's
    // result and score; without them the tiles show the numbers alone.
    state?: PublicPlaying | null;
    seat?: Seat | null;
    // The claim is on its way.
    busy?: boolean;
  }>(),
  { forSeat: null, state: null, seat: null, busy: false },
);

const emit = defineEmits<{ claim: [tricks: number]; close: [] }>();

// The number picked; nothing is sent until the send button is pressed.
const tricks = ref(props.remaining);
// The player picked it by hand since the sheet opened.
const picked = ref(false);

function pick(n: number) {
  tricks.value = n;
  picked.value = true;
}

function outcome(n: number) {
  return props.state && props.seat ? claimOutcome(props.state, props.seat, n) : null;
}

// All the tricks left first, down to none.
const options = computed(() =>
  props.remaining < 1
    ? []
    : Array.from({ length: props.remaining + 1 }, (_, i) => props.remaining - i).map((n) => ({
        tricks: n,
        outcome: outcome(n),
      })),
);

const summary = computed(() => {
  if (props.state && props.seat) {
    return claimSummary(props.state, props.seat);
  }
  return `${props.remaining} trick${props.remaining === 1 ? '' : 's'} left`;
});

const answerers = computed(() =>
  props.state && props.seat ? claimAnswerersText(props.state, props.seat) : 'The others',
);

// "Claim all 7 · 4♠ +1 · +450", "Claim 5 · 4♠ −1 · −50", "Concede · …".
const sendLabel = computed(() => {
  const n = tricks.value;
  const what = n === 0 ? 'Concede' : n === props.remaining && n > 1 ? `Claim all ${n}` : `Claim ${n}`;
  const made = outcome(n);
  return made ? `${what} · ${made.result} · ${made.score}` : what;
});

// Each opening starts with every remaining trick picked: a claim is almost
// always for all of them (#137).
watch(
  () => props.open,
  () => {
    tricks.value = props.remaining;
    picked.value = false;
  },
);

// A trick finishing meanwhile moves the default to the new maximum, and
// keeps a number picked by hand while it is still possible.
watch(
  () => props.remaining,
  (remaining) => {
    if (!picked.value || tricks.value > remaining) tricks.value = remaining;
  },
);
</script>

<style scoped>
.claim-content {
  --background: var(--bridge-surface);
}

.claim-sheet {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 440px;
  margin: 0 auto;
}

.claim-title {
  margin: 4px 0 0;
  font-size: 1.375rem;
  font-weight: 700;
}

.claim-summary {
  margin: -10px 0 0;
  font-size: 0.875rem;
  color: var(--bridge-muted);
}

/* Four tiles a row, all the tricks left first. */
.trick-picks {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.trick-pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-height: 48px;
  margin: 0;
  padding: 10px 4px;
  border: 0;
  border-radius: 14px;
  background: var(--bridge-ground);
  color: var(--bridge-ink);
  box-shadow: inset 0 0 0 1.5px var(--bridge-control);
  font-family: var(--bridge-font);
  cursor: pointer;
}

.trick-pick:disabled {
  cursor: default;
  opacity: 0.6;
}

.pick-count {
  font-family: var(--bridge-font-numbers);
  font-size: 1.875rem;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.pick-result {
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
}

.pick-score {
  font-size: 0.75rem;
  color: var(--bridge-muted);
  font-variant-numeric: tabular-nums;
}

/* Going down: the result in red. */
.trick-pick.down .pick-result {
  color: var(--ion-color-danger);
}

/* The number picked: the table's navy, ringed in the action's orange. */
.trick-pick.picked {
  background: var(--bridge-table);
  color: var(--bridge-on-table);
  box-shadow: 0 0 0 3px var(--bridge-action);
}

.trick-pick.picked .pick-score {
  color: var(--bridge-on-table-muted);
}

.trick-pick.picked.down .pick-result {
  color: var(--bridge-on-table);
}

.trick-pick:focus-visible {
  outline: 2px solid var(--ion-color-primary);
  outline-offset: 2px;
}

.claim-help {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--bridge-muted);
}

.send-claim {
  margin: 0;
  --border-radius: 14px;
  min-height: 54px;
  font-size: 1.05rem;
}

.claim-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.claim-deadline {
  max-width: 240px;
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--bridge-muted);
}

.concede {
  flex: none;
  margin: 0;
}
</style>
