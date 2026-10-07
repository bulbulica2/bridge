<template>
  <!-- A seated player off the table (#163: StartBox, the table's page), in
       the table's plate look: avatar, name over "North · you", a robot or an
       admin marked, the green tick once they pressed Start ("West · ready"),
       and red with the clock to the robot while they are away. With
       `selectable` the name opens their profile. -->
  <div
    class="seat-plate"
    :class="{ 'seat-plate-away': !!away, 'seat-plate-mine': mine, 'seat-plate-ready': ready && !away }"
  >
    <PlayerAvatar :user="user" :away="!!away" />
    <span class="plate-text">
      <span class="plate-name">
        <button
          v-if="selectable"
          type="button"
          class="seat-user"
          :aria-label="`${user.username}'s profile`"
          @click="emit('select', user)"
        >
          {{ user.username }}
        </button>
        <span v-else class="seat-user">{{ user.username }}</span>
        <AdminBadge v-if="user.is_admin" />
      </span>
      <span class="plate-sub">
        <span class="seat-name">{{ SEAT_NAMES[seat] }}</span>
        <span v-if="mine" class="seat-you">· you</span>
        <span v-if="user.is_robot" class="plate-robot">· robot</span>
        <AwaySeatTag v-if="away" class="seat-away" :tag="away" />
        <span v-else-if="ready" class="plate-ready">· ready</span>
      </span>
    </span>
    <span v-if="ready && !away" class="seat-plate-tick" title="Pressed Start" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12l5 5 9-10" />
      </svg>
    </span>
  </div>
</template>

<script setup lang="ts">
import AdminBadge from '@/components/AdminBadge.vue';
import AwaySeatTag from '@/components/AwaySeatTag.vue';
import PlayerAvatar from '@/components/PlayerAvatar.vue';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES } from '@/utils/auction';
import type { AwayTag } from '@/utils/away';

withDefaults(
  defineProps<{
    user: PublicUser;
    seat: Seat;
    // The viewer's own seat.
    mine?: boolean;
    // Pressed Start (a robot always has).
    ready?: boolean;
    // Away mid-set, with the clock to the robot taking the seat.
    away?: AwayTag | null;
    // The name is a button opening the player's profile.
    selectable?: boolean;
  }>(),
  { mine: false, ready: false, away: null, selectable: false },
);

const emit = defineEmits<{ select: [user: PublicUser] }>();
</script>

<style scoped>
.seat-plate {
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 52px;
  padding: 8px 12px 8px 8px;
  border-radius: 14px;
  background: var(--bridge-plate);
  color: var(--bridge-on-plate);
  text-align: left;
}

.seat-plate-mine {
  box-shadow: 0 0 0 2px var(--bridge-action);
}

.seat-plate-away {
  background: var(--bridge-plate-away);
}

.plate-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.plate-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.seat-user {
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button.seat-user {
  cursor: pointer;
}

button.seat-user:hover,
button.seat-user:focus-visible {
  text-decoration: underline;
  text-underline-offset: 2px;
}

button.seat-user:focus-visible {
  outline: 2px solid var(--bridge-amber);
  outline-offset: 2px;
}

.plate-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 4px;
  font-size: 0.75rem;
  color: var(--bridge-on-plate-muted);
}

.seat-plate-ready .plate-ready {
  color: var(--bridge-on-table-good);
}

.seat-plate-away .plate-sub {
  color: var(--bridge-on-plate-away);
}

.seat-away {
  --away-tag-color: var(--bridge-on-plate-away);
  --away-tag-urgent: var(--bridge-on-plate);
}

.seat-plate-tick {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--bridge-ready);
  color: var(--bridge-on-ready);
}

.seat-plate-tick svg {
  width: 14px;
  height: 14px;
}
</style>
