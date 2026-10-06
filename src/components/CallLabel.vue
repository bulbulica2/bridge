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
  color: var(--bridge-red-suit, #c8102e);
}

.pass {
  color: var(--bridge-pass-text, #1d6b31);
}

.double {
  color: var(--bridge-double-text, #b3261e);
}

.redouble {
  color: var(--bridge-redouble-text, #1e4fc2);
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
  background: var(--call-chip-bg, var(--bridge-chip, #eef1f5));
  color: var(--call-chip-ink, var(--bridge-ink, #142033));
  font-size: 1rem;
  line-height: 1;
}

.chip.red {
  color: var(--call-chip-red, var(--bridge-red-suit, #c8102e));
}

.chip.pass {
  background: var(--bridge-pass-bg, #e3f1e6);
  color: var(--bridge-pass-text, #1d6b31);
}

.chip.double {
  background: var(--bridge-double-bg, #fde6e4);
  color: var(--bridge-double-text, #b3261e);
}

.chip.redouble {
  background: var(--bridge-redouble-bg, #e1ebfd);
  color: var(--bridge-redouble-text, #1e4fc2);
}
</style>
