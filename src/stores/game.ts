import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as gameService from '@/services/game';
import type {
  AlertDraft,
  Bid,
  CallAlertedEvent,
  CallQuestionedEvent,
  Card,
  Claim,
  CompactPlaying,
  DeclarerHandShownEvent,
  HandDealtEvent,
  Phase,
  Playing,
  PublicPlaying,
} from '@/services/game';
import type { BroadcastTable, Seat } from '@/services/tables';
import type { BoardMessageSentEvent } from '@/services/chat';
import { leaveUser, listenToUser, onReconnect } from '@/services/echo';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import {
  answerText,
  emptyBook,
  noteAlert,
  noteQuestion,
  questionText,
  takeNotes,
  withNotes,
} from '@/utils/alerts';
import type { AlertBook } from '@/utils/alerts';
import { asksAboutMyCall, chatQuestionText } from '@/utils/chat';
import { expandPlaying } from '@/utils/compact';
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
    claim_locked: false,
    result: null,
    deal: null,
    ready: null,
    next_board_at: null,
    my_seat: null,
    hand: null,
    declarer_hand: null,
  };
}

// A question about one of our calls comes twice when asked with the Ask
// button (`CallQuestioned`, and its line in the chat): it is told once.
const QUESTION_TOLD_MS = 10_000;

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
  // The user whose own channel (HandDealt, UserBanned) we listen on.
  const watchedUserId = ref<number | null>(null);
  // A HandDealt that beat its board's PlayingUpdated: both come from the same
  // request, but on different channels, so either can arrive first.
  let pendingHand: HandDealtEvent | null = null;
  // The set whose forfeit we have told (applyTableUpdate), so a later event
  // of the same table doesn't tell it again.
  let forfeitToldFor: number | null = null;
  // The 38 calls from GET /bids: a call is sent as its id, and ids aren't
  // pinned, so they are read once rather than hard-coded.
  const bids = ref<Bid[]>([]);
  let bidsRequest: Promise<Bid[]> | null = null;
  // The 52 cards from GET /cards: `PlayingUpdated` sends cards (and calls) as
  // ids, which these two lists turn back into what the page draws.
  const cards = ref<Card[]>([]);
  let cardsRequest: Promise<Card[]> | null = null;
  const cardsById = computed(() => new Map(cards.value.map((card) => [card.id, card])));
  const bidsById = computed(() => new Map(bids.value.map((bid) => [bid.id, bid])));
  // The `PlayingUpdated`s waiting for those lists, in the order they came.
  let updateQueue: Promise<void> | null = null;
  // The alerts and open questions we know of on the board we hold, by call
  // index: `PlayingUpdated` carries none, so they are kept here and laid
  // back on every state we show. Our HTTP answers and the user channel's
  // `CallAlerted`/`CallQuestioned` fill it; a new board starts it again.
  let alerts: AlertBook = emptyBook();
  // When each question about one of our calls was last told, by
  // `playing:index:asker`.
  const questionsTold = new Map<string, number>();

  const auth = useAuthStore();

  // Tell a question about our call at `index`, unless the same one was told
  // a moment ago. Toasts stay at the top, off the bidding box and the hand.
  function tellQuestion(playingId: number, index: number, askedBy: Seat, text: string) {
    const key = `${playingId}:${index}:${askedBy}`;
    const now = Date.now();
    if (now - (questionsTold.get(key) ?? -Infinity) < QUESTION_TOLD_MS) {
      return;
    }
    questionsTold.set(key, now);
    showToast(text, 'warning', 'top');
  }

  function mySeatIn(state: PublicPlaying): Seat | null {
    const me = auth.user?.id;
    const entry = Object.entries(state.players ?? {}).find(([, user]) => user.id === me);
    return (entry?.[0] as Seat | undefined) ?? null;
  }

  // A full state answered over HTTP, with the alerts we may see: they go in
  // the book, and the state is shown with every alert known.
  function hold(state: Playing) {
    alerts = takeNotes(alerts, state);
    playing.value = withNotes(state, alerts);
    if (pendingHand?.playing_id === state.playing_id) {
      pendingHand = null;
    }
  }

  // The HTTP snapshot is the whole truth (hand included), so it replaces
  // everything: this is also how a reload or a reconnect catches up.
  async function load(id: number) {
    const state = await gameService.getPlaying(id);
    tableId.value = id;
    hold(state);
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
    hold(state);
  }

  // `PlayingUpdated` never carries a hand, so it replaces only the public part
  // and the hand is carried over: the one we hold for the same board (less any
  // card played since), or the one HandDealt brought for a new board. A new
  // board whose HandDealt hasn't come yet shows no hand until it does. A
  // robot declarer's hand we play (`declarer_hand`) is carried over the same
  // way, until the play is over.
  function applyPlayingUpdate(id: number, update: PublicPlaying) {
    if (tableId.value !== id || isBehind(update, playing.value)) {
      return;
    }
    const current = playing.value;
    const sameBoard = !!current && current.playing_id === update.playing_id;
    const played = playedCardIds(update);
    const unplayed = (cards: Card[]) => cards.filter((card) => !played.has(card.id));
    let hand: Card[] | null = null;
    if (sameBoard && current.hand) {
      hand = unplayed(current.hand);
    } else if (pendingHand && pendingHand.playing_id === update.playing_id) {
      hand = pendingHand.hand;
      pendingHand = null;
    }
    const declarerHand =
      sameBoard && current.declarer_hand && update.phase === 'play'
        ? unplayed(current.declarer_hand)
        : null;
    playing.value = withNotes(
      { ...update, my_seat: mySeatIn(update), hand, declarer_hand: declarerHand },
      alerts,
    );
  }

  // A `PlayingUpdated` as the table channel brings it: compact, every card
  // and call an id (bridge_backend docs/API.md, Event PlayingUpdated). Applied
  // at once when both lists are held; otherwise it waits for them behind any
  // update already waiting, so the events still apply in order. Without the
  // lists the state is read over HTTP instead.
  function receivePlayingUpdate(id: number, update: CompactPlaying) {
    if (!updateQueue && cards.value.length > 0 && bids.value.length > 0) {
      applyCompact(id, update);
      return;
    }
    const queued: Promise<void> = (updateQueue ?? Promise.resolve())
      .then(() => Promise.all([loadCards(), loadBids()]))
      .then(
        () => applyCompact(id, update),
        () => reload(id),
      )
      .finally(() => {
        if (updateQueue === queued) {
          updateQueue = null;
        }
      });
    updateQueue = queued;
  }

  function applyCompact(id: number, update: CompactPlaying) {
    let expanded: PublicPlaying;
    try {
      expanded = expandPlaying(update, cardsById.value, bidsById.value);
    } catch {
      // An id neither list has: they are out of date. Read them again for the
      // next event, and this state over HTTP.
      Promise.all([loadCards(true), loadBids(true)]).catch(() => {
        // The next event tries again.
      });
      return reload(id);
    }
    applyPlayingUpdate(id, expanded);
  }

  // The HTTP state of the table we hold, for an event we couldn't read.
  async function reload(id: number) {
    if (tableId.value === id) {
      await load(id).catch(() => {
        // The page shows its own errors on its next load.
      });
    }
  }

  // The card list, fetched once and shared like the bids.
  async function loadCards(force = false): Promise<Card[]> {
    if (cards.value.length > 0 && !force) {
      return cards.value;
    }
    cardsRequest ??= gameService
      .getCards()
      .then((list) => {
        cards.value = list;
        return list;
      })
      .finally(() => {
        cardsRequest = null;
      });
    return cardsRequest;
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

  // Our call in the auction, alerted to the opponents if `alert` says so.
  // The answer is the whole new state, hand included, so it replaces ours,
  // unless the table channel has already brought a later one (the next
  // player may have called by then).
  async function call(bidId: number, alert: AlertDraft | null = null): Promise<Playing> {
    return act((id) => gameService.makeCall(id, bidId, alert));
  }

  // Ask what the opponents' call at `index` of the auction means. A robot's
  // answer is in the state we get back; a human's comes as `CallAlerted`.
  async function askAboutCall(index: number): Promise<Playing> {
    return act((id) => gameService.askAboutCall(id, index));
  }

  // Explain our own call at `index` to the opponents: an answer to their
  // question, or a late or fixed alert.
  async function explainCall(index: number, explanation: string): Promise<Playing> {
    return act((id) => gameService.explainCall(id, index, explanation));
  }

  // Our card (or dummy's, as declarer, or a robot declarer's, as its dummy):
  // same race as a call, since the next
  // player may already have played by the time our answer lands.
  async function play(cardId: number): Promise<Playing> {
    return act((id) => gameService.playCard(id, cardId));
  }

  // Ask for the next board now, before its `next_board_at`, for ourselves.
  // The answer is the finished board with our seat in `ready`, or the new
  // board itself when we were the last human to ask.
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
      hold(state);
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

  // A robot declarer's cards, for us, its dummy, to play: the auction ended
  // (usually on a robot's call, so no answer of ours carried them). Only for
  // the board we hold; any other gets them from GET /playing when loaded.
  function applyDeclarerHand(event: DeclarerHandShownEvent) {
    const current = playing.value;
    if (tableId.value !== event.table_id || current?.playing_id !== event.playing_id) {
      return;
    }
    const played = playedCardIds(current);
    playing.value = {
      ...current,
      declarer_hand: event.declarer_hand.filter((card) => !played.has(card.id)),
    };
  }

  // An opponent alerted or explained one of their calls (`CallAlerted`, on
  // our own channel): into the book, and onto the table if it is the board
  // we hold. The answer to a question we (or partner) asked is also told.
  function applyCallAlerted(event: CallAlertedEvent) {
    if (tableId.value !== event.table_id) {
      return;
    }
    const current = playing.value;
    const call =
      current?.playing_id === event.playing_id ? current.auction?.[event.index] : undefined;
    alerts = noteAlert(alerts, event.playing_id, event.index, event.explanation);
    if (current) {
      playing.value = withNotes(current, alerts);
    }
    if (call?.question) {
      showToast(answerText(call, { explanation: event.explanation }), 'success');
    }
  }

  // An opponent asks what one of our calls means (`CallQuestioned`): said
  // wherever we are, and the play page offers the answer.
  function applyCallQuestioned(event: CallQuestionedEvent) {
    const current = playing.value;
    const held = tableId.value === event.table_id;
    const call =
      held && current?.playing_id === event.playing_id ? current.auction?.[event.index] : null;
    if (held) {
      alerts = noteQuestion(alerts, event.playing_id, event.index, event.asked_by);
      if (current) {
        playing.value = withNotes(current, alerts);
      }
    }
    tellQuestion(event.playing_id, event.index, event.asked_by, questionText(event.asked_by, call));
  }

  // A chat message we may read (`BoardMessageSent`): into the chat. An
  // opponent asking about one of our calls is told in a toast too, unless
  // the chat is open in front of us.
  function applyBoardMessage(event: BoardMessageSentEvent) {
    const chat = useChatStore();
    const current = playing.value;
    const message = event.message;
    const onBoard = tableId.value === event.table_id && current?.playing_id === event.playing_id;
    if (
      onBoard &&
      !chat.open &&
      message.call_index !== null &&
      asksAboutMyCall(message, current.auction, current.my_seat, auth.user?.id ?? null)
    ) {
      const call = current.auction![message.call_index];
      tellQuestion(event.playing_id, message.call_index, message.seat, chatQuestionText(message, call));
    }
    chat.receive(event);
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
    const leaver = Object.values(current.players ?? {}).find(
      (user) => !table.seats.some((s) => s.user_id === user.id),
    );
    const set = table.set;
    // A side forfeited the set this board belongs to (a player away too
    // long, or walking out), mid-board or between boards: say so once. The
    // set's results show next on the play page.
    const forfeit =
      set?.ended === 'forfeit' &&
      set.forfeited_by &&
      set.id === current.set?.id &&
      !current.set.ended &&
      forfeitToldFor !== set.id
        ? set
        : null;
    if (forfeit) {
      forfeitToldFor = forfeit.id;
    }
    const inProgress = current.phase === 'auction' || current.phase === 'play';
    if (table.board_id === null && inProgress) {
      playing.value = waitingState();
    }
    if (forfeit) {
      const side = forfeit.forfeited_by === 'NS' ? 'N-S' : 'E-W';
      showToast(
        `${leaver ? `${leaver.username} is gone` : 'A player is gone'}: ${side} lose set ${forfeit.number} by forfeit.`,
        'warning',
      );
    } else if (table.board_id === null && inProgress) {
      showToast(
        `${leaver ? leaver.username : 'A player'} left, the board was abandoned.`,
        'warning',
      );
    }
  }

  function clear() {
    playing.value = null;
    tableId.value = null;
    pendingHand = null;
    alerts = emptyBook();
    questionsTold.clear();
    useChatStore().clear();
  }

  // Follow the user's own channel from login to logout: a board can be dealt
  // while they look at any page, and its HandDealt is sent only once. The
  // channel also brings DeclarerHandShown, and UserBanned, which the auth
  // store handles, the opponents' alerts and questions, and the board chat.
  function watchUser(userId: number) {
    if (watchedUserId.value === userId) {
      return;
    }
    unwatchUser();
    watchedUserId.value = userId;
    listenToUser(
      userId,
      applyHandDealt,
      (ban) => auth.applyBan(ban),
      applyDeclarerHand,
      applyCallAlerted,
      applyCallQuestioned,
      applyBoardMessage,
    );
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
    cards,
    load,
    adopt,
    loadBids,
    loadCards,
    call,
    askAboutCall,
    explainCall,
    play,
    claim,
    respondToClaim,
    withdrawClaim,
    next,
    phaseOf,
    applyPlayingUpdate,
    receivePlayingUpdate,
    applyHandDealt,
    applyDeclarerHand,
    applyCallAlerted,
    applyCallQuestioned,
    applyBoardMessage,
    applyTableUpdate,
    clear,
    watchUser,
    unwatchUser,
  };
});
