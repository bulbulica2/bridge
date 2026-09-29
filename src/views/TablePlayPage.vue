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

          <!-- The end of the auction: the contract, or nobody bid at all. It
               stays above the table for the whole play, with the tricks. -->
          <section v-if="playing.contract" class="outcome" aria-live="polite">
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
              <ion-button
                v-if="lastTrick"
                size="small"
                fill="clear"
                class="peek"
                :aria-pressed="peeking"
                @click="peeking = !peeking"
              >
                {{ peeking ? 'Hide last trick' : 'Last trick' }}
              </ion-button>
            </p>
          </section>
          <section v-else-if="passedOut" class="outcome" aria-live="polite">
            <p class="outcome-title">Passed out</p>
            <p class="outcome-detail">Nobody bid, so the board scores 0. Waiting for the next board.</p>
          </section>

          <BridgeTable
            :players="players"
            :my-seat="mySeat"
            :board="playing.board"
            :turn="playing.turn"
            :my-turn="myTurn"
            :dummy="dummy"
            :dummy-playable="playFrom === 'dummy' ? legalIds(playing.dummy_hand) : null"
            :busy="sendingCard !== null"
            :sending-id="sendingCard"
            @select="player = $event"
            @play="playCard"
          >
            <p class="waiting-title">Waiting for 4 players</p>
            <p class="waiting-count">{{ seatedCount }} of 4 seated</p>

            <template v-if="playing.contract" #centre>
              <TrickArea
                :cards="shownTrick.cards"
                :my-seat="mySeat"
                :winner="shownTrick.winner"
              />
              <p class="trick-caption" aria-live="polite">{{ shownTrick.caption }}</p>
            </template>
          </BridgeTable>

          <p v-if="status" class="status" :class="{ 'status-mine': myTurn }">{{ status }}</p>

          <AuctionHistory
            v-if="playing.phase === 'auction' && playing.auction"
            :auction="playing.auction"
            :board="playing.board"
            :my-seat="mySeat"
            :turn="playing.turn"
            :players="players"
          />

          <section v-if="playing.phase !== 'waiting'" class="my-hand">
            <HandView
              v-if="playing.hand"
              :cards="playing.hand"
              :label="iAmDummy ? 'Your hand, dummy' : 'Your hand'"
              :playable="playFrom === 'own' ? legalIds(playing.hand) : null"
              :busy="sendingCard !== null"
              :sending-id="sendingCard"
              @play="playCard"
            />
            <div v-else class="dealing">
              <ion-spinner name="dots" />
              <span>Dealing…</span>
            </div>
          </section>

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
  onIonViewWillEnter,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import AuctionHistory from '@/components/AuctionHistory.vue';
import BiddingBox from '@/components/BiddingBox.vue';
import BridgeTable from '@/components/BridgeTable.vue';
import CallLabel from '@/components/CallLabel.vue';
import HandView from '@/components/HandView.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import TrickArea from '@/components/TrickArea.vue';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useTablesStore } from '@/stores/tables';
import { seatsOf } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { Bid, Card, PlayedCard, Trick } from '@/services/game';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES, contractLabel, doubledSuffix } from '@/utils/auction';
import { SUIT_NAMES } from '@/utils/cards';
import { handToPlay, legalCards } from '@/utils/play';
import { errorMessage, statusOf } from '@/utils/errors';
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
const peeking = ref(false);

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

// The suit we must follow, when we are on play and still hold it.
const mustFollow = computed(() => {
  const state = playing.value;
  const led = state?.current_trick?.[0]?.card.suit;
  const hand = playFrom.value === 'dummy' ? state?.dummy_hand : state?.hand;
  return led && hand?.some((card) => card.suit === led) ? led : null;
});

const lastTrick = computed(() => playing.value?.tricks?.at(-1) ?? null);

// What the middle of the table shows: the last trick while peeking, the
// trick in progress, or, for a moment after its fourth card, the trick just
// won, until the next lead replaces it.
const shownTrick = computed<{ cards: PlayedCard[]; winner: Seat | null; caption: string }>(() => {
  const state = playing.value;
  const current = state?.current_trick ?? [];
  if (peeking.value && lastTrick.value) {
    const trick = lastTrick.value;
    return { cards: trick.cards, winner: trick.winner, caption: `Last trick: ${wins(trick.winner)}` };
  }
  if (current.length === 0 && finishedTrick.value) {
    const trick = finishedTrick.value;
    return { cards: trick.cards, winner: trick.winner, caption: wins(trick.winner) };
  }
  if (state?.phase === 'finished') {
    return { cards: [], winner: null, caption: 'All 13 tricks played' };
  }
  return { cards: current, winner: null, caption: `Trick ${(state?.tricks?.length ?? 0) + 1}` };
});

function wins(seat: Seat): string {
  return seat === mySeat.value ? 'You win' : `${seat} wins`;
}

// Four passes: the board ends at once, with no contract and no play.
const passedOut = computed(
  () => playing.value?.phase === 'finished' && !playing.value.contract,
);

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
  if (!state || state.phase === 'waiting' || passedOut.value) {
    return '';
  }
  if (state.phase === 'finished') {
    return 'The board is finished.';
  }
  if (state.phase === 'play') {
    return playStatus(state.turn);
  }
  if (myTurn.value) {
    return 'Auction: your turn.';
  }
  const actor = actorName();
  return actor ? `Auction: waiting for ${actor}.` : 'Auction.';
});

function actorName(): string | null {
  const state = playing.value;
  const actor = Object.values(state?.players ?? {}).find((u) => u.id === state?.acting_user_id);
  return actor?.username ?? null;
}

function playStatus(turn: Seat | null): string {
  if (sendingCard.value !== null) {
    return 'Playing your card…';
  }
  const leading = (playing.value?.current_trick ?? []).length === 0;
  if (playFrom.value) {
    const from = playFrom.value === 'dummy' ? ` from dummy (${turn})` : '';
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
    ? `Play: waiting for ${actor}, from dummy.`
    : `Play: waiting for ${actor}.`;
}

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
  load();
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

// A new board on the table the events haven't described yet (the fourth
// seat taken, or the next board): read it rather than wait.
watch(
  () => table.value?.board_id,
  (boardId) => {
    const shown = playing.value?.board?.id ?? null;
    if (boardId && boardId !== shown && !loading.value) {
      load();
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

// Any new card puts the last-trick peek away: the table has moved on.
watch(
  () => [playing.value?.playing_id, playing.value?.current_trick?.length, lastTrick.value?.round],
  () => {
    peeking.value = false;
  },
);

onBeforeUnmount(() => clearTimeout(pauseTimer));

// Both the table (seats, live channel) and its board; either alone would
// leave the page half drawn. The playing snapshot also rebuilds everything
// after a reload.
async function load() {
  if (!tableId.value) {
    return;
  }
  loading.value = true;
  loadError.value = '';
  loadBids();
  try {
    await Promise.all([tablesStore.loadTable(tableId.value), game.load(tableId.value)]);
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

.status-mine {
  font-weight: 600;
  color: var(--ion-color-warning-shade, #e0ac08);
}

.my-hand {
  margin: 8px 0 16px;
}

.trick-caption {
  margin-top: 4px;
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

.peek {
  margin: 0;
  --padding-start: 6px;
  --padding-end: 6px;
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
</style>
