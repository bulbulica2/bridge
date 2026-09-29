<template>
  <!-- Dummy's cards as a bridge diagram lays them out: one column per suit,
       ♠ ♥ ♦ ♣, high to low down each column. Narrow enough for a side seat,
       where the viewer is a defender and only looks at them. -->
  <div class="dummy-columns" aria-label="Dummy's hand">
    <div v-for="suit in SUITS" :key="suit" class="column" :class="{ red: isRed(suit) }">
      <span class="suit" :aria-label="SUIT_NAMES[suit]">{{ SUIT_SYMBOLS[suit] }}</span>
      <span v-for="card in bySuit[suit]" :key="card.id" class="rank">{{ rankLabel(card.rank) }}</span>
      <span v-if="bySuit[suit].length === 0" class="void" aria-label="none">–</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Card, Suit } from '@/services/game';
import { SUITS, SUIT_NAMES, SUIT_SYMBOLS, isRed, rankLabel, sortHand } from '@/utils/cards';

const props = defineProps<{ cards: Card[] }>();

const bySuit = computed(() => {
  const sorted = sortHand(props.cards);
  return Object.fromEntries(
    SUITS.map((suit) => [suit, sorted.filter((card) => card.suit === suit)]),
  ) as Record<Suit, Card[]>;
});
</script>

<style scoped>
.dummy-columns {
  display: flex;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  border-radius: 6px;
  background: #fff;
  color: #1a1a1a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  font-weight: 700;
  line-height: 1.15;
}

.column {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 18px;
}

.column.red {
  color: #c62828;
}

.suit {
  font-size: 0.9rem;
}

.rank {
  font-size: 0.85rem;
  letter-spacing: -0.05em;
}

.void {
  color: #9e9e9e;
}
</style>
