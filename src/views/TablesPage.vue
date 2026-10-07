<template>
  <ion-page>
    <AppHeader title="Tables" />
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" v-ion-event:ion-refresh="refresh">
        <ion-refresher-content />
      </ion-refresher>

      <!-- The lobby (the Daylight Lobby board): the table we sit at, two ways
           to start, the open tables, and beside them (below on a phone) how
           we have been playing. -->
      <div class="tables-page">
        <div class="lobby-main">
          <!-- Banned: the lobby stays readable, but nobody may sit or create. -->
          <div v-if="auth.ban" class="banned" role="status">
            <ion-text color="danger">
              <p class="banned-why">{{ banText(auth.ban) }}</p>
            </ion-text>
            <p class="banned-what">Until then you can't create a table or take a seat.</p>
          </div>

          <!-- Our table, one tap back (a held seat comes back to it). Leaving
               the table's pages keeps the seat: getting up is Leave, here
               too (#121). -->
          <YourTableHero>
            <template #actions>
              <ion-button
                v-if="seatedAt"
                fill="clear"
                size="small"
                class="seated-leave"
                :disabled="leaving"
                @click="leave(seatedAt)"
              >
                <ion-spinner v-if="leaving" name="crescent" />
                <span v-else>Leave</span>
              </ion-button>
            </template>
          </YourTableHero>

          <div v-if="!auth.ban" class="start-cards">
            <!-- Robots fill the other three seats, so one person plays on
                 their own: their Start, on the table's page, deals. -->
            <section class="lobby-card start-robots" aria-labelledby="start-robots-title">
              <div class="start-head">
                <h2 id="start-robots-title">Play now with robots</h2>
                <p>You sit South, robots take the other three seats.</p>
              </div>
              <!-- Each player's time for a set of 4 boards (the set clock). -->
              <SetMinutesPicker
                v-model="setMinutes"
                label="Your time for a set of 4 boards"
                label-id="create-set-minutes"
                :disabled="creating !== null"
              />
              <ion-text v-if="createError.robots" color="danger">
                <p class="error">{{ createError.robots }}</p>
              </ion-text>
              <ion-button color="action" class="deal-me-in" :disabled="creating !== null" @click="createWithRobots">
                <ion-spinner v-if="creating === 'robots'" name="crescent" />
                <span v-else>Deal me in</span>
              </ion-button>
            </section>

            <!-- A table for people: seat players or add robots from it. -->
            <form class="lobby-card start-friends" aria-labelledby="start-friends-title" @submit.prevent="createForFriends">
              <div class="start-head">
                <h2 id="start-friends-title">Open a table for friends</h2>
                <p>Name it, then seat players or add robots from the table.</p>
              </div>
              <ion-input
                v-model="name"
                class="table-name-input"
                type="text"
                label="Table name"
                label-placement="stacked"
                fill="outline"
                :maxlength="TABLE_NAME_MAX"
                placeholder="Sunday pairs"
              />
              <ion-text v-if="createError.friends" color="danger">
                <p class="error">{{ createError.friends }}</p>
              </ion-text>
              <ion-button type="submit" fill="outline" class="create-table" :disabled="creating !== null">
                <ion-spinner v-if="creating === 'friends'" name="crescent" />
                <span v-else>Create table</span>
              </ion-button>
            </form>
          </div>

          <section class="open-tables" aria-labelledby="open-tables-title">
            <div class="open-head">
              <h2 id="open-tables-title">Open tables</h2>
              <!-- Counted over the list we hold (GET /tables). -->
              <button
                v-for="chip in TABLE_FILTERS"
                :key="chip.value"
                type="button"
                class="filter-chip"
                :class="{ 'filter-on': filter === chip.value }"
                :aria-pressed="filter === chip.value"
                :data-filter="chip.value"
                @click="filter = chip.value"
              >
                {{ chip.label }} {{ counts[chip.value] }}
              </button>
            </div>

            <!-- First visit: skeleton cards where the list will be. -->
            <div v-if="loading && !tablesStore.loaded" class="table-grid" aria-busy="true">
              <div v-for="n in 3" :key="n" class="table-skeleton">
                <ion-skeleton-text animated class="skeleton-title" />
                <ion-skeleton-text animated class="skeleton-compass" />
              </div>
            </div>

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
              <p v-else-if="tablesStore.tables.length > 0 && shown.length === 0" class="empty">
                No table matches.
              </p>

              <div v-if="shown.length > 0" class="table-grid">
                <TableCard
                  v-for="table in shown"
                  :key="table.id"
                  :table="table"
                  :me="me"
                  :mine="table.id === myTableId"
                  :busy="joining !== null"
                  :joining="joiningSeat(table.id)"
                  :banned="auth.isBanned"
                  :now="now"
                  @join="join(table, $event)"
                  @player="player = $event"
                />
              </div>
            </template>
          </section>
        </div>

        <aside class="lobby-aside">
          <YourForm ref="form" />
          <RecentBoards ref="recent" />
        </aside>
      </div>

      <PlayerProfileSheet :player="player" @close="player = null" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonPage,
  IonContent,
  IonInput,
  IonButton,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonSpinner,
  IonSkeletonText,
  onIonViewWillEnter,
  onIonViewDidLeave,
  useIonRouter,
} from '@ionic/vue';
import { vIonEvent } from '@/directives/ionEvent';
import AppHeader from '@/components/AppHeader.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import RecentBoards from '@/components/RecentBoards.vue';
import SetMinutesPicker from '@/components/SetMinutesPicker.vue';
import TableCard from '@/components/TableCard.vue';
import YourForm from '@/components/YourForm.vue';
import YourTableHero from '@/components/YourTableHero.vue';
import { useTablesStore } from '@/stores/tables';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { DEFAULT_SET_MINUTES } from '@/services/tables';
import type { CreateTablePayload, Seat, SetMinutes, Table } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { banText } from '@/utils/ban';
import { errorMessage, logUnexpected, statusOf } from '@/utils/errors';
import { TABLE_NAME_MAX } from '@/utils/limits';
import { TABLE_FILTERS, filterCounts, matchesFilter } from '@/utils/lobby';
import type { TableFilter } from '@/utils/lobby';
import { confirmLeave, confirmMove, heldNotice } from '@/utils/seatMove';
import { showToast } from '@/utils/toast';

