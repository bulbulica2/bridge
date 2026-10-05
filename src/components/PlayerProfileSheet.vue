<template>
  <!-- A bottom sheet over the table: the player's public profile in one tap.
       The parent owns which player is open and clears it on close. -->
  <ion-modal
    :is-open="player !== null"
    :initial-breakpoint="0.5"
    :breakpoints="[0, 0.5, 0.9]"
    @did-dismiss="emit('close')"
  >
    <ion-content class="ion-padding">
      <div v-if="shown" class="profile">
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

        <!-- A robot has no page of its own: nothing more to see there. -->
        <ion-button v-if="!gone && !shown.is_robot" expand="block" fill="outline" @click="openPage">
          Full profile
        </ion-button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { IonModal, IonContent, IonButton, IonSpinner, IonText, useIonRouter } from '@ionic/vue';
import BanUserForm from '@/components/BanUserForm.vue';
import AdminBadge from '@/components/AdminBadge.vue';
import PlayerStats from '@/components/PlayerStats.vue';
import RobotBadge from '@/components/RobotBadge.vue';
import { useAuthStore } from '@/stores/auth';
import { useUsersStore } from '@/stores/users';
import type { PublicUser } from '@/services/users';
import { banDate, canBan } from '@/utils/ban';
import { errorMessage, statusOf } from '@/utils/errors';

const props = defineProps<{ player: PublicUser | null }>();
const emit = defineEmits<{ close: [] }>();

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

.profile-name {
  margin: 8px 0 0;
  font-size: 1.3rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.profile-username {
  margin: 4px 0 16px;
  color: var(--ion-color-medium);
  overflow-wrap: anywhere;
}

.profile-description {
  margin: 0 0 16px;
  white-space: pre-line;
  overflow-wrap: anywhere;
  text-align: left;
}

.profile-empty,
.profile-gone {
  margin: 0 0 16px;
  color: var(--ion-color-medium);
}

.refreshing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--ion-color-medium);
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
.ban-open {
  margin-bottom: 12px;
}
</style>
