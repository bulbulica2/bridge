import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as gameService from '@/services/game';
import type {
  Bid,
  Card,
  Claim,
  HandDealtEvent,
  Phase,
  Playing,
  PublicPlaying,
} from '@/services/game';
import type { BroadcastTable, Seat } from '@/services/tables';
import { leaveUser, listenToUser, onReconnect } from '@/services/echo';
import { useAuthStore } from '@/stores/auth';
import { showToast } from '@/utils/toast';

// What GET /tables/{id}/playing answers for a table without a board.
function waitingState(): Playing {
  return {
    phase: 'waiting',
    playing_id: null,
    set: null,
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
    claim: null,
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

const PHASES: PublicPlaying['phase'][] = ['waiting', 'auction', 'play', 'finished'];

// How far one board has got: every part only grows while the board lasts,
// and each stops before the next one starts (calls, then cards, then who is
// ready for the next board), so comparing them in order is enough.
function progress(state: PublicPlaying): number[] {
  return [
    PHASES.indexOf(state.phase),
    state.auction?.length ?? 0,
    playedCardIds(state).size,
    state.ready?.length ?? 0,
  ];
}

// Is `state` an older picture of the same board than `current`? A call's
// HTTP answer and the table channel race each other, and the later of the
// two must not roll the table back.
function isBehind(state: PublicPlaying, current: PublicPlaying | null): boolean {
  if (!current || current.playing_id === null || current.playing_id !== state.playing_id) {
    return false;
  }
  const a = progress(state);
  const b = progress(current);
  const i = a.findIndex((value, index) => value !== b[index]);
  if (i !== -1) {
    return a[i] < b[i];
  }
  return claimIsBehind(state.claim, current.claim);
}

// Between two cards a claim comes and goes (a reject or a withdrawal leaves
// the cards as they were), so it can't be a counter like the rest: a claim
// appearing or going away is always taken as newer. Only answers to the same
// claim are ordered, by how many have accepted it.
function claimIsBehind(state: Claim | null, current: Claim | null): boolean {
  if (!state || !current || state.seat !== current.seat || state.tricks !== current.tricks) {
    return false;
  }
  return state.accepted.length < current.accepted.length;
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
  // The 38 calls from GET /bids: a call is sent as its id, and ids aren't
  // pinned, so they are read once rather than hard-coded.
  const bids = ref<Bid[]>([]);
  let bidsRequest: Promise<Bid[]> | null = null;

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

  // A full state (hand included) that another request answered with, such as
  // the Start that dealt a board: it becomes the table we hold, so the play
  // page draws at once and this table's events apply from now on. Skipped
  // if the channel already brought a later state of the same board.
  function adopt(id: number, state: Playing) {
    if (tableId.value === id && isBehind(state, playing.value)) {
      return;
    }
    tableId.value = id;
    playing.value = state;
    if (pendingHand?.playing_id === state.playing_id) {
      pendingHand = null;
    }
  }

  // `PlayingUpdated` never carries a hand, so it replaces only the public part
  // and the hand is carried over: the one we hold for the same board (less any
  // card played since), or the one HandDealt brought for a new board. A new
  // board whose HandDealt hasn't come yet shows no hand until it does.
  function applyPlayingUpdate(id: number, update: PublicPlaying) {
    if (tableId.value !== id || isBehind(update, playing.value)) {
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

  // The bid list, fetched once and shared (a second caller waits for the same
  // request). `force` refetches it, for when an id was refused as unknown.
  async function loadBids(force = false): Promise<Bid[]> {
    if (bids.value.length > 0 && !force) {
      return bids.value;
    }
    bidsRequest ??= gameService
      .getBids()
      .then((list) => {
        bids.value = list;
        return list;
      })
      .finally(() => {
        bidsRequest = null;
      });
    return bidsRequest;
  }

  // Our call in the auction. The answer is the whole new state, hand
  // included, so it replaces ours, unless the table channel has already
  // brought a later one (the next player may have called by then).
  async function call(bidId: number): Promise<Playing> {
    return act((id) => gameService.makeCall(id, bidId));
  }

  // Our card (or dummy's, as declarer): same race as a call, since the next
  // player may already have played by the time our answer lands.
  async function play(cardId: number): Promise<Playing> {
    return act((id) => gameService.playCard(id, cardId));
  }

  // Ask for the next board once this one is finished, for ourselves. The
  // answer is the finished board with our seat in `ready`, or the new board
  // itself when we were the last to ask.
  async function next(): Promise<Playing> {
    return act((id) => gameService.nextBoard(id));
  }

  // Claim `tricks` of the remaining tricks for our side (0 concedes). The
  // answer races the channel like a card: a defender may already have
  // answered by the time it lands.
  async function claim(tricks: number): Promise<Playing> {
    return act((id) => gameService.makeClaim(id, tricks));
  }

  // Accept or reject the pending claim. The last accept finishes the board.
  async function respondToClaim(accept: boolean): Promise<Playing> {
    return act((id) => gameService.respondToClaim(id, accept));
  }

  // Take our own pending claim back.
  async function withdrawClaim(): Promise<Playing> {
    return act((id) => gameService.withdrawClaim(id));
  }

  async function act(send: (id: number) => Promise<Playing>): Promise<Playing> {
    const id = tableId.value;
    if (id === null) {
      throw new Error('No board is loaded.');
    }
    const state = await send(id);
    if (tableId.value === id && !isBehind(state, playing.value)) {
      playing.value = state;
      if (pendingHand?.playing_id === state.playing_id) {
        pendingHand = null;
      }
    }
    return state;
  }

  // The phase of `id`'s board, if it is the table we hold.
  function phaseOf(id: number): Phase | null {
    return tableId.value === id ? (playing.value?.phase ?? null) : null;
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
  function applyTableUpdate(table: BroadcastTable) {
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
    bids,
    load,
    adopt,
    loadBids,
    call,
    play,
    claim,
    respondToClaim,
    withdrawClaim,
    next,
    phaseOf,
    applyPlayingUpdate,
    applyHandDealt,
    applyTableUpdate,
    clear,
    watchUser,
    unwatchUser,
  };
});
