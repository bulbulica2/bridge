<template>
  <!-- A claim waiting for its answers: what is claimed, who has agreed, and
       what the viewer can do about it. The claimer's cards lie face up at
       their seat on the table (BridgeTable's `claim`). -->
  <section class="claim" aria-live="polite" aria-label="Pending claim">
    <p class="claim-text">{{ claimText(claim, remaining, mySeat) }}</p>
    <ul class="claim-answers">
      <li
        v-for="seat in answerers"
        :key="seat"
        :class="{ 'is-accepted': claim.accepted.includes(seat) }"
        :data-seat="seat"
      >
        <span aria-hidden="true">{{ claim.accepted.includes(seat) ? '✓' : '…' }}</span>
        {{ seat }} {{ seat === mySeat ? 'you' : (players[seat]?.username ?? '') }}
        <span class="sr-only">{{ claim.accepted.includes(seat) ? 'accepted' : 'to answer' }}</span>
      </li>
    </ul>

    <div v-if="action === 'answer'" class="claim-buttons">
      <ion-button class="accept" color="success" :disabled="busy" @click="emit('accept')">
        Accept
      </ion-button>
      <ion-button class="reject" color="danger" fill="outline" :disabled="busy" @click="emit('reject')">
        Reject
      </ion-button>
    </div>
    <div v-else-if="action === 'withdraw'" class="claim-buttons">
      <ion-button class="withdraw" fill="outline" color="medium" :disabled="busy" @click="emit('withdraw')">
        Withdraw
      </ion-button>
    </div>
    <p class="claim-detail">
      Play stops until {{ waitingFor.length === 0 ? 'the claim is settled' : waitingText }}.
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonButton } from '@ionic/vue';
import type { Claim, PublicPlaying } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { claimAction, claimAnswerers, claimText, claimWaitingFor, tricksLeft } from '@/utils/claim';

const props = withDefaults(
  defineProps<{
    state: PublicPlaying & { claim: Claim };
    mySeat: Seat | null;
    players: Partial<Record<Seat, PublicUser | null>>;
    // An answer or a withdrawal is on its way.
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{ accept: []; reject: []; withdraw: [] }>();

const claim = computed(() => props.state.claim);
const remaining = computed(() => tricksLeft(props.state));
const answerers = computed(() => claimAnswerers(props.state));
const waitingFor = computed(() => claimWaitingFor(props.state));
const action = computed(() => claimAction(props.state, props.mySeat));

// "East and West answer", "you answer".
const waitingText = computed(() => {
  const names = waitingFor.value.map((seat) => (seat === props.mySeat ? 'you' : seat));
  return `${names.join(' and ')} ${names.length === 1 && names[0] !== 'you' ? 'answers' : 'answer'}`;
});
</script>

<style scoped>
.claim {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 2px solid var(--ion-color-warning, #ffc409);
  background: rgba(var(--ion-color-warning-rgb, 255, 196, 9), 0.1);
  text-align: center;
}

.claim p {
  margin: 0;
}

.claim-text {
  font-size: 1.05rem;
  font-weight: 700;
}

.claim-answers {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

.claim-answers .is-accepted {
  font-weight: 600;
  color: var(--ion-color-success-shade, #28ba62);
}

.claim-buttons {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}

.claim .claim-detail {
  margin-top: 6px;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
