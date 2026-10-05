<template>
  <ion-page>
    <AppHeader title="Tables" />
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="tables-page">
        <!-- Banned: the lobby stays readable, but nobody may sit or create. -->
        <div v-if="auth.ban" class="banned" role="status">
          <ion-text color="danger">
            <p class="banned-why">{{ banText(auth.ban) }}</p>
          </ion-text>
          <p class="banned-what">Until then you can't create a table or take a seat.</p>
        </div>
        <ion-button v-else expand="block" @click="createOpen = true">Create table</ion-button>

        <!-- Left mid-set: the seat waits a few minutes, opening the game
             comes back to it. -->
        <div v-if="heldTable" class="held">
          <AwayNotice :table="heldTable" :me="me" held />
          <ion-button
            size="small"
            :router-link="`/tables/${heldTable.id}/play`"
            router-direction="forward"
          >
            Come back to {{ heldTable.name || `table #${heldTable.id}` }}
          </ion-button>
        </div>

        <!-- Leaving the table's pages keeps the seat (the header's Your
             table goes back to it): getting up is Leave, here too (#121). -->
        <p v-else-if="seatedAt" class="seated-at">
          You sit at
          <router-link :to="`/tables/${seatedAt.id}`">{{
            seatedAt.name || `table #${seatedAt.id}`
          }}</router-link>
          ·
          <ion-button
            fill="clear"
            size="small"
            color="danger"
            class="seated-leave"
            :disabled="leaving"
            @click="leave(seatedAt)"
          >
            <ion-spinner v-if="leaving" name="crescent" />
            <span v-else>Leave</span>
          </ion-button>
        </p>

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
            <ion-item
              v-for="table in tablesStore.tables"
              :key="table.id"
              lines="full"
              :class="{ 'table-mine': table.id === myTableId }"
            >
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
                    v-if="!auth.isBanned"
                    fill="clear"
                    size="small"
                    :router-link="`/tables/${table.id}`"
                    router-direction="forward"
                  >
                    Open
                    <ion-icon slot="end" :icon="chevronForwardOutline" />
                  </ion-button>
                </div>
                <!-- Only robots left: anyone may sit down and run the table. -->
                <p v-if="table.unattended_since" class="unattended">
                  Robots only — sit down to take over
                </p>
                <div class="seats">
                  <div v-for="{ seat, user } in seatsOf(table)" :key="seat" class="seat">
                    <span class="seat-name">{{ seat }}</span>
                    <!-- Tapping a player opens their public profile. -->
                    <button
                      v-if="user"
                      type="button"
                      class="seat-user"
                      :aria-label="`${user.username}'s profile`"
                      @click="player = user"
                    >
                      {{ user.username }}
                    </button>
                    <RobotBadge v-if="user?.is_robot" />
                    <AdminBadge v-if="user?.is_admin" />
                    <ion-badge v-if="user && user.id === me" color="primary">You</ion-badge>
                    <ion-button
                      v-else
                      size="small"
                      fill="outline"
                      :disabled="joining !== null || auth.isBanned"
                      @click="join(table, seat)"
                    >
                      <ion-spinner v-if="isJoining(table.id, seat)" name="crescent" />
                      <span v-else>{{ table.id === myTableId ? 'move here' : 'empty' }}</span>
                    </ion-button>
                  </div>
                </div>
              </div>
            </ion-item>
          </ion-list>
        </template>
      </div>

      <PlayerProfileSheet :player="player" @close="player = null" />

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
                  :maxlength="TABLE_NAME_MAX"
                  placeholder="Friday club"
                />
              </ion-item>
              <!-- Robots fill the other three seats, so one person can play
                   on their own: their Start deals the first board. -->
              <ion-item>
                <ion-toggle v-model="withRobots">
                  Play with robots
                  <p class="toggle-hint">Robots take the other three seats</p>
                </ion-toggle>
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
import { computed, ref } from 'vue';
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
  IonBadge,
  IonIcon,
  IonModal,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonSpinner,
  IonSkeletonText,
  IonToggle,
  onIonViewWillEnter,
  onIonViewDidLeave,
  useIonRouter,
} from '@ionic/vue';
import { chevronForwardOutline } from 'ionicons/icons';
import AppHeader from '@/components/AppHeader.vue';
import AwayNotice from '@/components/AwayNotice.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import AdminBadge from '@/components/AdminBadge.vue';
import RobotBadge from '@/components/RobotBadge.vue';
import { useTablesStore } from '@/stores/tables';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { seatsOf } from '@/services/tables';
import type { Seat, Table } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { banText } from '@/utils/ban';
import { errorMessage, logUnexpected, statusOf } from '@/utils/errors';
import { TABLE_NAME_MAX } from '@/utils/limits';
import { confirmLeave, confirmMove, heldNotice } from '@/utils/seatMove';
import { showToast } from '@/utils/toast';

const tablesStore = useTablesStore();
const auth = useAuthStore();
const game = useGameStore();
const ionRouter = useIonRouter();

