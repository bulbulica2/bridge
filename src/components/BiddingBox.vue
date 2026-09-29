<template>
  <!-- The 35 bids, one row per level, clubs to no trump, then Pass, X and XX.
       A call the rules wouldn't allow is disabled (a hint: the backend has
       the final word), and everything is while a call is on its way. -->
  <section class="bidding-box" aria-label="Bidding box" :aria-busy="busy">
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
