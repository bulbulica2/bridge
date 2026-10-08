<template>
  <!-- A small dialog in the middle of the screen for making a claim (#173):
       the title with an X, one tile per number of the tricks still to play,
       from all of them down to 0, each with what it makes of the contract
       and the claimer's side's score (every trick left picked to start
       with), then the one send button for the number picked, which reads
       Concede for 0. The X, the backdrop and Escape close it. The parent
       owns whether it is open and sends the claim. A robot declarer's dummy
       claims for declarer (`forSeat`); `seat` is the seat claimed for
       either way. -->
  <ion-modal
    :is-open="open"
    class="claim-dialog"
    aria-labelledby="claim-dialog-title"
    @did-dismiss="emit('close')"
  >
    <div class="claim-sheet">
      <header class="claim-head">
        <h2 id="claim-dialog-title" class="claim-title">
          Claim<template v-if="forSeat"> for {{ SEAT_NAMES[forSeat] }}</template>
        </h2>
        <ion-button fill="clear" size="small" class="claim-close" aria-label="Close" @click="emit('close')">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </header>

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
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonModal, IonButton, IonIcon, IonSpinner } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import type { PublicPlaying } from '@/services/game';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { claimOutcome } from '@/utils/claim';

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
// The player picked it by hand since the dialog opened.
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

// "Claim 5 · 4♠ +3 · +510", "Claim 1 · 4♠ −1 · −50"; the 0 tile is the
// concede, whose result and score its tile shows.
const sendLabel = computed(() => {
  const n = tricks.value;
  if (n === 0) {
    return 'Concede';
  }
  const made = outcome(n);
  return made ? `Claim ${n} · ${made.result} · ${made.score}` : `Claim ${n}`;
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
/* Centred, as tall as its content: no breakpoints, so no drag handle.
   Ionic's own `ion-modal > .ion-page` rule lets the content set the height. */
ion-modal.claim-dialog {
  --width: min(400px, calc(100vw - 32px));
  --height: auto;
  --border-radius: 16px;
  --box-shadow: 0 12px 40px var(--bridge-shadow-strong);
  /* Ionic shows no backdrop behind a phone's (full-screen) modal. */
  --backdrop-opacity: var(--ion-backdrop-opacity, 0.4);
}

.claim-sheet {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px 16px 16px;
  background: var(--bridge-surface);
  color: var(--bridge-ink);
}

.claim-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-right: -10px;
}

.claim-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
}

/* A 44 px tap area in the corner. */
.claim-close {
  flex: none;
  width: 44px;
  height: 44px;
  margin: 0;
  --color: var(--bridge-muted);
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

.send-claim {
  margin: 0;
  --border-radius: 14px;
  min-height: 54px;
  font-size: 1.05rem;
}
</style>