const me = computed(() => auth.user?.id ?? null);
// Where the user sits, so the list shows what a move would give up.
const myTableId = computed(() => tablesStore.myTable?.id ?? null);
// That table, while our seat at it is held after a Leave mid-set.
const heldTable = computed(() =>
  tablesStore.myTable && tablesStore.heldTableId === tablesStore.myTable.id ? tablesStore.myTable : null,
);

// The table we sit at, when the seat isn't held (that has Come back above).
const seatedAt = computed(() => (heldTable.value ? null : tablesStore.myTable));

const loading = ref(false);
const loadError = ref('');
// Our Leave on its way.
const leaving = ref(false);
const joining = ref<string | null>(null);
const createOpen = ref(false);
const creating = ref(false);
const createError = ref('');
const name = ref('');
const withRobots = ref(true);
// The seated player whose profile sheet is open.
const player = ref<PublicUser | null>(null);

// The router guard (meta.requiresAuth) already keeps guests out; this only
// re-fetches the list every time the page is shown. The list is refresh-only:
// there is no channel for it (a table's channel admits only the players seated
// there), so only the table you sit at updates live, through the store.
onIonViewWillEnter(() => {
  load();
});

// A seat taken here navigates away with its buttons still disabled, so a
// second tap can't land while the page changes; back on the list they work again.
onIonViewDidLeave(() => {
  joining.value = null;
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

async function join(table: Table, seat: Seat) {
  // Taking a seat at another table moves you off yours, so ask first; a seat
  // change at your own table costs nothing.
  const from = tablesStore.myTable;
  if (
    from &&
    me.value &&
    from.id !== table.id &&
    !(await confirmMove(from, table, me.value, game.phaseOf(from.id), tablesStore.stakeOf(from)))
  ) {
    return;
  }
  joining.value = `${table.id}-${seat}`;
  let joined: Table;
  try {
    // A move reloads the list, so the old table's row updates or disappears.
    joined = await tablesStore.join(table.id, seat);
  } catch (e) {
    // 409 when the seat was taken meanwhile (or the seat name is unknown).
    joining.value = null;
    await showToast(errorMessage(e, 'Could not take that seat. Please try again.'), 'danger');
    return;
  }
  // Taking a seat takes you to the table, like Create table: to the game when
  // it has a board (the answer says so, the list row may be stale), else to
  // its page. Not awaited, as for Create table, and the seat buttons stay
  // disabled until the page has gone (onIonViewDidLeave frees them).
  const path = joined.board_id !== null ? `/tables/${joined.id}/play` : `/tables/${joined.id}`;
  ionRouter.navigate(path, 'forward', 'push');
}

// Getting up without opening the table: the same confirmation as on its
// pages, inside the try so nothing fails unseen. The store updates the list.
async function leave(table: Table) {
  player.value = null;
  try {
    const stake = tablesStore.stakeOf(table);
    const board = game.tableId === table.id ? (game.playing?.board?.number ?? null) : null;
    if (!(await confirmLeave(table, me.value, game.phaseOf(table.id), board, stake))) {
      return;
    }
    leaving.value = true;
    const { tableDeleted, held } = await tablesStore.leave(table.id);
    if (held) {
      game.clear();
      await showToast(heldNotice(stake), 'warning');
    } else {
      await showToast(
        tableDeleted ? 'You left the table. Nobody was left, so it was deleted.' : 'You left the table.',
        'success',
      );
    }
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    logUnexpected(e);
    await showToast(errorMessage(e, 'Could not leave the table. Please try again.'), 'danger');
    await load();
  } finally {
    leaving.value = false;
  }
}

function closeCreate() {
  createOpen.value = false;
  createError.value = '';
  name.value = '';
  withRobots.value = true;
}

async function submitCreate() {
  createError.value = '';
  creating.value = true;
  try {
    // The name is optional; an empty field means an unnamed table.
    const table = await tablesStore.create({ name: name.value.trim() || null, robots: withRobots.value });
    closeCreate();
    // The creator sits there already: off to the table's page, where Start,
    // the seats and Seat a player / Add robot are (with robots the table is
    // full, but nothing is dealt until Start). Not awaited: the page draws
    // the table the store already holds, so the form has nothing left to
    // wait for.
    ionRouter.navigate(`/tables/${table.id}`, 'forward', 'push');
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

.seated-at {
  margin: 12px 0 0;
  text-align: center;
}

.seated-leave {
  margin: 0;
  vertical-align: middle;
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

.banned {
  padding: 12px 16px;
  border: 1px solid var(--ion-color-danger);
  border-radius: 8px;
}

.banned p {
  margin: 0;
  overflow-wrap: anywhere;
}

.banned-why {
  font-weight: 600;
  white-space: pre-line;
}

.banned .banned-what {
  margin-top: 4px;
  color: var(--ion-color-medium);
  font-size: 0.9rem;
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

.unattended {
  margin: -4px 0 8px;
  font-size: 0.85rem;
  color: var(--ion-color-tertiary, #5260ff);
}

.toggle-hint {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.held {
  margin: 12px 0;
}

.table-mine {
  --background: rgba(var(--ion-color-primary-rgb), 0.06);
}

/* A plain button that reads as a link: the name itself is the tap target. */
.seat-user {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--ion-color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
