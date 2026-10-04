<template>
  <!-- A bottom sheet for explaining one of our own calls to the opponents:
       the answer to their question about it. The parent owns whether it is
       open and sends the explanation. -->
  <ion-modal
    :is-open="open"
    :initial-breakpoint="0.5"
    :breakpoints="[0, 0.5, 0.9]"
    @did-dismiss="emit('close')"
  >
    <ion-content class="ion-padding">
      <div v-if="call" class="explain-sheet">
        <h2 class="explain-title">Explain your <CallLabel :bid="call.bid" /></h2>
        <p v-if="call.question" class="explain-asked">
          {{ SEAT_NAMES[call.question.asked_by] }} asks what it means.
        </p>
        <textarea
          v-model="text"
          class="explain-input"
          rows="3"
          :maxlength="ALERT_MAX"
          placeholder="What does this call mean?"
          aria-label="Your explanation"
          :disabled="busy"
        />
        <p class="explain-hint">
          Only the opponents see this. Your partner doesn't. · {{ text.length }}/{{ ALERT_MAX }}
        </p>
        <ion-button
          expand="block"
          class="send-explanation"
          :disabled="busy || text.trim() === ''"
          @click="emit('explain', text.trim())"
        >
          <ion-spinner v-if="busy" name="crescent" />
          <span v-else>Send to the opponents</span>
        </ion-button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { IonButton, IonContent, IonModal, IonSpinner } from '@ionic/vue';
import CallLabel from '@/components/CallLabel.vue';
import type { AuctionCall } from '@/services/game';
import { SEAT_NAMES } from '@/utils/auction';
import { ALERT_MAX } from '@/utils/limits';

const props = withDefaults(
  defineProps<{
    open: boolean;
    // The call to explain: one of ours.
    call: AuctionCall | null;
    // The explanation is on its way.
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{ explain: [explanation: string]; close: [] }>();

// Starts from what the opponents were told already, if anything.
const text = ref('');
watch(
  () => [props.open, props.call] as const,
  ([open, call]) => {
    if (open) {
      text.value = call?.alert?.explanation ?? '';
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.explain-sheet {
  max-width: 420px;
  margin: 0 auto;
}

.explain-title {
  margin: 8px 0 4px;
  font-size: 1.2rem;
  font-weight: 700;
  text-align: center;
}

.explain-asked {
  margin: 0 0 8px;
  text-align: center;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

.explain-input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--ion-color-step-300, #b3b3b3);
  border-radius: 8px;
  background: var(--ion-background-color, #fff);
  color: var(--ion-text-color, #1a1a1a);
  font: inherit;
  resize: vertical;
}

.explain-hint {
  margin: 4px 0 8px;
  font-size: 0.75rem;
  color: var(--ion-color-medium);
}
</style>
