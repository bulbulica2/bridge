<template>
  <ion-page>
    <AppHeader :title="headerTitle">
      <template #end>
        <ion-button
          v-if="tableId"
          :router-link="`/tables/${tableId}`"
          router-direction="back"
        >
          Table
        </ion-button>
      </template>
    </AppHeader>
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div class="play">
        <div v-if="notFound" class="gone">
          <p>This table no longer exists.</p>
          <ion-button router-link="/tables" router-direction="back">Back to tables</ion-button>
        </div>

        <!-- 403: only the four players seated here may see the board. -->
        <div v-else-if="notSeated" class="gone">
          <p>You don't sit at this table, so you can't see its board.</p>
          <ion-button :router-link="`/tables/${tableId}`" router-direction="back">
            Go to the table
          </ion-button>
        </div>

        <div v-else-if="loading && !playing" class="loading" aria-busy="true">
          <ion-spinner name="crescent" />
          <p>Loading the board…</p>
        </div>

        <ion-text v-if="!notFound && !notSeated && loadError" color="danger">
          <p class="error">{{ loadError }}</p>
        </ion-text>

        <template v-if="!notFound && !notSeated && playing">
          <div v-if="loading" class="refreshing">
            <ion-spinner name="crescent" />
            <span>Refreshing…</span>
          </div>

          <!-- The end of the auction: the contract. It stays above the table
               for the whole play, with the tricks. -->
          <section
            v-if="playing.phase === 'play' && playing.contract"
            class="outcome"
            aria-live="polite"
          >
            <p class="outcome-title">
              <CallLabel :bid="playing.contract.bid" />{{ doubledSuffix(playing.contract.doubled) }}
              by {{ SEAT_NAMES[playing.contract.declarer] }}
            </p>
            <p class="outcome-detail">
              Declarer {{ who(playing.contract.declarer) }} · Dummy {{ who(playing.contract.dummy) }}
            </p>
            <p v-if="playing.tricks_won" class="tricks-won">
              <span>NS {{ playing.tricks_won.ns }}</span>
              <span aria-hidden="true">·</span>
              <span>EW {{ playing.tricks_won.ew }}</span>
            </p>
          </section>
          <!-- A claim waiting for its answers: play stops until it is settled. -->
          <ClaimPanel
            v-if="pendingClaim"
            :state="pendingClaim"
            :my-seat="mySeat"
            :players="players"
            :busy="claiming"
            @accept="answerClaim(true)"
            @reject="answerClaim(false)"
            @withdraw="withdrawClaim"
          />
          <!-- The board is over (13 tricks, or passed out): its score, then
               moving on. The deal lies face up on the table below. -->
          <template v-else-if="playing.phase === 'finished' && playing.result">
            <BoardResultPanel :result="playing.result" :my-seat="mySeat" :session="session" />
            <!-- The same board at every other table, with matchpoints. -->
            <ion-button
              v-if="playing.board"
              expand="block"
              fill="outline"
              class="compare"
              :router-link="`/boards/${playing.board.id}/results`"
            >
              Compare with other tables
            </ion-button>
            <!-- The same four go on with Next; once one of them has been
                 replaced, it is Start again (below). -->
            <NextBoardBox
              v-if="!showStart"
              :ready="playing.ready ?? []"
              :players="players"
              :my-seat="mySeat"
              :manager="isManager"
              :busy="asking"
              @next="askNext(false)"
              @everyone="askNext(true)"
              @leave="leave"
            />
          </template>

          <!-- No board yet (or a finished one with new players): the same
               Start as on the table's page, so opening the game table early
               is no dead end. The last Start deals the board here. -->
          <StartBox
            v-if="showStart && table"
            :table="table"
            :me="me"
            show-seats
            :busy="asking"
            @start="start"
            @cancel="cancelStart"
          />

          <BridgeTable
            :players="players"
            :my-seat="mySeat"
            :board="playing.board"
            :turn="playing.turn"
            :my-turn="myTurn"
            :thinking="robotActing"
            :dummy="dummy"
            :dummy-playable="playFrom === 'dummy' ? legalIds(playing.dummy_hand) : null"
            :dummy-forced-id="playFrom === 'dummy' ? (autoPlay.card.value?.id ?? null) : null"
            :claim="pendingClaim ? { seat: pendingClaim.claim.seat, cards: pendingClaim.claim.hand } : null"
            :deal="playing.phase === 'finished' ? playing.deal : null"
            :busy="sendingCard !== null"
            :sending-id="sendingCard"
            @select="player = $event"
            @play="playCard"
          >
            <p class="waiting-title">
              {{ seatedCount < 4 ? 'Waiting for 4 players' : 'Waiting for Start' }}
            </p>
            <p class="waiting-count">{{ seatedCount }} of 4 seated</p>

            <!-- Once the board is over the centre goes back to the board's
                 details, after the last trick's moment on show. -->
            <template
              v-if="playing.contract && (playing.phase === 'play' || finishedTrick)"
              #centre
            >
              <TrickArea
                :cards="shownTrick.cards"
                :my-seat="mySeat"
                :winner="shownTrick.winner"
              />
              <div class="trick-foot">
                <p class="trick-caption" aria-live="polite">{{ shownTrick.caption }}</p>
                <!-- The last trick in a pop-up, so the trick in progress
                     stays in the middle. -->
                <LastTrickPopover v-if="peekTrick" :trick="peekTrick" :my-seat="mySeat" />
              </div>
            </template>
          </BridgeTable>

          <p
            v-if="status"
            class="status"
            :class="{ 'status-mine': myTurn, 'status-robot': robotActing }"
          >
            {{ status }}
          </p>

          <AuctionHistory
            v-if="playing.phase === 'auction' && playing.auction"
            :auction="playing.auction"
            :board="playing.board"
            :my-seat="mySeat"
            :turn="playing.turn"
            :players="players"
          />

          <!-- A finished board shows every hand on the table instead. -->
          <section
            v-if="playing.phase === 'auction' || playing.phase === 'play'"
            class="my-hand"
          >
            <HandView
              v-if="playing.hand"
              :cards="playing.hand"
              :label="iAmDummy ? 'Your hand, dummy' : 'Your hand'"
              :playable="playFrom === 'own' ? legalIds(playing.hand) : null"
              :busy="sendingCard !== null"
              :sending-id="sendingCard"
              :forced-id="playFrom === 'own' ? (autoPlay.card.value?.id ?? null) : null"
              @play="playCard"
            />
            <div v-else class="dealing">
              <ion-spinner name="dots" />
              <span>Dealing…</span>
            </div>
          </section>

          <!-- Ending the play early: any player but dummy, while no claim is pending. -->
          <ion-button
            v-if="mayClaim"
            expand="block"
            fill="outline"
            class="claim-button"
            :disabled="sendingCard !== null || claiming"
            @click="claimOpen = true"
          >
            Claim
          </ion-button>

          <template v-if="canBid">
            <BiddingBox
              v-if="game.bids.length > 0"
              :bids="game.bids"
              :auction="playing.auction ?? []"
              :seat="mySeat!"
              :busy="calling"
              @call="makeCall"
            />
            <div v-else class="bids-missing">
              <p v-if="bidsError">{{ bidsError }}</p>
              <p v-else><ion-spinner name="dots" /> Loading the bidding box…</p>
              <ion-button v-if="bidsError" size="small" fill="outline" @click="loadBids()">
                Try again
              </ion-button>
            </div>
          </template>

          <!-- Once the auction is over it is only for reference: below the hand. -->
          <AuctionHistory
            v-if="(playing.phase === 'play' || playing.phase === 'finished') && playing.auction"
            :auction="playing.auction"
            :board="playing.board"
            :my-seat="mySeat"
            :turn="null"
            :players="players"
          />

          <ion-button
            expand="block"
            fill="outline"
            class="refresh"
            :disabled="loading"
            @click="load()"
          >
            Refresh
          </ion-button>
        </template>
      </div>

      <PlayerProfileSheet :player="player" @close="player = null" />
      <ClaimSheet
        :open="claimOpen"
        :remaining="playing ? tricksLeft(playing) : 0"
        :busy="claiming"
        @claim="sendClaim"
        @close="claimOpen = false"
      />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonButton,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonSpinner,
  alertController,
  onIonViewWillEnter,
  onIonViewWillLeave,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import AuctionHistory from '@/components/AuctionHistory.vue';
