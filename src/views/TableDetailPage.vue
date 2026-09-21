<template>
  <ion-page>
    <AppHeader :title="headerTitle">
      <template #end>
        <ion-button router-link="/tables" router-direction="back">Tables</ion-button>
      </template>
    </AppHeader>
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="table-detail">
        <div v-if="loading" class="centered">
          <ion-spinner name="crescent" />
        </div>

        <!-- A table lives only while somebody sits at it, so a dead id is the
             normal end of a table's life, not an error worth shouting about. -->
        <div v-else-if="notFound" class="gone">
          <p>This table no longer exists.</p>
          <ion-button router-link="/tables" router-direction="back">Back to tables</ion-button>
        </div>

        <ion-text v-else-if="loadError" color="danger">
          <p class="error">{{ loadError }}</p>
        </ion-text>

        <template v-else-if="table">
          <div class="compass">
            <div
              v-for="{ seat, user } in seats"
              :key="seat"
              class="seat"
              :class="[`seat-${seat.toLowerCase()}`, { 'seat-mine': user && user.id === me }]"
            >
              <span class="seat-name">{{ seat }}</span>

              <span v-if="user" class="seat-user">
                {{ user.username }}
                <span v-if="user.id === me" class="seat-you">you</span>
              </span>
              <span v-else class="seat-empty">Empty</span>

              <ion-button
                v-if="user && user.id === me"
                size="small"
                fill="outline"
                color="danger"
                :disabled="busySeat !== null"
                @click="confirmLeave(seat)"
              >
                <ion-spinner v-if="busySeat === seat" name="crescent" />
                <span v-else>Leave</span>
              </ion-button>

              <!-- No "sit" button on the other free seats once you hold one:
                   a seat is unique per user across every table, so a second
                   one is a guaranteed 409. -->
              <ion-button
                v-else-if="!user && !mySeat"
                size="small"
                fill="outline"
                :disabled="busySeat !== null"
                @click="sit(seat)"
              >
                <ion-spinner v-if="busySeat === seat" name="crescent" />
                <span v-else>Sit here</span>
              </ion-button>

              <!-- Managers only; the backend has the final say (403). -->
              <ion-button
                v-else-if="user && isManager"
                size="small"
                fill="clear"
                color="danger"
                :disabled="busySeat !== null"
                @click="confirmRemove(seat, user)"
              >
                <ion-spinner v-if="busySeat === seat" name="crescent" />
                <span v-else>Remove</span>
              </ion-button>
            </div>

            <div class="table-info">
              <h2 class="table-title">{{ table.name || 'Unnamed table' }}</h2>
              <p class="table-id">#{{ table.id }}</p>
              <p v-if="managerName" class="table-manager">Manager: {{ managerName }}</p>
              <p v-if="isManager" class="table-yours">You manage this table</p>
            </div>
          </div>

          <ion-button
            expand="block"
            fill="outline"
            class="refresh"
            :disabled="busySeat !== null"
            @click="load()"
          >
            Refresh
          </ion-button>
          <p class="hint">Seats update when you refresh — there are no live updates yet.</p>
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
import { useTablesStore } from '@/stores/tables';
import { useAuthStore } from '@/stores/auth';
import { canManage, seatsOf } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { User } from '@/services/auth';
import { errorMessage, statusOf } from '@/utils/errors';

const route = useRoute();
const ionRouter = useIonRouter();
const store = useTablesStore();
const auth = useAuthStore();

const tableId = ref(0);
const loading = ref(false);
const loadError = ref('');
const notFound = ref(false);
// One seat action at a time, so the whole compass locks while a request is out.
const busySeat = ref<Seat | null>(null);

// Only trust the store's current table when it is the one this route asks for,
// otherwise moving from one table to another flashes the previous one.
const table = computed(() =>
  store.currentTable && store.currentTable.id === tableId.value ? store.currentTable : null,
);
const me = computed(() => auth.user?.id ?? null);
const seats = computed(() => (table.value ? seatsOf(table.value) : []));
const mySeat = computed(
  () => table.value?.seats.find((s) => s.user_id === me.value)?.seat ?? null,
);
const isManager = computed(() => !!table.value && canManage(table.value, me.value));
const managerName = computed(() => {
  const current = table.value;
  if (!current) {
    return null;
  }
  return current.seats.find((s) => s.user_id === current.moderated_by)?.user.username ?? null;
});
const headerTitle = computed(
  () => table.value?.name || (tableId.value ? `Table #${tableId.value}` : 'Table'),
);

