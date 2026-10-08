<template>
  <!-- The trick in the middle of the table: each card in front of the hand it
       came from, rotated like the table (the viewer's card at the bottom),
       stacked in the order of play: the lead at the bottom, the last card
       on top (#201). A finished trick rings its winning card in amber;
       given the contract's `trump`, a trick in progress rings the card
       winning it so far, and `mySlot` draws a dashed place for the
       viewer's card until it comes, under every card. `spread` (the Last
       trick pop-up) parts the cards and names each seat. The cards are the
       card size setting's (cardSize.ts), as large as the table's centre
       allows. -->
  <div
    class="trick"
    :class="{ spread }"
    :style="{ '--card-w': cardWidthCss, '--trick-w': TRICK_WIDTH, '--trick-h': TRICK_HEIGHT }"
    role="group"
    :aria-label="label"
  >
    <div
      v-for="side in SIDES"
      :key="side"
      class="slot"
      :class="[`slot-${side}`, { won: ringedSide === side }]"
      :style="slotStyle(side, stack(side))"
      :data-side="side"
      :data-seat="seatOn[side]"
      :data-order="order[side] ?? undefined"
    >
      <PlayingCard v-if="bySide[side]" :card="bySide[side]!" />
      <span v-else-if="mySlot && side === 'bottom'" class="my-slot" aria-hidden="true" />
      <span v-if="spread" class="seat-tag" aria-hidden="true">
        {{ seatOn[side] === mySeat ? 'You' : seatOn[side] }}
      </span>
    </div>
    <!-- The winner's ring lies over every card, so a later card never
         hides it, while the winning card keeps its place in the stack. -->
    <span
      v-if="ringedSide"
      class="win-ring"
      :class="`slot-${ringedSide}`"
      :style="slotStyle(ringedSide, RING_LAYER)"
      :data-side="ringedSide"
      aria-hidden="true"
    />
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
import { trickBySide, trickOrder, winningSoFar } from '@/utils/play';
import { TRICK_HEIGHT, TRICK_SLOTS, TRICK_WIDTH } from '@/utils/trickLayout';

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

// Above the four cards (layers 1 to 4).
const RING_LAYER = 5;

const bySide = computed(() => trickBySide(props.cards, props.mySeat));

const order = computed(() => trickOrder(props.cards, props.mySeat));

// A card's layer is its place in the order of play, the lead lowest; an
// empty slot (the dashed `.my-slot`) lies under them all.
function stack(side: ScreenSide): number {
  const index = order.value[side];
  return index === null ? 0 : index + 1;
}

function slotStyle(side: ScreenSide, layer: number) {
  return { '--x': TRICK_SLOTS[side].x, '--y': TRICK_SLOTS[side].y, zIndex: layer };
}

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

const ringedSide = computed(
  () => SIDES.find((side) => ringed.value !== null && seatOn.value[side] === ringed.value) ?? null,
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
/* Four card slots in a pinwheel, all measured in cards (`--card-w`, and
   `--card-h` = 17/12 of it): the box is TRICK_WIDTH cards wide and
   TRICK_HEIGHT tall, each slot at TRICK_SLOTS' place (trickLayout.ts,
   bound inline as `--x`/`--y`), so the cards barely overlap and never on
   an index. Each slot's z-index is its card's place in the order of play.
   In the table's centre (a size container, see BridgeTable) the cards
   shrink to fit its width. The box is the same size from the first card
   to the fourth (#133). A spread trick (below) drops the overlap. */
.trick {
  --card-max: calc(100cqi / var(--trick-w));
  --card-h: calc(var(--card-w) * 17 / 12);
  position: relative;
  width: calc(var(--card-w) * var(--trick-w));
  height: calc(var(--card-h) * var(--trick-h));
  margin: 0 auto;
}

.slot,
.win-ring {
  position: absolute;
  top: calc(var(--card-h) * var(--y));
  left: calc(var(--card-w) * var(--x));
  width: var(--card-w);
  height: var(--card-h);
}

/* The winner's ring, drawn over every card just outside the winning one's
   edge: the card itself keeps its place in the stack. */
.win-ring {
  box-sizing: border-box;
  margin: -3px;
  width: calc(var(--card-w) + 6px);
  height: calc(var(--card-h) + 6px);
  border: 3px solid var(--bridge-amber);
  border-radius: calc(var(--card-w) * 0.12 + 3px);
  pointer-events: none;
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
  top: calc(var(--card-h) + 26px);
  left: calc(var(--card-w) + 24px);
}

.spread .slot-left {
  top: calc(var(--card-h) / 2 + 21px);
  left: 14px;
}

.spread .slot-right {
  top: calc(var(--card-h) / 2 + 21px);
  left: calc(var(--card-w) * 2 + 34px);
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
