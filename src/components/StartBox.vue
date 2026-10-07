<template>
  <!-- Before a board: every human presses Start, and the last one deals it
       (robots are always ready). Who is missing updates live from the
       table's seats. -->
  <section class="start-box" aria-label="Start">
    <p class="start-title">{{ iAmReady ? 'Waiting for the others…' : 'Ready to play?' }}</p>

    <!-- The four seats as plates (#163): a green tick once a player pressed
         Start, an empty seat dashed orange. A manager fills an empty one
         from here too (the table's page has the same buttons), so being
         left alone at the game table is no dead end, and takes a player (a
         robot, say) out. -->
    <ul v-if="showSeats" class="start-seats">
      <li
        v-for="{ seat, held } in seats"
        :key="seat"
        :class="{ 'is-ready': held && isReady(held) }"
        :data-seat="seat"
      >
        <SeatPlate
          v-if="held"
          :user="held.user"
          :seat="seat"
          :mine="held.user_id === me"
          :ready="isReady(held)"
        />
        <div v-else class="start-empty">
          <span class="start-empty-label">Empty · {{ SEAT_NAMES[seat] }}</span>
          <div v-if="fillable.includes(seat)" class="start-fill" :data-fill-seat="seat">
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
          </div>
        </div>
        <ion-button
          v-if="held && removable.includes(seat)"
          size="small"
          fill="outline"
          color="danger"
          class="start-remove"
          :aria-label="`Remove ${held.user.username}`"
          :disabled="busy || fillingSeat !== null"
          @click="emit('remove', seat)"
        >
          <ion-spinner v-if="fillingSeat === seat" name="crescent" />
          <span v-else>Remove</span>
        </ion-button>
      </li>
    </ul>

    <p v-if="waiting" class="start-detail" aria-live="polite">{{ waiting }}</p>

    <ion-button
      v-if="!iAmReady"
      expand="block"
      color="action"
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

    <!-- Between sets (or before the first) nothing is at stake: the way off
         the seat, for a page that has no Leave of its own (#121). -->
    <ion-button
      v-if="canLeave"
      fill="outline"
      color="danger"
      class="start-leave"
      :disabled="busy || fillingSeat !== null"
      @click="emit('leave')"
    >
      Leave the table
    </ion-button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonButton, IonSpinner } from '@ionic/vue';
import SeatPlate from '@/components/SeatPlate.vue';
import { SEATS } from '@/services/tables';
import type { BroadcastTable, Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
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
    // The seat being filled or emptied, while that request is on its way.
    fillingSeat?: Seat | null;
    // With the seats shown: the taken ones the viewer may empty
    // (`canRemove`), each with a Remove.
    removable?: Seat[];
    // A Leave of its own, for the play page.
    canLeave?: boolean;
  }>(),
  { showSeats: false, busy: false, manage: false, fillingSeat: null, removable: () => [], canLeave: false },
);

const emit = defineEmits<{
  start: [];
  cancel: [];
  seatPlayer: [seat: Seat];
  addRobot: [seat: Seat];
  remove: [seat: Seat];
  leave: [];
}>();

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
/* Daylight's white card (#163), the seats as plates. */
.start-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0 0 16px;
  padding: 16px;
  border-radius: 18px;
  background: var(--bridge-surface);
  box-shadow: 0 1px 0 var(--bridge-card-border);
  text-align: center;
}

.start-box p {
  margin: 0;
}

.start-title {
  font-size: 1.05rem;
  font-weight: 700;
}

.start-box .start-detail {
  font-size: 0.875rem;
  color: var(--bridge-muted);
}

.start-seats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.start-seats li {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

/* An empty seat: dashed orange, waiting for a player (a manager's buttons
   to fill it inside). */
.start-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  min-height: 52px;
  padding: 8px;
  border: 2px dashed var(--bridge-action);
  border-radius: 14px;
  background: var(--bridge-action-tint);
  color: var(--bridge-action-text);
}

.start-empty-label {
  font-size: 0.95rem;
  font-weight: 700;
}

.start-fill {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* The seats' small buttons: still a 44 px touch target. */
.start-fill ion-button,
.start-remove,
.start-cancel {
  height: 44px;
  margin: 0;
  font-size: 0.875rem;
}

.start-button,
.start-leave {
  margin: 0;
}

.start-leave {
  align-self: center;
}
</style>
