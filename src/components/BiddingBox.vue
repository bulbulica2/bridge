<template>
  <!-- The 35 bids, one row per level, clubs to no trump, then Pass, X and XX.
       A call the rules wouldn't allow is disabled (a hint: the backend has
       the final word), and everything is while a call is on its way. Above
       them, the alert for the next call: its explanation and an Alert
       toggle, so a call can be alerted with nothing written (the page owns
       both, and clears them once a call is taken). -->
  <section class="bidding-box" aria-label="Bidding box" :aria-busy="busy">
    <div class="alert-field">
      <div class="alert-row">
        <input
          class="alert-input"
          type="text"
          :value="explanation"
          :maxlength="ALERT_MAX"
          placeholder="Explain to the opponents (optional)"
          aria-label="Explain your next call to the opponents"
          :disabled="busy"
          @input="type(($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="alert-toggle"
          :class="{ on: alert }"
          :aria-pressed="alert"
          :disabled="busy"
          @click="flip"
        >
          <span class="alert-mark" aria-hidden="true">!</span> Alert
        </button>
      </div>
      <p class="alert-hint">Only the opponents see this. Your partner doesn't.</p>
    </div>

    <div class="bids">
      <div v-for="row in grid" :key="row.level" class="level">
        <button
          v-for="bid in row.bids"
          :key="bid.id"
          type="button"
          class="bid"
          :class="{ red: isRedStrain(bid.strain), nt: bid.strain === 'NT' }"
          :data-call="bid.call"
          :aria-label="callName(bid)"
          :disabled="busy || !isLegalCall(bid, auction, seat)"
          @click="emit('call', bid)"
        >
          {{ bid.level }}<span class="strain">{{ strainSymbol(bid.strain!) }}</span>
        </button>
      </div>
    </div>

    <div class="specials">
      <button
        v-for="bid in specials"
        :key="bid.id"
        type="button"
        class="special"
        :class="`special-${bid.call.toLowerCase()}`"
        :data-call="bid.call"
        :aria-label="callName(bid)"
        :disabled="busy || !isLegalCall(bid, auction, seat)"
        @click="emit('call', bid)"
      >
        {{ callLabel(bid) }}
      </button>
    </div>

    <p v-if="busy" class="sending">
      <ion-spinner name="dots" />
      <span>Sending your call…</span>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonSpinner } from '@ionic/vue';
import type { AuctionCall, Bid } from '@/services/game';
import type { Seat } from '@/services/tables';
import { ALERT_MAX } from '@/utils/limits';
import {
  DOUBLE,
  LEVELS,
  PASS,
  REDOUBLE,
  STRAINS,
  callLabel,
  callName,
  isContractBid,
  isLegalCall,
  isRedStrain,
  strainSymbol,
} from '@/utils/auction';

const props = defineProps<{
  // The GET /bids list: every button sends its bid's id.
  bids: Bid[];
  auction: AuctionCall[];
  // Whose call it is: the viewer's own seat.
  seat: Seat;
  busy: boolean;
}>();

const emit = defineEmits<{ call: [bid: Bid] }>();

// The next call's alert: whether it is alerted, and what it means.
const alert = defineModel<boolean>('alert', { default: false });
const explanation = defineModel<string>('explanation', { default: '' });

// Writing an explanation alerts the call.
function type(text: string) {
  explanation.value = text;
  if (text.trim() !== '') {
    alert.value = true;
  }
}

// Turned off, nothing is said either: an explanation alone would alert.
function flip() {
  alert.value = !alert.value;
  if (!alert.value) {
    explanation.value = '';
  }
}

// Laid out by level and strain rather than by list order or id.
const grid = computed(() =>
  LEVELS.map((level) => ({
    level,
    bids: STRAINS.map((strain) =>
      props.bids.find((b) => isContractBid(b) && b.level === level && b.strain === strain),
    ).filter((b): b is Bid => !!b),
  })),
);

const specials = computed(() =>
  [PASS, DOUBLE, REDOUBLE]
    .map((call) => props.bids.find((b) => b.call === call))
    .filter((b): b is Bid => !!b),
);
</script>

<style scoped>
.bidding-box {
  margin: 12px 0;
  padding: 10px;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 10px;
  background: var(--ion-color-light, #f4f5f8);
}

.bids {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.level {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
}

/* Bidding cards: white like the real ones, so the suit colours read the same
   in dark mode. */
button {
  min-height: 34px;
  padding: 0;
  border: 1px solid #b8b8b8;
  border-radius: 6px;
  background: #fff;
  color: #1a1a1a;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

button:not(:disabled):hover,
button:not(:disabled):focus-visible {
  border-color: var(--ion-color-primary, #0054e9);
  box-shadow: 0 0 0 2px rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.3);
  outline: none;
}

button:disabled {
  opacity: 0.3;
  cursor: default;
}

.bid.red {
  color: #c62828;
}

.bid.nt {
  font-size: 0.9rem;
}

.specials {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 4px;
  margin-top: 8px;
}

.special {
  min-height: 40px;
  color: #fff;
}

.special-p {
  border-color: #2e7d32;
  background: #2e7d32;
}

.special-x {
  border-color: #c62828;
  background: #c62828;
}

.special-xx {
  border-color: #1565c0;
  background: #1565c0;
}

.alert-field {
  margin-bottom: 10px;
}

.alert-row {
  display: flex;
  gap: 6px;
}

.alert-input {
  flex: 1;
  min-width: 0;
  min-height: 34px;
  padding: 0 8px;
  border: 1px solid #b8b8b8;
  border-radius: 6px;
  background: var(--ion-background-color, #fff);
  color: var(--ion-text-color, #1a1a1a);
  font: inherit;
  font-size: 0.9rem;
}

.alert-input:focus-visible {
  border-color: var(--ion-color-primary, #0054e9);
  outline: none;
}

/* Amber like an alerted call in the auction. */
.alert-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  font-size: 0.9rem;
}

.alert-toggle.on {
  border-color: #e0a800;
  background: #ffd54f;
}

.alert-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #e0a800;
  color: #1a1a1a;
  font-size: 0.7rem;
  font-weight: 800;
}

.alert-hint {
  margin: 4px 0 0;
  font-size: 0.75rem;
  color: var(--ion-color-medium);
}

.sending {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 8px 0 0;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}
</style>