// Ionic keeps the page alive, so read the param on every entry rather than at
// setup time — arriving at a different table must not reuse the old id.
onIonViewWillEnter(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    // A nonsense URL is the same dead end as a deleted table, and asking the
    // backend about it would only produce a 404 anyway.
    tableId.value = 0;
    notFound.value = true;
    return;
  }
  tableId.value = id;
  notFound.value = false;
  load();
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await store.loadTable(tableId.value);
  } catch (e) {
    if (handleExpiredSession(e)) {
      return;
    }
    if (statusOf(e) === 404) {
      store.forget(tableId.value);
      notFound.value = true;
      return;
    }
    loadError.value = errorMessage(e, 'Could not load the table. Please try again.');
  } finally {
    loading.value = false;
  }
}

async function refresh(event: CustomEvent) {
  if (tableId.value) {
    await load();
  }
  (event.target as HTMLIonRefresherElement).complete();
}

async function sit(seat: Seat) {
  busySeat.value = seat;
  try {
    await store.join(tableId.value, seat);
  } catch (e) {
    if (!handleExpiredSession(e)) {
      // 409 when somebody got there first, or you already hold a seat somewhere.
      await showToast(errorMessage(e, 'Could not take that seat. Please try again.'), 'danger');
      await load();
    }
  } finally {
    busySeat.value = null;
  }
}

async function confirmLeave(seat: Seat) {
  const alert = await alertController.create({
    header: 'Leave this table?',
    message: 'Your seat will be freed. If nobody is left, the table is deleted.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Leave', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive') {
    return;
  }

  busySeat.value = seat;
  try {
    const { tableDeleted } = await store.leave(tableId.value);
    if (tableDeleted) {
      // The id 404s from here on, so go back to the list instead of reloading.
      await showToast('You left the table. Nobody was left, so it was deleted.', 'success');
      ionRouter.navigate('/tables', 'back', 'replace');
    }
  } catch (e) {
    if (!handleExpiredSession(e)) {
      await showToast(errorMessage(e, 'Could not leave the table. Please try again.'), 'danger');
      await load();
    }
  } finally {
    busySeat.value = null;
  }
}

async function confirmRemove(seat: Seat, user: User) {
  const alert = await alertController.create({
    header: `Remove ${user.username}?`,
    message: `${user.username} loses seat ${seat}. They can sit down again afterwards.`,
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Remove', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive') {
    return;
  }

  busySeat.value = seat;
  try {
    const { tableDeleted } = await store.removePlayer(tableId.value, user.id);
    if (tableDeleted) {
      // Can't normally happen (a manager is still seated), but the id is dead.
      await showToast(`${user.username} was removed and the table was deleted.`, 'success');
      ionRouter.navigate('/tables', 'back', 'replace');
      return;
    }
    await showToast(`${user.username} was removed from the table.`, 'success');
  } catch (e) {
    if (!handleExpiredSession(e)) {
      // 403: you no longer manage this table (the role moves when a manager
      // leaves). 404: they already left. Either way the page is stale.
      await showToast(errorMessage(e, 'Could not remove that player. Please try again.'), 'danger');
      await load();
    }
  } finally {
    busySeat.value = null;
  }
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
  const toast = await toastController.create({
    message,
    duration: 4000,
    color,
    position: 'bottom',
  });
  await toast.present();
}
</script>

<style scoped>
.table-detail {
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

.error {
  margin: 16px 0;
}

/* N on top, W and E flanking the table itself, S underneath. */
.compass {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}

.seat-n {
  grid-column: 2;
  grid-row: 1;
}

.seat-w {
  grid-column: 1;
  grid-row: 2;
}

.table-info {
  grid-column: 2;
  grid-row: 2;
}

.seat-e {
  grid-column: 3;
  grid-row: 2;
}

.seat-s {
  grid-column: 2;
  grid-row: 3;
}

.seat,
.table-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 8px;
  text-align: center;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 8px;
  min-height: 108px;
}

.seat-mine {
  border-color: var(--ion-color-primary);
}

.seat-name {
  font-weight: 700;
  color: var(--ion-color-medium);
}

.seat-user {
  font-size: 0.95rem;
  overflow-wrap: anywhere;
}

.seat-you {
  display: block;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--ion-color-primary);
}

.seat-empty {
  font-size: 0.95rem;
  color: var(--ion-color-medium);
}

.table-info {
  background: var(--ion-color-light, #f4f5f8);
}

.table-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.table-id,
.table-manager,
.table-yours {
  margin: 0;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.table-yours {
  color: var(--ion-color-primary);
}

.refresh {
  margin-top: 8px;
}

.hint {
  margin: 8px 0 0;
  font-size: 0.8rem;
  text-align: center;
  color: var(--ion-color-medium);
}
</style>
