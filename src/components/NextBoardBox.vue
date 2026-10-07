<template>
  <!-- Between boards of a set, for the four who played the board: the next
       board comes by itself at `next_board_at` (bb#97), so this counts down
       to it, a ring emptying over the wait ("8" in its middle) beside "Next
       board in 0:08" and "Board 3 of 4 · or skip the wait". "Deal now" is
       optional: once every human has asked (robots count as asked), it is
       dealt at once. Every player asks for themselves (a manager too,
       bb#74). Leaving is free now that the board is over. Once one of the
       four is replaced, or the set is over, it is Start instead (StartBox). -->
  <section class="next-board" aria-label="Next board">
    <div class="next-bar">
      <div
        v-if="left !== null"
        class="next-ring"
        :style="{ '--ring-fill': `${ringPercent}%` }"
        aria-hidden="true"
      >
        <span class="next-ring-face bridge-number">{{ left }}</span>
      </div>
      <div class="next-text">
        <p class="next-title">{{ title }}</p>
        <p v-if="sub" class="next-sub">{{ sub }}</p>
      </div>
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
    </div>
    <p v-if="iAmReady" class="next-detail">
      You asked to deal now. Waiting for {{ waitingFor.join(', ') || 'the others' }}.
    </p>

    <div class="next-leave">
      <ion-button fill="clear" color="medium" size="small" :disabled="busy" @click="emit('leave')">
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
import type { SetPosition } from '@/services/game';
import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { formatClock, secondsLeft } from '@/utils/away';
import { NEXT_BOARD_SECONDS } from '@/utils/sets';

const props = withDefaults(
  defineProps<{
    ready: Seat[];
    players: Partial<Record<Seat, PublicUser | null>>;
    mySeat: Seat | null;
    // The finished board's `next_board_at`; null when no deal is coming by
    // itself.
    nextBoardAt?: string | null;
    // The finished board's place in its set: the next one is told from it.
    set?: Pick<SetPosition, 'board' | 'of'> | null;
    busy?: boolean;
  }>(),
  { nextBoardAt: null, set: null, busy: false },
);

const emit = defineEmits<{ next: []; leave: [] }>();

// The clock only redraws the countdown; the deadline is the backend's.
const now = useNow(() => !!props.nextBoardAt);

// Whole seconds to the deal, or null when none is coming by itself.
const left = computed(() => (props.nextBoardAt ? secondsLeft(props.nextBoardAt, now.value) : null));

// How much of the ring is left: all of it at NEXT_BOARD_SECONDS.
const ringPercent = computed(() => Math.min(100, Math.round(((left.value ?? 0) / NEXT_BOARD_SECONDS) * 100)));

// "Next board in 0:08", then, once the time is up and the deal is on its
// way, "Dealing the next board…".
const title = computed(() => {
  if (left.value === null) {
    return 'Next board';
  }
  return left.value > 0 ? `Next board in ${formatClock(left.value)}` : 'Dealing the next board…';
});

const iAmReady = computed(() => !!props.mySeat && props.ready.includes(props.mySeat));

// "Board 3 of 4 · or skip the wait".
const sub = computed(() => {
  const set = props.set;
  const parts = set && set.board < set.of ? [`Board ${set.board + 1} of ${set.of}`] : [];
  if (!iAmReady.value) {
    parts.push('or skip the wait');
  }
  return parts.join(' · ');
});

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
  padding: 12px 14px;
  border: 1px solid var(--bridge-line);
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
}

.next-board p {
  margin: 0;
}

.next-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* The countdown ring: the action colour empties clockwise over the wait. */
.next-ring {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: conic-gradient(
    var(--bridge-action) 0 var(--ring-fill),
    var(--bridge-line) var(--ring-fill) 100%
  );
}

.next-ring-face {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--bridge-surface);
  font-size: 1.125rem;
}

.next-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.next-title {
  font-weight: 700;
}

.next-board .next-sub,
.next-board .next-detail {
  font-size: 0.8125rem;
  color: var(--bridge-muted);
}

.next-button {
  flex: none;
  margin: 0;
}

.next-board > .next-detail {
  margin-top: 8px;
}

.next-leave {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 8px;
  margin-top: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--bridge-line);
}

/* Small, but a 44 px touch target still (#163). */
.next-leave ion-button {
  height: 44px;
  margin: 0;
}
</style>
