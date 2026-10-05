<template>
  <!-- Who is away mid-set (bridge_backend docs/API.md, Away mid-set). Only
       the away player the board waits for (on turn) has a clock, the seat's
       forfeit_at, which this redraws every second: that line comes first,
       highlighted. Any other away seat gets one plain line, or one line
       together, until the turn reaches it. With `held`, the viewer's own
       held seat instead, seen away from the table. -->
  <div v-if="lines.length > 0" class="away-notice" role="status" aria-live="polite">
    <p
      v-for="line in lines"
      :key="line.key"
      class="away-line"
      :class="{ 'away-clock': line.clock, 'away-urgent': line.urgent }"
    >
      {{ line.text }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNow } from '@/composables/useNow';
import type { BroadcastTable } from '@/services/tables';
import {
  awaySeats,
  awayText,
  awayTogetherText,
  forfeitSuspended,
  heldText,
  myAwaySeat,
  secondsLeft,
} from '@/utils/away';

const props = withDefaults(
  defineProps<{
    table: BroadcastTable | null;
    me: number | null;
    // Show the viewer's own held seat, not the others' away seats.
    held?: boolean;
  }>(),
  { held: false },
);

const seats = computed(() => {
  const table = props.table;
  if (!table) {
    return [];
  }
  if (props.held) {
    const mine = myAwaySeat(table, props.me);
    return mine ? [mine] : [];
  }
  return awaySeats(table, props.me);
});

const waits = computed(() => !!props.table && forfeitSuspended(props.table));

// The backend runs one clock at a time; should two ever show, the nearest
// deadline comes first.
const clocked = computed(() =>
  seats.value
    .filter((s) => !!s.forfeit_at)
    .sort((a, b) => Date.parse(a.forfeit_at as string) - Date.parse(b.forfeit_at as string)),
);
const waiting = computed(() => seats.value.filter((s) => !s.forfeit_at));

const now = useNow(() => clocked.value.length > 0);

interface Line {
  key: string;
  text: string;
  clock: boolean;
  urgent: boolean;
}

// The last minute is urgent.
const lines = computed<Line[]>(() => {
  const tell = props.held ? heldText : awayText;
  const out: Line[] = clocked.value.map((seat) => ({
    key: seat.seat,
    text: tell(seat, now.value, waits.value),
    clock: true,
    urgent: secondsLeft(seat.forfeit_at as string, now.value) <= 60,
  }));
  if (waiting.value.length === 1) {
    const seat = waiting.value[0];
    out.push({ key: seat.seat, text: tell(seat, now.value, waits.value), clock: false, urgent: false });
  } else if (waiting.value.length > 1) {
    out.push({
      key: waiting.value.map((s) => s.seat).join(''),
      text: awayTogetherText(waiting.value, waits.value),
      clock: false,
      urgent: false,
    });
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
  font-variant-numeric: tabular-nums;
}

.away-line + .away-line {
  margin-top: 4px;
}

.away-clock {
  font-weight: 600;
}

.away-urgent {
  font-weight: 600;
  color: var(--ion-color-danger, #c5000f);
}
</style>
