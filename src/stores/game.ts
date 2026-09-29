import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as gameService from '@/services/game';
import type { Card, HandDealtEvent, Playing, PublicPlaying } from '@/services/game';
import type { Seat, Table } from '@/services/tables';
import { leaveUser, listenToUser, onReconnect } from '@/services/echo';
import { useAuthStore } from '@/stores/auth';
import { showToast } from '@/utils/toast';

// What GET /tables/{id}/playing answers for a table without a board.
function waitingState(): Playing {
  return {
    phase: 'waiting',
    playing_id: null,
    board: null,
    players: null,
    turn: null,
    acting_user_id: null,
    auction: null,
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    result: null,
    deal: null,
    ready: null,
    my_seat: null,
    hand: null,
  };
}

// Every card already face up on the table, which no hand holds any more.
function playedCardIds(state: PublicPlaying): Set<number> {
  const played = [...(state.tricks ?? []).flatMap((t) => t.cards), ...(state.current_trick ?? [])];
  return new Set(played.map((p) => p.card.id));
}

export const useGameStore = defineStore('game', () => {
  // The game state of one table's current board, with the user's own hand.
  // Only the table the play page last loaded: events for any other are ignored.
  const playing = ref<Playing | null>(null);
  const tableId = ref<number | null>(null);
  // The user whose own channel (HandDealt) we listen on.
  const watchedUserId = ref<number | null>(null);
  // A HandDealt that beat its board's PlayingUpdated: both come from the same
  // request, but on different channels, so either can arrive first.
  let pendingHand: HandDealtEvent | null = null;

  const auth = useAuthStore();

  function mySeatIn(state: PublicPlaying): Seat | null {
    const me = auth.user?.id;
    const entry = Object.entries(state.players ?? {}).find(([, user]) => user.id === me);
    return (entry?.[0] as Seat | undefined) ?? null;
  }

  // The HTTP snapshot is the whole truth (hand included), so it replaces
  // everything: this is also how a reload or a reconnect catches up.
  async function load(id: number) {
    const state = await gameService.getPlaying(id);
    tableId.value = id;
    playing.value = state;
    if (pendingHand?.playing_id === state.playing_id) {
      pendingHand = null;
    }
    return state;
  }

  // `PlayingUpdated` never carries a hand, so it replaces only the public part
  // and the hand is carried over: the one we hold for the same board (less any
  // card played since), or the one HandDealt brought for a new board. A new
  // board whose HandDealt hasn't come yet shows no hand until it does.
  function applyPlayingUpdate(id: number, update: PublicPlaying) {
    if (tableId.value !== id) {
      return;
    }
    const current = playing.value;
    let hand: Card[] | null = null;
    if (current && current.playing_id === update.playing_id && current.hand) {
      const played = playedCardIds(update);
      hand = current.hand.filter((card) => !played.has(card.id));
    } else if (pendingHand && pendingHand.playing_id === update.playing_id) {
      hand = pendingHand.hand;
      pendingHand = null;
    }
    playing.value = { ...update, my_seat: mySeatIn(update), hand };
  }

  // Our own cards for a board just dealt, from the user channel.
  function applyHandDealt(event: HandDealtEvent) {
    const current = playing.value;
    if (current && current.playing_id === event.playing_id) {
      playing.value = { ...current, my_seat: event.my_seat, hand: event.hand };
    } else {
      pendingHand = event;
    }
  }

  // A `TableUpdated` for the table we show. A player leaving mid-board
  // abandons it: `board_id` goes back to null and no PlayingUpdated follows,
  // so this is where the table goes back to waiting.
  function applyTableUpdate(table: Table) {
    const current = playing.value;
    if (tableId.value !== table.id || !current) {
      return;
    }
    if (!table.seats.some((s) => s.user_id === auth.user?.id)) {
      // We left or were kicked: nothing here is ours to show any more.
      clear();
      return;
    }
    if (table.board_id !== null || (current.phase !== 'auction' && current.phase !== 'play')) {
      return;
    }
    const leaver = Object.values(current.players ?? {}).find(
      (user) => !table.seats.some((s) => s.user_id === user.id),
    );
    playing.value = waitingState();
    showToast(
      `${leaver ? leaver.username : 'A player'} left, the board was abandoned.`,
      'warning',
    );
  }

  function clear() {
    playing.value = null;
    tableId.value = null;
    pendingHand = null;
  }

  // Follow the user's own channel from login to logout: a board can be dealt
  // while they look at any page, and its HandDealt is sent only once.
  function watchUser(userId: number) {
    if (watchedUserId.value === userId) {
      return;
    }
    unwatchUser();
    watchedUserId.value = userId;
    listenToUser(userId, applyHandDealt);
  }

  function unwatchUser() {
    if (watchedUserId.value !== null) {
      leaveUser(watchedUserId.value);
      watchedUserId.value = null;
    }
    clear();
  }

  // Whatever was broadcast while the socket was down is lost: refetch.
  onReconnect(() => {
    if (tableId.value !== null) {
      load(tableId.value).catch(() => {
        // The page shows its own errors on its next load; nothing to add here.
      });
    }
  });

  return {
    playing,
    tableId,
    watchedUserId,
    load,
    applyPlayingUpdate,
    applyHandDealt,
    applyTableUpdate,
    clear,
    watchUser,
    unwatchUser,
  };
});
