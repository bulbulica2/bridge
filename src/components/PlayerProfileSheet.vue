<template>
  <!-- A bottom sheet over the table: the player's public profile in one tap.
       The parent owns which player is open and clears it on close. At the
       game table a manager takes the player out from here (`removable`,
       the `remove` event: #181, no Remove on the table itself). -->
  <ion-modal
    :is-open="player !== null"
    :initial-breakpoint="0.5"
    :breakpoints="[0, 0.5, 0.9]"
    @did-dismiss="emit('close')"
  >
    <ion-content class="ion-padding">
      <div v-if="shown" class="profile">
        <!-- The plate's avatar, large (#163). -->
        <PlayerAvatar :user="shown" class="profile-avatar" />
        <h2 class="profile-name">{{ shown.name }}</h2>
        <p class="profile-username">
          @{{ shown.username }}
          <RobotBadge v-if="shown.is_robot" />
          <AdminBadge v-if="shown.is_admin" />
        </p>

        <p v-if="gone" class="profile-gone">This player's account no longer exists.</p>
        <template v-else>
          <!-- The embedded copy has no description (bridge_backend
               docs/API.md, Message size): it shows once GET /users/{id} is in. -->
          <p v-if="shown.description" class="profile-description">{{ shown.description }}</p>
          <p v-else-if="shown.description === null" class="profile-empty">No description yet.</p>
          <!-- One line of their stats; a robot has none worth showing. -->
          <PlayerStats v-if="!shown.is_robot" ref="stats" :user-id="shown.id" compact />
          <!-- A robot's system at a glance (#203), to answer it as partner. -->
          <section v-else class="robot-system" :aria-labelledby="systemId">
            <h3 :id="systemId" class="robot-system-title">{{ ROBOT_SYSTEM_TITLE }}</h3>
            <ul class="robot-system-list">
              <li v-for="line in ROBOT_SYSTEM" :key="line">{{ line }}</li>
            </ul>
            <p class="robot-system-note">{{ ROBOT_ALERTS_NOTE }}</p>
          </section>
        </template>

        <div v-if="refreshing" class="refreshing">
          <ion-spinner name="crescent" />
          <span>Refreshing…</span>
        </div>
        <ion-text v-if="loadError" color="danger">
          <p class="error">{{ loadError }}</p>
        </ion-text>

        <!-- Admins only: the ban in force (GET /users/{id} gives it to them),
             and the form to ban this player. Lifting is on the full profile. -->
        <p v-if="!gone && shown.ban" class="profile-banned">
          Banned until {{ banDate(shown.ban.until) }}: {{ shown.ban.reason }}
        </p>
        <template v-if="!gone && canBan(auth.user, shown)">
          <BanUserForm v-if="banning" :user="shown" class="ban-form" @banned="onBanned" @cancel="banning = false" />
          <ion-button v-else expand="block" color="danger" fill="outline" class="ban-open" @click="banning = true">
            {{ shown.ban ? 'Ban again' : 'Ban' }}
          </ion-button>
        </template>

        <!-- The page confirms and sends it (canRemove said it may). Mid-set
             it is greyed out (`removeBlocked`, #190): tapped or hovered, it
             says why in a small pop-up above it (usePopover), which is also
             its description for a screen reader, and removes nobody. -->
        <div
          v-if="removable"
          ref="root"
          class="profile-remove-peek"
          @pointerenter="removeBlocked && hover(true, $event)"
          @pointerleave="hover(false, $event)"
        >
          <ion-button
            :ref="setButton"
            expand="block"
            :color="removeBlocked ? 'medium' : 'danger'"
            fill="outline"
            class="profile-remove"
            :class="{ 'is-locked': removeBlocked }"
            :disabled="busy && !removeBlocked"
            :aria-disabled="removeBlocked ? 'true' : undefined"
            :aria-describedby="removeBlocked ? noteId : undefined"
            :aria-expanded="removeBlocked ? open : undefined"
            @click="tapRemove"
          >
            <ion-spinner v-if="busy && !removeBlocked" name="crescent" />
            <span v-else>Remove from the table</span>
          </ion-button>
          <!-- Always there while blocked, so the button's aria-describedby
               finds it; shown only while open. -->
          <span
            v-if="removeBlocked"
            v-show="open"
            :id="noteId"
            ref="popup"
            class="profile-remove-note"
            role="tooltip"
            :style="{ '--nudge': `${nudge}px`, '--drop': `${drop}px` }"
          >
            <span class="profile-remove-box">{{ REMOVE_BLOCKED_TEXT }}</span>
          </span>
        </div>

        <!-- A robot has no page of its own: nothing more to see there. -->
        <ion-button v-if="!gone && !shown.is_robot" expand="block" fill="outline" @click="openPage">
          Full profile
        </ion-button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue';
import { IonModal, IonContent, IonButton, IonSpinner, IonText, useIonRouter } from '@ionic/vue';
import BanUserForm from '@/components/BanUserForm.vue';
import AdminBadge from '@/components/AdminBadge.vue';
import PlayerAvatar from '@/components/PlayerAvatar.vue';
import PlayerStats from '@/components/PlayerStats.vue';
import RobotBadge from '@/components/RobotBadge.vue';
import { usePopover } from '@/composables/usePopover';
import { useAuthStore } from '@/stores/auth';
import { useUsersStore } from '@/stores/users';
import type { PublicUser } from '@/services/users';
import { banDate, canBan } from '@/utils/ban';
import { errorMessage, statusOf } from '@/utils/errors';
import { ROBOT_ALERTS_NOTE, ROBOT_SYSTEM, ROBOT_SYSTEM_TITLE } from '@/utils/robots';
import { REMOVE_BLOCKED_TEXT } from '@/utils/seatMove';

const props = withDefaults(
  defineProps<{
    player: PublicUser | null;
    // The viewer may take this player out of the table (canRemove).
    removable?: boolean;
    // ...but not now: the set is running (removeBlocked, #190).
    removeBlocked?: boolean;
    // That removal on its way.
    busy?: boolean;
  }>(),
  { removable: false, removeBlocked: false, busy: false },
);
const emit = defineEmits<{ close: []; remove: [player: PublicUser] }>();

const store = useUsersStore();
const auth = useAuthStore();
const ionRouter = useIonRouter();

// Starts as the copy the table payload embedded, so the sheet has something to
// show the moment it opens, then is replaced by GET /users/{id}.
const shown = ref<PublicUser | null>(null);
const refreshing = ref(false);
const loadError = ref('');
const gone = ref(false);
// An admin has the ban form open.
const banning = ref(false);
const stats = ref<InstanceType<typeof PlayerStats> | null>(null);

const { root, button, popup, open, nudge, drop, hover, toggle, close } = usePopover();
const noteId = `remove-blocked-${useId()}`;
const systemId = `robot-system-${useId()}`;

// The ion-button's element, for the pop-up's Escape to give focus back to.
function setButton(el: unknown) {
  button.value = (el as { $el?: HTMLElement } | null)?.$el ?? null;
}

// Blocked, a tap says why; else the page confirms and removes.
function tapRemove() {
  if (props.removeBlocked) {
    toggle();
  } else if (props.player) {
    emit('remove', props.player);
  }
}

// The set is over (or another player opened): nothing left to explain.
watch(
  () => [props.removeBlocked, props.player] as const,
  ([blocked]) => {
    if (!blocked) {
      close();
    }
  },
);

watch(
  () => props.player,
  async (player) => {
    if (!player) {
      return;
    }
    shown.value = player;
    gone.value = false;
    banning.value = false;
    loadError.value = '';
    refreshing.value = true;
    // The stats line reads by itself, beside the profile (failures said there).
    nextTick(() => stats.value?.load());
    try {
      const fresh = await store.load(player.id);
      // Another player may have been tapped while this one loaded.
      if (props.player?.id === player.id) {
        shown.value = fresh;
      }
    } catch (e) {
      if (props.player?.id !== player.id) {
        return;
      }
      if (statusOf(e) === 404) {
        gone.value = true;
      } else {
        // The embedded copy is still worth showing; just say it may be stale.
        loadError.value = errorMessage(e, 'Could not refresh this profile.');
      }
    } finally {
      if (props.player?.id === player.id) {
        refreshing.value = false;
      }
    }
  },
  { immediate: true },
);

// The store put the ban on the cached profile; show that copy.
function onBanned() {
  banning.value = false;
  if (shown.value && store.profiles[shown.value.id]) {
    shown.value = store.profiles[shown.value.id];
  }
}

function openPage() {
  const id = shown.value?.id;
  emit('close');
  if (id) {
    ionRouter.navigate(`/users/${id}`, 'forward');
  }
}
</script>

<style scoped>
.profile {
  max-width: 520px;
  margin: 0 auto;
  text-align: center;
}

.profile-avatar {
  --avatar-size: 64px;
  margin: 8px auto 0;
  box-shadow: 0 0 0 4px var(--bridge-plate);
  background: var(--bridge-plate);
  color: var(--bridge-on-plate);
}

.profile-avatar.player-avatar-robot {
  background: var(--bridge-avatar-robot);
  color: var(--bridge-avatar-ink);
}

.profile-name {
  margin: 12px 0 0;
  font-size: 1.3rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.profile-username {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 4px 0 16px;
  color: var(--bridge-muted);
  overflow-wrap: anywhere;
}

.profile-description {
  margin: 0 0 16px;
  white-space: pre-line;
  overflow-wrap: anywhere;
  text-align: left;
}

.robot-system {
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
  box-shadow: 0 1px 0 var(--bridge-line);
  text-align: left;
}

.robot-system-title {
  margin: 0 0 6px;
  font-size: 1rem;
  font-weight: 700;
}

.robot-system-list {
  margin: 0;
  padding-left: 20px;
  line-height: 1.5;
}

.robot-system-note {
  margin: 8px 0 0;
  color: var(--bridge-muted);
  font-size: 0.9rem;
}

.profile-empty,
.profile-gone {
  margin: 0 0 16px;
  color: var(--bridge-muted);
}

.refreshing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--bridge-muted);
  font-size: 0.9rem;
}

.refreshing ion-spinner {
  width: 18px;
  height: 18px;
}

.error {
  margin: 0 0 12px;
}

.profile-banned {
  margin: 0 0 12px;
  color: var(--ion-color-danger);
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.ban-form,
.ban-open,
.profile-remove-peek {
  margin-bottom: 12px;
}

.profile-remove-peek {
  position: relative;
}

/* Mid-set: grey like a disabled outline button, but it still answers a tap. */
.profile-remove.is-locked {
  --border-color: var(--bridge-line);
  --color: var(--bridge-disabled-text);
  --ion-color-base: var(--bridge-disabled-text);
  cursor: help;
}

/* Above the button; kept clear of the screen's edges. */
.profile-remove-note {
  position: absolute;
  bottom: 100%;
  left: 50%;
  z-index: 30;
  box-sizing: border-box;
  width: min(280px, calc(100vw - 16px));
  padding-bottom: 8px;
  transform: translate(calc(-50% + var(--nudge, 0px)), var(--drop, 0px));
}

.profile-remove-box {
  display: block;
  padding: 10px 12px;
  border-radius: var(--bridge-radius-button);
  background: var(--bridge-popup);
  color: var(--bridge-on-popup);
  box-shadow: 0 4px 16px var(--bridge-shadow-strong);
  font-size: 0.875rem;
  line-height: 1.35;
  text-align: left;
}

/* The sheet's buttons: Daylight's 48 px, side by side with room. */
.profile ion-button {
  margin-inline: 0;
}
</style>
