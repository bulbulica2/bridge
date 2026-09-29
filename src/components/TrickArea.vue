<template>
  <!-- The trick in the middle of the table: each card in front of the hand it
       came from, rotated like the table (the viewer's card at the bottom).
       A finished trick rings its winning card. -->
  <div class="trick" role="group" :aria-label="label">
    <div
      v-for="side in SIDES"
      :key="side"
      class="slot"
      :class="[`slot-${side}`, { won: winner !== null && seatOn[side] === winner }]"
      :data-side="side"
      :data-seat="seatOn[side]"
    >
      <PlayingCard v-if="bySide[side]" :card="bySide[side]!" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import PlayingCard from '@/components/PlayingCard.vue';
import type { PlayedCard } from '@/services/game';
import type { Seat } from '@/services/tables';
import { SUIT_NAMES, rankLabel, seatAt } from '@/utils/cards';
import type { ScreenSide } from '@/utils/cards';
import { trickBySide } from '@/utils/play';

const props = withDefaults(
  defineProps<{
    cards: PlayedCard[];
    mySeat: Seat | null;
    // Set once the trick is complete.
    winner?: Seat | null;
  }>(),
  { winner: null },
);

const SIDES: ScreenSide[] = ['top', 'left', 'right', 'bottom'];

const bySide = computed(() => trickBySide(props.cards, props.mySeat));

const seatOn = computed(
  () =>
    Object.fromEntries(SIDES.map((side) => [side, seatAt(side, props.mySeat)])) as Record<
      ScreenSide,
      Seat
    >,
);

const label = computed(() => {
  if (props.cards.length === 0) {
    return 'Trick: no cards yet';
  }
  const played = props.cards
    .map(({ seat, card }) => `${seat} ${rankLabel(card.rank)} of ${SUIT_NAMES[card.suit]}`)
    .join(', ');
  return props.winner ? `Trick won by ${props.winner}: ${played}` : `Trick: ${played}`;
});
</script>

<style scoped>
/* Four card slots in a cross; the middle row overlaps the top and bottom
   ones a little so the whole trick fits the table's centre cell. */
.trick {
  position: relative;
  width: 124px;
  height: 150px;
  margin: 0 auto;
}

.slot {
  position: absolute;
  width: 48px;
  height: 68px;
}

.slot-top {
  top: 0;
  left: 38px;
}

.slot-bottom {
  bottom: 0;
  left: 38px;
}

.slot-left {
  top: 41px;
  left: 0;
}

.slot-right {
  top: 41px;
  right: 0;
}

/* Stacked so every overlap hides a card's bottom corner, never its index. */
.slot-left,
.slot-right {
  z-index: 1;
}

.slot-bottom {
  z-index: 2;
}

.slot.won {
  z-index: 3;
}

.slot.won :deep(.playing-card) {
  box-shadow: 0 0 0 3px var(--ion-color-success, #2dd36f);
}
</style>
