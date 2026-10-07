<template>
  <!-- One call as players write it: 1♣ … 7NT with red hearts and diamonds,
       Pass, X or XX. As a `chip` (the auction, a seat's last call) it sits
       on Daylight's colours: grey for a bid, green Pass, red X, blue XX. -->
  <span
    class="call"
    :class="{
      chip,
      red: isRedStrain(bid.strain),
      pass: bid.call === PASS,
      double: bid.call === DOUBLE,
      redouble: bid.call === REDOUBLE,
    }"
    :aria-label="spoken"
  >
    <template v-if="isContractBid(bid)">
      {{ bid.level }}<span class="strain">{{ strainSymbol(bid.strain!) }}</span>
    </template>
    <template v-else>{{ callLabel(bid) }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Bid } from '@/services/game';
import {
  DOUBLE,
  PASS,
  REDOUBLE,
  callLabel,
  callName,
  isContractBid,
  isRedStrain,
  strainSymbol,
} from '@/utils/auction';

const props = withDefaults(defineProps<{ bid: Bid; chip?: boolean }>(), { chip: false });

const spoken = computed(() => callName(props.bid));
</script>

<style scoped>
.call {
  font-weight: 700;
  white-space: nowrap;
}

.red {
  color: var(--bridge-red-suit);
}

.pass {
  color: var(--bridge-pass-text);
}

.double {
  color: var(--bridge-double-text);
}

.redouble {
  color: var(--bridge-redouble-text);
}

/* A chip; whoever holds it may set its neutral colours (the navy table
   draws white chips). */
.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 40px;
  height: 30px;
  padding: 0 8px;
  border-radius: 8px;
  background: var(--call-chip-bg, var(--bridge-chip));
  color: var(--call-chip-ink, var(--bridge-ink));
  font-size: 1rem;
  line-height: 1;
}

.chip.red {
  color: var(--call-chip-red, var(--bridge-red-suit));
}

.chip.pass {
  background: var(--bridge-pass-bg);
  color: var(--bridge-pass-text);
}

.chip.double {
  background: var(--bridge-double-bg);
  color: var(--bridge-double-text);
}

.chip.redouble {
  background: var(--bridge-redouble-bg);
  color: var(--bridge-redouble-text);
}
</style>
