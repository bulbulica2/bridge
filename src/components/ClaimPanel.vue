<template>
  <!-- A claim waiting for its answers, as Daylight's dark banner (#161):
       what is claimed with its countdown on the right, who has agreed, and
       what the viewer can do about it (Accept / Reject as two equal
       buttons, Withdraw for the claimer). The claimer's cards lie face up
       at their seat on the table (BridgeTable's `claim`). A robot
       declarer's dummy claims and answers for declarer's seat (`actsFor`).
       Silence rejects it at `expires_at`: the clock counts down to it, and
       the buttons go once it has run out (a late answer only gets a 409). -->
  <section class="claim" aria-live="polite" aria-label="Pending claim">
    <div class="claim-head">
      <p class="claim-text">{{ claimText(claim, remaining, mySeat, ownSeat) }}</p>
      <!-- The clock line below says it in words, for screen readers too. -->
      <span v-if="seconds !== null" class="claim-seconds" aria-hidden="true">{{ formatClock(seconds) }}</span>
    </div>
    <ul class="claim-answers">
      <li
        v-for="seat in answerers"
        :key="seat"
        :class="{ 'is-accepted': claim.accepted.includes(seat) }"
        :data-seat="seat"
      >
        <span aria-hidden="true">{{ claim.accepted.includes(seat) ? '✓' : '…' }}</span>
        {{ seat }} {{ isMine(seat) ? 'you' : (players[seat]?.username ?? '') }}
        <span class="sr-only">{{ claim.accepted.includes(seat) ? 'accepted' : 'to answer' }}</span>
      </li>
    </ul>

    <div v-if="action === 'answer'" class="claim-buttons">
      <ion-button class="accept" :disabled="busy || expired" @click="emit('accept')">
        Accept
      </ion-button>
      <ion-button class="reject" :disabled="busy || expired" @click="emit('reject')">
        Reject
      </ion-button>
    </div>
    <div v-else-if="action === 'withdraw'" class="claim-buttons">
      <ion-button class="withdraw" :disabled="busy || expired" @click="emit('withdraw')">
        Withdraw
      </ion-button>
    </div>
    <!-- Ticks every second: kept out of the live region's announcements. -->
    <p v-if="clockText" class="claim-detail claim-clock" aria-live="off">{{ clockText }}</p>
    <p v-else class="claim-detail">
      Play stops until {{ waitingFor.length === 0 ? 'the claim is settled' : waitingText }}.
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonButton } from '@ionic/vue';
import { useNow } from '@/composables/useNow';
import type { Claim, PublicPlaying } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { formatClock } from '@/utils/away';
import {
  claimAction,
  claimAnswerers,
  claimClockText,
  claimExpired,
  claimSecondsLeft,
  claimText,
  claimWaitingFor,
  tricksLeft,
} from '@/utils/claim';

const props = withDefaults(
  defineProps<{
    state: PublicPlaying & { claim: Claim };
    mySeat: Seat | null;
    // The seat the viewer claims and answers for, when not their own: a
    // robot declarer's, whose game its dummy plays (claimSeatOf).
    actsFor?: Seat | null;
    players: Partial<Record<Seat, PublicUser | null>>;
    // An answer or a withdrawal is on its way.
    busy?: boolean;
  }>(),
  { actsFor: null, busy: false },
);

const emit = defineEmits<{ accept: []; reject: []; withdraw: [] }>();

const claim = computed(() => props.state.claim);
const remaining = computed(() => tricksLeft(props.state));
const answerers = computed(() => claimAnswerers(props.state));
const waitingFor = computed(() => claimWaitingFor(props.state));
const ownSeat = computed(() => props.actsFor ?? props.mySeat);
const action = computed(() => claimAction(props.state, ownSeat.value));

// The clock only redraws the countdown; the deadline is the claim's own.
const now = useNow(() => !!claim.value.expires_at);
const expired = computed(() => claimExpired(claim.value, now.value));
const clockText = computed(() => claimClockText(props.state, ownSeat.value, now.value));
// The seconds on the right, while somebody still has to answer.
const seconds = computed(() => (clockText.value ? claimSecondsLeft(claim.value, now.value) : null));

function isMine(seat: Seat): boolean {
  return seat === props.mySeat || seat === ownSeat.value;
}

// "East and West answer", "you answer".
const waitingText = computed(() => {
  const names = waitingFor.value.map((seat) => (isMine(seat) ? 'you' : seat));
  return `${names.join(' and ')} ${names.length === 1 && names[0] !== 'you' ? 'answers' : 'answer'}`;
});
</script>

<style scoped>
/* Daylight's dark banner: the pop-ups' colours, in both modes. */
.claim {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0 0 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--bridge-popup);
  color: var(--bridge-on-popup);
}

.claim p {
  margin: 0;
}

.claim-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.claim-text {
  font-size: 0.95rem;
  font-weight: 700;
}

/* The countdown, in the numbers' font and the action's light orange. */
.claim-seconds {
  flex: none;
  font-family: var(--bridge-font-numbers);
  font-size: 1.15rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--bridge-on-popup-clock);
}

.claim-answers {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.85rem;
  color: var(--bridge-on-popup-muted);
}

.claim-answers .is-accepted {
  font-weight: 700;
  color: var(--bridge-on-popup-ok);
}

/* Two equal buttons: the light one agrees, the dark one says no. */
.claim-buttons {
  display: flex;
  gap: 8px;
}

.claim-buttons ion-button {
  flex: 1;
  margin: 0;
  --border-radius: 10px;
  --box-shadow: none;
}

.claim .claim-buttons ion-button:not(.button-small) {
  height: 44px;
  font-size: 0.875rem;
}

.accept {
  --background: var(--bridge-on-popup);
  --color: var(--bridge-popup);
}

.reject,
.withdraw {
  --background: var(--bridge-popup-button);
  --color: var(--bridge-on-popup);
}

.claim .claim-detail {
  font-size: 0.8rem;
  color: var(--bridge-on-popup-muted);
}

.claim .claim-clock {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
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
