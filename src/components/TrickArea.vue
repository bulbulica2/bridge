<template>
  <!-- The trick in the middle of the table: each card in front of the hand it
       came from, rotated like the table (the viewer's card at the bottom).
       A finished trick rings its winning card. `spread` (the Last trick
       pop-up) parts the cards and names each seat. -->
  <div class="trick" :class="{ spread }" role="group" :aria-label="label">
    <div
      v-for="side in SIDES"
      :key="side"
      class="slot"
      :class="[`slot-${side}`, { won: winner !== null && seatOn[side] === winner }]"
      :data-side="side"
      :data-seat="seatOn[side]"
    >
      <PlayingCard v-if="bySide[side]" :card="bySide[side]!" />
      <span v-if="spread" class="seat-tag" aria-hidden="true">
        {{ seatOn[side] === mySeat ? 'You' : seatOn[side] }}
      </span>
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
    // Room between the cards, for a pop-up that isn't held to the table's
    // centre cell.
    spread?: boolean;
  }>(),
  { winner: null, spread: false },
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
   ones a little so the whole trick fits the table's centre cell. A spread
   trick (below) drops the overlap. */
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

/* The winner keeps its place in that stacking: lifting it would lay its
   ring over a neighbour's index. Its ring goes under the cards above it. */
.slot.won :deep(.playing-card) {
  box-shadow: 0 0 0 3px var(--ion-color-success, #2dd36f);
}

/* Spread: no overlap at all. The side cards sit halfway down, level with
   the gap between top and bottom, and a 10px gap all round leaves the
   winner's ring room. Each seat's tag sits on the outer side of its card. */
.trick.spread {
  width: 192px;
  height: 178px;
}

.spread .slot-top {
  top: 16px;
  left: 72px;
}

.spread .slot-bottom {
  bottom: 16px;
  left: 72px;
}

.spread .slot-left {
  top: 55px;
  left: 14px;
}

.spread .slot-right {
  top: 55px;
  right: 14px;
}

.seat-tag {
  position: absolute;
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  color: var(--ion-color-medium);
}

.slot.won .seat-tag {
  color: var(--ion-color-success, #2dd36f);
}

.slot-top .seat-tag,
.slot-bottom .seat-tag {
  left: 50%;
  transform: translateX(-50%);
}

.slot-top .seat-tag {
  bottom: calc(100% + 4px);
}

.slot-bottom .seat-tag {
  top: calc(100% + 4px);
}

.slot-left .seat-tag,
.slot-right .seat-tag {
  top: 50%;
  transform: translateY(-50%);
}

.slot-left .seat-tag {
  right: calc(100% + 4px);
}

.slot-right .seat-tag {
  left: calc(100% + 4px);
}
</style>
