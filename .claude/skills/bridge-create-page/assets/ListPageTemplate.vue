<!--
  List page template (from src/views/TablesPage.vue): a collection loaded from
  the backend, rows rendered from the store, a "create" modal that adds to the
  list in place, pull-to-refresh, and per-row actions with a toast on failure.
  Use FormPageTemplate.vue instead for a single centered form.
-->
<template>
  <ion-page>
    <AppHeader title="__Title__" />
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="list-page">
        <ion-button expand="block" @click="createOpen = true">Create __item__</ion-button>

        <div v-if="loading" class="centered"><ion-spinner name="crescent" /></div>
        <ion-text v-else-if="loadError" color="danger"><p class="error">{{ loadError }}</p></ion-text>
        <p v-else-if="store.items.length === 0" class="empty">Nothing here yet.</p>

        <ion-list v-else>
          <ion-item v-for="item in store.items" :key="item.id" lines="full">
            <div class="row">
              <!-- row content; keep it in a plain div so row buttons stay clickable -->
            </div>
          </ion-item>
        </ion-list>
      </div>

      <ion-modal :is-open="createOpen" @did-dismiss="closeCreate">
        <ion-header>
          <ion-toolbar>
            <ion-title>Create __item__</ion-title>
            <ion-buttons slot="end"><ion-button @click="closeCreate">Cancel</ion-button></ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding">
          <form @submit.prevent="submitCreate">
            <ion-list>
              <ion-item>
                <ion-input v-model="name" type="text" label="Name" label-placement="stacked" />
              </ion-item>
            </ion-list>
            <ion-text v-if="createError" color="danger"><p class="error">{{ createError }}</p></ion-text>
            <ion-button type="submit" expand="block" :disabled="creating">
              <ion-spinner v-if="creating" name="crescent" />
              <span v-else>Create</span>
            </ion-button>
          </form>
        </ion-content>
      </ion-modal>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { isAxiosError } from 'axios';
import {
  IonPage, IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IonList, IonItem,
  IonInput, IonButton, IonModal, IonRefresher, IonRefresherContent, IonText, IonSpinner,
  onIonViewWillEnter, toastController, useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import { use__Domain__Store } from '@/stores/__domain__';

const store = use__Domain__Store();
const ionRouter = useIonRouter();

const loading = ref(false);
const loadError = ref('');
const createOpen = ref(false);
const creating = ref(false);
const createError = ref('');
const name = ref('');

// onIonViewWillEnter, not onMounted: Ionic keeps the page alive in the stack,
// so this is what re-fetches every time the user comes back to it.
onIonViewWillEnter(() => {
  load();
});

// Auth-required page: until issue #7's guard + session restore land, the
// backend's 401 is what sends a logged-out visitor to the login page.
async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await store.load();
  } catch (e) {
    if (isAxiosError(e) && e.response?.status === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    loadError.value = errorMessage(e, 'Could not load the list. Please try again.');
  } finally {
    loading.value = false;
  }
}

async function refresh(event: CustomEvent) {
  await load();
  (event.target as HTMLIonRefresherElement).complete();
}

function closeCreate() {
  createOpen.value = false;
  createError.value = '';
  name.value = '';
}

async function submitCreate() {
  createError.value = '';
  creating.value = true;
  try {
    await store.create({ name: name.value.trim() || null });
    closeCreate();
  } catch (e) {
    createError.value = errorMessage(e, 'Could not create it. Please try again.');
  } finally {
    creating.value = false;
  }
}

// Row actions fail against a list that may be stale (someone took the seat
// first), so report them with a toast instead of inline text.
async function showError(message: string) {
  const toast = await toastController.create({ message, duration: 4000, color: 'danger', position: 'bottom' });
  await toast.present();
}

// Game endpoints answer {status, message, data} (409s included); Laravel
// validation still answers 422 {message, errors: {field: [msg]}}.
function errorMessage(e: unknown, fallback: string): string {
  if (isAxiosError(e)) {
    if (!e.response) {
      return 'Cannot reach the server. Please try again later.';
    }
    const data = e.response.data as { message?: string; errors?: Record<string, string[]> };
    const firstError = data.errors && Object.values(data.errors)[0]?.[0];
    if (firstError || data.message) {
      return firstError || data.message!;
    }
  }
  return fallback;
}
</script>

<style scoped>
.list-page { max-width: 720px; margin: 0 auto; }
.centered { display: flex; justify-content: center; padding: 24px; }
.empty { color: var(--ion-color-medium); text-align: center; }
.error { margin: 8px 16px; }
.row { width: 100%; padding: 12px 0; }
</style>
