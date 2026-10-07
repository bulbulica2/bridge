<template>
  <!-- The trick in the middle of the table: each card in front of the hand it
       came from, rotated like the table (the viewer's card at the bottom).
       A finished trick rings its winning card in amber; given the
       contract's `trump`, a trick in progress rings the card winning it so
       far, and `mySlot` draws a dashed place for the viewer's card until it
       comes. `spread` (the Last trick pop-up) parts the cards and names
       each seat. The cards are the card
       size setting's (cardSize.ts), as large as the table's centre allows. -->
  <div
    class="trick"
    :class="{ spread }"
    :style="{ '--card-w': cardWidthCss }"
    role="group"
    :aria-label="label"
  >
    <div
      v-for="side in SIDES"
      :key="side"
      class="slot"
      :class="[`slot-${side}`, { won: ringed !== null && seatOn[side] === ringed }]"
      :data-side="side"
      :data-seat="seatOn[side]"
    >
      <PlayingCard v-if="bySide[side]" :card="bySide[side]!" />
      <span v-else-if="mySlot && side === 'bottom'" class="my-slot" aria-hidden="true" />
      <span v-if="spread" class="seat-tag" aria-hidden="true">
        {{ seatOn[side] === mySeat ? 'You' : seatOn[side] }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import PlayingCard from '@/components/PlayingCard.vue';
import type { PlayedCard, Strain } from '@/services/game';
import type { Seat } from '@/services/tables';
import { SUIT_NAMES, rankLabel, seatAt } from '@/utils/cards';
import { cardWidthCss } from '@/utils/cardSize';
import type { ScreenSide } from '@/utils/cards';
import { trickBySide, winningSoFar } from '@/utils/play';

const props = withDefaults(
  defineProps<{
    cards: PlayedCard[];
    mySeat: Seat | null;
    // Set once the trick is complete.
    winner?: Seat | null;
    // Room between the cards, for a pop-up that isn't held to the table's
    // centre cell.
    spread?: boolean;
    // The contract's strain: the card winning so far is ringed. Left out,
    // only a finished trick's winner is.
    trump?: Strain | null;
    // A dashed place for the viewer's card while it hasn't come.
    mySlot?: boolean;
  }>(),
  { winner: null, spread: false, trump: undefined, mySlot: false },
);

const SIDES: ScreenSide[] = ['top', 'left', 'right', 'bottom'];

const bySide = computed(() => trickBySide(props.cards, props.mySeat));

const ringed = computed(() => {
  if (props.winner !== null || props.trump === undefined) {
    return props.winner;
  }
  return winningSoFar(props.cards, props.trump);
});

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
/* Four card slots in a cross, all measured in cards (`--card-w`, and
   `--card-h` = 17/12 of it): two cards wide and two tall. The side cards
   lie over the top card's lower half and under the bottom card's upper
   half, so every overlap hides a corner without an index. In the table's centre
   (a size container, see BridgeTable) the cards shrink to fit its width.
   A spread trick (below) drops the overlap. */
.trick {
  --card-max: calc(100cqi / 2);
  --card-h: calc(var(--card-w) * 17 / 12);
  position: relative;
  width: calc(var(--card-w) * 2);
  height: calc(var(--card-h) * 2);
  margin: 0 auto;
}

.slot {
  position: absolute;
  width: var(--card-w);
  height: var(--card-h);
}

.slot-top {
  top: 0;
  left: calc(var(--card-w) / 2);
}

.slot-bottom {
  bottom: 0;
  left: calc(var(--card-w) / 2);
}

.slot-left {
  top: calc(var(--card-h) / 2);
  left: 0;
}

.slot-right {
  top: calc(var(--card-h) / 2);
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
  box-shadow:
    0 0 0 3px var(--bridge-amber),
    0 4px 10px var(--bridge-card-shadow);
}

/* Where the viewer's card goes: a dashed outline on the table. */
.my-slot {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 2px dashed var(--bridge-table-slot);
  border-radius: calc(var(--card-w) * 0.12);
}

/* Spread: no overlap at all. The side cards sit halfway down, level with
   the gap between top and bottom, and a 10px gap all round leaves the
   winner's ring room. Each seat's tag sits on the outer side of its card.
   A pop-up, so its cards fit the screen's width rather than the centre's. */
.trick.spread {
  --card-max: calc((100vw - 82px) / 3);
  width: calc(var(--card-w) * 3 + 48px);
  height: calc(var(--card-h) * 2 + 42px);
}

.spread .slot-top {
  top: 16px;
  left: calc(var(--card-w) + 24px);
}

.spread .slot-bottom {
  bottom: 16px;
  left: calc(var(--card-w) + 24px);
}

.spread .slot-left {
  top: calc(var(--card-h) / 2 + 21px);
  left: 14px;
}

.spread .slot-right {
  top: calc(var(--card-h) / 2 + 21px);
  right: 14px;
}

.seat-tag {
  position: absolute;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  color: var(--ion-color-medium);
}

.slot.won .seat-tag {
  color: var(--ion-color-warning-shade);
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
