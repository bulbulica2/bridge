<template>
  <!-- Each player's time for a set at the table (the set clock, bb#131):
       8, 12, 16 or 20 minutes for its 4 boards, like a chess clock. The
       create-table form and a manager's settings at the game table pick it
       here. -->
  <div class="set-minutes">
    <p :id="labelId" class="set-minutes-label">{{ label }}</p>
    <ion-segment
      :model-value="String(modelValue)"
      :disabled="disabled"
      :aria-labelledby="labelId"
      @update:model-value="pick($event)"
    >
      <ion-segment-button v-for="minutes in SET_MINUTES" :key="minutes" :value="String(minutes)">
        <ion-label>{{ minutes }} min</ion-label>
      </ion-segment-button>
    </ion-segment>
  </div>
</template>

<script setup lang="ts">
import { IonLabel, IonSegment, IonSegmentButton } from '@ionic/vue';
import { SET_MINUTES } from '@/services/tables';
import type { SetMinutes } from '@/services/tables';

const props = withDefaults(
  defineProps<{
    modelValue: SetMinutes;
    disabled?: boolean;
    // Ties the label to the segment; unique per page.
    labelId?: string;
    label?: string;
  }>(),
  { disabled: false, labelId: 'set-minutes-label', label: 'Time for a set, each' },
);

const emit = defineEmits<{ 'update:modelValue': [minutes: SetMinutes] }>();

// Only one of the four lengths, and only a change.
function pick(value: unknown) {
  const minutes = SET_MINUTES.find((m) => String(m) === String(value));
  if (minutes !== undefined && minutes !== props.modelValue) {
    emit('update:modelValue', minutes);
  }
}
</script>

<style scoped>
.set-minutes {
  width: 100%;
  padding: 8px 0;
}

.set-minutes-label {
  margin: 0 0 6px;
  font-size: 0.8125rem;
  font-weight: 700;
}

/* Daylight's segmented control: four equal parts on the chip grey, the
   picked one raised on the surface. */
.set-minutes ion-segment {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--bridge-chip);
}

.set-minutes ion-segment-button {
  --background: transparent;
  --background-checked: var(--bridge-surface);
  --color: var(--bridge-muted);
  --color-checked: var(--bridge-ink);
  --indicator-color: transparent;
  --indicator-height: 0;
  --border-radius: 9px;
  --border-width: 0;
  min-width: 0;
  min-height: 40px;
  margin: 0;
  border-radius: 9px;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0;
}

.set-minutes ion-segment-button.segment-button-checked {
  box-shadow: 0 1px 3px rgba(var(--ion-text-color-rgb), 0.2);
}
</style>
