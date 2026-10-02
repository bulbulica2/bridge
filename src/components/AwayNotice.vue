<template>
  <!-- Who is away mid-set, each with the time left before their side loses
       the set (bridge_backend docs/API.md, Away mid-set). The deadline is the
       seat's forfeit_at; the clock here only redraws it every second. With
       `held`, the viewer's own held seat instead, seen away from the table. -->
  <div v-if="lines.length > 0" class="away-notice" role="status" aria-live="polite">
    <p v-for="line in lines" :key="line.key" class="away-line" :class="{ 'away-urgent': line.urgent }">
      {{ line.text }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNow } from '@/composables/useNow';
import type { BroadcastTable } from '@/services/tables';
import { awaySeats, awayText, heldText, myAwaySeat, secondsLeft } from '@/utils/away';

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

const now = useNow(() => seats.value.length > 0);

// The last minute is urgent.
const lines = computed(() =>
  seats.value.map((seat) => ({
    key: seat.seat,
    text: props.held ? heldText(seat, now.value) : awayText(seat, now.value),
    urgent: !!seat.forfeit_at && secondsLeft(seat.forfeit_at, now.value) <= 60,
  })),
);
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

.away-urgent {
  font-weight: 600;
  color: var(--ion-color-danger, #c5000f);
}
</style>
