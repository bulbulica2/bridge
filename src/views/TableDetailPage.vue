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
        <!-- A table lives only while somebody sits at it, so a dead id is the
             normal end of a table's life, not an error worth shouting about. -->
        <div v-if="notFound" class="gone">
          <p>This table no longer exists.</p>
          <ion-button router-link="/tables" router-direction="back">Back to tables</ion-button>
        </div>

        <!-- Nothing to show yet: a big spinner where the compass will be. -->
        <div v-else-if="loading && !table" class="loading" aria-busy="true">
          <ion-spinner name="crescent" />
          <p>Loading table…</p>
        </div>

        <ion-text v-if="!notFound && loadError" color="danger">
          <p class="error">{{ loadError }}</p>
        </ion-text>

        <!-- A table already in the store shows at once and refreshes in place. -->
        <template v-if="!notFound && table">
          <div v-if="loading" class="refreshing">
            <ion-spinner name="crescent" />
            <span>Refreshing…</span>
          </div>

          <div class="compass">
            <div
              v-for="{ seat, user } in seats"
              :key="seat"
              class="seat"
              :class="[`seat-${seat.toLowerCase()}`, { 'seat-mine': user && user.id === me }]"
            >
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
                <span v-if="user.id === me" class="seat-you">you</span>
              </button>
              <span v-else class="seat-empty">Empty</span>
              <RobotBadge v-if="user?.is_robot" />
              <AdminBadge v-if="user?.is_admin" />
              <!-- Away mid-set: the seat is held, the notice below counts down. -->
              <span v-if="awayMarks.includes(seat)" class="seat-away">away</span>
              <!-- Before a board: who has pressed Start (robots always have). -->
              <span v-if="showStart && readySeats.includes(seat)" class="seat-ready">
                ✓ Ready
              </span>

              <!-- A held seat has been left already: "Come back" below. -->
              <ion-button
                v-if="user && user.id === me && !held"
                size="small"
                fill="outline"
                color="danger"
                :disabled="busySeat !== null"
                @click="leave(seat)"
              >
                <ion-spinner v-if="busySeat === seat" name="crescent" />
                <span v-else>Leave</span>
              </ion-button>

              <!-- Holding a seat here makes a free one a plain seat change;
                   holding one elsewhere makes it a move, confirmed in sit(). -->
              <ion-button
                v-else-if="!user && !held"
                size="small"
                fill="outline"
                :disabled="busySeat !== null"
                @click="sit(seat)"
              >
                <ion-spinner v-if="busySeat === seat" name="crescent" />
                <span v-else>{{ mySeat ? 'Move here' : 'Sit here' }}</span>
              </ion-button>

              <!-- Managers put somebody else in a free seat, found by name. -->
              <ion-button
                v-if="!user && isManager"
                size="small"
                fill="clear"
                :disabled="busySeat !== null"
                @click="seatingAt = seat"
              >
                Seat a player
              </ion-button>
              <!-- …or a robot, which the backend picks from its pool. -->
              <ion-button
                v-if="!user && isManager"
                size="small"
                fill="clear"
                :disabled="busySeat !== null"
                @click="addRobot(seat)"
              >
                Add robot
              </ion-button>

              <!-- Managers, and anyone for a robot while only robots sit here;
                   an admin's seat only for another admin. The backend has
                   the final say (403). -->
              <ion-button
                v-else-if="user && canRemove(table, user, auth.user)"
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
              <!-- While a set of four boards is running: how far it has got. -->
              <p v-if="runningSet" class="table-set">{{ setLabel(runningSet) }}</p>
            </div>
          </div>

          <!-- We left in the middle of the set: the seat waits for us a few
               minutes, and coming back is one tap (or opening the game). -->
          <div v-if="held" class="held">
            <AwayNotice :table="table" :me="me" held />
            <ion-button expand="block" :disabled="comingBack" @click="comeBack">
              <ion-spinner v-if="comingBack" name="crescent" />
              <span v-else>Come back</span>
            </ion-button>
          </div>

          <!-- Somebody else away mid-set, with the time left. -->
          <AwayNotice :table="table" :me="me" />

          <!-- Only robots sit here since the last person left: they wait for
               somebody to take over, and the backend deletes the table after
               a few minutes if nobody does. -->
          <p v-if="table.unattended_since" class="unattended">
            Robots only — sit down to take over. You'll manage the table, and it is
            deleted {{ UNATTENDED_MINUTES }} minutes after the last player left if nobody does.
          </p>

          <!-- Every human presses Start; the last one deals the board, and the
               board_id watch below takes everyone seated here to the game. -->
          <StartBox
            v-if="showStart"
            :table="table"
            :me="me"
            :busy="starting"
            @start="start"
            @cancel="cancelStart"
          />

          <!-- The game itself lives on its own page; a board being dealt
               takes the players there by itself. -->
          <ion-button
            v-if="mySeat && !held"
            expand="block"
            :fill="showStart ? 'outline' : 'solid'"
            class="play"
            :router-link="`/tables/${tableId}/play`"
            router-direction="forward"
          >
            {{ table.board_id !== null ? 'Go to the board' : 'Open the game table' }}
          </ion-button>

          <!-- Between boards the Leave button costs the others nothing. -->
          <p v-if="mySeat && !held && boardPhase === 'finished'" class="between-boards">
            {{ leaveWarning(boardPhase, game.playing?.board?.number ?? null, stake) }}
          </p>

          <p v-if="seatedElsewhere" class="seated-elsewhere">
            You sit at
            <router-link :to="`/tables/${seatedElsewhere.id}`">
              {{ seatedElsewhere.name || `table #${seatedElsewhere.id}` }}</router-link
            >. Taking a seat here moves you.
          </p>

          <OfflineRefresh :table-id="tableId" :disabled="busySeat !== null || loading" @refresh="load()" />
        </template>
      </div>

      <PlayerProfileSheet :player="player" @close="player = null" />
      <SeatPlayerSheet :seat="seatingAt" @select="seatPlayer" @close="seatingAt = null" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import AwayNotice from '@/components/AwayNotice.vue';