const tablesStore = useTablesStore();
const auth = useAuthStore();
const game = useGameStore();
const ionRouter = useIonRouter();

const me = computed(() => auth.user?.id ?? null);
// Where the user sits, so the list shows what a move would give up.
const myTableId = computed(() => tablesStore.myTable?.id ?? null);
// The table we sit at, when the seat isn't held (Your table comes back to
// a held one instead).
const seatedAt = computed(() =>
  tablesStore.myTable && tablesStore.heldTableId !== tablesStore.myTable.id ? tablesStore.myTable : null,
);

const loading = ref(false);
const loadError = ref('');
// Our Leave on its way.
const leaving = ref(false);
// The seat being taken, "<table>-<seat>".
const joining = ref<string | null>(null);
// Which start card's table is being created, and each card's refusal.
type CreateKind = 'robots' | 'friends';
const creating = ref<CreateKind | null>(null);
const createError = ref<Record<CreateKind, string>>({ robots: '', friends: '' });
const name = ref('');
const setMinutes = ref<SetMinutes>(DEFAULT_SET_MINUTES);
// The seated player whose profile sheet is open.
const player = ref<PublicUser | null>(null);
// The open tables' chip, and the time the cards' minutes are told from (as
// of the last load: the list itself is refresh-only).
const filter = ref<TableFilter>('all');
const now = ref(Date.now());
const form = ref<InstanceType<typeof YourForm> | null>(null);
const recent = ref<InstanceType<typeof RecentBoards> | null>(null);

const counts = computed(() => filterCounts(tablesStore.tables));
const shown = computed(() => tablesStore.tables.filter((t) => matchesFilter(t, filter.value)));