import BiddingBox from '@/components/BiddingBox.vue';
import BoardResultPanel from '@/components/BoardResultPanel.vue';
import BridgeTable from '@/components/BridgeTable.vue';
import CallLabel from '@/components/CallLabel.vue';
import ClaimPanel from '@/components/ClaimPanel.vue';
import ClaimSheet from '@/components/ClaimSheet.vue';
import HandView from '@/components/HandView.vue';
import LastTrickPopover from '@/components/LastTrickPopover.vue';
import NextBoardBox from '@/components/NextBoardBox.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import StartBox from '@/components/StartBox.vue';
import TrickArea from '@/components/TrickArea.vue';
import { useForcedPlay } from '@/composables/useForcedPlay';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useTablesStore } from '@/stores/tables';
import { seatsOf } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { Bid, Card, Claim, PlayedCard, Playing, Trick } from '@/services/game';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES, contractLabel, doubledSuffix } from '@/utils/auction';
import { SUIT_NAMES, SUIT_SYMBOLS, rankLabel } from '@/utils/cards';
import { canClaim, tricksLeft } from '@/utils/claim';
import { autoPlaysForced, forcedCard, handToPlay, legalCards } from '@/utils/play';
import { errorMessage, statusOf } from '@/utils/errors';
import { resultSummary } from '@/utils/result';
import { leaveNote, leaveWarning } from '@/utils/seatMove';
import { startNeeded } from '@/utils/start';
import { showToast } from '@/utils/toast';

