<!--
  Detail page template (from src/views/TableDetailPage.vue): one record
  addressed by a route param, loaded into the store's `current…`, with actions
  on it. Use ListPageTemplate.vue for the collection that links here.

  The four branches — loading / gone / error / content — matter: a record that
  the backend deletes (a table nobody sits at any more) is a normal end of life,
  not an error, and must read differently from "the request failed".
-->
<template>
  <ion-page>
    <AppHeader :title="headerTitle">
      <template #end>
        <ion-button router-link="/__collection__" router-direction="back">__Collection__</ion-button>
      </template>
    </AppHeader>
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="detail-page">
        <div v-if="loading" class="centered"><ion-spinner name="crescent" /></div>

        <div v-else-if="notFound" class="gone">
          <p>This __item__ no longer exists.</p>
          <ion-button router-link="/__collection__" router-direction="back">Back</ion-button>
        </div>

        <ion-text v-else-if="loadError" color="danger"><p class="error">{{ loadError }}</p></ion-text>

        <template v-else-if="item">
          <!-- content + per-item actions, each disabled while `busy` is set -->

          <!-- Pull-to-refresh can't be triggered with a mouse, so a desktop
               user needs a real button whenever the data goes stale on its own. -->
          <ion-button expand="block" fill="outline" :disabled="busy !== null" @click="load()">
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
  alertController,
  onIonViewWillEnter,
  toastController,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import { useThingsStore } from '@/stores/things';
import { errorMessage, statusOf } from '@/utils/errors';

const route = useRoute();
const ionRouter = useIonRouter();
const store = useThingsStore();

const itemId = ref(0);
const loading = ref(false);
const loadError = ref('');
const notFound = ref(false);
const busy = ref<string | null>(null);

// Only trust the store's current record when it is the one this route asks
// for, otherwise moving between two records flashes the previous one.
const item = computed(() =>
  store.currentThing && store.currentThing.id === itemId.value ? store.currentThing : null,
);
const headerTitle = computed(() => item.value?.name || '__Item__');

// Ionic keeps the page alive, so read the param on every entry, not at setup.
onIonViewWillEnter(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    // A nonsense URL is the same dead end as a deleted record, and asking the
    // backend about it would only produce a 404 anyway.
    itemId.value = 0;
    notFound.value = true;
    return;
  }
  itemId.value = id;
  notFound.value = false;
  load();
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await store.loadThing(itemId.value);
  } catch (e) {
    if (handleExpiredSession(e)) return;
    if (statusOf(e) === 404) {
      store.forget(itemId.value);
      notFound.value = true;
      return;
    }
    loadError.value = errorMessage(e, 'Could not load it. Please try again.');
  } finally {
    loading.value = false;
  }
}

async function refresh(event: CustomEvent) {
  if (itemId.value) await load();
  (event.target as HTMLIonRefresherElement).complete();
}

// Destructive actions confirm first, then re-load on failure: a 403/404/409
// here means the view went stale, and re-loading is what makes it honest again.
async function confirmAction() {
  const alert = await alertController.create({
    header: '__Do it?__',
    message: '__What will happen.__',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: '__Do it__', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive') return;
  // … call the store action, then handle the gone-case by navigating away
}

// A 401 here means the session expired after the router guard let us in.
function handleExpiredSession(e: unknown): boolean {
  if (statusOf(e) === 401) {
    ionRouter.navigate('/login', 'root', 'replace');
    return true;
  }
  return false;
}

async function showToast(message: string, color: 'danger' | 'success') {
  const toast = await toastController.create({ message, duration: 4000, color, position: 'bottom' });
  await toast.present();
}
</script>

<style scoped>
/* Detail pages cap their width like list pages; only forms are centered vertically. */
.detail-page {
  max-width: 520px;
  margin: 0 auto;
}

.centered {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}

.gone {
  padding: 32px 0;
  text-align: center;
}
</style>
