<template>
  <div
    class="turn-line"
    :class="{ 'turn-line-mine': mine, 'turn-line-urgent': urgent, 'turn-line-robot': robot }"
    role="timer"
  >
    <!-- The turn clock line over the hand (Daylight, #161): what the board
         waits for on the left ("Your call", "Your turn · follow in ♦",
         "Waiting for East"), the clock on the right, and a 6 px bar under
         them that empties over the move's minute. Orange when it is the
         viewer's move, red in its last seconds. Its height never changes:
         the text has two lines of room (bottom-aligned) and the bar's track
         stays when no clock runs (a robot or an admin on turn, a claim). -->
    <p class="turn-line-row">
      <span class="turn-line-text">{{ text }}</span>
      <span v-if="time" class="turn-line-time">{{ time }}</span>
    </p>
    <div class="turn-bar" aria-hidden="true">
      <div v-if="fraction !== null" class="turn-bar-fill" :style="{ width: `${fraction * 100}%` }" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    // What the board waits for, in words.
    text: string;
    // The clock ("0:42", "Set 0:42"), or '' with none to show.
    time?: string;
    // The part of the move's minute left, 0 to 1; null hides the bar's fill.
    fraction?: number | null;
    // The viewer's move: orange.
    mine?: boolean;
    // The viewer's clock in its last seconds: red.
    urgent?: boolean;
    // A robot's move, due by itself.
    robot?: boolean;
  }>(),
  { time: '', fraction: null, mine: false, urgent: false, robot: false },
);
</script>

<style scoped>
.turn-line {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 2px 4px;
  color: var(--bridge-muted);
}

/* Two lines of room, the text sitting on the bar: one line or two, the
   hand below stays where it is. */
.turn-line-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  min-height: calc(2 * 1.3em);
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.3;
}

.turn-line-time {
  flex: none;
  font-family: var(--bridge-font-numbers);
  font-size: 1.0625rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.turn-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--bridge-line);
}

.turn-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--bridge-muted);
  transition: width 1s linear;
}

.turn-line-mine {
  font-weight: 700;
  color: var(--bridge-action-text);
}

.turn-line-mine .turn-bar-fill {
  background: var(--bridge-action);
}

.turn-line-robot {
  color: var(--bridge-redouble-text);
}

.turn-line-urgent {
  color: var(--ion-color-danger);
}

.turn-line-urgent .turn-bar-fill {
  background: var(--ion-color-danger);
}

@media (prefers-reduced-motion: reduce) {
  .turn-bar-fill {
    transition: none;
  }
}
</style>