const route = useRoute();
const ionRouter = useIonRouter();
const auth = useAuthStore();
const game = useGameStore();
const tablesStore = useTablesStore();

const tableId = ref(0);
const loading = ref(false);
const loadError = ref('');
const notFound = ref(false);
const notSeated = ref(false);
const player = ref<PublicUser | null>(null);
// A call on its way: the bidding box stays disabled until it lands.
const calling = ref(false);
const bidsError = ref('');
// The card on its way, if any: both hands stay disabled until it lands.
const sendingCard = ref<number | null>(null);
// A trick just completed, still shown with its winner for a moment.
const finishedTrick = ref<Trick | null>(null);
// Asking for the next board, Start (or taking it back), or leaving between
// boards: one at a time.
const asking = ref(false);
// The claim sheet is open; a claim, an answer or a withdrawal is on its way.
const claimOpen = ref(false);
const claiming = ref(false);
// The page is on screen: a forced card only plays itself while it is.
const viewActive = ref(false);

const me = computed(() => auth.user?.id ?? null);

// The game store holds one table's board; only trust it for this route's table.
const playing = computed(() => (game.tableId === tableId.value ? game.playing : null));

const table = computed(() => {
  if (tablesStore.currentTable?.id === tableId.value) {
    return tablesStore.currentTable;
  }
  return tablesStore.tables.find((t) => t.id === tableId.value) ?? null;
});

// Once a board is dealt the playing's own seat snapshot names the players;
// while waiting there is none, so the table's seats do.
const players = computed<Partial<Record<Seat, PublicUser | null>>>(() => {
  if (playing.value?.players) {
    return playing.value.players;
  }
  return Object.fromEntries(
    (table.value ? seatsOf(table.value) : []).map(({ seat, user }) => [seat, user]),
  );
});

const mySeat = computed<Seat | null>(() => {
  if (playing.value?.my_seat) {
    return playing.value.my_seat;
  }
  const entry = Object.entries(players.value).find(([, user]) => user?.id === me.value);
  return (entry?.[0] as Seat | undefined) ?? null;
});