import OfflineRefresh from '@/components/OfflineRefresh.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import AdminBadge from '@/components/AdminBadge.vue';
import RobotBadge from '@/components/RobotBadge.vue';
import SeatPlayerSheet from '@/components/SeatPlayerSheet.vue';
import StartBox from '@/components/StartBox.vue';
import { useTablesStore } from '@/stores/tables';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { UNATTENDED_MINUTES, canRemove, seatsOf } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { PublicUser, SearchedUser } from '@/services/users';
import { errorMessage, statusOf } from '@/utils/errors';
import { awaySeats } from '@/utils/away';
import { confirmLeave, confirmMove, heldNotice, leaveWarning } from '@/utils/seatMove';
import { SIDE_LABELS, sideOf } from '@/utils/result';
import { currentSet, setLabel } from '@/utils/sets';
import { isReady, startNeeded } from '@/utils/start';
import { showToast } from '@/utils/toast';

const route = useRoute();
const ionRouter = useIonRouter();
const store = useTablesStore();
const auth = useAuthStore();
const game = useGameStore();

const tableId = ref(0);
const loading = ref(false);
const loadError = ref('');
const notFound = ref(false);
// One seat action at a time, so the whole compass locks while a request is out.
const busySeat = ref<Seat | null>(null);
// The seated player whose profile sheet is open.
const player = ref<PublicUser | null>(null);
// The free seat a manager is finding a player for.
const seatingAt = ref<Seat | null>(null);
// Our Start (or taking it back) on its way.
const starting = ref(false);
// "Come back" to a held seat on its way.
const comingBack = ref(false);

// Only trust the store's current table when it is the one this route asks for,
// otherwise moving from one table to another flashes the previous one. Coming
// from the list, its copy of the table shows at once while the fresh one loads.
const table = computed(() => {
  if (store.currentTable && store.currentTable.id === tableId.value) {
    return store.currentTable;
  }
  return store.tables.find((t) => t.id === tableId.value) ?? null;
});
const me = computed(() => auth.user?.id ?? null);
const seats = computed(() => (table.value ? seatsOf(table.value) : []));
const mySeat = computed(
  () => table.value?.seats.find((s) => s.user_id === me.value)?.seat ?? null,
);
// Another table the user holds a seat at, which sitting down here gives up.
const seatedElsewhere = computed(() =>
  store.myTable && store.myTable.id !== tableId.value ? store.myTable : null,
);
// The backend's own answer for this user (admins included); a 403 corrects it
// if the role has moved on since.
const isManager = computed(() => table.value?.can_manage ?? false);
// The phase of the board here, when the game store holds it: leaving during
// a board abandons it, between boards (finished) it abandons nothing.
const boardPhase = computed(() =>
  table.value?.board_id != null ? game.phaseOf(tableId.value) : null,
);
// The next board waits for Start: no board yet (or one abandoned), or a
// finished one whose four players aren't all still in their seats. Only for
// a player seated here; the rest just watch the marks.
const showStart = computed(
  () =>
    !!table.value &&
    !!mySeat.value &&
    startNeeded(table.value, game.tableId === tableId.value ? game.playing : null),
);
// The set being played here, while it goes on (the board's own `set`, when
// the game store holds it, knows the last board has finished).
const runningSet = computed(() => {
  const set = table.value
    ? currentSet(table.value, game.tableId === tableId.value ? game.playing : null)
    : null;
  return set && !set.finished && table.value?.board_id != null ? set : null;
});
// We left mid-set and our seat here is held for us (the tables store sends
// no heartbeat for it until we come back).
const held = computed(() => !!mySeat.value && store.heldTableId === tableId.value);
// The others' seats marked away mid-set.
const awayMarks = computed(() =>
  table.value ? awaySeats(table.value, me.value).map((s) => s.seat) : [],
);
// What leaving would put at stake: the set going on here, if any.
const stake = computed(() => (table.value && mySeat.value ? store.stakeOf(table.value) : null));
const readySeats = computed(() => table.value?.seats.filter(isReady).map((s) => s.seat) ?? []);
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
  load(false);
});

