<template>
  <!-- A card face: rank over suit in the corner, the suit again in the middle. -->
  <div
    class="playing-card"
    :class="{ red: isRed(card.suit) }"
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

defineProps<{ card: Card }>();
</script>

<style scoped>
/* Sized so 13 overlapping cards fit a 360px phone (see HandView). */
.playing-card {
  position: relative;
  flex: none;
  width: 48px;
  height: 68px;
  border: 1px solid #b8b8b8;
  border-radius: 6px;
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
  top: 3px;
  left: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}

.rank {
  font-size: 0.9rem;
  letter-spacing: -0.05em;
}

.suit {
  font-size: 0.85rem;
}

.pip {
  position: absolute;
  right: 5px;
  bottom: 3px;
  font-size: 1.4rem;
  line-height: 1;
}
</style>
