import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as tablesService from '@/services/tables';
import type { BroadcastTable, CreateTablePayload, Seat, Table } from '@/services/tables';
import { leaveTable, listenToTable, onReconnect } from '@/services/echo';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useHistoryStore } from '@/stores/history';
import { lostSetText, myAwaySeat, setAtStake } from '@/utils/away';
import type { LostSet } from '@/utils/away';
import { statusOf } from '@/utils/errors';
import { sideOf } from '@/utils/result';
import { runningSet, sideOfCode } from '@/utils/sets';
import { showToast } from '@/utils/toast';

// How often a seated player tells the backend they are still there. It frees
// a seat after a few idle minutes (BRIDGE_IDLE_SEAT_MINUTES, 5 by default)
// and, mid-set, marks a player away after a minute without one
// (BRIDGE_AWAY_SECONDS), so a single lost beat never costs anybody anything.
export const HEARTBEAT_MS = 30_000;

export const IDLE_NOTICE = 'You were removed from the table after being inactive.';

export const WELCOME_BACK = 'Welcome back. The set goes on.';

// The set the user was last in the middle of, kept across visits: if their
// side forfeited it while they were gone (the tab closed), the next visit
// says so. Browser storage may be missing or refuse; then it just isn't told.
const SET_MEMORY_KEY = 'bridge.setInProgress';

interface SetMemory {
  userId: number;
  tableId: number;
  setId: number;
}

function readSetMemory(): SetMemory | null {
  try {
    const raw = localStorage.getItem(SET_MEMORY_KEY);
    return raw ? (JSON.parse(raw) as SetMemory) : null;
  } catch {
    return null;
  }
}

