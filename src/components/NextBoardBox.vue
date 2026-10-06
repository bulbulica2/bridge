<template>
  <!-- Between boards of a set, for the four who played the board: the next
       board comes by itself at `next_board_at` (bb#97), so this counts down
       to it. "Deal now" is optional: once every human has asked (robots
       count as asked), it is dealt at once. Every player asks for themselves
       (a manager too, bb#74). Leaving is free now that the board is over.
       Once one of the four is replaced, or the set is over, it is Start
       instead (StartBox). -->
  <section class="next-board" aria-label="Next board">
    <p class="next-title">{{ title }}</p>

    <ion-button
      v-if="!iAmReady"
      color="action"
      class="next-button"
      :disabled="busy"
      @click="emit('next')"
    >
      <ion-spinner v-if="busy" name="crescent" />
      <span v-else>Deal now</span>
    </ion-button>
    <p v-else class="next-detail">
      You asked to deal now. Waiting for {{ waitingFor.join(', ') || 'the others' }}.
    </p>

    <div class="next-leave">
      <ion-button fill="outline" color="medium" size="small" :disabled="busy" @click="emit('leave')">
        Leave the table
      </ion-button>
      <p class="next-detail">The board is over, so leaving now abandons nothing.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonButton, IonSpinner } from '@ionic/vue';
import { useNow } from '@/composables/useNow';
import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { formatClock, secondsLeft } from '@/utils/away';

const props = withDefaults(
  defineProps<{
    ready: Seat[];
    players: Partial<Record<Seat, PublicUser | null>>;
    mySeat: Seat | null;
    // The finished board's `next_board_at`; null when no deal is coming by
    // itself.
    nextBoardAt?: string | null;
    busy?: boolean;
  }>(),
  { nextBoardAt: null, busy: false },
);

const emit = defineEmits<{ next: []; leave: [] }>();

// The clock only redraws the countdown; the deadline is the backend's.
const now = useNow(() => !!props.nextBoardAt);

// "Next board in 0:08", then, once the time is up and the deal is on its
// way, "Dealing the next board…".
const title = computed(() => {
  if (!props.nextBoardAt) {
    return 'Next board';
  }
  const left = secondsLeft(props.nextBoardAt, now.value);
  return left > 0 ? `Next board in ${formatClock(left)}` : 'Dealing the next board…';
});

const iAmReady = computed(() => !!props.mySeat && props.ready.includes(props.mySeat));

// The humans who haven't asked yet: robots never hold the deal up.
const waitingFor = computed(() =>
  SEATS.filter((seat) => !props.ready.includes(seat) && !props.players[seat]?.is_robot).map(
    (seat) => props.players[seat]?.username ?? seat,
  ),
);
</script>

<style scoped>
.next-board {
  margin: 0 0 12px;
  padding: 12px;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 8px;
  text-align: center;
}

.next-board p {
  margin: 0;
}

.next-title {
  font-weight: 700;
}

.next-board .next-detail {
  margin-top: 4px;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.next-button {
  margin-top: 4px;
}

.next-leave {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--ion-color-step-150, #e0e0e0);
}
</style>
