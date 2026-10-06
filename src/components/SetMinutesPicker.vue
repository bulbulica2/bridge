<template>
  <!-- Each player's time for a set at the table (the set clock, bb#131):
       8, 12, 16 or 20 minutes for its 4 boards, like a chess clock. The
       create-table form and a manager on the table's page pick it here. -->
  <div class="set-minutes">
    <p :id="labelId" class="set-minutes-label">Time for a set, each</p>
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
  }>(),
  { disabled: false, labelId: 'set-minutes-label' },
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
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}
</style>
