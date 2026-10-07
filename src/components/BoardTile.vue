<template>
  <!-- The board as BBO draws it (Daylight, #160): the number in a navy
       square, the four sides round it (N on top, as the cards lie on the
       table's paper, not rotated for the viewer), a vulnerable side's red,
       and the dealer under the number. -->
  <div class="board-tile" role="img" :aria-label="label">
    <span class="tile-side tile-n" :class="{ vul: vul('N') }">N</span>
    <span class="tile-side tile-w" :class="{ vul: vul('W') }">W</span>
    <span class="tile-centre">
      <span class="tile-number">{{ board.number }}</span>
      <span class="tile-dealer">DEALER {{ board.dealer }}</span>
    </span>
    <span class="tile-side tile-e" :class="{ vul: vul('E') }">E</span>
    <span class="tile-side tile-s" :class="{ vul: vul('S') }">S</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Board } from '@/services/game';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { isVulnerable, vulnerabilityLabel } from '@/utils/cards';

const props = defineProps<{ board: Pick<Board, 'number' | 'dealer' | 'vulnerable'> }>();

function vul(seat: Seat): boolean {
  return isVulnerable(seat, props.board.vulnerable);
}

const label = computed(
  () =>
    `Board ${props.board.number}, dealer ${SEAT_NAMES[props.board.dealer]}, vulnerable: ${vulnerabilityLabel(props.board.vulnerable)}`,
);
</script>

<style scoped>
.board-tile {
  display: grid;
  flex: none;
  grid-template-columns: 18px 1fr 18px;
  grid-template-rows: 18px 1fr 18px;
  width: 92px;
  height: 92px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--bridge-chip);
}

.tile-side {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bridge-line);
  color: var(--bridge-ink);
  font-size: 0.7rem;
  font-weight: 700;
}

.tile-side.vul {
  background: var(--bridge-vul-seat);
  color: var(--bridge-on-vul-seat);
}

.tile-n {
  grid-column: 2;
  grid-row: 1;
}

.tile-w {
  grid-column: 1;
  grid-row: 2;
}

.tile-e {
  grid-column: 3;
  grid-row: 2;
}

.tile-s {
  grid-column: 2;
  grid-row: 3;
}

.tile-centre {
  display: flex;
  grid-column: 2;
  grid-row: 2;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bridge-table);
  color: var(--bridge-on-table);
  line-height: 1;
}

.tile-number {
  font-family: var(--bridge-font-numbers);
  font-size: 1.6rem;
  font-weight: 700;
}

.tile-dealer {
  margin-top: 2px;
  font-size: 0.55rem;
  font-weight: 700;
  color: var(--bridge-on-table-accent);
}
</style>
