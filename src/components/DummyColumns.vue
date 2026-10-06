<template>
  <!-- A hand as a bridge diagram lays it out: one column per suit, in
       `order` (♠ ♥ ♦ ♣ by default; trumps first for dummy, see suitOrder),
       high to low down each column. Narrow enough for a side seat: dummy's
       cards for a defender, and every hand of a finished deal. Given `rows`,
       each column keeps room for that many cards, so the hand stays as tall
       as cards go (a replay keeps the height the hand had as dealt). The
       text follows the card size setting (cardSize.ts). -->
  <div class="dummy-columns" :style="{ '--hand-text': cardTextSize }" :aria-label="label">
    <div v-for="suit in order" :key="suit" class="column" :class="{ red: isRed(suit) }">
      <span class="suit" :aria-label="SUIT_NAMES[suit]">{{ SUIT_SYMBOLS[suit] }}</span>
      <span v-for="card in bySuit[suit]" :key="card.id" class="rank">{{ rankLabel(card.rank) }}</span>
      <span v-if="bySuit[suit].length === 0" class="void" aria-label="none">–</span>
      <span
        v-for="n in fillers[suit]"
        :key="`filler-${n}`"
        class="rank filler"
        aria-hidden="true"
      >&nbsp;</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Card, Suit } from '@/services/game';
import { SUITS, SUIT_NAMES, SUIT_SYMBOLS, isRed, rankLabel, sortHand } from '@/utils/cards';
import { cardTextSize } from '@/utils/cardSize';

const props = withDefaults(
  defineProps<{ cards: Card[]; label?: string; rows?: number; order?: readonly Suit[] }>(),
  { label: "Dummy's hand", rows: 0, order: () => SUITS },
);

const bySuit = computed(() => {
  const sorted = sortHand(props.cards, props.order);
  return Object.fromEntries(
    props.order.map((suit) => [suit, sorted.filter((card) => card.suit === suit)]),
  ) as Record<Suit, Card[]>;
});

// Blank lines under each column up to `rows` (a void's dash takes a line).
const fillers = computed(
  () =>
    Object.fromEntries(
      props.order.map((suit) => [suit, Math.max(0, props.rows - Math.max(1, bySuit.value[suit].length))]),
    ) as Record<Suit, number>,
);
</script>

<style scoped>
/* Sized in the rank's text (`--hand-text`, 1.15rem when Large): a column a
   little wider than "10", the suit symbol a little larger than the ranks. */
.dummy-columns {
  display: flex;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--bridge-card-border, #d5d9e0);
  border-radius: 8px;
  background: var(--bridge-card-face, #fff);
  color: var(--bridge-card-ink, #142033);
  box-shadow: 0 1px 2px rgba(20, 32, 51, 0.3);
  font-family: var(--bridge-font-numbers, sans-serif);
  font-size: var(--hand-text);
  font-weight: 700;
  line-height: 1.15;
}

.column {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 1.3em;
}

.column.red {
  color: var(--bridge-card-red, #c8102e);
}

.suit {
  font-size: 1.15em;
}

.rank {
  letter-spacing: -0.05em;
}

/* A rank's line height, so a suit going void doesn't change the hand's. */
.void {
  color: #4b5668;
}

/* Three hands side by side on a 360px phone (a finished deal): no larger
   than this, and packed a little closer. */
@media (max-width: 575px) {
  .dummy-columns {
    gap: 1px;
    padding: 3px;
    font-size: min(var(--hand-text), 1.1rem);
  }

  .column {
    min-width: 1.2em;
  }
}
</style>
