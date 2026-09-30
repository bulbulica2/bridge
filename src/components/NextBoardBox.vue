<template>
  <!-- Between boards: who has asked for the next one (`ready`), the button
       that asks, a manager's "for everyone", and leaving, which is free now
       that the board is over. -->
  <section class="next-board" aria-label="Next board">
    <template v-if="short">
      <p class="next-title">Waiting for a fourth player</p>
      <p class="next-detail">
        Somebody left after the board. The next one is dealt as soon as a fourth player sits down.
      </p>
    </template>
    <template v-else>
      <p class="next-title">Next board: {{ ready.length }} of 4 ready</p>
      <ul class="next-seats">
        <li
          v-for="seat in SEATS"
          :key="seat"
          :class="{ 'is-ready': ready.includes(seat) }"
          :data-seat="seat"
        >
          <span class="next-mark" aria-hidden="true">{{ ready.includes(seat) ? '✓' : '…' }}</span>
          <span>{{ seat }} {{ seat === mySeat ? 'you' : (players[seat]?.username ?? '') }}</span>
          <RobotBadge v-if="players[seat]?.is_robot" />
          <span class="sr-only">{{ ready.includes(seat) ? 'ready' : 'not yet' }}</span>
        </li>
      </ul>

      <ion-button
        v-if="!iAmReady"
        expand="block"
        class="next-button"
        :disabled="busy"
        @click="emit('next')"
      >
        <ion-spinner v-if="busy" name="crescent" />
        <span v-else>Next board</span>
      </ion-button>
      <p v-else class="next-detail">
        You're ready. Waiting for {{ waitingFor.join(', ') || 'the others' }}.
      </p>

      <ion-button
        v-if="canDealForAll"
        expand="block"
        fill="clear"
        size="small"
        :disabled="busy"
        @click="emit('everyone')"
      >
        Deal the next board for everyone
      </ion-button>
    </template>

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
import RobotBadge from '@/components/RobotBadge.vue';
import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';

const props = withDefaults(
  defineProps<{
    ready: Seat[];
    players: Partial<Record<Seat, PublicUser | null>>;
    mySeat: Seat | null;
    // Fewer than four seated: nothing to confirm, a newcomer deals it.
    short?: boolean;
    // The table's can_manage: may ask for all four at once.
    manager?: boolean;
    busy?: boolean;
  }>(),
  { short: false, manager: false, busy: false },
);

const emit = defineEmits<{ next: []; everyone: []; leave: [] }>();

const iAmReady = computed(() => !!props.mySeat && props.ready.includes(props.mySeat));

const waitingFor = computed(() =>
  SEATS.filter((seat) => !props.ready.includes(seat)).map(
    (seat) => props.players[seat]?.username ?? seat,
  ),
);

const canDealForAll = computed(() => props.manager && props.ready.length < 4);
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

.next-seats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 8px 0;
  padding: 0;
  list-style: none;
}

.next-seats li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--ion-color-light, #f4f5f8);
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.next-seats li.is-ready {
  background: rgba(var(--ion-color-success-rgb, 45, 211, 111), 0.15);
  color: var(--ion-text-color, #000);
}

.next-mark {
  font-weight: 700;
}

.is-ready .next-mark {
  color: var(--ion-color-success-shade, #28ba62);
}

.next-button {
  margin-top: 4px;
}

.next-leave {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--ion-color-step-150, #e0e0e0);
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
