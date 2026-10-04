import { computed, inject } from 'vue';
import { routeLocationKey } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useTablesStore } from '@/stores/tables';
import { myAwaySeat } from '@/utils/away';
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

  // The play page once a board is dealt (and to come back to an away seat, as
  // Home's card does), else the table's own page: a seat's rule on Tables.
  const target = computed(() => {
    const t = table.value;
    if (!t) {
      return null;
    }
    return away.value || t.board_id !== null ? `/tables/${t.id}/play` : `/tables/${t.id}`;
  });

  // The page the shortcut leads to is the one on screen.
  const current = computed(() => !!target.value && route?.path === target.value);

  // On either page of the table (the other one may still be a tap away).
  const atTable = computed(() => {
    const t = table.value;
    const path = route?.path;
    return !!t && (path === `/tables/${t.id}` || path === `/tables/${t.id}/play`);
  });

  const label = computed(() => {
    const t = table.value;
    return t ? t.name || `Table #${t.id}` : '';
  });

  // "Your turn" needs the board, which the game store holds once the play
  // page has read it (or Start dealt it); the table alone tells a Start.
  const status = computed<YourTableStatus>(() => {
    const t = table.value;
    if (!t) {
      return null;
    }
    if (away.value) {
      return 'away';
    }
    const playing = game.tableId === t.id ? game.playing : null;
    if (turnNotice(playing, auth.user?.id ?? null, t, startNeeded(t, playing)) !== null) {
      return 'turn';
    }
    return t.board_id !== null ? 'board' : null;
  });

  const statusText = computed(() => (status.value ? STATUS_TEXT[status.value] : ''));

  // For a screen reader: "Your table: Table #3, your turn".
  const ariaLabel = computed(() =>
    statusText.value
      ? `Your table: ${label.value}, ${statusText.value.toLowerCase()}`
      : `Your table: ${label.value}`,
  );

  return { table, target, current, atTable, label, status, statusText, ariaLabel };
}
