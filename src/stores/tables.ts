import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as tablesService from '@/services/tables';
import type { CreateTablePayload, Seat, Table } from '@/services/tables';

export const useTablesStore = defineStore('tables', () => {
  const tables = ref<Table[]>([]);

  async function load() {
    tables.value = await tablesService.listTables();
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
    tables.value = tables.value.map((t) => (t.id === table.id ? table : t));
    return table;
  }

  return { tables, load, create, join };
});
