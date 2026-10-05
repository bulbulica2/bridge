<template>
  <!-- Before a board: every human presses Start, and the last one deals it
       (robots are always ready). Who is missing updates live from the
       table's seats. -->
  <section class="start-box" aria-label="Start">
    <p class="start-title">{{ iAmReady ? 'Waiting for the others…' : 'Ready to play?' }}</p>

    <ul v-if="showSeats" class="start-seats">
      <li
        v-for="{ seat, held } in seats"
        :key="seat"
        :class="{ 'is-ready': held && isReady(held) }"
        :data-seat="seat"
      >
        <span class="start-mark" aria-hidden="true">{{ !held ? '–' : isReady(held) ? '✓' : '…' }}</span>
        <span>{{ seat }} {{ !held ? 'empty' : held.user_id === me ? 'you' : held.user.username }}</span>
        <RobotBadge v-if="held?.user.is_robot" />
        <AdminBadge v-if="held?.user.is_admin" />
        <span class="sr-only">{{ !held ? '' : isReady(held) ? 'ready' : 'not yet' }}</span>
      </li>
    </ul>

    <!-- A manager fills the empty seats from here too (the table's page has
         the same buttons), so being left alone at the game table is no dead
         end. -->
    <ul v-if="fillable.length > 0" class="start-fill" aria-label="Fill the empty seats">
      <li v-for="seat in fillable" :key="seat" :data-fill-seat="seat">
        <span class="start-fill-seat">{{ seat }}</span>
        <ion-button
          size="small"
          fill="outline"
          class="start-seat-player"
          :disabled="busy || fillingSeat !== null"
          @click="emit('seatPlayer', seat)"
        >
          Seat a player
        </ion-button>
        <ion-button
          size="small"
          fill="outline"
          class="start-add-robot"
          :disabled="busy || fillingSeat !== null"
          @click="emit('addRobot', seat)"
        >
          <ion-spinner v-if="fillingSeat === seat" name="crescent" />
          <span v-else>Add robot</span>
        </ion-button>
      </li>
    </ul>

    <p v-if="waiting" class="start-detail" aria-live="polite">{{ waiting }}</p>

    <ion-button
      v-if="!iAmReady"
      expand="block"
      class="start-button"
      :disabled="busy"
      @click="emit('start')"
    >
      <ion-spinner v-if="busy" name="crescent" />
      <span v-else>Start</span>
    </ion-button>
    <ion-button
      v-else
      fill="clear"
      size="small"
      color="medium"
      class="start-cancel"
      :disabled="busy"
      @click="emit('cancel')"
    >
      <ion-spinner v-if="busy" name="crescent" />
      <span v-else>Cancel</span>
    </ion-button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonButton, IonSpinner } from '@ionic/vue';
import AdminBadge from '@/components/AdminBadge.vue';
import RobotBadge from '@/components/RobotBadge.vue';
import { SEATS } from '@/services/tables';
import type { BroadcastTable, Seat } from '@/services/tables';
import { isReady, startWaiting } from '@/utils/start';

const props = withDefaults(
  defineProps<{
    table: BroadcastTable;
    me: number | null;
    // The four seats with their ready marks, for a page that doesn't show
    // them already (the table page marks its compass instead).
    showSeats?: boolean;
    // A Start or a Cancel on its way.
    busy?: boolean;
    // The viewer manages the table (`can_manage`): with the seats shown,
    // each empty one offers Seat a player and Add robot.
    manage?: boolean;
    // The empty seat being filled, while that request is on its way.
    fillingSeat?: Seat | null;
  }>(),
  { showSeats: false, busy: false, manage: false, fillingSeat: null },
);

const emit = defineEmits<{ start: []; cancel: []; seatPlayer: [seat: Seat]; addRobot: [seat: Seat] }>();

const seats = computed(() =>
  SEATS.map((seat) => ({ seat, held: props.table.seats.find((s) => s.seat === seat) ?? null })),
);

const fillable = computed(() =>
  props.showSeats && props.manage ? seats.value.filter((s) => !s.held).map((s) => s.seat) : [],
);

const iAmReady = computed(
  () => props.table.seats.find((s) => s.user_id === props.me)?.ready ?? false,
);

const waiting = computed(() => startWaiting(props.table, props.me));
</script>

<style scoped>
.start-box {
  margin: 0 0 16px;
  padding: 12px;
  border: 1px solid var(--ion-color-primary);
  border-radius: 8px;
  text-align: center;
}

.start-box p {
  margin: 0;
}

.start-title {
  font-weight: 700;
}

.start-box .start-detail {
  margin-top: 4px;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.start-seats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 8px 0;
  padding: 0;
  list-style: none;
}

.start-seats li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--ion-color-light, #f4f5f8);
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.start-seats li.is-ready {
  background: rgba(var(--ion-color-success-rgb, 45, 211, 111), 0.15);
  color: var(--ion-text-color, #000);
}

.start-mark {
  font-weight: 700;
}

.is-ready .start-mark {
  color: var(--ion-color-success-shade, #28ba62);
}

.start-fill {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}

.start-fill li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.start-fill-seat {
  min-width: 1.5em;
  font-weight: 700;
}

.start-button {
  margin-top: 8px;
}

.start-cancel {
  margin-top: 4px;
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
