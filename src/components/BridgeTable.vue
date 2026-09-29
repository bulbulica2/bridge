<template>
  <!-- The viewer is always at the bottom, partner opposite, the opponents on
       the left and right (see screenSide). Once a board is dealt each seat is
       striped red when its side is vulnerable and green when it is not. -->
  <div class="bridge-table">
    <div
      v-for="side in SIDES"
      :key="side"
      class="seat"
      :class="[
        `side-${side}`,
        board ? (isVulnerable(seatOn[side], board.vulnerable) ? 'vul' : 'not-vul') : null,
        { 'seat-turn': turn === seatOn[side], 'seat-mine': side === 'bottom' && mySeat },
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
      <span v-if="turn === seatOn[side]" class="turn">
        <span class="turn-dot" aria-hidden="true" />{{ side === 'bottom' ? 'Your turn' : 'To act' }}
      </span>
    </div>

    <div class="centre">
      <template v-if="board">
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
import type { Board } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { isVulnerable, seatAt, vulnerabilityLabel } from '@/utils/cards';
import type { ScreenSide } from '@/utils/cards';

const props = defineProps<{
  players: Partial<Record<Seat, PublicUser | null>>;
  // Null for someone watching without a seat: then North is at the top.
  mySeat: Seat | null;
  board: Board | null;
  turn: Seat | null;
}>();

const emit = defineEmits<{ select: [user: PublicUser] }>();

const SIDES: ScreenSide[] = ['top', 'left', 'right', 'bottom'];

const seatOn = computed(
  () =>
    Object.fromEntries(SIDES.map((side) => [side, seatAt(side, props.mySeat)])) as Record<
      ScreenSide,
      Seat
    >,
);
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