const seatedCount = computed(() => Object.values(players.value).filter(Boolean).length);

// acting_user_id is who must act for `turn`: declarer on dummy's turn.
const myTurn = computed(
  () => !!playing.value?.acting_user_id && playing.value.acting_user_id === me.value,
);

// Our call to make: the box shows only then.
const canBid = computed(
  () => playing.value?.phase === 'auction' && myTurn.value && mySeat.value !== null,
);

// The hand we play from now, if any: ours, or dummy's as declarer.
const playFrom = computed(() => (playing.value ? handToPlay(playing.value, me.value) : null));

const iAmDummy = computed(
  () => !!playing.value?.contract && playing.value.contract.dummy === mySeat.value,
);

// The claim waiting for its answers, if any (only ever during the play).
const pendingClaim = computed(() => {
  const state = playing.value;
  return state?.phase === 'play' && state.claim ? (state as Playing & { claim: Claim }) : null;
});

// The Claim button: any player but dummy, while no claim is pending.
const mayClaim = computed(() => !!playing.value && canClaim(playing.value, mySeat.value));

// Dummy's cards lie face up from the opening lead to the last trick.
const dummy = computed(() => {
  const state = playing.value;
  if (state?.phase !== 'play' || !state.contract || !state.dummy_hand) {
    return null;
  }
  return { seat: state.contract.dummy, cards: state.dummy_hand };
});

// The ids of the cards `hand` may follow with (a hint; the backend decides).
function legalIds(hand: Card[] | null): number[] {
  return legalCards(hand ?? [], playing.value?.current_trick ?? null).map((card) => card.id);
}

// The one card the hand on play may play to this trick, if only one is legal
// (never on the lead), keyed by the state it is forced in. Only for declarer
// (a defender taps their own card). Nothing while a card or a claim is on
// its way, the claim sheet is open or the page is left.
const forced = computed(() => {
  const state = playing.value;
  const from = playFrom.value;
  if (
    !state ||
    !from ||
    !autoPlaysForced(state) ||
    !viewActive.value ||
    sendingCard.value !== null ||
    claimOpen.value ||
    claiming.value
  ) {
    return null;
  }
  const card = forcedCard((from === 'dummy' ? state.dummy_hand : state.hand) ?? [], state.current_trick);
  if (!card) {
    return null;
  }
  const trick = state.current_trick?.length ?? 0;
  return { key: `${state.playing_id}:${state.tricks?.length ?? 0}:${trick}:${state.turn}:${card.id}`, card };
});

// Nothing to decide: the forced card plays itself after a few seconds,
// unless it is tapped first (playCard sends one card at a time either way).
const autoPlay = useForcedPlay(() => forced.value, playCard);