// While seated here the store follows the table live (TableUpdated). When an
// update shows we were kicked, the store has already said so in a toast; a
// seat we no longer hold is no reason to stay.
watch(
  () => store.kickedFrom,
  (kicked) => {
    if (kicked !== null && kicked === tableId.value) {
      store.kickedFrom = null;
      // Freed because our side forfeited the set: its results instead.
      const lost = store.lostSet;
      ionRouter.navigate(lost?.tableId === kicked ? `/sets/${lost.id}` : '/tables', 'back', 'replace');
    }
  },
);

// The last Start deals a board: whoever sits here and is looking at this
// page moves on to the game, the one whose Start dealt it included (the
// store applies its answer). Only on the change, so the page stays
// reachable (to leave, say) while a board is being played. A new board in
// place of a finished one counts too (Start after somebody was replaced).
// Ionic keeps this page alive underneath others, hence the check that it is
// the one showing.
watch(
  () => table.value?.board_id ?? null,
  (boardId, before) => {
    if (
      boardId !== null &&
      boardId !== before &&
      mySeat.value &&
      route.path === `/tables/${tableId.value}`
    ) {
      ionRouter.navigate(`/tables/${tableId.value}/play`, 'forward', 'push');
    }
  },
);

// `refetchTable: false` (entering the page) reuses the table the store
// already follows live, such as the user's own coming back from the game.
async function load(refetchTable = true) {
  loading.value = true;
  loadError.value = '';
  try {
    await (refetchTable ? store.loadTable(tableId.value) : store.openTable(tableId.value));
    loadBoardPhase();
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

// Seated at a table with a board the game store doesn't hold yet (this page
// opened by URL): read it, so Leave can say what leaving costs. Only the
// players seated here may, and a failure only leaves the wording generic.
// Not for a held seat: reading the board would bring us back.
function loadBoardPhase() {
  if (
    mySeat.value &&
    !held.value &&
    table.value?.board_id != null &&
    game.phaseOf(tableId.value) === null
  ) {
    game.load(tableId.value).catch(() => {});
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
    // Moving off another table costs something there, so ask first. A seat
    // change at this table doesn't.
    if (!mySeat.value && table.value && me.value) {
      const from = await store.seatedTable();
      if (
        from &&
        from.id !== tableId.value &&
        !(await confirmMove(from, table.value, me.value, game.phaseOf(from.id), store.stakeOf(from)))
      ) {
        return;
      }
    }
    await store.join(tableId.value, seat);
  } catch (e) {
    if (!handleExpiredSession(e)) {
      // 409 when somebody got there first (or the seat name is unknown).
      await showToast(errorMessage(e, 'Could not take that seat. Please try again.'), 'danger');
      await load();
    }
  } finally {
    busySeat.value = null;
  }
}

async function leave(seat: Seat) {
  const atStake = stake.value;
  const confirmed = await confirmLeave(
    table.value,
    me.value,
    boardPhase.value,
    game.playing?.board?.number ?? null,
    atStake,
  );
  if (!confirmed) {
    return;
  }

  busySeat.value = seat;
  try {
    const { tableDeleted, held: kept } = await store.leave(tableId.value);
    if (kept) {
      // Mid-set: the seat waits for us a few minutes. Off to the list, where
      // being away is what it is (staying here would read as being back).
      game.clear();
      await showToast(heldNotice(atStake), 'warning');
      ionRouter.navigate('/tables', 'back', 'replace');
    } else if (tableDeleted) {
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

// What a kick costs the set going on here (bridge_backend docs/API.md, DELETE
// /tables/{table}/seats/{user}): a player away loses it for their side, one
// who is there only breaks it off.
function removeCost(seat: Seat): string {
  const current = table.value;
  const set = current ? currentSet(current, game.tableId === tableId.value ? game.playing : null) : null;
  if (!current || !set || set.finished) {
    return '';
  }
  const theirs = current.seats.find((s) => s.seat === seat);
  return theirs?.forfeit_at
    ? `They are away, so ${SIDE_LABELS[sideOf(seat)]} lose set ${set.number} by forfeit.`
    : `Set ${set.number} ends with no winner.`;
}

// Back to a held seat before the time is up: the store vouches for us, and
// greets us once the backend has taken the away mark back.
async function comeBack() {
  comingBack.value = true;
  try {
    await store.comeBack(tableId.value);
    loadBoardPhase();
  } finally {
    comingBack.value = false;
  }
}

async function confirmRemove(seat: Seat, user: PublicUser) {
  const alert = await alertController.create({
    header: `Remove ${user.username}?`,
    message: user.is_robot
      ? `The robot leaves seat ${seat}, which becomes free.`
      : [`${user.username} loses seat ${seat}. They can sit down again afterwards.`, removeCost(seat)]
          .filter(Boolean)
          .join(' '),
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
      // The last robot of an unattended table (a manager is otherwise still
      // seated): the id is dead.
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

async function seatPlayer(user: SearchedUser) {
  const seat = seatingAt.value;
  seatingAt.value = null;
  if (!seat) {
    return;
  }
  // Naming yourself is a plain join (maybe a move), so it goes that way.
  if (user.id === me.value) {
    await sit(seat);
    return;
  }

  busySeat.value = seat;
  try {
    await store.seatUser(tableId.value, user.id, seat);
    await showToast(`${user.username} now sits at ${seat}.`, 'success');
  } catch (e) {
    if (!handleExpiredSession(e)) {
      // 409: the seat was taken or they sat down somewhere meanwhile. 403:
      // you no longer manage this table. Either way the page is stale.
      await showToast(errorMessage(e, 'Could not seat that player. Please try again.'), 'danger');
      await load();
    }
  } finally {
    busySeat.value = null;
  }
}

// A manager fills a free seat with a robot. Robots are always ready, so the
// fourth seat deals the board if every human here has pressed Start, which
// takes a manager seated here to the game (the board_id watch).
async function addRobot(seat: Seat) {
  busySeat.value = seat;
  try {
    await store.seatRobot(tableId.value, seat);
    await showToast(`A robot now sits at ${seat}.`, 'success');
  } catch (e) {
    if (!handleExpiredSession(e)) {
      // 409: the seat was taken meanwhile. 403: you no longer manage this
      // table. Either way the page is stale.
      await showToast(errorMessage(e, 'Could not add a robot. Please try again.'), 'danger');
      await load();
    }
  } finally {
    busySeat.value = null;
  }
}

// Our Start. The answer that deals brings the board, and its board_id takes
// us to the game (the watch above); otherwise the box waits for the others.
async function start() {
  starting.value = true;
  try {
    await store.start(tableId.value);
  } catch (e) {
    if (!handleExpiredSession(e)) {
      // 409: a board is already on (somebody else's Start dealt it), or we
      // lost the seat meanwhile. Either way the page is stale.
      await showToast(errorMessage(e, 'Could not start. Please try again.'), 'danger');
      await load();
    }
  } finally {
    starting.value = false;
  }
}

async function cancelStart() {
  starting.value = true;
  try {
    await store.cancelStart(tableId.value);
  } catch (e) {
    if (!handleExpiredSession(e)) {
      // 409: the board was dealt meanwhile, which takes us to it anyway.
      await showToast(errorMessage(e, 'Could not take your Start back. Please try again.'), 'danger');
      await load();
    }
  } finally {
    starting.value = false;
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

</script>

<style scoped>
.table-detail {
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

/* A plain button that reads as a link: the name itself is the tap target. */
.seat-user {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.95rem;
  color: var(--ion-color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.seat-you {
  display: block;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--ion-color-primary);
}

.seat-away {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--ion-color-warning-shade, #e0ac08);
}

.held {
  margin: 12px 0;
}

.seat-ready {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ion-color-success-shade, #28ba62);
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
.table-set {
  margin: 4px 0 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ion-color-primary);
}

.table-manager,
.table-yours {
  margin: 0;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.table-yours {
  color: var(--ion-color-primary);
}

.unattended {
  margin: 0 0 16px;
  font-size: 0.9rem;
  text-align: center;
  color: var(--ion-color-tertiary, #5260ff);
}

.between-boards,
.seated-elsewhere {
  margin: 0 0 16px;
  font-size: 0.9rem;
  text-align: center;
  color: var(--ion-color-medium);
}

.play {
  margin-bottom: 16px;
}
</style>