function writeSetMemory(memory: SetMemory | null) {
  try {
    if (memory) {
      localStorage.setItem(SET_MEMORY_KEY, JSON.stringify(memory));
    } else {
      localStorage.removeItem(SET_MEMORY_KEY);
    }
  } catch {
    // Not kept: a forfeit while away is then only told live.
  }
}

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
  // The watched table where our seat is *held* rather than ours: we left in
  // the middle of a set (the backend's 202), or found the seat away when we
  // weren't following the table (the tab was closed). No heartbeat goes out
  // for it, since one would bring us back behind the user's back; the play
  // page, or the detail page's "Come back", does that (comeBack).
  const heldTableId = ref<number | null>(null);
  // A set our side lost by forfeit while we were away from it, told on Home
  // until dismissed (and the pages showing that table go to its results).
  const lostSet = ref<LostSet | null>(null);
  // Our own seat requests in flight. Their broadcast can beat the HTTP
  // response, and an update that unseats us then is our own doing, not a kick.
  let ownSeatRequests = 0;
  // The heartbeat for the watched table: running while the page is visible,
  // paused while it is hidden (a closed or backgrounded app is exactly what
  // the backend should see as idle), except in the middle of a set, where
  // three quiet minutes lose the set: switching tabs while partner thinks
  // isn't leaving (bridge_backend docs/API.md, POST /tables/{table}/heartbeat).
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  // How many updates of the watched table have come over the channel. A
  // Start answer that a broadcast overtook is older than what we show (the
  // other player's Start, or the board it dealt), so it is not applied.
  let tableUpdates = 0;
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
  // leaves the old channel first. `away`: our seat there is away and we
  // weren't following the table, so it is held, not reclaimed (heldTableId).
  function watchTable(tableId: number, away = false) {
    if (watchedTableId.value === tableId) {
      return;
    }
    unwatchTable();
    watchedTableId.value = tableId;
    kickedFrom.value = null;
    if (away) {
      heldTableId.value = tableId;
    }
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
    heldTableId.value = null;
    if (watchedTableId.value !== null) {
      leaveTable(watchedTableId.value);
      watchedTableId.value = null;
    }
  }

  // Whether the table is in the middle of a set, as far as the table and
  // (for the same table) the board we hold can tell.
  function midSet(tableId: number) {
    const game = useGameStore();
    return !!runningSet(heldTable(tableId), game.tableId === tableId ? game.playing : null);
  }

  // Whether we vouch for the watched table now: never for a held seat, and
  // while the page is hidden only in the middle of a set.
  function shouldBeat() {
    const tableId = watchedTableId.value;
    return (
      tableId !== null && heldTableId.value !== tableId && (!pageHidden() || midSet(tableId))
    );
  }

  function startHeartbeat() {
    stopHeartbeat();
    if (shouldBeat()) {
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
    if (!shouldBeat()) {
      // Hidden, and the set ended meanwhile: back to pausing while hidden.
      stopHeartbeat();
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
  // whatever happened meanwhile. A seat lost while away is told as such. A
  // held seat stays held (no beat, no game request): only catching up.
  async function resume() {
    const tableId = watchedTableId.value;
    if (tableId !== null) {
      const held = heldTableId.value === tableId;
      if (!held) {
        startHeartbeat();
        await tablesService.sendHeartbeat(tableId).catch(() => {
          // The refetch below tells whether we still sit there.
        });
      }
      await catchUp(tableId, true);
      const game = useGameStore();
      if (!held && watchedTableId.value === tableId && game.tableId === tableId) {
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
      if (!shouldBeat()) {
        stopHeartbeat();
      }
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
      watchTable(table.id, !!myAwaySeat(table, auth.user?.id ?? null));
      rememberSet(table);
    } else if (watchedTableId.value === table.id) {
      unwatchTable();
    }
  }

  // Coming back to a table whose seat is held, or that has us down as away
  // (the play page on entry, the detail page's "Come back"): vouch at once,
  // then refetch, so the seat cleared of `away_since` greets us
  // (applyTableUpdate) even if its TableUpdated went by before the channel
  // was up.
  async function comeBack(tableId: number) {
    if (watchedTableId.value !== tableId) {
      return;
    }
    const wasHeld = heldTableId.value === tableId;
    heldTableId.value = null;
    startHeartbeat();
    const table = heldTable(tableId);
    if (!wasHeld && !(table && myAwaySeat(table, auth.user?.id ?? null))) {
      return;
    }
    await tablesService.sendHeartbeat(tableId).catch(() => {
      // The refetch below tells whether we still sit there.
    });
    await catchUp(tableId, false);
  }

  // Back in time: the seat is ours again and the set goes on. The board may
  // have moved on while we were gone, so read it again.
  function welcomeBack(tableId: number) {
    showToast(WELCOME_BACK, 'success');
    const game = useGameStore();
    if (game.tableId === tableId) {
      game.load(tableId).catch(() => {
        // The page reads it again on its next load.
      });
    }
  }

  // Keep the set we are in the middle of in mind across visits (see
  // SET_MEMORY_KEY), and forget it once that set is seen to end with us.
  function rememberSet(table: BroadcastTable) {
    const me = auth.user?.id;
    if (!me) {
      return;
    }
    const memory = readSetMemory();
    const running = table.set && !table.set.finished ? table.set : null;
    if (running && (memory?.setId !== running.id || memory.userId !== me)) {
      writeSetMemory({ userId: me, tableId: table.id, setId: running.id });
    } else if (!running && memory?.tableId === table.id) {
      writeSetMemory(null);
    }
  }

  // Our seat was freed because our side forfeited the set: we were away too
  // long (or kicked while away). From the update that freed us, and the seat
  // we held before it.
  function lostSetFrom(table: BroadcastTable, seat: Seat | undefined): LostSet | null {
    const set = table.set;
    if (!seat || !set || set.ended !== 'forfeit' || !set.forfeited_by) {
      return null;
    }
    const side = sideOf(seat);
    return sideOfCode(set.forfeited_by) === side
      ? { id: set.id, number: set.number, side, tableId: table.id }
      : null;
  }

  // A later visit: the set we were in the middle of, at a table we no longer
  // sit at. If our side forfeited it meanwhile, say so (GET /sets/{id}).
  async function checkLostSet() {
    const memory = readSetMemory();
    const me = auth.user?.id;
    if (!memory || !me) {
      return;
    }
    if (memory.userId !== me) {
      writeSetMemory(null);
      return;
    }
    if (tables.value.some((t) => t.id === memory.tableId && seatsMe(t))) {
      return;
    }
    let set;
    try {
      set = await useHistoryStore().loadSet(memory.setId);
    } catch (e) {
      const status = statusOf(e);
      if (status === 403 || status === 404) {
        writeSetMemory(null);
      }
      return;
    }
    writeSetMemory(null);
    const seat = tablesService.SEATS.find((s) => set.players[s]?.id === me);
    if (seat && set.ended === 'forfeit' && set.forfeited_by && sideOfCode(set.forfeited_by) === sideOf(seat)) {
      lostSet.value = {
        id: memory.setId,
        number: set.number,
        side: sideOf(seat),
        tableId: memory.tableId,
      };
    }
  }

  function dismissLostSet() {
    lostSet.value = null;
  }

  // What walking out of `table` now would put at stake (utils/away), with
  // the board we hold of it, if any, and whether we are an admin.
  function stakeOf(table: Table) {
    const game = useGameStore();
    return setAtStake(
      table,
      game.tableId === table.id ? game.playing : null,
      auth.user?.id ?? null,
      !!auth.user?.is_admin,
    );
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
    tableUpdates++;
    const me = auth.user?.id ?? null;
    const before = heldTable(update.id);
    const wasAway = !!before && !!myAwaySeat(before, me);
    const mySeat = before?.seats.find((s) => s.user_id === me)?.seat;
    const table = withCanManage(update);
    syncTable(table);
    useGameStore().applyTableUpdate(table);
    if (seatsMe(table)) {
      rememberSet(table);
      const away = !!myAwaySeat(table, me);
      if (wasAway && !away) {
        welcomeBack(table.id);
      } else if (away && !wasAway && heldTableId.value !== table.id && heartbeat !== null) {
        // Marked away while this client still vouches for us (a beat lost or
        // late): vouch now, and the backend takes the mark back.
        beat();
      }
      return;
    }
    unwatchTable();
    if (ownSeatRequests === 0) {
      kickedFrom.value = table.id;
      const lost = lostSetFrom(table, mySeat);
      if (lost) {
        lostSet.value = lost;
        writeSetMemory(null);
        announceRemoval(lostSetText(lost));
        return;
      }
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
      followSeat(mine);
    } else {
      unwatchTable();
    }
    checkLostSet();
  }

  async function loadTable(tableId: number) {
    const before = watchedTableId.value === tableId ? heldTable(tableId) : null;
    const table = await tablesService.getTable(tableId);
    currentTable.value = table;
    upsertInList(table);
    followSeat(table);
    // A refresh can be the first to show our away mark taken back.
    const me = auth.user?.id ?? null;
    if (before && myAwaySeat(before, me) && seatsMe(table) && !myAwaySeat(table, me)) {
      welcomeBack(tableId);
    }
    return table;
  }

  // A page opening a table: the copy we already follow live is as fresh as a
  // refetch would be (TableUpdated replaces it on every change), so only a
  // table we don't watch costs a GET. Pull-to-refresh still calls loadTable().
  async function openTable(tableId: number) {
    const held = watchedTableId.value === tableId ? heldTable(tableId) : null;
    if (!held) {
      return loadTable(tableId);
    }
    currentTable.value = held;
    return held;
  }

  // The list is newest first (as the backend orders it), so a new table goes on
  // top. It is also the table the next page shows (the detail page, after
  // Create with robots), so that page can draw it without a GET.
  async function create(payload: CreateTablePayload) {
    const table = await ownSeatRequest(() => tablesService.createTable(payload));
    tables.value = [table, ...tables.value];
    currentTable.value = table;
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
    if (movedFrom !== null && movedFrom !== tableId) {
      // Walked out on any set there (forfeited at once mid-set, as the move
      // was confirmed): nothing to tell on a later visit.
      writeSetMemory(null);
    }
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
  // of the two happened before deciding whether to stay on the page. In the
  // middle of a set the seat is held instead (`held`): we stay seated, away,
  // and stop vouching for it, or the next beat would bring us back.
  async function leave(tableId: number) {
    const result = await ownSeatRequest(() => tablesService.leaveSeat(tableId));
    if (!tablesService.isTableDeleted(result) && seatsMe(result)) {
      syncTable(result);
      if (watchedTableId.value === tableId) {
        heldTableId.value = tableId;
        stopHeartbeat();
      } else {
        watchTable(tableId, true);
      }
      return { tableDeleted: false, held: true };
    }
    // Gone at once: no set of ours was left running there to tell about.
    writeSetMemory(null);
    return { ...applyRemoval(tableId, result), held: false };
  }

  // A manager kicking someone else (or anyone taking a robot out of an
  // unattended table) answers exactly like leaving does.
  async function removePlayer(tableId: number, userId: number) {
    return applyRemoval(tableId, await tablesService.removePlayer(tableId, userId));
  }

  // A manager seats another user (never themselves: that is a join, and may
  // be a move). Their broadcast reaches the rest of the table. It deals
  // nothing: the newcomer presses Start like everybody else.
  async function seatUser(tableId: number, userId: number, seat: Seat) {
    const table = await tablesService.seatUser(tableId, userId, seat);
    syncTable(table);
    return table;
  }

  // A manager puts a robot in a free seat. A robot is always ready, so the
  // fourth seat taken this way deals the board if every human has pressed
  // Start; the pages move the players on from board_id.
  async function seatRobot(tableId: number, seat: Seat) {
    const table = await tablesService.seatRobot(tableId, seat);
    syncTable(table);
    return table;
  }

  // Our Start: the board is dealt once the table is full and every human has
  // pressed it. The answer that deals carries our game state, which goes to
  // the game store first, so the board_id it brings takes the page to /play
  // with the board already there. Everyone else learns it from TableUpdated
  // (and PlayingUpdated + HandDealt when it deals).
  async function start(tableId: number) {
    const seen = tableUpdates;
    const { playing, ...table } = await tablesService.startTable(tableId);
    if (playing) {
      useGameStore().adopt(tableId, playing);
    }
    if (tableUpdates === seen) {
      syncTable(table);
    }
    return table;
  }

  // Take our Start back while nothing is dealt.
  async function cancelStart(tableId: number) {
    const seen = tableUpdates;
    const table = await tablesService.cancelStart(tableId);
    if (tableUpdates === seen) {
      syncTable(table);
    }
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
    heldTableId,
    lostSet,
    load,
    loadTable,
    openTable,
    seatedTable,
    create,
    join,
    leave,
    removePlayer,
    seatUser,
    seatRobot,
    start,
    cancelStart,
    forget,
    watchTable,
    unwatchTable,
    applyTableUpdate,
    comeBack,
    dismissLostSet,
    stakeOf,
  };
});
