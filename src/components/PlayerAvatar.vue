<template>
  <!-- A player's round avatar (#163, the component kit's seats): the first
       two letters of their username ("bulbulica" reads BU), or a robot's
       icon. White in both modes, the plates' navy ink on it. -->
  <span
    class="player-avatar"
    :class="{ 'player-avatar-robot': user.is_robot, 'player-avatar-away': away }"
    :title="user.is_robot ? 'Robot player' : undefined"
    aria-hidden="true"
  >
    <svg
      v-if="user.is_robot"
      class="player-avatar-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 4v4M9 13h.01M15 13h.01" />
    </svg>
    <template v-else>{{ user.username.slice(0, 2).toUpperCase() }}</template>
  </span>
</template>

<script setup lang="ts">
import type { PublicUser } from '@/services/users';

withDefaults(
  defineProps<{
    user: Pick<PublicUser, 'username' | 'is_robot'>;
    // Away mid-set: the red avatar of an away plate.
    away?: boolean;
  }>(),
  { away: false },
);
</script>

<style scoped>
.player-avatar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--avatar-size, 34px);
  height: var(--avatar-size, 34px);
  border-radius: 50%;
  background: var(--bridge-avatar);
  color: var(--bridge-avatar-ink);
  font-size: calc(var(--avatar-size, 34px) * 0.36);
  font-weight: 700;
}

.player-avatar-robot {
  background: var(--bridge-avatar-robot);
}

.player-avatar-away {
  background: var(--bridge-avatar-away);
  color: var(--bridge-avatar-away-ink);
}

.player-avatar-icon {
  width: 52%;
  height: 52%;
}
</style>
