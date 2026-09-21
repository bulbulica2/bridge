import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as tablesService from '@/services/tables';
import type { CreateTablePayload, Seat, Table } from '@/services/tables';

export const useTablesStore = defineStore('tables', () => {
  const tables = ref<Table[]>([]);
  // The table the detail page is showing, held next to the list so both stay
  // truthful when a seat changes from either page.
  const currentTable = ref<Table | null>(null);

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
    tables.value = tables.value.filter((t) => t.id !== tableId);
    if (currentTable.value?.id === tableId) {
      currentTable.value = null;
    }
  }

  async function load() {
    tables.value = await tablesService.listTables();
  }

  async function loadTable(tableId: number) {
    const table = await tablesService.getTable(tableId);
    currentTable.value = table;
    upsertInList(table);
    return table;
  }

  // The list is newest first (as the backend orders it), so a new table goes on top.
  async function create(payload: CreateTablePayload) {
    const table = await tablesService.createTable(payload);
    tables.value = [table, ...tables.value];
    return table;
  }

  // Replaces the table in place so the page doesn't have to reload the list.
  async function join(tableId: number, seat: Seat) {
    const table = await tablesService.joinSeat(tableId, seat);
    syncTable(table);
    return table;
  }

  // Giving up the last seat deletes the table, so the caller has to know which
  // of the two happened before deciding whether to stay on the page.
  async function leave(tableId: number) {
    return applyRemoval(tableId, await tablesService.leaveSeat(tableId));
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
    return { tableDeleted: false };
  }

  return { tables, currentTable, load, loadTable, create, join, leave, removePlayer, forget };
});
