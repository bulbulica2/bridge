<template>
  <!-- A bottom sheet for making a claim: one button per number of the tricks
       still to play, every one of them picked to start with, then a send
       button for the number picked, or Concede for none. The parent owns whether it is open and sends the claim. A
       robot declarer's dummy claims for declarer (`forSeat`). -->
  <ion-modal
    :is-open="open"
    :initial-breakpoint="0.5"
    :breakpoints="[0, 0.5, 0.9]"
    @did-dismiss="emit('close')"
  >
    <ion-content class="ion-padding">
      <div class="claim-sheet">
        <h2 class="claim-title">
          Claim tricks<template v-if="forSeat"> for {{ SEAT_NAMES[forSeat] }}</template>
        </h2>
        <p class="claim-help">
          How many of the remaining {{ remaining }} trick{{ remaining === 1 ? '' : 's' }} does your
          side take? All of them unless you pick fewer.
          {{ forSeat ? `${SEAT_NAMES[forSeat]}'s hand` : 'Your hand' }} is shown to everyone while
          the others answer.
        </p>
        <p class="claim-deadline">
          The others have {{ CLAIM_SECONDS }} seconds to answer: no answer counts as no.
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
            @click="pick(n)"
          >
            {{ n }}
          </ion-button>
        </div>

        <ion-button
          expand="block"
          class="send-claim"
          :disabled="busy || tricks < 1"
          @click="emit('claim', tricks)"
        >
          <ion-spinner v-if="busy" name="crescent" />
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
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { CLAIM_SECONDS } from '@/utils/claim';

const props = withDefaults(
  defineProps<{
    open: boolean;
    // The tricks still to play: the most that can be claimed.
    remaining: number;
    // The seat claimed for, when not the viewer's own: a robot declarer's,
    // whose game its dummy plays.
    forSeat?: Seat | null;
    // The claim is on its way.
    busy?: boolean;
  }>(),
  { forSeat: null, busy: false },
);

const emit = defineEmits<{ claim: [tricks: number]; close: [] }>();

// The number picked; nothing is sent until the send button is pressed.
const tricks = ref(props.remaining);
// The player picked it by hand since the sheet opened.
const picked = ref(false);

function pick(n: number) {
  tricks.value = n;
  picked.value = true;
}

// Each opening starts with every remaining trick picked: a claim is almost
// always for all of them (#137).
watch(
  () => props.open,
  () => {
    tricks.value = props.remaining;
    picked.value = false;
  },
);

// A trick finishing meanwhile moves the default to the new maximum, and
// keeps a number picked by hand while it is still possible.
watch(
  () => props.remaining,
  (remaining) => {
    if (!picked.value || tricks.value > remaining) tricks.value = remaining;
  },
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
  margin: 0 0 4px;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

.claim-deadline {
  margin: 0 0 12px;
  font-size: 0.85rem;
  font-weight: 600;
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
