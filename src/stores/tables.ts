import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as tablesService from '@/services/tables';
import type { BroadcastTable, CreateTablePayload, Seat, Table } from '@/services/tables';
import { leaveTable, listenToTable, onReconnect } from '@/services/echo';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { statusOf } from '@/utils/errors';
import { showToast } from '@/utils/toast';

// How often a seated player tells the backend they are still there. It frees
// a seat after a few idle minutes (BRIDGE_IDLE_SEAT_MINUTES, 5 by default), so
// a couple of lost beats never cost anybody their seat.
export const HEARTBEAT_MS = 30_000;

export const IDLE_NOTICE = 'You were removed from the table after being inactive.';

function pageHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export const useTablesStore = defineStore('tables', () => {
  const tables = ref<Table[]>([]);
  // The table the detail page is showing, held next to the list so both stay
  // truthful when a seat changes from either page.
  const currentTable = ref<Table | null>(null);
  // Whether `tables` has come from the backend at least once, so the page can
  // tell "nothing loaded yet" (skeleton) from "loaded, and empty".
  const loaded = ref(false);
  // The table whose channel we are subscribed to. Only one: a user sits at
  // one table at most, and the channel refuses anyone not seated there.
  const watchedTableId = ref<number | null>(null);
  // Set when a live update shows the user was kicked from that table, so the
  // detail page can leave it.
  const kickedFrom = ref<number | null>(null);
  // Our own seat requests in flight. Their broadcast can beat the HTTP
  // response, and an update that unseats us then is our own doing, not a kick.
  let ownSeatRequests = 0;
  // The heartbeat for the watched table: running while the page is visible,
  // paused while it is hidden (a closed or backgrounded app is exactly what
  // the backend should see as idle).
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  // A removal noticed while the page was hidden, told once it shows again (a
  // toast shown to nobody would be gone by then).
  let pendingNotice: string | null = null;

  const auth = useAuthStore();

  function seatsMe(table: Table) {
    const me = auth.user?.id;
    return !!me && table.seats.some((s) => s.user_id === me);
  }

  // Replace only, never append: the list is ordered by the backend (newest
  // first), so a table we only ever opened by URL has no correct position in
  // it. load() brings it in properly.
  function upsertInList(table: Table) {
    tables.value = tables.value.map((t) => (t.id === table.id ? table : t));
  }

  // The table the user sits at, as far as the copies we hold can tell (a seat
  // is unique per user across every table). Null when unseated or unknown.
  const myTable = computed<Table | null>(() => {
    if (currentTable.value && seatsMe(currentTable.value)) {
      return currentTable.value;
    }
    return tables.value.find(seatsMe) ?? null;
  });

  // The table the user sits at, loading the list first if nothing we hold says
  // so yet (a detail page opened by URL knows only its own table). Pages ask
  // before a seat request so a move to another table can be confirmed.
  async function seatedTable(): Promise<Table | null> {
    if (!myTable.value && !loaded.value) {
      await load();
    }
    return myTable.value;
  }

  // A table came back from the backend: refresh every copy we hold.
  function syncTable(table: Table) {
    upsertInList(table);
    if (currentTable.value?.id === table.id) {
      currentTable.value = table;
    }
  }

  // Our freshest copy of a table: the detail page's, else the list's.
  function heldTable(tableId: number): Table | null {
    if (currentTable.value?.id === tableId) {
      return currentTable.value;
    }
    return tables.value.find((t) => t.id === tableId) ?? null;
  }

  // `TableUpdated` leaves `can_manage` out, so a broadcast keeps the answer we
  // last got over HTTP. Only a new moderator changes it for somebody who didn't
  // make the request, so that asks the backend again.
  function withCanManage(update: BroadcastTable | Table): Table {
    if ('can_manage' in update) {
      return update;
    }
    const held = heldTable(update.id);
    if (!held || held.moderated_by !== update.moderated_by) {
      refreshCanManage(update.id);
    }
    return { ...update, can_manage: held?.can_manage ?? false };
  }

  // Takes only `can_manage` from the refetch: seats keep coming over the
  // channel, and a later broadcast may already have overtaken this answer.
  // Skipped if the moderator changed again meanwhile (that refetches anew).
  async function refreshCanManage(tableId: number) {
    let fresh: Table;
    try {
      fresh = await tablesService.getTable(tableId);
    } catch {
      // Gone or offline: the next load or catch-up says what happened.
      return;
    }
    const held = heldTable(tableId);
    if (held && held.moderated_by === fresh.moderated_by) {
      syncTable({ ...held, can_manage: fresh.can_manage });
    }
  }

  // The table is gone (the last player left, or it 404s): forget it everywhere.
  function forget(tableId: number) {
    if (watchedTableId.value === tableId) {
      unwatchTable();
    }
    tables.value = tables.value.filter((t) => t.id !== tableId);
    if (currentTable.value?.id === tableId) {
      currentTable.value = null;
    }
  }

  // Subscribes to the table's channel. Only call it while the user is seated
  // there: the backend answers anyone else with a 403. Moving to another table
  // leaves the old channel first.
  function watchTable(tableId: number) {
    if (watchedTableId.value === tableId) {
      return;
    }
    unwatchTable();
    watchedTableId.value = tableId;
    kickedFrom.value = null;
    // The same channel carries the game state; the game store keeps that.
    listenToTable(
      tableId,
      (table) => applyTableUpdate(table),
      (playing) => useGameStore().applyPlayingUpdate(tableId, playing),
    );
    startHeartbeat();
  }

  // Leaving, a kick, a move and logout all end here, and so does the heartbeat.
  function unwatchTable() {
    stopHeartbeat();
    if (watchedTableId.value !== null) {
      leaveTable(watchedTableId.value);
      watchedTableId.value = null;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    if (watchedTableId.value !== null && !pageHidden()) {
      heartbeat = setInterval(beat, HEARTBEAT_MS);
    }
  }

  function stopHeartbeat() {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  // A 403 or 404 means the seat is already gone (freed as idle, most likely,
  // with its TableUpdated missed), so look at the table to find out how.
  // Anything else (offline, a 500) just waits for the next beat.
  async function beat() {
    const tableId = watchedTableId.value;
    if (tableId === null) {
      return;
    }
    try {
      await tablesService.sendHeartbeat(tableId);
    } catch (e) {
      const status = statusOf(e);
      if (status === 403 || status === 404) {
        await catchUp(tableId, true);
      }
    }
  }

  // Back from the background: vouch for the seat at once, then catch up with
  // whatever happened meanwhile. A seat lost while away is told as such.
  async function resume() {
    const tableId = watchedTableId.value;
    if (tableId !== null) {
      startHeartbeat();
      await tablesService.sendHeartbeat(tableId).catch(() => {
        // The refetch below tells whether we still sit there.
      });
      await catchUp(tableId, true);
      const game = useGameStore();
      if (watchedTableId.value === tableId && game.tableId === tableId) {
        await game.load(tableId).catch(() => {
          // The page shows its own errors on its next load; nothing to add here.
        });
      }
    }
    if (pendingNotice !== null && !pageHidden()) {
      showToast(pendingNotice, 'warning');
      pendingNotice = null;
    }
  }

  function onVisibilityChange() {
    if (pageHidden()) {
      stopHeartbeat();
    } else {
      resume();
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  // Tell the user they lost their seat, or keep it for when they look again.
  function announceRemoval(message: string) {
    if (pageHidden()) {
      pendingNotice = message;
    } else {
      showToast(message, 'warning');
    }
  }

  // Refetch the watched table and apply it as an update. `idle`: a removal
  // found this way happened while the user wasn't looking.
  async function catchUp(tableId: number, idle: boolean) {
    try {
      applyTableUpdate(await tablesService.getTable(tableId), idle);
    } catch (e) {
      if (statusOf(e) !== 404 || watchedTableId.value !== tableId) {
        return;
      }
      // Gone with us still in it as far as we knew: we were the last one
      // there, and our seat went too.
      forget(tableId);
      if (ownSeatRequests === 0) {
        kickedFrom.value = tableId;
        announceRemoval(idle ? IDLE_NOTICE : 'The table you sat at is gone.');
      }
    }
  }

  // A table fresh from the backend: follow its channel while we sit there, and
  // drop it once we don't.
  function followSeat(table: Table) {
    if (seatsMe(table)) {
      watchTable(table.id);
    } else if (watchedTableId.value === table.id) {
      unwatchTable();
    }
  }

  // A `TableUpdated` event (or a refetch after a reconnect or a resume). It is
  // the whole table, so it replaces ours rather than merging into it. `idle`:
  // a removal is worded as the idle-seat sweep rather than a kick, which is
  // what it most likely was when the user wasn't looking (the backend doesn't
  // say which).
  function applyTableUpdate(update: BroadcastTable | Table, idle = pageHidden()) {
    if (watchedTableId.value !== update.id) {
      return;
    }
    const table = withCanManage(update);
    syncTable(table);
    useGameStore().applyTableUpdate(table);
    if (seatsMe(table)) {
      return;
    }
    unwatchTable();
    if (ownSeatRequests === 0) {
      kickedFrom.value = table.id;
      announceRemoval(
        idle ? IDLE_NOTICE : `You were removed from ${table.name || `table #${table.id}`}.`,
      );
    }
  }

  // Events sent while the socket was down are gone for good, so catch up once.
  onReconnect(async () => {
    const tableId = watchedTableId.value;
    if (tableId !== null) {
      await catchUp(tableId, pageHidden());
    }
  });

  async function ownSeatRequest<T>(request: () => Promise<T>): Promise<T> {
    ownSeatRequests++;
    try {
      return await request();
    } finally {
      ownSeatRequests--;
    }
  }

  // The list has no channel of its own (only seated players may subscribe to
  // a table), so it stays refresh-only; it does tell us where we sit, though.
  async function load() {
    tables.value = await tablesService.listTables();
    loaded.value = true;
    const mine = tables.value.find(seatsMe);
    if (mine) {
      watchTable(mine.id);
    } else {
      unwatchTable();
    }
  }

  async function loadTable(tableId: number) {
    const table = await tablesService.getTable(tableId);
    currentTable.value = table;
    upsertInList(table);
    followSeat(table);
    return table;
  }

  // The list is newest first (as the backend orders it), so a new table goes on top.
  async function create(payload: CreateTablePayload) {
    const table = await ownSeatRequest(() => tablesService.createTable(payload));
    tables.value = [table, ...tables.value];
    followSeat(table);
    return table;
  }

  // Replaces the table in place so the page doesn't have to reload the list.
  // Taking a seat while holding one is a move: within the same table it is a
  // plain seat change, but a move off another table frees the old seat (maybe
  // deleting that table or handing its manager role on), and the response only
  // describes the table joined. followSeat() switches channels, and the list is
  // reloaded so the old table's row changes or disappears.
  async function join(tableId: number, seat: Seat) {
    const movedFrom = myTable.value?.id ?? watchedTableId.value;
    const table = await ownSeatRequest(() => tablesService.joinSeat(tableId, seat));
    syncTable(table);
    followSeat(table);
    if (movedFrom !== null && movedFrom !== tableId) {
      await reloadAfterMove(movedFrom);
    }
    return table;
  }

  // The seat is already ours, so a failed reload is not the join failing: the
  // old row just stays stale until the next refresh.
  async function reloadAfterMove(oldTableId: number) {
    try {
      await load();
    } catch {
      return;
    }
    if (currentTable.value?.id === oldTableId) {
      currentTable.value = tables.value.find((t) => t.id === oldTableId) ?? null;
    }
  }

  // Giving up the last seat deletes the table, so the caller has to know which
  // of the two happened before deciding whether to stay on the page.
  async function leave(tableId: number) {
    return applyRemoval(tableId, await ownSeatRequest(() => tablesService.leaveSeat(tableId)));
  }

  // A manager kicking someone else answers exactly like leaving does.
  async function removePlayer(tableId: number, userId: number) {
    return applyRemoval(tableId, await tablesService.removePlayer(tableId, userId));
  }

  // A manager seats another user (never themselves: that is a join, and may
  // be a move). Their broadcast reaches the rest of the table; a fourth seat
  // deals the board and the pages move the players on from board_id.
  async function seatUser(tableId: number, userId: number, seat: Seat) {
    const table = await tablesService.seatUser(tableId, userId, seat);
    syncTable(table);
    return table;
  }

  function applyRemoval(tableId: number, result: tablesService.SeatRemovalResult) {
    if (tablesService.isTableDeleted(result)) {
      forget(tableId);
      return { tableDeleted: true };
    }
    syncTable(result);
    followSeat(result);
    return { tableDeleted: false };
  }

  return {
    tables,
    currentTable,
    loaded,
    myTable,
    watchedTableId,
    kickedFrom,
    load,
    loadTable,
    seatedTable,
    create,
    join,
    leave,
    removePlayer,
    seatUser,
    forget,
    watchTable,
    unwatchTable,
    applyTableUpdate,
  };
});