// "♥7".
function cardLabel(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${rankLabel(card.rank)}`;
}

// The suit we must follow, when we are on play and still hold it.
const mustFollow = computed(() => {
  const state = playing.value;
  const led = state?.current_trick?.[0]?.card.suit;
  const hand = playFrom.value === 'dummy' ? state?.dummy_hand : state?.hand;
  return led && hand?.some((card) => card.suit === led) ? led : null;
});

// The trick just won, still in the middle of the table for a moment after
// its fourth card, until the next lead replaces it.
const heldTrick = computed(() =>
  (playing.value?.current_trick ?? []).length === 0 ? finishedTrick.value : null,
);

// What the middle of the table shows: the trick held up, else the trick in
// progress.
const shownTrick = computed<{ cards: PlayedCard[]; winner: Seat | null; caption: string }>(() => {
  const held = heldTrick.value;
  if (held) {
    return { cards: held.cards, winner: held.winner, caption: wins(held.winner) };
  }
  const state = playing.value;
  return { cards: state?.current_trick ?? [], winner: null, caption: `Trick ${(state?.tricks?.length ?? 0) + 1}` };
});

// The last trick, on demand beside the trick in progress: from the second
// trick of the play on, but not while that trick is still held up anyway.
const peekTrick = computed(() =>
  playing.value?.phase === 'play' && !heldTrick.value ? (playing.value.tricks?.at(-1) ?? null) : null,
);

function wins(seat: Seat): string {
  return seat === mySeat.value ? 'You win' : `${seat} wins`;
}

// "North (ann)", or "North (you)".
function who(seat: Seat): string {
  if (seat === mySeat.value) {
    return `${SEAT_NAMES[seat]} (you)`;
  }
  const user = players.value[seat];
  return user ? `${SEAT_NAMES[seat]} (${user.username})` : SEAT_NAMES[seat];
}

const status = computed(() => {
  const state = playing.value;
  // A finished board: the result panel and the next-board box say it all.
  if (!state || state.phase === 'waiting' || state.phase === 'finished') {
    return '';
  }
  if (state.phase === 'play') {
    // A pending claim: its panel says what is going on.
    return state.claim ? '' : playStatus(state.turn);
  }
  if (myTurn.value) {
    return 'Auction: your turn.';
  }
  const actor = actorName();
  return actor ? `Auction: ${waitingFor(actor)}` : 'Auction.';
});

// Who must act for `turn` (declarer on dummy's turn), from the players.
const actor = computed(() => {
  const state = playing.value;
  return Object.values(state?.players ?? {}).find((u) => u.id === state?.acting_user_id) ?? null;
});

// A robot's move is due: it comes by itself about a second later
// (PlayingUpdated), so the page says it is thinking rather than waiting.
const robotActing = computed(() => !!actor.value?.is_robot);

function actorName(): string | null {
  return actor.value?.username ?? null;
}

// "waiting for ann.", or "robot-1 is thinking…"; `from` goes before the end.
function waitingFor(name: string, from = ''): string {
  return robotActing.value ? `${name} is thinking${from}…` : `waiting for ${name}${from}.`;
}

function playStatus(turn: Seat | null): string {
  if (sendingCard.value !== null) {
    return 'Playing your card…';
  }
  const leading = (playing.value?.current_trick ?? []).length === 0;
  if (playFrom.value) {
    const from = playFrom.value === 'dummy' ? ` from dummy (${turn})` : '';
    const auto = autoPlay.card.value;
    if (auto) {
      return `Play: your turn${from}. Playing ${cardLabel(auto)} in ${autoPlay.secondsLeft.value} s…`;
    }
    if (mustFollow.value) {
      return `Play: your turn${from}. Follow suit: ${SUIT_NAMES[mustFollow.value]}.`;
    }
    return leading ? `Play: your lead${from}.` : `Play: your turn${from}.`;
  }
  if (iAmDummy.value) {
    return 'Declarer is playing your cards.';
  }
  const actor = actorName();
  if (!actor) {
    return 'Play.';
  }
  return turn && turn === playing.value?.contract?.dummy
    ? `Play: ${waitingFor(actor, ', from dummy')}`
    : `Play: ${waitingFor(actor)}`;
}

// The next board waits for every human's Start: none dealt yet (or one
// abandoned), or a finished board whose four players aren't all still in
// their seats. The table's seats say who sits here: a newcomer isn't in the
// finished board's players.
const showStart = computed(
  () =>
    !!table.value &&
    table.value.seats.some((s) => s.user_id === me.value) &&
    startNeeded(table.value, playing.value),
);

// A hint for the "for everyone" button; a 403 corrects it.
const isManager = computed(() => table.value?.can_manage ?? false);

// The running score at this table, once the store has read it for this table.
const session = computed(() => (game.session?.tableId === tableId.value ? game.session : null));

const headerTitle = computed(() => {
  const board = playing.value?.board;
  const name = table.value?.name || (tableId.value ? `Table #${tableId.value}` : 'Table');
  return board ? `${name} · Board ${board.number}` : name;
});

onIonViewWillEnter(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    tableId.value = 0;
    notFound.value = true;
    return;
  }
  tableId.value = id;
  notFound.value = false;
  notSeated.value = false;
  viewActive.value = true;
  load(false);
});

