<template>
  <ion-page>
    <AppHeader title="Tables" />
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="tables-page">
        <ion-button expand="block" @click="createOpen = true">Create table</ion-button>

        <!-- First visit: skeleton rows where the list will be. -->
        <ion-list v-if="loading && !tablesStore.loaded" aria-busy="true">
          <ion-item v-for="n in 3" :key="n" lines="full">
            <div class="table-row">
              <ion-skeleton-text animated class="skeleton-title" />
              <div class="seats">
                <ion-skeleton-text v-for="s in 4" :key="s" animated class="skeleton-seat" />
              </div>
            </div>
          </ion-item>
        </ion-list>

        <template v-else>
          <!-- Later visits keep the list from last time while it refreshes. -->
          <div v-if="loading" class="refreshing">
            <ion-spinner name="crescent" />
            <span>Refreshing…</span>
          </div>

          <ion-text v-if="loadError" color="danger">
            <p class="error">{{ loadError }}</p>
          </ion-text>

          <p v-if="tablesStore.loaded && tablesStore.tables.length === 0" class="empty">
            No tables yet. Create the first one.
          </p>

          <ion-list v-else-if="tablesStore.tables.length > 0">
            <ion-item v-for="table in tablesStore.tables" :key="table.id" lines="full">
              <div class="table-row">
                <div class="table-heading">
                  <h2 class="table-title">
                    <span class="table-id">#{{ table.id }}</span>
                    {{ table.name || 'Unnamed table' }}
                  </h2>
                  <!-- An explicit link, not a tappable row: the row already owns
                       four seat buttons, and a button inside a button swallows
                       their taps. -->
                  <ion-button
                    fill="clear"
                    size="small"
                    :router-link="`/tables/${table.id}`"
                    router-direction="forward"
                  >
                    Open
                    <ion-icon slot="end" :icon="chevronForwardOutline" />
                  </ion-button>
                </div>
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
        </template>
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
  IonIcon,
  IonModal,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonSpinner,
  IonSkeletonText,
  onIonViewWillEnter,
  useIonRouter,
} from '@ionic/vue';
import { chevronForwardOutline } from 'ionicons/icons';
import AppHeader from '@/components/AppHeader.vue';
import { useTablesStore } from '@/stores/tables';
import { seatsOf } from '@/services/tables';
import type { Seat } from '@/services/tables';
import { errorMessage, statusOf } from '@/utils/errors';
import { showToast } from '@/utils/toast';

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
    if (statusOf(e) === 401) {
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

function isJoining(tableId: number, seat: Seat) {
  return joining.value === `${tableId}-${seat}`;
}

async function join(tableId: number, seat: Seat) {
  joining.value = `${tableId}-${seat}`;
  try {
    await tablesStore.join(tableId, seat);
  } catch (e) {
    // 409 when the seat was taken meanwhile or you already sit somewhere.
    await showToast(errorMessage(e, 'Could not take that seat. Please try again.'), 'danger');
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

</script>

<style scoped>
.tables-page {
  max-width: 720px;
  margin: 0 auto;
}

.refreshing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  color: var(--ion-color-medium);
  font-size: 0.9rem;
}

.refreshing ion-spinner {
  width: 18px;
  height: 18px;
}

.skeleton-title {
  width: 40%;
  height: 18px;
  margin: 0 0 10px;
}

.skeleton-seat {
  width: 120px;
  height: 28px;
  border-radius: 6px;
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
