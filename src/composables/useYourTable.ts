import { computed, inject } from 'vue';
import { routeLocationKey } from 'vue-router';
import { useTurnClock } from '@/composables/useTurnClock';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useTablesStore } from '@/stores/tables';
import { formatClock, myAwaySeat } from '@/utils/away';
import { startNeeded } from '@/utils/start';
import { turnNotice } from '@/utils/turn';

// What the table's shortcut says about it, most pressing first: our seat is
// held (we left mid-set, or were marked away), the game waits for us, or a
// board is being played there.
export type YourTableStatus = 'away' | 'turn' | 'board' | null;

export const STATUS_TEXT: Record<Exclude<YourTableStatus, null>, string> = {
  away: 'Away',
  turn: 'Your turn',
  board: 'Board in progress',
};

// The table the user sits at, as the header's button and the menu's entry
// show it: one tap back to the game from any page. Nothing for a guest, a
// banned user (the table pages would send them away) or somebody not seated.
// The tables store's `myTable` is known on every page: the router asks for
// the seat (findSeat) on the pages that don't load tables themselves.
export function useYourTable() {
  const auth = useAuthStore();
  const tables = useTablesStore();
  const game = useGameStore();
  // Without a router (some page tests) nothing is the current page.
  const route = inject(routeLocationKey, null);

  const table = computed(() =>
    auth.isAuthenticated && !auth.isBanned ? tables.myTable : null,
  );

  // Our seat is held after a Leave mid-set, or marked away (AwayNotice's
  // held seat): opening the game is coming back.
  const away = computed(() => {
    const t = table.value;
    return !!t && (tables.heldTableId === t.id || !!myAwaySeat(t, auth.user?.id ?? null));
  });

  // The game table, the table's one page (#181): the board, or the waiting
  // table with Start, or coming back to an away seat.
  const target = computed(() => (table.value ? `/tables/${table.value.id}/play` : null));

  // The page the shortcut leads to is the one on screen.
  const current = computed(() => !!target.value && route?.path === target.value);

  // At the table: the same page now that it has only one.
  const atTable = current;

  const label = computed(() => {
    const t = table.value;
    return t ? t.name || `Table #${t.id}` : '';
  });

  // The board we hold of this table: the game store has it once the play
  // page has read it (or Start dealt it).
  const playing = computed(() => {
    const t = table.value;
    return t && game.tableId === t.id ? game.playing : null;
  });

  // Our turn clock there, when it runs (bb#120): the turn status counts it.
  const { clock } = useTurnClock(
    () => playing.value,
    () => auth.user?.id ?? null,
  );

  // "Your turn" needs the board; the table alone tells a Start.
  const status = computed<YourTableStatus>(() => {
    const t = table.value;
    if (!t) {
      return null;
    }
    if (away.value) {
      return 'away';
    }
    if (turnNotice(playing.value, auth.user?.id ?? null, t, startNeeded(t, playing.value)) !== null) {
      return 'turn';
    }
    return t.board_id !== null ? 'board' : null;
  });

  // "Your turn · 0:42" while our clock runs.
  const statusText = computed(() => {
    if (!status.value) {
      return '';
    }
    const mine = status.value === 'turn' && clock.value?.mine ? clock.value : null;
    return mine ? `${STATUS_TEXT.turn} · ${formatClock(mine.seconds)}` : STATUS_TEXT[status.value];
  });

  // For a screen reader: "Your table: Table #3, your turn".
  const ariaLabel = computed(() =>
    statusText.value
      ? `Your table: ${label.value}, ${statusText.value.toLowerCase()}`
      : `Your table: ${label.value}`,
  );

  return { table, target, current, atTable, label, status, statusText, ariaLabel };
}
