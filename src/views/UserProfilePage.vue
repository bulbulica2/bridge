<template>
  <ion-page>
    <AppHeader :title="profile ? profile.username : 'Player'" />
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="user-profile">
        <div v-if="notFound" class="gone">
          <p>This player doesn't exist.</p>
          <ion-button router-link="/tables" router-direction="back">Back to tables</ion-button>
        </div>

        <!-- Nothing to show yet: a big spinner where the profile will be. -->
        <div v-else-if="loading && !profile" class="loading" aria-busy="true">
          <ion-spinner name="crescent" />
          <p>Loading profile…</p>
        </div>

        <ion-text v-if="!notFound && loadError" color="danger">
          <p class="error">{{ loadError }}</p>
        </ion-text>

        <!-- A profile already in the store (the sheet loaded it) shows at once
             and refreshes in place. -->
        <template v-if="!notFound && profile">
          <div v-if="loading" class="refreshing">
            <ion-spinner name="crescent" />
            <span>Refreshing…</span>
          </div>

          <div class="card">
            <h2 class="profile-name">{{ profile.name }}</h2>
            <p class="profile-username">
              @{{ profile.username }}
              <AdminBadge v-if="profile.is_admin" />
            </p>
            <p v-if="profile.description" class="profile-description">{{ profile.description }}</p>
            <p v-else class="profile-empty">No description yet.</p>
          </div>

          <!-- Your own read GET /api/user/stats; nothing for a robot. -->
          <PlayerStats v-if="!profile.is_robot" ref="stats" :user-id="historyOwner" />

          <!-- Admins only: GET /users/{id} gives them the ban in force. -->
          <div v-if="profile.ban" class="card ban-card">
            <p class="ban-until">Banned until {{ banDate(profile.ban.until) }}</p>
            <p class="ban-reason">{{ profile.ban.reason }}</p>
            <p class="ban-by">
              Since {{ banDate(profile.ban.banned_at) }}<template v-if="profile.ban.banned_by">,
              by @{{ profile.ban.banned_by.username }}</template>
            </p>
            <ion-button size="small" fill="outline" :disabled="lifting" @click="lift">
              <ion-spinner v-if="lifting" name="crescent" />
              <span v-else>Lift ban</span>
            </ion-button>
          </div>

          <template v-if="canBan(auth.user, profile)">
            <div v-if="banning" class="card">
              <BanUserForm :user="profile" @banned="banning = false" @cancel="banning = false" />
            </div>
            <ion-button v-else expand="block" color="danger" fill="outline" class="ban-open" @click="banning = true">
              {{ profile.ban ? 'Ban again' : 'Ban' }}
            </ion-button>
          </template>

          <p v-if="isMe" class="profile-mine">
            This is you. Edit it on your <router-link to="/account">Account</router-link> page.
          </p>

          <ion-button
            expand="block"
            fill="outline"
            class="refresh"
            :disabled="loading"
            @click="load()"
          >
            Refresh
          </ion-button>

          <h3 class="boards-title">Boards played</h3>
          <HistoryList
            ref="history"
            :owner="historyOwner"
            :empty-text="isMe ? 'You haven\'t finished a board yet.' : 'No finished boards yet.'"
          />
        </template>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonButton,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonSpinner,
  onIonViewWillEnter,
  useIonRouter,
} from '@ionic/vue';
import AdminBadge from '@/components/AdminBadge.vue';
import AppHeader from '@/components/AppHeader.vue';
import BanUserForm from '@/components/BanUserForm.vue';
import HistoryList from '@/components/HistoryList.vue';
import PlayerStats from '@/components/PlayerStats.vue';
import { useUsersStore } from '@/stores/users';
import { useAuthStore } from '@/stores/auth';
import { banDate, canBan } from '@/utils/ban';
import { errorMessage, statusOf } from '@/utils/errors';
import { showToast } from '@/utils/toast';

const route = useRoute();
const ionRouter = useIonRouter();
const store = useUsersStore();
const auth = useAuthStore();

const userId = ref(0);
const loading = ref(false);
const loadError = ref('');
const notFound = ref(false);
// The admin's ban form is open, and a lift is on its way.
const banning = ref(false);
const lifting = ref(false);

const profile = computed(() => store.profiles[userId.value] ?? null);
const isMe = computed(() => !!userId.value && auth.user?.id === userId.value);
// Your own profile shares the "My boards" list (null); anyone else's is theirs.
const historyOwner = computed(() => (isMe.value ? null : userId.value));
const history = ref<InstanceType<typeof HistoryList> | null>(null);
const stats = ref<InstanceType<typeof PlayerStats> | null>(null);

// Ionic keeps the page alive, so read the param on every entry rather than at
// setup time — opening another player must not reuse the old id.
onIonViewWillEnter(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    userId.value = 0;
    notFound.value = true;
    return;
  }
  userId.value = id;
  notFound.value = false;
  banning.value = false;
  load();
});

// The profile, then (once it is up and the list follows the new id) their
// stats and the boards they played. Each says its own failures.
async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await store.load(userId.value);
    await nextTick();
    await Promise.all([stats.value?.load(), history.value?.load()]);
  } catch (e) {
    // A 401 here means the session expired after the router guard let us in.
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    if (statusOf(e) === 404) {
      notFound.value = true;
      return;
    }
    loadError.value = errorMessage(e, 'Could not load this profile. Please try again.');
  } finally {
    loading.value = false;
  }
}

// The user just logs in again to play: the ban already ended their sessions.
async function lift() {
  lifting.value = true;
  try {
    await store.liftBan(userId.value);
    await showToast('Ban lifted. They can play once they log in again.', 'success');
  } catch (e) {
    // 404: it had already ended or been lifted, and the store dropped it.
    await showToast(errorMessage(e, 'Could not lift the ban. Please try again.'), 'danger');
  } finally {
    lifting.value = false;
  }
}

async function refresh(event: CustomEvent) {
  if (userId.value) {
    await load();
  }
  (event.target as HTMLIonRefresherElement).complete();
}
</script>

<style scoped>
.user-profile {
  max-width: 520px;
  margin: 0 auto;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--ion-color-medium);
}

.loading ion-spinner {
  width: 48px;
  height: 48px;
}

.loading p {
  margin: 0;
}

.refreshing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 0 12px;
  color: var(--ion-color-medium);
  font-size: 0.9rem;
}

.refreshing ion-spinner {
  width: 18px;
  height: 18px;
}

.gone {
  padding: 32px 0;
  text-align: center;
}

.error {
  margin: 16px 0;
}

.card {
  padding: 16px;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 8px;
  margin-bottom: 16px;
}

.profile-name {
  margin: 0;
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
  margin: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.profile-empty {
  margin: 0;
  color: var(--ion-color-medium);
}

.profile-mine {
  margin: 0 0 16px;
  font-size: 0.9rem;
  text-align: center;
  color: var(--ion-color-medium);
}

.refresh {
  margin-top: 8px;
}

.ban-card {
  border-color: var(--ion-color-danger);
}

.ban-until {
  margin: 0 0 8px;
  font-weight: 600;
  color: var(--ion-color-danger);
}

.ban-reason {
  margin: 0 0 8px;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.ban-by {
  margin: 0 0 8px;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

.ban-open {
  margin-bottom: 16px;
}

.boards-title {
  margin: 24px 0 8px;
  font-size: 1.1rem;
  font-weight: 600;
}
</style>
