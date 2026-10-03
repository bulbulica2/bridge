<template>
  <!-- The table pages' way out when live updates break (Reverb down, the
       channel refused): a note and Refresh, shown only after live updates
       have been off for a few seconds. While live, nothing; pull-to-refresh
       stays on the page either way. -->
  <div v-if="offline" class="offline-refresh">
    <p class="offline-note" role="status">{{ OFFLINE_NOTE }}</p>
    <ion-button expand="block" fill="outline" class="refresh" :disabled="disabled" @click="emit('refresh')">
      Refresh
    </ion-button>
  </div>
</template>

<script setup lang="ts">
import { IonButton } from '@ionic/vue';
import { useLiveStatus } from '@/composables/useLiveStatus';

const props = withDefaults(defineProps<{ tableId: number; disabled?: boolean }>(), {
  disabled: false,
});

const emit = defineEmits<{ refresh: [] }>();

const OFFLINE_NOTE = 'Live updates are off. Refresh to see the latest.';

const { offline } = useLiveStatus(() => props.tableId);
</script>

<style scoped>
.offline-refresh {
  margin-top: 8px;
}

.offline-note {
  margin: 0 0 4px;
  font-size: 0.9em;
  text-align: center;
  color: var(--ion-color-medium);
}
</style>