// The router guard (meta.requiresAuth) already keeps guests out; this only
// re-fetches the list every time the page is shown. The list is refresh-only:
// there is no channel for it (a table's channel admits only the players seated
// there), so only the table you sit at updates live, through the store. The
// aside's stats and recent boards follow once the list is in (the local
// backend answers one request at a time).
onIonViewWillEnter(async () => {
  await load();
  form.value?.load();
  recent.value?.load();
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
    now.value = Date.now();
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

// The seat of table `tableId` being taken, if any.
function joiningSeat(tableId: number): Seat | null {
  const [id, seat] = joining.value?.split('-') ?? [];
  return Number(id) === tableId ? (seat as Seat) : null;
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
    // A move reloads the list, so the old table's card updates or disappears.
    joined = await tablesStore.join(table.id, seat);
  } catch (e) {
    // 409 when the seat was taken meanwhile (or the seat name is unknown).
    joining.value = null;
    await showToast(errorMessage(e, 'Could not take that seat. Please try again.'), 'danger');
    return;
  }
  // Taking a seat takes you to the table, like creating one: to the game
  // when it has a board (the answer says so, the card may be stale), else to
  // its page. Not awaited, and the seats stay disabled until the page has
  // gone (onIonViewDidLeave frees them).
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
      await showToast(heldNotice(), 'warning');
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

// "Deal me in": a table of our own with three robots, at the picked time
// for a set.
function createWithRobots() {
  return create('robots', { name: null, robots: true, set_minutes: setMinutes.value });
}

// A named table (the name is optional) for people to join; its time for a
// set is the backend's default until its manager changes it on its page.
function createForFriends() {
  return create('friends', { name: name.value.trim() || null, robots: false });
}

async function create(kind: CreateKind, payload: CreateTablePayload) {
  createError.value = { robots: '', friends: '' };
  creating.value = kind;
  try {
    const table = await tablesStore.create(payload);
    name.value = '';
    setMinutes.value = DEFAULT_SET_MINUTES;
    // The creator sits there already: off to the table's page, where Start,
    // the seats and Seat a player / Add robot are (with robots the table is
    // full, but nothing is dealt until Start). Not awaited: the page draws
    // the table the store already holds, so the card has nothing left to
    // wait for.
    ionRouter.navigate(`/tables/${table.id}`, 'forward', 'push');
  } catch (e) {
    createError.value[kind] = errorMessage(e, 'Could not create the table. Please try again.');
  } finally {
    creating.value = null;
  }
}
</script>

<style scoped>
/* Two columns from about 1000 px (the list, then the aside), one below. */
.tables-page {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  max-width: 1280px;
  margin: 0 auto;
}

.lobby-main {
  display: flex;
  flex: 999 1 640px;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.lobby-aside {
  display: flex;
  flex: 1 1 280px;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

@media (min-width: 992px) {
  .lobby-aside {
    max-width: 360px;
  }
}

.seated-leave {
  --color: var(--bridge-on-table-muted);
  margin: 0;
}

.start-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 16px;
}

.start-cards .lobby-card {
  gap: 14px;
  padding: 20px;
}

.start-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.start-head h2 {
  margin: 0;
  font-size: 1.1875rem;
}

.start-head p {
  margin: 0;
  font-size: 0.875rem;
  color: var(--bridge-muted);
}

.start-cards ion-button {
  height: 50px;
  margin: 0;
}

/* The friends' card's button is the navy outline, the robots' the orange. */
.create-table {
  --border-color: var(--ion-color-primary);
  --color: var(--ion-color-primary);
}

.table-name-input {
  --border-color: var(--bridge-control);
  --border-radius: 12px;
  --border-width: 1.5px;
}

.open-tables {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.open-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.open-head h2 {
  margin: 0 8px 0 0;
  font-size: 1.3125rem;
}

.filter-chip {
  height: 36px;
  padding: 0 14px;
  border: 1.5px solid var(--bridge-control);
  border-radius: var(--bridge-radius-pill);
  background: var(--bridge-surface);
  color: var(--bridge-ink);
  font: 700 0.875rem var(--bridge-font);
  cursor: pointer;
}

.filter-chip.filter-on {
  border-color: var(--bridge-ink);
  background: var(--bridge-ink);
  color: var(--bridge-ground);
}

.table-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
  gap: 14px;
}

.table-skeleton {
  padding: 16px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
}

.skeleton-title {
  width: 50%;
  height: 18px;
  margin: 0 0 12px;
}

.skeleton-compass {
  height: 132px;
  border-radius: 12px;
}

.refreshing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  color: var(--bridge-muted);
  font-size: 0.9rem;
}

.refreshing ion-spinner {
  width: 18px;
  height: 18px;
}

.empty {
  margin: 0;
  color: var(--bridge-muted);
  text-align: center;
}

.error {
  margin: 0;
}

.banned {
  padding: 12px 16px;
  border: 1px solid var(--ion-color-danger);
  border-radius: 12px;
  background: var(--bridge-surface);
}

.banned p {
  margin: 0;
  overflow-wrap: anywhere;
}

.banned-why {
  font-weight: 700;
  white-space: pre-line;
}

.banned .banned-what {
  margin-top: 4px;
  color: var(--bridge-muted);
  font-size: 0.9rem;
}
</style>
