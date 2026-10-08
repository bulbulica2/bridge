<template>
  <!-- One open table in the lobby: its name (opening the game table), a
       meta line ("16 min · set 2 · board 2/4", or "left 3 min ago · closes
       in 7" while only robots are left), a status pill, and a mini compass
       of the four seats: names, robots blue, away players red, the viewer
       orange, an empty seat a dashed "Sit N" that takes it (`join`; a move
       from another table is confirmed by the page). Tapping a player opens
       their profile (`player`). Under it, how many watch the table ("2
       watching") and, where the table allows it and we don't sit there,
       Watch (`watch`: as a kibitzer, #182). -->
  <article class="table-card" :class="{ 'table-card-mine': mine }">
    <div class="table-card-head">
      <div class="table-card-title">
        <router-link v-if="!banned" class="table-card-name" :to="`/tables/${table.id}/play`">
          {{ name }}
        </router-link>
        <span v-else class="table-card-name">{{ name }}</span>
        <span class="table-card-meta">{{ meta }}</span>
      </div>
      <span class="table-card-pill" :class="`pill-${status.tone}`">{{ status.text }}</span>
    </div>

    <div class="compass" role="group" :aria-label="`Seats at ${name}`">
      <div
        v-for="seat in SEATS"
        :key="seat"
        class="compass-cell"
        :class="[`compass-${seat}`, `compass-${seats[seat].kind}`]"
        :data-seat="seat"
      >
        <button
          v-if="seats[seat].user"
          type="button"
          class="compass-seat seat-user"
          :title="seatTitle(seat)"
          :aria-label="`${seatTitle(seat)}: profile`"
          @click="emit('player', seats[seat].user!)"
        >
          {{ seatLabel(seat) }}
        </button>
        <button
          v-else
          type="button"
          class="compass-sit"
          :disabled="busy || banned"
          :aria-label="mine ? `Move to ${SEAT_NAMES[seat]}` : `Sit ${SEAT_NAMES[seat]}`"
          @click="emit('join', seat)"
        >
          <ion-spinner v-if="joining === seat" name="crescent" />
          <span v-else>Sit {{ seat }}</span>
        </button>
      </div>
      <span class="compass-middle" aria-hidden="true">♠</span>
    </div>

    <div v-if="table.kibitzers > 0 || watchable" class="table-card-foot">
      <span v-if="table.kibitzers > 0" class="table-card-kibitzers">
        <ion-icon :icon="eyeOutline" aria-hidden="true" />
        {{ table.kibitzers }} watching
      </span>
      <button
        v-if="watchable"
        type="button"
        class="table-card-watch"
        :class="{ 'is-watching': watching }"
        :disabled="busy"
        :aria-label="watching ? `Back to watching ${name}` : `Watch ${name}`"
        @click="emit('watch')"
      >
        <ion-spinner v-if="watchBusy" name="crescent" />
        <span v-else>{{ watching ? 'Watching' : 'Watch' }}</span>
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import { eyeOutline } from 'ionicons/icons';
import { SEATS } from '@/services/tables';
import type { BroadcastTable, Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES } from '@/utils/auction';
import { compassSeats, tableMeta, tableStatus } from '@/utils/lobby';

const props = withDefaults(
  defineProps<{
    table: BroadcastTable;
    me: number | null;
    // The table we sit at (an empty seat there is a seat change).
    mine?: boolean;
    // A seat being taken anywhere on the page: every Sit waits.
    busy?: boolean;
    // The seat being taken here, spinning.
    joining?: Seat | null;
    banned?: boolean;
    // The table we watch without a seat (#182).
    watching?: boolean;
    // Watch on its way here, spinning.
    watchBusy?: boolean;
    // Now, for the unattended table's minutes (the page's clock).
    now?: number;
  }>(),
  {
    mine: false,
    busy: false,
    joining: null,
    banned: false,
    watching: false,
    watchBusy: false,
    now: () => Date.now(),
  },
);

const emit = defineEmits<{ join: [seat: Seat]; player: [user: PublicUser]; watch: [] }>();

// Watch: where the table allows kibitzers, never at our own table, nor for
// a banned user.
const watchable = computed(() => props.table.allow_kibitzers && !props.mine && !props.banned);

const name = computed(() => props.table.name || `Table #${props.table.id}`);
const meta = computed(() => tableMeta(props.table, props.now));
const status = computed(() => tableStatus(props.table));
const seats = computed(() => compassSeats(props.table, props.me));

// "You", "nick · away", or the username.
function seatLabel(seat: Seat): string {
  const { user, kind } = seats.value[seat];
  if (kind === 'me') {
    return 'You';
  }
  return kind === 'away' ? `${user!.username} · away` : user!.username;
}

// "North: robot-1 (robot)", "South: eve (admin)".
function seatTitle(seat: Seat): string {
  const { user, kind } = seats.value[seat];
  const tags = [kind === 'robot' && 'robot', user?.is_admin && 'admin', kind === 'away' && 'away']
    .filter(Boolean)
    .join(', ');
  return `${SEAT_NAMES[seat]}: ${user!.username}${tags ? ` (${tags})` : ''}`;
}
</script>

<style scoped>
.table-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
  box-shadow: 0 1px 0 var(--bridge-card-border);
}

.table-card-mine {
  box-shadow: inset 0 0 0 1.5px var(--bridge-action-line);
}

.table-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.table-card-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.table-card-name {
  overflow: hidden;
  font-size: 1rem;
  font-weight: 700;
  color: var(--bridge-ink);
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

a.table-card-name:hover {
  text-decoration: underline;
}

.table-card-meta {
  font-size: 0.8125rem;
  color: var(--bridge-muted);
}

.table-card-pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--bridge-radius-pill);
  font-size: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
}

.pill-wait {
  background: var(--bridge-action-tint);
  color: var(--bridge-action-text);
}

.pill-play {
  background: var(--bridge-navy-tint);
  color: var(--bridge-navy-tint-text);
}

.pill-robots {
  background: var(--bridge-redouble-bg);
  color: var(--bridge-redouble-text);
}

/* The mini compass: N top, W and E either side of a spade, S below. */
.compass {
  display: grid;
  grid-template-areas:
    '. n .'
    'w m e'
    '. s .';
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, 40px);
  gap: 4px;
  padding: 6px;
  border-radius: 12px;
  background: var(--bridge-ground);
}

