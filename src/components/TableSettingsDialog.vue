<template>
  <!-- The table's settings, a small dialog in the middle of the screen
       (#181), opened by the gear in the game table's top-right corner while
       no set runs and the viewer manages the table: each player's time for
       a set (the set clock, bb#131). Picking a time sends it at once; the
       parent owns whether it is open, sends the change and bumps `pickerKey`
       to put the picker back after a refusal. The X, the backdrop and Escape
       close it. -->
  <ion-modal
    :is-open="open"
    class="settings-dialog"
    aria-labelledby="settings-dialog-title"
    @did-dismiss="dismissed"
  >
    <!-- Drawn only while on show, and kept until it has closed, so it never
         empties on the way out. -->
    <div v-if="shown" class="settings-sheet">
      <header class="settings-head">
        <h2 id="settings-dialog-title" class="settings-title">Table settings</h2>
        <ion-button fill="clear" size="small" class="settings-close" aria-label="Close" @click="emit('close')">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </header>

      <SetMinutesPicker
        :key="pickerKey"
        :model-value="minutes"
        :disabled="busy"
        label-id="table-set-minutes"
        @update:model-value="emit('change', $event)"
      />
      <!-- A change takes back every Start pressed for the old time
           (bb#142): the players press again. -->
      <p class="settings-note">Changing it takes back every Start already pressed.</p>
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { IonModal, IonButton, IonIcon } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import SetMinutesPicker from '@/components/SetMinutesPicker.vue';
import type { SetMinutes } from '@/services/tables';

const props = withDefaults(
  defineProps<{
    open: boolean;
    minutes: SetMinutes;
    // A change on its way.
    busy?: boolean;
    pickerKey?: number;
  }>(),
  { busy: false, pickerKey: 0 },
);

const emit = defineEmits<{ change: [minutes: SetMinutes]; close: [] }>();

const shown = ref(props.open);
watch(
  () => props.open,
  (open) => {
    if (open) {
      shown.value = true;
    }
  },
);

// Closed by the backdrop or Escape (still `open`), or after the X.
function dismissed() {
  shown.value = false;
  emit('close');
}
</script>

<style scoped>
/* Centred, as tall as its content, like the claim dialog. */
ion-modal.settings-dialog {
  --width: min(400px, calc(100vw - 32px));
  --height: auto;
  --border-radius: 16px;
  --box-shadow: 0 12px 40px var(--bridge-shadow-strong);
  /* Ionic shows no backdrop behind a phone's (full-screen) modal. */
  --backdrop-opacity: var(--ion-backdrop-opacity, 0.4);
}

.settings-sheet {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 16px 16px;
  background: var(--bridge-surface);
  color: var(--bridge-ink);
}

.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-right: -10px;
}

.settings-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
}

/* A 44 px tap area in the corner. */
.settings-close {
  flex: none;
  width: 44px;
  height: 44px;
  margin: 0;
  --color: var(--bridge-muted);
}

.settings-note {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--bridge-muted);
}
</style>
