<template>
  <!-- A card face: rank over suit in the corner, the suit again in the middle. -->
  <div
    class="playing-card"
    :class="{ red: isRed(card.suit) }"
    :style="{ '--card-w': cardWidthCss }"
    role="img"
    :aria-label="`${card.rank_name} of ${SUIT_NAMES[card.suit]}`"
  >
    <span class="corner">
      <span class="rank">{{ rankLabel(card.rank) }}</span>
      <span class="suit">{{ SUIT_SYMBOLS[card.suit] }}</span>
    </span>
    <span class="pip" aria-hidden="true">{{ SUIT_SYMBOLS[card.suit] }}</span>
  </div>
</template>

<script setup lang="ts">
import type { Card } from '@/services/game';
import { SUIT_NAMES, SUIT_SYMBOLS, isRed, rankLabel } from '@/utils/cards';
import { cardWidthCss } from '@/utils/cardSize';

defineProps<{ card: Card }>();
</script>

<style scoped>
/* Everything scales with `--card-w`, the card size setting's width (see
   cardSize.ts): 48 px is the old card, rank 0.9rem and pip 1.4rem. */
.playing-card {
  --card-h: calc(var(--card-w) * 17 / 12);
  position: relative;
  flex: none;
  box-sizing: border-box;
  width: var(--card-w);
  height: var(--card-h);
  border: 1px solid #9e9e9e;
  border-radius: calc(var(--card-w) * 0.12);
  background: #fff;
  color: #1a1a1a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  font-weight: 700;
  user-select: none;
}

.playing-card.red {
  color: #c62828;
}

.corner {
  position: absolute;
  top: calc(var(--card-w) * 0.06);
  left: calc(var(--card-w) * 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}

.rank {
  font-size: calc(var(--card-w) * 0.3);
  letter-spacing: -0.05em;
}

.suit {
  font-size: calc(var(--card-w) * 0.28);
}

.pip {
  position: absolute;
  right: calc(var(--card-w) * 0.1);
  bottom: calc(var(--card-w) * 0.06);
  font-size: calc(var(--card-w) * 0.47);
  line-height: 1;
}
</style>
