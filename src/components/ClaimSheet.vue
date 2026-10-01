<template>
  <!-- A bottom sheet for making a claim: one button per number of the tricks
       still to play, then a send button for the number picked, or Concede
       for none. The parent owns whether it is open and sends the claim. -->
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

        <div class="trick-picks" role="group" aria-label="Tricks to claim">
          <ion-button
            v-for="n in remaining"
            :key="n"
            :fill="tricks === n ? 'solid' : 'outline'"
            class="trick-pick"
            :class="{ picked: tricks === n }"
            :aria-pressed="tricks === n"
            :data-tricks="n"
            :disabled="busy"
            @click="tricks = n"
          >
            {{ n }}
          </ion-button>
        </div>

        <ion-button
          expand="block"
          class="send-claim"
          :disabled="busy || tricks === null"
          @click="tricks !== null && emit('claim', tricks)"
        >
          <ion-spinner v-if="busy" name="crescent" />
          <span v-else-if="tricks === null">Pick a number</span>
          <span v-else>Claim {{ tricks }} trick{{ tricks === 1 ? '' : 's' }}</span>
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

// The number picked; nothing is sent until the send button is pressed.
const tricks = ref<number | null>(null);

// Each opening (or a trick finishing meanwhile) starts with nothing picked.
watch(
  () => [props.open, props.remaining] as const,
  () => {
    tricks.value = null;
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

.claim-help {
  margin: 0 0 12px;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

/* Up to 13 buttons wrap onto two or three rows on a phone. */
.trick-picks {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-bottom: 12px;
}

.trick-pick {
  width: 48px;
  height: 48px;
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.send-claim {
  margin-top: 8px;
}
</style>
