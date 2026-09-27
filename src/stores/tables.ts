import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as tablesService from '@/services/tables';
import type { CreateTablePayload, Seat, Table } from '@/services/tables';
import { leaveTable, listenToTable, onReconnect } from '@/services/echo';
import { useAuthStore } from '@/stores/auth';
import { statusOf } from '@/utils/errors';
import { showToast } from '@/utils/toast';

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

  // A table came back from the backend: refresh every copy we hold.
  function syncTable(table: Table) {
    upsertInList(table);
    if (currentTable.value?.id === table.id) {
      currentTable.value = table;
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
    listenToTable(tableId, applyTableUpdate);
  }

  function unwatchTable() {
    if (watchedTableId.value !== null) {
      leaveTable(watchedTableId.value);
      watchedTableId.value = null;
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

  // A `TableUpdated` event (or the refetch after a reconnect). It is the whole
  // table, so it replaces ours rather than merging into it.
  function applyTableUpdate(table: Table) {
    if (watchedTableId.value !== table.id) {
      return;
    }
    syncTable(table);
    if (seatsMe(table)) {
      return;
    }
    unwatchTable();
    if (ownSeatRequests === 0) {
      kickedFrom.value = table.id;
      showToast(`You were removed from ${table.name || `table #${table.id}`}.`, 'warning');
    }
  }

  // Events sent while the socket was down are gone for good, so catch up once.
  onReconnect(async () => {
    const tableId = watchedTableId.value;
    if (tableId === null) {
      return;
    }
    try {
      applyTableUpdate(await tablesService.getTable(tableId));
    } catch (e) {
      if (statusOf(e) === 404) {
        forget(tableId);
      }
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
  // Sitting down while seated elsewhere is a move, which followSeat() turns
  // into a switch of channels.
  async function join(tableId: number, seat: Seat) {
    const table = await ownSeatRequest(() => tablesService.joinSeat(tableId, seat));
    syncTable(table);
    followSeat(table);
    return table;
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
    watchedTableId,
    kickedFrom,
    load,
    loadTable,
    create,
    join,
    leave,
    removePlayer,
    forget,
    watchTable,
    unwatchTable,
    applyTableUpdate,
  };
});