// Off screen (another page pushed on top): no card plays itself meanwhile.
onIonViewWillLeave(() => {
  viewActive.value = false;
});

// Kicked (the tables store has already said so in a toast): nothing to see.
watch(
  () => tablesStore.kickedFrom,
  (kicked) => {
    if (kicked !== null && kicked === tableId.value) {
      tablesStore.kickedFrom = null;
      ionRouter.navigate('/tables', 'back', 'replace');
    }
  },
);

// A new board on the table the events haven't described yet (the last
// Start, or the next board): read it rather than wait.
watch(
  () => table.value?.board_id,
  (boardId) => {
    const shown = playing.value?.board?.id ?? null;
    if (boardId && boardId !== shown && !loading.value) {
      load(false);
    }
  },
);

// The last call of the auction, seen live (not on a reload): announce how it
// ended, whoever made that call.
watch(
  () => [playing.value?.playing_id, playing.value?.phase] as const,
  ([id, phase], [oldId, oldPhase]) => {
    if (id == null || id !== oldId || oldPhase !== 'auction' || phase === 'auction') {
      return;
    }
    const contract = playing.value?.contract;
    if (contract) {
      showToast(`Contract: ${contractLabel(contract)}.`, 'success');
    } else if (phase === 'finished') {
      showToast('Passed out: nobody bid.', 'warning');
    }
  },
);

// The last card, seen live: the board's score in a toast.
watch(
  () => [playing.value?.playing_id, playing.value?.phase] as const,
  ([id, phase], [oldId, oldPhase]) => {
    const result = playing.value?.result;
    if (id != null && id === oldId && oldPhase === 'play' && phase === 'finished' && result) {
      showToast(`Board over: ${resultSummary(result)}.`, 'success');
    }
  },
);

// A claim rejected or withdrawn, seen live: play goes on where it stopped.
// (Accepted, the board is finished and the toast above tells its score.)
watch(
  () => [playing.value?.playing_id, playing.value?.claim ?? null] as const,
  ([id, claim], [oldId, oldClaim]) => {
    if (id != null && id === oldId && oldClaim && !claim && playing.value?.phase === 'play') {
      showToast(`${SEAT_NAMES[oldClaim.seat]}'s claim is off: play goes on.`, 'warning');
    }
  },
);

// Somebody else's claim (or the board moving on) takes the sheet away.
watch(mayClaim, (may) => {
  if (!may) {
    claimOpen.value = false;
  }
});

// Each finished board adds to the running score: read it once per board, on
// a reload as well as live. A failure only hides the line.
let sessionReadFor: number | null = null;
watch(
  () => [playing.value?.playing_id, playing.value?.phase] as const,
  ([id, phase]) => {
    if (phase === 'finished' && id != null && id !== sessionReadFor) {
      sessionReadFor = id;
      game.loadSessionScore(tableId.value).catch(() => {
        sessionReadFor = null;
      });
    }
  },
  { immediate: true },
);

// The fourth card of a trick, seen live: hold the trick up with its winner
// for a moment before the table clears it (a reload shows the next lead).
const TRICK_PAUSE_MS = 2000;
let pauseTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => [playing.value?.playing_id, playing.value?.tricks?.length ?? 0] as const,
  ([id, count], [oldId, oldCount]) => {
    clearTimeout(pauseTimer);
    finishedTrick.value = null;
    if (id != null && id === oldId && count > oldCount) {
      finishedTrick.value = playing.value!.tricks![count - 1];
      pauseTimer = setTimeout(() => (finishedTrick.value = null), TRICK_PAUSE_MS);
    }
  },
);

onBeforeUnmount(() => clearTimeout(pauseTimer));

