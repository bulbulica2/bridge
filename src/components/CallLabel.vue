<template>
  <!-- One call as players write it: 1♣ … 7NT with red hearts and diamonds,
       Pass, X or XX. -->
  <span
    class="call"
    :class="{
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

const props = defineProps<{ bid: Bid }>();

const spoken = computed(() => callName(props.bid));
</script>

<style scoped>
.call {
  font-weight: 700;
  white-space: nowrap;
}

.red {
  color: var(--bridge-red-suit, #c62828);
}

.pass {
  color: var(--ion-color-success-shade, #2dd55b);
}

.double {
  color: var(--ion-color-danger, #c5000f);
}

.redouble {
  color: var(--ion-color-primary, #0054e9);
}
</style>
