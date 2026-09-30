<template>
  <!-- The viewer is always at the bottom, partner opposite, the opponents on
       the left and right (see screenSide). Once a board is dealt each seat is
       striped red when its side is vulnerable and green when it is not.
       Once dummy is face up its cards lie at its seat: across the top when
       the viewer is declarer (who plays them from there), in suit columns on
       a side seat for a defender, and not at all when the viewer is dummy,
       whose own hand below is the same cards. While a claim is pending, the
       claimer's cards lie face up at their seat (the viewer's own are below
       the table already). Once the board is over, the whole deal lies face
       up, each hand at its seat. -->
  <div class="bridge-table">
    <div
      v-for="side in SIDES"
      :key="side"
      class="seat"
      :class="[
        `side-${side}`,
        board ? (isVulnerable(seatOn[side], board.vulnerable) ? 'vul' : 'not-vul') : null,
        {
          'seat-turn': turn === seatOn[side],
          'seat-mine': side === 'bottom' && mySeat,
          'seat-wide': side === 'top' && dummySide === 'top',
        },
      ]"
      :data-seat="seatOn[side]"
    >
      <span class="seat-head">
        <span class="seat-name">{{ seatOn[side] }}</span>
        <span v-if="board?.dealer === seatOn[side]" class="dealer" title="Dealer">D</span>
      </span>

      <button
        v-if="players[seatOn[side]]"
        type="button"
        class="seat-user"
        :aria-label="`${players[seatOn[side]]!.username}'s profile`"
        @click="emit('select', players[seatOn[side]]!)"
      >
        {{ players[seatOn[side]]!.username }}
      </button>
      <span v-else class="seat-empty">Empty</span>

      <span v-if="side === 'bottom' && mySeat" class="seat-you">you</span>
      <span v-if="dummy && dummy.seat === seatOn[side] && side !== 'bottom'" class="seat-dummy">
        dummy
      </span>
      <span v-if="turn === seatOn[side]" class="turn">
        <span class="turn-dot" aria-hidden="true" />{{ turnLabel(side) }}
      </span>

      <template v-if="dummySide === side">
        <HandView
          v-if="side === 'top'"
          class="dummy-hand"
          :cards="dummy!.cards"
          label="Dummy's hand"
          :playable="dummyPlayable"
          :busy="busy"
          :sending-id="sendingId"
          @play="emit('play', $event)"
        />
        <DummyColumns v-else :cards="dummy!.cards" />
      </template>
      <DummyColumns
        v-else-if="claimSide === side"
        class="claim-hand"
        :cards="claim!.cards"
        :label="`${SEAT_NAMES[seatOn[side]]}'s hand, claiming`"
      />
      <DummyColumns
        v-else-if="deal"
        class="dealt-hand"
        :cards="deal[seatOn[side]]"
        :label="`${SEAT_NAMES[seatOn[side]]}'s ${replay ? 'cards left' : 'hand as dealt'}`"
      />
    </div>

    <div class="centre" :class="{ 'centre-slot': $slots.centre }">
      <slot v-if="$slots.centre" name="centre" />
      <template v-else-if="board">
        <p class="board-number">Board {{ board.number }}</p>
        <p class="board-line">Dealer {{ board.dealer }}</p>
        <p class="board-line">Vul {{ vulnerabilityLabel(board.vulnerable) }}</p>
      </template>
      <slot v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import DummyColumns from '@/components/DummyColumns.vue';
import HandView from '@/components/HandView.vue';
import type { Board, Card } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES } from '@/utils/auction';
import { isVulnerable, seatAt, vulnerabilityLabel } from '@/utils/cards';
import type { ScreenSide } from '@/utils/cards';

