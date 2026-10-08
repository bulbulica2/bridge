<template>
  <!-- A hand as a bridge diagram lays it out: one column per suit, in
       `order` (♠ ♥ ♦ ♣ by default; trumps first for dummy, see suitOrder),
       high to low down each column. Narrow enough for a side seat: dummy's
       cards for a defender, and every hand of a finished deal. Given `rows`,
       each column keeps room for that many cards, so the hand stays as tall
       as cards go (a replay keeps the height the hand had as dealt). The
       text follows the card size setting (cardSize.ts). Given `marks` (the
       opening leader's hand before the lead in a review, #212), each card
       carries a pill right after its rank with the tricks the defence makes
       double dummy if it is led: the best leads green, the lead made ringed
       amber. The hand is then drawn a step larger, so the pills fit. -->
  <div
    class="dummy-columns"
    :class="{ 'with-marks': marks }"
    :style="{ '--hand-text': cardTextSize }"
    :aria-label="label"
  >
    <div v-for="suit in order" :key="suit" class="column" :class="{ red: isRed(suit) }">
      <span class="suit" :aria-label="SUIT_NAMES[suit]">{{ SUIT_SYMBOLS[suit] }}</span>
      <template v-for="card in bySuit[suit]" :key="card.id">
        <span
          v-if="marks?.[card.id]"
          class="rank marked"
          :class="{ best: marks[card.id]!.best, led: marks[card.id]!.led }"
          :data-card="card.id"
          role="img"
          :aria-label="leadMarkLabel(card, marks[card.id]!)"
        >
          <span class="rank-text">{{ rankLabel(card.rank) }}</span>
          <span class="lead-pill">{{ marks[card.id]!.tricks }}</span>
        </span>
        <span v-else class="rank">{{ rankLabel(card.rank) }}</span>
      </template>
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
import { leadMarkLabel } from '@/utils/doubleDummy';
import type { LeadMark } from '@/utils/doubleDummy';

const props = withDefaults(
  defineProps<{
    cards: Card[];
    label?: string;
    rows?: number;
    order?: readonly Suit[];
    // Each card's opening-lead pill, by card id (see the comment above).
    marks?: Record<number, LeadMark> | null;
  }>(),
  { label: "Dummy's hand", rows: 0, order: () => SUITS, marks: null },
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
  border: 1px solid var(--bridge-card-border);
  border-radius: 8px;
  background: var(--bridge-card-face);
  color: var(--bridge-card-ink);
  box-shadow: 0 1px 2px var(--bridge-card-shadow);
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
  color: var(--bridge-card-red);
}

.suit {
  font-size: 1.15em;
}

.rank {
  letter-spacing: -0.05em;
}

/* The opening leader's hand with its pills (#212): a step larger, each
   rank in its usual column width and its pill right after it on the same
   line, no taller than the line, so the hand keeps its rows. The suit
   symbol stays over the ranks. */
.with-marks {
  font-size: calc(var(--hand-text) * 1.15);
}

.with-marks .column {
  align-items: flex-start;
}

.with-marks .suit,
.with-marks .void,
.with-marks .rank:not(.marked) {
  min-width: 1.3em;
  text-align: center;
}

.marked {
  display: flex;
  align-items: center;
  gap: 0.12em;
  border-radius: 0.4em;
}

.rank-text {
  min-width: 1.3em;
  text-align: center;
}

/* Small and rounded, in the table's figures: neutral, green for a best
   lead. On the hand's white face in both modes. */
.lead-pill {
  min-width: 1.1em;
  padding: 0 0.28em;
  border-radius: 999px;
  background: var(--bridge-card-border);
  color: var(--bridge-card-ink);
  font-size: 0.62em;
  line-height: 1.45;
  letter-spacing: 0;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.marked.best .lead-pill {
  background: var(--ion-color-success);
  color: var(--ion-color-success-contrast);
}

/* The lead made: ringed amber, rank and pill together. An outline takes no
   room. */
.marked.led {
  outline: 2px solid var(--bridge-amber);
  outline-offset: 0;
}

/* A rank's line height, so a suit going void doesn't change the hand's. */
.void {
  color: var(--bridge-card-muted);
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

  .with-marks {
    font-size: min(calc(var(--hand-text) * 1.15), 1.2rem);
  }
}
</style>
