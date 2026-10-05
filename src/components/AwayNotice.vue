<template>
  <!-- Who is away mid-set (bridge_backend docs/API.md, Away mid-set). No
       countdown here: a seat has no clock of its own, and the one clock
       that runs, the player on turn's, is the play page's status line
       (turn_deadline, bb#120). Each away admin gets a line of their own
       (the table waits for them), the others one line, or one together.
       With `held`, the viewer's own held seat instead, seen away from the
       table. -->
  <div v-if="lines.length > 0" class="away-notice" role="status" aria-live="polite">
    <p v-for="line in lines" :key="line.key" class="away-line">
      {{ line.text }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BroadcastTable } from '@/services/tables';
import { awaySeats, awayText, awayTogetherText, heldText, myAwaySeat } from '@/utils/away';

const props = withDefaults(
  defineProps<{
    table: BroadcastTable | null;
    me: number | null;
    // Show the viewer's own held seat, not the others' away seats.
    held?: boolean;
  }>(),
  { held: false },
);

interface Line {
  key: string;
  text: string;
}

const lines = computed<Line[]>(() => {
  const table = props.table;
  if (!table) {
    return [];
  }
  if (props.held) {
    const mine = myAwaySeat(table, props.me);
    return mine ? [{ key: mine.seat, text: heldText(mine) }] : [];
  }
  const seats = awaySeats(table, props.me);
  const out: Line[] = seats
    .filter((s) => s.user.is_admin)
    .map((seat) => ({ key: seat.seat, text: awayText(seat) }));
  const others = seats.filter((s) => !s.user.is_admin);
  if (others.length === 1) {
    out.push({ key: others[0].seat, text: awayText(others[0]) });
  } else if (others.length > 1) {
    out.push({ key: others.map((s) => s.seat).join(''), text: awayTogetherText(others) });
  }
  return out;
});
</script>

<style scoped>
.away-notice {
  margin: 8px 0;
  padding: 8px 12px;
  border-radius: 8px;
  border-left: 4px solid var(--ion-color-warning, #ffc409);
  background: rgba(var(--ion-color-warning-rgb, 255, 196, 9), 0.12);
}

.away-line {
  margin: 0;
  font-size: 0.9rem;
}

.away-line + .away-line {
  margin-top: 4px;
}
</style>
