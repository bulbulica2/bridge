<template>
  <!-- A bottom sheet for making a claim: how many of the tricks still to
       play our side takes (all of them to start with), or Concede for none.
       The parent owns whether it is open and sends the claim. -->
  <ion-modal
    :is-open="open"
    :initial-breakpoint="0.5"
    :breakpoints="[0, 0.5, 0.9]"
    @did-dismiss="emit('close')"
  >
    <ion-content class="ion-padding">
      <div class="claim-sheet">
        <h2 class="claim-title">Claim tricks</h2>
        <p class="claim-help">
          How many of the remaining {{ remaining }} trick{{ remaining === 1 ? '' : 's' }} does your
          side take? Your hand is shown to everyone while the others answer.
        </p>

        <div class="stepper" role="group" aria-label="Tricks to claim">
          <ion-button
            fill="outline"
            class="step-down"
            aria-label="One trick fewer"
            :disabled="busy || tricks <= 0"
            @click="tricks--"
          >
            −
          </ion-button>
          <output class="step-value" aria-live="polite">{{ tricks }}</output>
          <ion-button
            fill="outline"
            class="step-up"
            aria-label="One trick more"
            :disabled="busy || tricks >= remaining"
            @click="tricks++"
          >
            +
          </ion-button>
        </div>
        <p class="claim-detail">of {{ remaining }}</p>

        <ion-button expand="block" class="send-claim" :disabled="busy" @click="emit('claim', tricks)">
          <ion-spinner v-if="busy" name="crescent" />
          <span v-else>{{ tricks === 0 ? 'Concede all' : `Claim ${tricks}` }}</span>
        </ion-button>
        <ion-button
          expand="block"
          fill="clear"
          color="medium"
          class="concede"
          :disabled="busy"
          @click="emit('claim', 0)"
        >
          Concede the rest
        </ion-button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { IonModal, IonContent, IonButton, IonSpinner } from '@ionic/vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    // The tricks still to play: the most that can be claimed.
    remaining: number;
    // The claim is on its way.
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{ claim: [tricks: number]; close: [] }>();

const tricks = ref(props.remaining);

// Each opening starts from "all of them".
watch(
  () => [props.open, props.remaining] as const,
  ([open]) => {
    if (open) {
      tricks.value = props.remaining;
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.claim-sheet {
  max-width: 420px;
  margin: 0 auto;
  text-align: center;
}

.claim-title {
  margin: 8px 0 4px;
  font-size: 1.2rem;
  font-weight: 700;
}

.claim-help,
.claim-detail {
  margin: 0 0 12px;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.stepper ion-button {
  min-width: 48px;
  font-size: 1.3rem;
}

.step-value {
  min-width: 2ch;
  font-size: 2rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.send-claim {
  margin-top: 8px;
}
</style>
