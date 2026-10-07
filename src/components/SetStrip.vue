<template>
  <!-- A set's boards in a row, B1–B4: the viewer's side's matchpoints on each
       board finished ("62 %", "—" while no other table has played it), the
       board on now tinted ("now" until it is finished), "·" for the rest.
       Light under a board's result, `onTable` on a navy card (Your table). -->
  <ol class="set-strip" :class="{ 'on-table': onTable }" :aria-label="`Set ${number} so far`">
    <li
      v-for="tile in tiles"
      :key="tile.position"
      class="strip-tile"
      :class="{ 'strip-current': tile.current, 'strip-played': tile.played }"
      :aria-current="tile.current ? 'step' : undefined"
    >
      <span class="strip-label">{{ onTable ? tile.label : `Board ${tile.position}` }}</span>
      <b class="strip-value bridge-number">{{ valueOf(tile) }}</b>
    </li>
  </ol>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SetBoardRow } from '@/services/history';
import { NO_FIGURE } from '@/utils/stats';
import { percentText } from '@/utils/result';
import type { Side } from '@/utils/result';
import { setStripTiles } from '@/utils/sets';
import type { SetStripTile } from '@/utils/sets';

const props = withDefaults(
  defineProps<{
    // The set's number at the table and how many boards it has.
    number: number;
    of: number;
    // The board on now (its place in the set), if any.
    current?: number | null;
    // Its finished boards, once its results are read (GET /sets/{id}).
    boards?: Pick<SetBoardRow, 'position' | 'matchpoints' | 'top'>[];
    // Whose matchpoints: the viewer's side (N-S for someone without a seat).
    side?: Side;
    onTable?: boolean;
  }>(),
  { current: null, boards: () => [], side: 'ns', onTable: false },
);

const tiles = computed(() => setStripTiles(props.of, props.current, props.boards, props.side));

function valueOf(tile: SetStripTile): string {
  if (tile.played) {
    return tile.percent === null ? NO_FIGURE : percentText(tile.percent);
  }
  if (tile.current) {
    return 'now';
  }
  return props.onTable ? '' : '·';
}
</script>

<style scoped>
.set-strip {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.strip-tile {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 8px 0;
  border-radius: 10px;
  background: var(--bridge-surface);
  font-size: 0.75rem;
  color: var(--bridge-muted);
}

.strip-value {
  font-size: 1.125rem;
  line-height: 1;
  color: var(--bridge-ink);
}

.strip-current {
  background: var(--bridge-action-tint);
  box-shadow: inset 0 0 0 1.5px var(--bridge-action-line);
}

/* On the navy card: smaller tiles, the boards to come dimmed, the board on
   now amber. */
.on-table .strip-tile {
  flex: none;
  justify-content: center;
  gap: 2px;
  width: 54px;
  height: 44px;
  padding: 0;
  background: var(--bridge-table-dim);
  font-size: 0.6875rem;
  color: var(--bridge-on-table-faint);
}

.on-table .strip-played {
  background: var(--bridge-table-inner);
  color: var(--bridge-on-table-muted);
}

.on-table .strip-value {
  font-size: 1rem;
  color: var(--bridge-on-table);
}

.on-table .strip-current {
  background: var(--bridge-amber);
  box-shadow: none;
  color: var(--bridge-on-amber);
}

.on-table .strip-current .strip-value {
  color: var(--bridge-on-amber);
}
</style>