// Both the table (seats, live channel) and its board; either alone would
// leave the page half drawn. The playing snapshot also rebuilds everything
// after a reload. `refetchTable: false` (entering the page, a new board)
// reuses the table the store already follows live, as it does right after
// Create or a join, so the first frame waits for GET /playing alone. The
// bids come after it: they are only needed on our turn to call, and
// usually already cached (the router reads them once after login).
async function load(refetchTable = true) {
  if (!tableId.value) {
    return;
  }
  loading.value = true;
  loadError.value = '';
  try {
    const id = tableId.value;
    const table = refetchTable ? tablesStore.loadTable(id) : tablesStore.openTable(id);
    await Promise.all([table, game.load(id)]);
    loadBids();
  } catch (e) {
    const status = statusOf(e);
    if (status === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
    } else if (status === 404) {
      tablesStore.forget(tableId.value);
      notFound.value = true;
    } else if (status === 403) {
      notSeated.value = true;
    } else {
      loadError.value = errorMessage(e, 'Could not load the board. Please try again.');
    }
  } finally {
    loading.value = false;
  }
}

// The bid ids, read once per app run; a failure only costs the bidding box.
async function loadBids(force = false) {
  bidsError.value = '';
  try {
    await game.loadBids(force);
  } catch (e) {
    bidsError.value = errorMessage(e, 'Could not load the bidding box.');
  }
}

// One call at a time. A refused call (409: not our turn, too low, …) means
// the table moved on or the hint was wrong: say why, then reread the board.
async function makeCall(bid: Bid) {
  if (calling.value) {
    return;
  }
  calling.value = true;
  try {
    await game.call(bid.id);
  } catch (e) {
    // A 422 means the bid list no longer matches the server's (a reseeded
    // database).
    await refused(e, 'Your call could not be made. Please try again.', () => loadBids(true));
  } finally {
    calling.value = false;
  }
}

// One card at a time, from whichever hand is on play (ours, or dummy's as
// declarer). Refused like a call: a 409 names what was wrong.
async function playCard(card: Card) {
  if (sendingCard.value !== null) {
    return;
  }
  sendingCard.value = card.id;
  try {
    await game.play(card.id);
  } catch (e) {
    await refused(e, 'Your card could not be played. Please try again.');
  } finally {
    sendingCard.value = null;
  }
}

// A move the backend didn't take. A 409 means the table moved on or our
// hint was wrong: say why, then reread the board.
async function refused(e: unknown, fallback: string, on422?: () => Promise<void>) {
  const status = statusOf(e);
  if (status === 401) {
    ionRouter.navigate('/login', 'root', 'replace');
  } else if (status === 403) {
    notSeated.value = true;
  } else if (status === 404) {
    tablesStore.forget(tableId.value);
    notFound.value = true;
  } else {
    showToast(errorMessage(e, fallback), 'danger');
    if (status === 422 && on422) {
      await on422();
    }
    if (status === 409 || status === 422) {
      await load();
    }
  }
}

// Claim `tricks` of the remaining tricks (0 concedes). Refused like a card.
async function sendClaim(tricks: number) {
  if (claiming.value) {
    return;
  }
  claiming.value = true;
  try {
    await game.claim(tricks);
    claimOpen.value = false;
  } catch (e) {
    claimOpen.value = false;
    await refused(e, 'Your claim could not be made. Please try again.');
  } finally {
    claiming.value = false;
  }
}

// Accept or reject the pending claim; the last accept finishes the board.
async function answerClaim(accept: boolean) {
  if (claiming.value) {
    return;
  }
  claiming.value = true;
  try {
    await game.respondToClaim(accept);
  } catch (e) {
    await refused(e, 'Your answer could not be sent. Please try again.');
  } finally {
    claiming.value = false;
  }
}

// Take our own claim back: play goes on.
async function withdrawClaim() {
  if (claiming.value) {
    return;
  }
  claiming.value = true;
  try {
    await game.withdrawClaim();
  } catch (e) {
    await refused(e, 'Your claim could not be withdrawn. Please try again.');
  } finally {
    claiming.value = false;
  }
}