const props = withDefaults(
  defineProps<{
    players: Partial<Record<Seat, PublicUser | null>>;
    // Null for someone watching without a seat: then North is at the top.
    mySeat: Seat | null;
    board: Board | null;
    turn: Seat | null;
    // Whether the viewer acts for `turn` (declarer does on dummy's turn).
    // Left out, the bottom seat's turn is taken to be the viewer's.
    myTurn?: boolean | null;
    // Dummy's seat and remaining cards, once they are face up.
    dummy?: { seat: Seat; cards: Card[] } | null;
    // Dummy's cards declarer may play now (see HandView), else null.
    dummyPlayable?: number[] | null;
    // The claimer's seat and remaining cards while a claim is pending.
    claim?: { seat: Seat; cards: Card[] } | null;
    // All four hands as dealt, once the board is finished.
    deal?: Record<Seat, Card[]> | null;
    // `deal` is what is left of each hand at a step of a board's replay.
    replay?: boolean;
    busy?: boolean;
    sendingId?: number | null;
  }>(),
  {
    myTurn: null,
    dummy: null,
    dummyPlayable: null,
    claim: null,
    deal: null,
    replay: false,
    busy: false,
    sendingId: null,
  },
);

const emit = defineEmits<{ select: [user: PublicUser]; play: [card: Card] }>();

const SIDES: ScreenSide[] = ['top', 'left', 'right', 'bottom'];

const seatOn = computed(
  () =>
    Object.fromEntries(SIDES.map((side) => [side, seatAt(side, props.mySeat)])) as Record<
      ScreenSide,
      Seat
    >,
);

// Where dummy's cards are drawn: nowhere for dummy themselves (their own hand
// is below the table).
const dummySide = computed<ScreenSide | null>(() => {
  const dummy = props.dummy;
  if (!dummy) {
    return null;
  }
  const side = SIDES.find((s) => seatOn.value[s] === dummy.seat);
  return side && side !== 'bottom' ? side : null;
});

// Where the claimer's cards are drawn: nowhere when the claimer is the
// viewer, whose own hand is below the table.
const claimSide = computed<ScreenSide | null>(() => {
  const claim = props.claim;
  const side = claim ? SIDES.find((s) => seatOn.value[s] === claim.seat) : undefined;
  return side && side !== 'bottom' ? side : null;
});

function turnLabel(side: ScreenSide): string {
  const mine = props.myTurn ?? side === 'bottom';
  return mine ? 'Your turn' : 'To act';
}
</script>

<style scoped>
.bridge-table {
  display: grid;
  grid-template-columns: 1fr 1.1fr 1fr;
  gap: 8px;
}

.side-top {
  grid-column: 2;
  grid-row: 1;
}

.side-left {
  grid-column: 1;
  grid-row: 2;
}

.centre {
  grid-column: 2;
  grid-row: 2;
}

.side-right {
  grid-column: 3;
  grid-row: 2;
}

.side-bottom {
  grid-column: 2;
  grid-row: 3;
}

/* Dummy across the top, for declarer: the whole width, like their own hand. */
.side-top.seat-wide {
  grid-column: 1 / 4;
}

.dummy-hand,
.claim-hand,
.dealt-hand {
  margin-top: 4px;
}

.seat,
.centre {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 88px;
  padding: 8px 6px;
  text-align: center;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 8px;
}

/* The usual convention: red for vulnerable, green for not. */
.seat.vul {
  border-top: 5px solid #d32f2f;
}

.seat.not-vul {
  border-top: 5px solid #2e7d32;
}

.seat-mine {
  background: rgba(var(--ion-color-primary-rgb, 56, 128, 255), 0.06);
}

.seat-turn {
  box-shadow: 0 0 0 2px var(--ion-color-warning, #ffc409);
}

.seat-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.seat-name {
  font-weight: 700;
  color: var(--ion-color-medium);
}

.dealer {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--ion-color-dark, #222);
  color: var(--ion-color-dark-contrast, #fff);
  font-size: 0.7rem;
  font-weight: 700;
}

.seat-user {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.9rem;
  color: var(--ion-color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.seat-empty {
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

.seat-dummy {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--ion-color-medium);
}

.seat-you {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--ion-color-primary);
}

.turn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ion-color-warning-shade, #e0ac08);
}

.turn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}

.centre {
  background: var(--ion-color-light, #f4f5f8);
}

.centre.centre-slot {
  padding: 6px 4px;
}

.centre p {
  margin: 0;
}

.board-number {
  font-weight: 700;
}

.board-line {
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}
</style>