.compass-N {
  grid-area: n;
}

.compass-E {
  grid-area: e;
}

.compass-S {
  grid-area: s;
}

.compass-W {
  grid-area: w;
}

.compass-middle {
  display: flex;
  grid-area: m;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
  color: var(--bridge-disabled-text);
}

.compass-cell {
  min-width: 0;
}

.compass-seat,
.compass-sit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 40px;
  padding: 0 6px;
  border-radius: 9px;
  font: 700 0.8125rem var(--bridge-font);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
}

.compass-seat {
  display: block;
  border: 0;
  background: var(--bridge-surface);
  color: var(--bridge-ink);
  line-height: 40px;
}

.compass-robot .compass-seat {
  background: var(--bridge-redouble-bg);
  color: var(--bridge-redouble-text);
}

.compass-away .compass-seat {
  background: var(--bridge-double-bg);
  color: var(--bridge-double-text);
}

.compass-me .compass-seat {
  background: var(--bridge-action-tint);
  color: var(--bridge-action-text);
}

.compass-sit {
  border: 1.5px dashed var(--bridge-action);
  background: var(--bridge-action-tint);
  color: var(--bridge-action-text);
}

.compass-sit:disabled {
  border-color: var(--bridge-control);
  background: var(--bridge-chip);
  color: var(--bridge-disabled-text);
  cursor: default;
}

/* Who watches, and Watch, under the compass. */
.table-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
}

.table-card-kibitzers {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  color: var(--bridge-muted);
}

.table-card-watch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 96px;
  height: 36px;
  margin-left: auto;
  padding: 0 14px;
  border: 1.5px solid var(--ion-color-primary);
  border-radius: var(--bridge-radius-pill);
  background: transparent;
  color: var(--ion-color-primary);
  font: 700 0.875rem var(--bridge-font);
  cursor: pointer;
}

/* The table we watch already: a tap goes back to it. */
.table-card-watch.is-watching {
  background: var(--bridge-navy-tint);
  color: var(--bridge-navy-tint-text);
  border-color: transparent;
}

.table-card-watch:disabled {
  border-color: var(--bridge-control);
  color: var(--bridge-disabled-text);
  cursor: default;
}

.table-card-watch ion-spinner,
.compass-sit ion-spinner {
  width: 18px;
  height: 18px;
}
</style>
