<template>
  <ion-page>
    <AppHeader :title="data ? `Set ${data.number}` : 'Set results'" />
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" v-ion-event:ion-refresh="refresh">
        <ion-refresher-content />
      </ion-refresher>

      <div class="set-page">
        <!-- A set you neither played nor finished every board of: the
             backend won't show it, since you might still be dealt them. -->
        <div v-if="gone" class="gone">
          <p>{{ gone }}</p>
          <ion-button router-link="/history" router-direction="back">My boards</ion-button>
        </div>

        <!-- Nothing to show yet: a big spinner where the results will be. -->
        <div v-else-if="loading && !data" class="loading" aria-busy="true">
          <ion-spinner name="crescent" />
          <p>Loading the set…</p>
        </div>

        <ion-text v-if="!gone && loadError" color="danger">
          <p class="error">{{ loadError }}</p>
        </ion-text>

        <template v-if="!gone && data">
          <div v-if="loading" class="refreshing">
            <ion-spinner name="crescent" />
            <span>Refreshing…</span>
          </div>

          <p class="set-info">
            {{ data.table_id !== null ? `Table ${data.table_id}` : 'Table closed' }} ·
            {{ when }}
          </p>
          <p class="set-players">
            <span>N-S {{ pair('N', 'S') }}</span>
            <span>E-W {{ pair('E', 'W') }}</span>
          </p>

          <SetResultsPanel :set="data" :my-seat="mySeat" />

          <ion-button
            expand="block"
            fill="outline"
            class="refresh"
            :disabled="loading"
            @click="load()"
          >
            Refresh
          </ion-button>
        </template>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
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
import { vIonEvent } from '@/directives/ionEvent';
import AppHeader from '@/components/AppHeader.vue';
import SetResultsPanel from '@/components/SetResultsPanel.vue';
import { useAuthStore } from '@/stores/auth';
import { useHistoryStore } from '@/stores/history';
import type { Seat } from '@/services/tables';
import { errorMessage, statusOf } from '@/utils/errors';
import { seatInSet } from '@/utils/sets';

const route = useRoute();
const ionRouter = useIonRouter();
const auth = useAuthStore();
const store = useHistoryStore();

const setId = ref(0);
const loading = ref(false);
const loadError = ref('');
// Why there is nothing to show (403, 404, a bad id), or ''.
const gone = ref('');

const data = computed(() => store.sets[setId.value] ?? null);

// Scores are turned to the viewer's side when they played the set (a robot
// may have finished it for them).
const mySeat = computed(() => (data.value ? seatInSet(data.value, auth.user?.id) : null));

const when = computed(() => {
  const at = data.value?.finished_at ?? data.value?.started_at;
  const date = at
    ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  return data.value?.finished ? `finished ${date}` : `started ${date}, still going on`;
});

function pair(a: Seat, b: Seat): string {
  const name = (seat: Seat) => data.value?.players[seat]?.username ?? '—';
  return `${name(a)} & ${name(b)}`;
}

// Ionic keeps the page alive, so read the param on every entry: opening
// another set must not reuse the old id.
onIonViewWillEnter(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    setId.value = 0;
    gone.value = "This set doesn't exist.";
    return;
  }
  setId.value = id;
  gone.value = '';
  load();
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await store.loadSet(setId.value);
  } catch (e) {
    const status = statusOf(e);
    // A 401 here means the session expired after the router guard let us in.
    if (status === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
    } else if (status === 403) {
      gone.value =
        "You can see a set's results if you played in it, or once you have finished all its boards yourself.";
    } else if (status === 404) {
      gone.value = "This set doesn't exist.";
    } else {
      loadError.value = errorMessage(e, 'Could not load the set. Please try again.');
    }
  } finally {
    loading.value = false;
  }
}

async function refresh(event: CustomEvent) {
  if (setId.value && !gone.value) {
    await load();
  }
  (event.target as HTMLIonRefresherElement).complete();
}
</script>

<style scoped>
.set-page {
  max-width: 640px;
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

.set-info {
  margin: 0;
  text-align: center;
  color: var(--ion-color-medium);
}

.set-players {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0 12px;
  margin: 2px 0 12px;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.refresh {
  margin-top: 8px;
}
</style>
