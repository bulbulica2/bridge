<template>
  <ion-page>
    <AppHeader title="Tables" />
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="tables-page">
        <ion-button expand="block" @click="createOpen = true">Create table</ion-button>

        <div v-if="loading" class="centered">
          <ion-spinner name="crescent" />
        </div>

        <ion-text v-else-if="loadError" color="danger">
          <p class="error">{{ loadError }}</p>
        </ion-text>

        <p v-else-if="tablesStore.tables.length === 0" class="empty">
          No tables yet. Create the first one.
        </p>

        <ion-list v-else>
          <ion-item v-for="table in tablesStore.tables" :key="table.id" lines="full">
            <div class="table-row">
              <h2 class="table-title">
                <span class="table-id">#{{ table.id }}</span>
                {{ table.name || 'Unnamed table' }}
              </h2>
              <div class="seats">
                <div v-for="{ seat, user } in seatsOf(table)" :key="seat" class="seat">
                  <span class="seat-name">{{ seat }}</span>
                  <span v-if="user" class="seat-user">{{ user.username }}</span>
                  <ion-button
                    v-else
                    size="small"
                    fill="outline"
                    :disabled="joining !== null"
                    @click="join(table.id, seat)"
                  >
                    <ion-spinner v-if="isJoining(table.id, seat)" name="crescent" />
                    <span v-else>empty</span>
                  </ion-button>
                </div>
              </div>
            </div>
          </ion-item>
        </ion-list>
      </div>

      <ion-modal :is-open="createOpen" @did-dismiss="closeCreate">
        <ion-header>
          <ion-toolbar>
            <ion-title>Create table</ion-title>
            <ion-buttons slot="end">
              <ion-button @click="closeCreate">Cancel</ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding">
          <form @submit.prevent="submitCreate">
            <ion-list>
              <ion-item>
                <ion-input
                  v-model="name"
                  type="text"
                  label="Table name"
                  label-placement="stacked"
                  placeholder="Friday club"
                />
              </ion-item>
            </ion-list>

            <ion-text v-if="createError" color="danger">
              <p class="error">{{ createError }}</p>
            </ion-text>

            <ion-button type="submit" expand="block" :disabled="creating">
              <ion-spinner v-if="creating" name="crescent" />
              <span v-else>Create table</span>
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
  IonPage,
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonList,
  IonItem,
  IonInput,
  IonButton,
  IonModal,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonSpinner,
  onIonViewWillEnter,
  toastController,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import { useTablesStore } from '@/stores/tables';
import { SEATS } from '@/services/tables';
import type { Seat, Table } from '@/services/tables';

const tablesStore = useTablesStore();
const ionRouter = useIonRouter();

const loading = ref(false);
const loadError = ref('');
const joining = ref<string | null>(null);
const createOpen = ref(false);
const creating = ref(false);
const createError = ref('');
const name = ref('');

// The router guard (meta.requiresAuth) already keeps guests out; this only
// re-fetches the list every time the page is shown.
onIonViewWillEnter(() => {
  load();
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await tablesStore.load();
  } catch (e) {
    // A 401 here means the session expired while the page was open.
    if (isAxiosError(e) && e.response?.status === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    loadError.value = errorMessage(e, 'Could not load the tables. Please try again.');
  } finally {
    loading.value = false;
  }
}

async function refresh(event: CustomEvent) {
  await load();
  (event.target as HTMLIonRefresherElement).complete();
}

// Always N, E, S, W, so every row shows the four seats in the same order.
function seatsOf(table: Table) {
  return SEATS.map((seat) => ({
    seat,
    user: table.seats.find((s) => s.seat === seat)?.user ?? null,
  }));
}

function isJoining(tableId: number, seat: Seat) {
  return joining.value === `${tableId}-${seat}`;
}

async function join(tableId: number, seat: Seat) {
  joining.value = `${tableId}-${seat}`;
  try {
    await tablesStore.join(tableId, seat);
  } catch (e) {
    // 409 when the seat was taken meanwhile or you already sit somewhere.
    await showError(errorMessage(e, 'Could not take that seat. Please try again.'));
  } finally {
    joining.value = null;
  }
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
    // The name is optional; an empty field means an unnamed table.
    await tablesStore.create({ name: name.value.trim() || null });
    closeCreate();
  } catch (e) {
    createError.value = errorMessage(e, 'Could not create the table. Please try again.');
  } finally {
    creating.value = false;
  }
}

async function showError(message: string) {
  const toast = await toastController.create({
    message,
    duration: 4000,
    color: 'danger',
    position: 'bottom',
  });
  await toast.present();
}

// Game endpoints send {status, message, data} (409s included); Laravel
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
.tables-page {
  max-width: 720px;
  margin: 0 auto;
}

.centered {
  display: flex;
  justify-content: center;
  padding: 24px;
}

.empty {
  color: var(--ion-color-medium);
  text-align: center;
}

.error {
  margin: 8px 16px;
}

.table-row {
  width: 100%;
  padding: 12px 0;
}

.table-title {
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 600;
}

.table-id {
  color: var(--ion-color-medium);
  margin-right: 6px;
}

.seats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.seat {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 120px;
}

.seat-name {
  font-weight: 600;
  color: var(--ion-color-medium);
}

.seat-user {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