// Ask for the next board: for ourselves, or (a manager) for all four. The
// last one to ask deals it, and the new board replaces this one.
async function askNext(everyone: boolean) {
  if (asking.value || (everyone && !(await confirmEveryone()))) {
    return;
  }
  asking.value = true;
  try {
    await game.next(everyone);
  } catch (e) {
    await refused(e, 'Could not ask for the next board. Please try again.');
  } finally {
    asking.value = false;
  }
}

// Our Start. The answer that deals is the new board's state, which the
// store takes at once; until then the box says who we wait for.
async function start() {
  if (asking.value) {
    return;
  }
  asking.value = true;
  try {
    await tablesStore.start(tableId.value);
  } catch (e) {
    await refused(e, 'Could not start. Please try again.');
  } finally {
    asking.value = false;
  }
}

async function cancelStart() {
  if (asking.value) {
    return;
  }
  asking.value = true;
  try {
    await tablesStore.cancelStart(tableId.value);
  } catch (e) {
    await refused(e, 'Could not take your Start back. Please try again.');
  } finally {
    asking.value = false;
  }
}

async function confirmEveryone(): Promise<boolean> {
  const alert = await alertController.create({
    header: 'Deal the next board for everyone?',
    message: "The players who haven't asked yet move on too.",
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Deal', role: 'confirm' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role === 'confirm';
}

// Leaving between boards: free, since the board is over.
async function leave() {
  if (asking.value) {
    return;
  }
  const alert = await alertController.create({
    header: 'Leave this table?',
    message: [
      leaveWarning(playing.value?.phase ?? null, playing.value?.board?.number ?? null),
      leaveNote(table.value, me.value),
    ]
      .filter(Boolean)
      .join(' '),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Leave', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive') {
    return;
  }
  asking.value = true;
  try {
    const { tableDeleted } = await tablesStore.leave(tableId.value);
    game.clear();
    await showToast(
      tableDeleted
        ? 'You left the table. Nobody was left, so it was deleted.'
        : 'You left the table.',
      'success',
    );
    ionRouter.navigate('/tables', 'back', 'replace');
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
    } else {
      await showToast(errorMessage(e, 'Could not leave the table. Please try again.'), 'danger');
      await load();
    }
  } finally {
    asking.value = false;
  }
}

async function refresh(event: CustomEvent) {
  await load();
  (event.target as HTMLIonRefresherElement).complete();
}
</script>

<style scoped>
/* Wide enough for 13 overlapping cards on one line, capped like the detail page. */
.play {
  max-width: 520px;
  margin: 0 auto;
}

.compare {
  margin: 0 0 12px;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--ion-color-medium);
}

.loading ion-spinner {
  width: 48px;
  height: 48px;
}

.loading p {
  margin: 0;
}

.refreshing,
.dealing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 0 12px;
  color: var(--ion-color-medium);
  font-size: 0.9rem;
}

.refreshing ion-spinner {
  width: 18px;
  height: 18px;
}

.gone {
  padding: 32px 0;
  text-align: center;
}

.error {
  margin: 16px 0;
}

.waiting-title {
  font-weight: 600;
}

.waiting-count {
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.status {
  margin: 16px 0;
  text-align: center;
  color: var(--ion-color-medium);
}

.status-robot {
  color: var(--ion-color-tertiary, #5260ff);
}

.status-mine {
  font-weight: 600;
  color: var(--ion-color-warning-shade, #e0ac08);
}

.my-hand {
  margin: 8px 0 16px;
}

.trick-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 8px;
  margin-top: 4px;
}

.trick-caption {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ion-color-medium);
}

.outcome .tricks-won {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 6px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.outcome {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.08);
  text-align: center;
}

.outcome p {
  margin: 0;
}

.outcome-title {
  font-size: 1.15rem;
  font-weight: 700;
}

.outcome .outcome-detail {
  margin-top: 4px;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.bids-missing {
  margin: 12px 0;
  text-align: center;
  color: var(--ion-color-medium);
}

.bids-missing p {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.refresh {
  margin-top: 8px;
}

.claim-button {
  margin: 0 0 16px;
}
</style>
