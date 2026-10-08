<template>
  <!-- Before a board, in the middle of the game table (#181): every human
       presses Start, and the last one deals it (robots are always ready).
       The seats around it carry the ticks; this says what the board still
       waits for, offers Start (or Cancel once pressed) and, while the Start
       timer runs on a seat (bb#142), counts it down: "Press Start · 0:12"
       in orange for us, red in its last seconds, "Waiting for East · 0:12"
       for the others. Who is missing updates live from the table's seats. -->
  <section class="start-box" aria-label="Start">
    <p class="start-title">{{ iAmReady ? 'Waiting for the others…' : 'Ready to play?' }}</p>

    <p v-if="waiting" class="start-detail" aria-live="polite">{{ waiting }}</p>

    <p
      v-if="clock"
      class="start-clock"
      :class="{ 'start-clock-mine': clock.mine, 'start-clock-urgent': clock.urgent }"
      role="timer"
    >
      {{ startClockText(clock) }}
    </p>

    <ion-button
      v-if="!iAmReady"
      color="action"
      class="start-button"
      :disabled="busy"
      @click="emit('start')"
    >
      <ion-spinner v-if="busy" name="crescent" />
      <span v-else>Start</span>
    </ion-button>
    <ion-button
      v-else
      fill="outline"
      size="small"
      class="start-cancel"
      :disabled="busy"
      @click="emit('cancel')"
    >
      <ion-spinner v-if="busy" name="crescent" />
      <span v-else>Cancel</span>
    </ion-button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonButton, IonSpinner } from '@ionic/vue';
import { useNow } from '@/composables/useNow';
import type { BroadcastTable } from '@/services/tables';
import { startClock, startClockText, startWaiting } from '@/utils/start';

const props = withDefaults(
  defineProps<{
    table: BroadcastTable;
    me: number | null;
    // A Start or a Cancel on its way.
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{
  start: [];
  cancel: [];
}>();

const iAmReady = computed(
  () => props.table.seats.find((s) => s.user_id === props.me)?.ready ?? false,
);

const waiting = computed(() => startWaiting(props.table, props.me));

// Ticks only while a seat has a deadline.
const now = useNow(() => props.table.seats.some((s) => s.start_deadline));
const clock = computed(() => startClock(props.table, props.me, now.value));
</script>

<style scoped>
/* On the table's navy, in its centre: short lines, one orange Start. */
.start-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 320px;
  padding: 4px;
  color: var(--bridge-on-table);
  text-align: center;
}

.start-box p {
  margin: 0;
}

.start-title {
  font-size: 1rem;
  font-weight: 700;
}

.start-box .start-detail {
  font-size: 0.8125rem;
  line-height: 1.35;
  color: var(--bridge-on-table-muted);
}

/* The Start timer: Barlow figures, orange for us, red at the end. */
.start-box .start-clock {
  font-family: var(--bridge-font-numbers);
  font-size: 0.95rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.start-box .start-clock-mine {
  color: var(--bridge-action);
}

.start-box .start-clock-urgent {
  color: var(--bridge-on-table-bad);
}

.start-button {
  min-width: 140px;
  margin: 0;
}

/* Light on the navy, still a 44 px touch target. */
.start-cancel {
  height: 44px;
  margin: 0;
  font-size: 0.875rem;
  --color: var(--bridge-on-table);
  --border-color: var(--bridge-on-table-muted);
}
</style>
