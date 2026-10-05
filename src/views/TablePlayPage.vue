<template>
  <ion-page>
    <AppHeader :title="headerTitle">
      <template #end>
        <!-- The board's chat, with how many messages came since we looked. -->
        <ion-button
          v-if="chatOn"
          class="chat-toggle"
          :aria-label="chatAria"
          :aria-expanded="chat.open"
          @click="chat.setOpen(!chat.open)"
        >
          <ion-icon slot="start" :icon="chatbubblesOutline" />
          <span class="chat-toggle-label">Chat</span>
          <ion-badge v-if="chat.unread > 0" color="danger" class="chat-badge">{{ chat.unread }}</ion-badge>
        </ion-button>
        <!-- Look back at the finished boards without leaving the table. -->
        <ion-button v-if="reviewable.length > 0" class="review-boards" @click="reviewOpen = true">
          Last board
        </ion-button>
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

      <!-- On a wide screen the chat sits beside the table, which stays
           centred in the room left of it; on a phone it is a bottom sheet
           (below). Pop-ups treat the panel as the screen's right edge. -->
      <aside v-if="chatSide" slot="fixed" class="chat-side" data-right-edge>
        <BoardChat v-bind="chatProps" v-model:draft="chatDraft" v-on="chatEvents" />
      </aside>

      <div class="play" :class="{ 'with-chat-side': chatSide, 'with-chat-sheet': chatSheet }">
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

          <!-- Where the table is in its set of four boards. -->
          <p v-if="playing.set" class="set-bar" :class="{ 'set-bar-over': shownSet?.finished }">
            {{ setLabel(playing.set) }}<template v-if="shownSet?.finished"> · set over</template>
          </p>

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
            <!-- A robot declarer hands its game to us, its dummy. -->
            <p v-if="forDeclarer" class="outcome-you">
              {{ players[playing.contract.declarer]?.username }} declares
              <CallLabel :bid="playing.contract.bid" />{{ doubledSuffix(playing.contract.doubled) }}
              — you play the hand
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
            :acts-for="claimSeat"
            :players="players"
            :busy="claiming"
            @accept="answerClaim(true)"
            @reject="answerClaim(false)"
            @withdraw="withdrawClaim"
          />
          <!-- The board is over (13 tricks, or passed out): its score, then
               moving on. The deal lies face up on the table below. -->
          <template v-else-if="playing.phase === 'finished' && playing.result">
            <!-- After the set's last board (or a forfeit between boards):
                 the whole set in place of the board, then everyone's Start. -->
            <SetResultsPanel
              v-if="endedSet"
              :set="endedSet"
              :my-seat="mySeat"
              :gone="forfeitedSeat(endedSet, table)"
            />
            <BoardResultPanel
              v-else
              :result="playing.result"
              :my-seat="mySeat"
              :set-so-far="setResults"
              :extras="boardExtras"
            />
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
            <!-- Replay it card by card, and export it (text, PBN, print),
                 in the review modal: we stay at the table. -->
            <ion-button
              v-if="reviewable.length > 0"
              expand="block"
              fill="outline"
              class="compare review-and-export"
              @click="reviewOpen = true"
            >
              Review and export
            </ion-button>
            <!-- The same four get the set's next board by itself, counted
                 down here (Deal now skips the wait); once one of them has
                 been replaced, it is Start again (below). -->
            <NextBoardBox
              v-if="!showStart"
              :ready="playing.ready ?? []"
              :players="players"
              :my-seat="mySeat"
              :next-board-at="playing.next_board_at ?? null"
              :busy="asking"
              @next="askNext"
              @leave="leave"
            />
          </template>

          <!-- A set that ended mid-board (a forfeit, or a player taken out of
               it): no board is left on the table, but its results are. -->
          <SetResultsPanel
            v-if="playing.phase === 'waiting' && endedSet"
            :set="endedSet"
            :my-seat="mySeat"
            :gone="forfeitedSeat(endedSet, table)"
          />

          <!-- No board yet (or a finished one with new players): the same
               Start as on the table's page, so opening the game table early
               is no dead end. The last Start deals the board here. A
               manager fills the empty seats from it too, as on the table's
               page (left alone after the others were freed, say). -->
          <StartBox
            v-if="showStart && table"
            :table="table"
            :me="me"
            show-seats
            :busy="asking"
            :manage="table.can_manage"
            :filling-seat="fillingSeat"
            @start="start"
            @cancel="cancelStart"
            @seat-player="seatingAt = $event"
            @add-robot="addRobot"
          />

          <BridgeTable
            :players="players"
            :my-seat="mySeat"
            :board="playing.board"
            :turn="playing.turn"
            :my-turn="myTurn"
            :thinking="robotActing"
            :trump="playing.contract?.bid.strain ?? null"
            :dummy="dummy"
            :dummy-playable="playFrom === 'dummy' ? legalIds(playing.dummy_hand) : null"
            :dummy-forced-id="playFrom === 'dummy' ? (autoPlay.card.value?.id ?? null) : null"
            :declarer="declarerHand"
            :declarer-playable="playFrom === 'declarer' ? legalIds(playing.declarer_hand) : null"
            :declarer-forced-id="playFrom === 'declarer' ? (autoPlay.card.value?.id ?? null) : null"
            :claim="pendingClaim ? { seat: pendingClaim.claim.seat, cards: pendingClaim.claim.hand } : null"
            :deal="playing.phase === 'finished' ? playing.deal : null"
            :away="awayMarks"
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

          <!-- Somebody away mid-set: the time left before their side loses
               the set, from their seat's forfeit_at. -->
          <AwayNotice :table="table" :me="me" />

          <p
            v-if="status"
            class="status"
            :class="{ 'status-mine': myTurn, 'status-robot': robotActing }"
          >
            {{ status }}
          </p>

          <!-- Alerted calls stand out; until the board is over, an
               opponent's call may be asked about and ours answered. -->
          <AuctionHistory
            v-if="playing.phase === 'auction' && playing.auction"
            :auction="playing.auction"
            :board="playing.board"
            :my-seat="mySeat"
            :turn="playing.turn"
            :players="players"
            live
            :busy="noting"
            @ask="askAbout"
            @explain="explainIndex = $event"
            @chat="chat.askAbout($event)"
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
              v-model:alert="alertDraft.alert"
              v-model:explanation="alertDraft.explanation"
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
            :live="playing.phase === 'play'"
            :busy="noting"
            @ask="askAbout"
            @explain="explainIndex = $event"
            @chat="chat.askAbout($event)"
          />

          <OfflineRefresh :table-id="tableId" :disabled="loading" @refresh="load()" />
        </template>
      </div>

      <PlayerProfileSheet :player="player" @close="player = null" />
      <SeatPlayerSheet :seat="seatingAt" @select="seatPlayer" @close="seatingAt = null" />
      <ClaimSheet
        :open="claimOpen"
        :remaining="playing ? tricksLeft(playing) : 0"
        :for-seat="forDeclarer ? claimSeat : null"
        :busy="claiming"
        @claim="sendClaim"
        @close="claimOpen = false"
      />
      <ExplainCallSheet
        :open="explaining !== null"
        :call="explaining"
        :busy="noting"
        @explain="sendExplanation"
        @close="explainIndex = null"
      />
      <!-- A phone's chat: a sheet over the lower half of the page, which
           stays usable above it (and gets the room to scroll the bidding
           box and the hand up out of the sheet's way). -->
      <ion-modal
        v-if="!chatWide"
        class="chat-sheet"
        :is-open="chatSheet"
        :initial-breakpoint="0.5"
        :breakpoints="[0, 0.5, 0.9]"
        :backdrop-breakpoint="0.9"
        @did-dismiss="chat.setOpen(false)"
      >
        <ion-content class="ion-padding">
          <BoardChat v-if="chatSheet" v-bind="chatProps" v-model:draft="chatDraft" v-on="chatEvents" />
        </ion-content>
      </ion-modal>
      <BoardReviewModal
        :open="reviewOpen"
        :choices="reviewable"
        :notice="notice"
        @close="reviewOpen = false"
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
  IonBadge,
  IonIcon,
  IonModal,
  onIonViewWillEnter,
  onIonViewWillLeave,
  useIonRouter,
} from '@ionic/vue';
import { chatbubblesOutline } from 'ionicons/icons';
import AppHeader from '@/components/AppHeader.vue';
import AuctionHistory from '@/components/AuctionHistory.vue';
import AwayNotice from '@/components/AwayNotice.vue';
import BiddingBox from '@/components/BiddingBox.vue';
import BoardChat from '@/components/BoardChat.vue';
import BoardResultPanel from '@/components/BoardResultPanel.vue';
import BoardReviewModal from '@/components/BoardReviewModal.vue';
import BridgeTable from '@/components/BridgeTable.vue';
import CallLabel from '@/components/CallLabel.vue';
import ClaimPanel from '@/components/ClaimPanel.vue';
import ClaimSheet from '@/components/ClaimSheet.vue';
import ExplainCallSheet from '@/components/ExplainCallSheet.vue';
import HandView from '@/components/HandView.vue';
import LastTrickPopover from '@/components/LastTrickPopover.vue';
import NextBoardBox from '@/components/NextBoardBox.vue';
import OfflineRefresh from '@/components/OfflineRefresh.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import SeatPlayerSheet from '@/components/SeatPlayerSheet.vue';
import SetResultsPanel from '@/components/SetResultsPanel.vue';
import StartBox from '@/components/StartBox.vue';
import TrickArea from '@/components/TrickArea.vue';
import { useForcedPlay } from '@/composables/useForcedPlay';
import { useMediaQuery } from '@/composables/useMediaQuery';
import { useStaleDeadline } from '@/composables/useStaleDeadline';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useGameStore } from '@/stores/game';
import { useHistoryStore } from '@/stores/history';
import { useTablesStore } from '@/stores/tables';
import { seatsOf } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { ChatTo } from '@/services/chat';
import type { AlertDraft, Bid, Card, Claim, PlayedCard, Playing, Trick } from '@/services/game';
import type { PublicUser, SearchedUser } from '@/services/users';
import { openQuestion } from '@/utils/alerts';
import { SEAT_NAMES, contractLabel, doubledSuffix } from '@/utils/auction';
import { SUIT_NAMES, SUIT_SYMBOLS, rankLabel } from '@/utils/cards';
import { canClaim, claimOffText, claimSeatOf, tricksLeft } from '@/utils/claim';
import {
  autoPlaysForced,
  cardsToPlay,
  forcedCard,
  handToPlay,
  legalCards,
  playsForDeclarer,
} from '@/utils/play';
import { errorMessage, statusOf } from '@/utils/errors';
import { playingExtras } from '@/utils/export';
import { resultSummary } from '@/utils/result';
import { awaySeats } from '@/utils/away';
import { confirmLeave, heldNotice } from '@/utils/seatMove';
import { currentSet, forfeitedSeat, setLabel } from '@/utils/sets';
import { reviewChoices } from '@/utils/review';
import type { SeenBoard } from '@/utils/review';
import { startNeeded } from '@/utils/start';
import { turnNotice } from '@/utils/turn';
import { showToast } from '@/utils/toast';

const route = useRoute();
const ionRouter = useIonRouter();
const auth = useAuthStore();
const game = useGameStore();
const tablesStore = useTablesStore();
const history = useHistoryStore();
const chat = useChatStore();

const tableId = ref(0);
const loading = ref(false);
const loadError = ref('');
const notFound = ref(false);
const notSeated = ref(false);
const player = ref<PublicUser | null>(null);
// A call on its way: the bidding box stays disabled until it lands.
const calling = ref(false);
// The next call's alert, typed in the bidding box: it goes with the call
// and is cleared once the call is taken (a refused one keeps it), and when
// the board changes.
const alertDraft = ref({ alert: false, explanation: '' });
// A question about an opponent's call, or our explanation of one of ours,
// on its way.
const noting = ref(false);
// The call of ours being explained in the sheet (its index in the auction).
const explainIndex = ref<number | null>(null);
const bidsError = ref('');
// The card on its way, if any: both hands stay disabled until it lands.
const sendingCard = ref<number | null>(null);
// A trick just completed, still shown with its winner for a moment.
const finishedTrick = ref<Trick | null>(null);
// Asking for the next board, Start (or taking it back), or leaving between
// boards: one at a time.
const asking = ref(false);
// A manager filling an empty seat: the seat whose player search is open, and
// the seat a player or robot is on its way to.
const seatingAt = ref<Seat | null>(null);
const fillingSeat = ref<Seat | null>(null);
// The claim sheet is open; a claim, an answer or a withdrawal is on its way.
const claimOpen = ref(false);
const claiming = ref(false);
// The page is on screen: a forced card only plays itself while it is.
const viewActive = ref(false);
// The review modal is open over the table (the game goes on underneath).
const reviewOpen = ref(false);
// The last board seen to finish here, to review once the next is dealt.
const seenBoard = ref<(SeenBoard & { tableId: number }) | null>(null);
// The chat message being written (kept when it is refused) and whether it
// is on its way.
const chatDraft = ref('');
const chatSending = ref(false);
// Wide enough for the chat beside the table, even with the menu pinned.
const chatWide = useMediaQuery('(min-width: 1100px)');

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

// The others' seats marked away mid-set (ours is vouched for while we look).
const awayMarks = computed(() =>
  table.value ? awaySeats(table.value, me.value).map((s) => s.seat) : [],
);

const seatedCount = computed(() => Object.values(players.value).filter(Boolean).length);

// acting_user_id is who must act for `turn`: declarer on dummy's turn.
const myTurn = computed(
  () => !!playing.value?.acting_user_id && playing.value.acting_user_id === me.value,
);

// Our call to make: the box shows only then.
const canBid = computed(
  () => playing.value?.phase === 'auction' && myTurn.value && mySeat.value !== null,
);

// The hand we play from now, if any: ours, dummy's as declarer, or a robot
// declarer's as its dummy.
const playFrom = computed(() => (playing.value ? handToPlay(playing.value, me.value) : null));

const iAmDummy = computed(
  () => !!playing.value?.contract && playing.value.contract.dummy === mySeat.value,
);

// We are dummy to a robot declarer, so we play both hands and claim for it.
const forDeclarer = computed(() => !!playing.value && playsForDeclarer(playing.value));

// The seat we claim (and answer claims) for: declarer's when we play its game.
const claimSeat = computed(() => (playing.value ? claimSeatOf(playing.value) : null));

// The claim waiting for its answers, if any (only ever during the play).
const pendingClaim = computed(() => {
  const state = playing.value;
  return state?.phase === 'play' && state.claim ? (state as Playing & { claim: Claim }) : null;
});

// The Claim button: any player but dummy (unless dummy plays for a robot
// declarer), while no claim is pending.
const mayClaim = computed(() => !!playing.value && canClaim(playing.value, claimSeat.value));

// Dummy's cards lie face up from the opening lead to the last trick.
const dummy = computed(() => {
  const state = playing.value;
  if (state?.phase !== 'play' || !state.contract || !state.dummy_hand) {
    return null;
  }
  return { seat: state.contract.dummy, cards: state.dummy_hand };
});

// A robot declarer's cards, ours alone to see and play, from the end of the
// auction to the end of the play.
const declarerHand = computed(() => {
  const state = playing.value;
  if (state?.phase !== 'play' || !state.contract || !state.declarer_hand) {
    return null;
  }
  return { seat: state.contract.declarer, cards: state.declarer_hand };
});

// The call of ours the explanation sheet is open for.
const explaining = computed(() => {
  const index = explainIndex.value;
  return index === null ? null : (playing.value?.auction?.[index] ?? null);
});

// An opponent's question about one of our calls, still unanswered, while
// the board is on.
const question = computed(() => {
  const state = playing.value;
  if (state?.phase !== 'auction' && state?.phase !== 'play') {
    return null;
  }
  return openQuestion(state.auction, mySeat.value);
});

// The ids of the cards `hand` may follow with (a hint; the backend decides).
function legalIds(hand: Card[] | null): number[] {
  return legalCards(hand ?? [], playing.value?.current_trick ?? null).map((card) => card.id);
}

// The one card the hand on play may play to this trick, if only one is legal
// (never on the lead), keyed by the state it is forced in. Only for
// declarer's game (a defender taps their own card). Nothing while a card or a claim is on
// its way, the claim sheet or the review is open or the page is left.
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
    reviewOpen.value ||
    explaining.value !== null ||
    claiming.value
  ) {
    return null;
  }
  const card = forcedCard(cardsToPlay(state, from) ?? [], state.current_trick);
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
  const hand = state && playFrom.value ? cardsToPlay(state, playFrom.value) : null;
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
    const from = {
      own: forDeclarer.value ? ' from your own hand' : '',
      dummy: ` from dummy (${turn})`,
      declarer: ` from ${SEAT_NAMES[turn!]}'s hand`,
    }[playFrom.value];
    const auto = autoPlay.card.value;
    if (auto) {
      return `Play: your turn${from}. Playing ${cardLabel(auto)} in ${autoPlay.secondsLeft.value} s…`;
    }
    if (mustFollow.value) {
      return `Play: your turn${from}. Follow suit: ${SUIT_NAMES[mustFollow.value]}.`;
    }
    return leading ? `Play: your lead${from}.` : `Play: your turn${from}.`;
  }
  if (iAmDummy.value && !forDeclarer.value) {
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

// The set the table is on (or ended last): the board's own `set`, updated
// by the table's events (a forfeit comes as a TableUpdated only).
const shownSet = computed(() => currentSet(table.value, playing.value));

// Its results as far as they go (GET /sets/{id}), once read: the running
// score under each board's result.
const setResults = computed(() => {
  const set = shownSet.value;
  return set ? (history.sets[set.id] ?? null) : null;
});

// This board's matchpoints, once read (its set's results, or its results at
// every table if those were opened): shown under its result.
const boardExtras = computed(() =>
  playingExtras(
    history.results,
    history.sets,
    playing.value?.board?.id ?? null,
    playing.value?.playing_id ?? null,
  ),
);

// The set is over and its results are in: they replace the board's result.
// Nothing to show for a set broken off before any board was finished.
const endedSet = computed(() => {
  const results = setResults.value;
  if (!shownSet.value?.finished || !results?.finished) {
    return null;
  }
  return results.boards.length > 0 || results.ended === 'forfeit' ? results : null;
});

// The finished boards the review modal offers: the running set's, else the
// last one seen here, else (after a reload) the latest in our history.
const reviewable = computed(() => {
  const set = shownSet.value;
  const seen = seenBoard.value?.tableId === tableId.value ? seenBoard.value : null;
  const latest = history.listOf(null)?.entries.find((e) => e.table_id === tableId.value) ?? null;
  return reviewChoices(set ? (history.sets[set.id] ?? null) : null, seen, latest);
});

// What the game waits for us to do, told inside the review modal.
const notice = computed(() =>
  turnNotice(playing.value, me.value, table.value, showStart.value),
);

// The chat is the board's: there is none before the first deal.
const chatOn = computed(() => !!playing.value?.playing_id);
const chatSide = computed(() => chatOn.value && chatWide.value && chat.open);
const chatSheet = computed(() => chatOn.value && !chatWide.value && chat.open);

const chatAria = computed(() => (chat.unread > 0 ? `Chat, ${chat.unread} new` : 'Chat'));

const chatProps = computed(() => ({
  messages: chat.tableId === tableId.value ? chat.messages : [],
  players: players.value,
  auction: playing.value?.auction ?? null,
  phase: playing.value?.phase ?? null,
  me: me.value,
  about: chat.about,
  busy: chatSending.value,
}));

const chatEvents = {
  send: sendChat,
  close: () => chat.setOpen(false),
  'clear-about': () => (chat.about = null),
};

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
  if (id !== tableId.value) {
    reviewOpen.value = false;
  }
  tableId.value = id;
  notFound.value = false;
  notSeated.value = false;
  viewActive.value = true;
  load(false);
});

// Off screen (another page pushed on top): no card plays itself meanwhile,
// and the review closes (with its export sheet and any printout).
onIonViewWillLeave(() => {
  viewActive.value = false;
  reviewOpen.value = false;
  explainIndex.value = null;
  seatingAt.value = null;
  chat.setOpen(false);
});

// The chat follows the board on show: read on entering the table, emptied
// for a new board, read again once a board is finished (its every message
// is public then).
watch(
  () => [tableId.value, playing.value?.playing_id ?? null, playing.value?.phase ?? null] as const,
  ([id, playingId, phase]) => {
    if (id && playing.value) {
      chat.follow(id, playingId, phase);
    }
  },
  { immediate: true },
);

// A new board: nothing typed for the last one's calls carries over. Set
// up before the question's watch below, which may open the sheet for it.
watch(
  () => playing.value?.playing_id,
  (id, oldId) => {
    if (id !== oldId) {
      alertDraft.value = { alert: false, explanation: '' };
      explainIndex.value = null;
    }
  },
);

// An opponent asks about one of our calls: the sheet to answer opens by
// itself, once per question and only while the page is on screen (closed,
// the call's pop-up in the auction still offers Answer).
let promptedFor: string | null = null;
watch(
  () => {
    const open = question.value;
    if (!open || !viewActive.value) {
      return null;
    }
    const key = `${playing.value!.playing_id}:${open.index}:${open.call.question!.asked_by}`;
    return { key, index: open.index };
  },
  (asked) => {
    if (asked && asked.key !== promptedFor) {
      promptedFor = asked.key;
      explainIndex.value = asked.index;
    }
  },
  { immediate: true },
);

// Kicked (the tables store has already said so in a toast): nothing to see.
// Freed because our side forfeited the set: its results instead.
watch(
  () => tablesStore.kickedFrom,
  (kicked) => {
    if (kicked !== null && kicked === tableId.value) {
      tablesStore.kickedFrom = null;
      const lost = tablesStore.lostSet;
      ionRouter.navigate(lost?.tableId === kicked ? `/sets/${lost.id}` : '/tables', 'back', 'replace');
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
      showToast(`Board over: ${resultSummary(result, mySeat.value)}.`, 'success');
    }
  },
);

// A claim rejected, withdrawn or expired, seen live: play goes on where it
// stopped. (Accepted, the board is finished and the toast above tells its
// score.)
watch(
  () => [playing.value?.playing_id, playing.value?.claim ?? null] as const,
  ([id, claim], [oldId, oldClaim]) => {
    if (id != null && id === oldId && oldClaim && !claim && playing.value?.phase === 'play') {
      showToast(claimOffText(oldClaim, Date.now()), 'warning');
    }
  },
);

// Still showing a claim 2 s after its deadline: the backend has settled it
// but its update hasn't come (it may have been lost), so reread the game.
// Only while the page is on screen; coming back loads it anyway.
useStaleDeadline(
  () => (viewActive.value ? (pendingClaim.value?.claim.expires_at ?? null) : null),
  reloadQuietly,
);

// The same for the set's next board: still on the finished one 2 s after
// its `next_board_at`, the deal (or its HandDealt) may have been lost.
useStaleDeadline(
  () => (viewActive.value && playing.value?.phase === 'finished' ? (playing.value.next_board_at ?? null) : null),
  reloadQuietly,
);

function reloadQuietly() {
  game.load(tableId.value).catch(() => {
    // The next update, or the offline note's Refresh, tells the rest.
  });
}

// Somebody else's claim (or the board moving on) takes the sheet away.
watch(mayClaim, (may) => {
  if (!may) {
    claimOpen.value = false;
  }
});

// Each finished board adds to the set, and the set ending (after its last
// board, or early) gives it a winner: read GET /sets/{id} once for each, on a
// reload as well as live. A failure (403 for a set we didn't play in, as a
// newcomer to the table) only hides the line or the set view.
let setReadFor: string | null = null;
watch(
  () => {
    const set = shownSet.value;
    const state = playing.value;
    if (!set || !state || (state.phase !== 'finished' && !set.finished)) {
      return null;
    }
    return `${set.id}:${set.finished}:${state.playing_id}:${state.phase}`;
  },
  (key) => {
    const set = shownSet.value;
    if (key && set && key !== setReadFor) {
      setReadFor = key;
      history.loadSet(set.id).catch(() => {
        setReadFor = null;
      });
    }
  },
  { immediate: true },
);

// A board finished here (live or on a reload): the one to review once the
// next board replaces it.
watch(
  () => (playing.value?.phase === 'finished' ? playing.value.playing_id : null),
  (playingId) => {
    if (playingId) {
      seenBoard.value = {
        tableId: tableId.value,
        playingId,
        number: playing.value!.board?.number ?? null,
        setId: playing.value!.set?.id ?? null,
      };
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
    // Opening the game is coming back: a seat held after a Leave mid-set, or
    // marked away, is ours again (the store greets us once the backend agrees).
    tablesStore.comeBack(id);
    loadBids();
    findReviewable();
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

// Boards finished here before the page saw them (a reload mid-set, or the
// next set's first board): the running set's results, then, if still none,
// our history's latest entry. Only once a board may have been finished
// here, and after the game state, so the board shows first. A failure (403
// for a newcomer's set) only leaves the review out.
async function findReviewable() {
  const set = shownSet.value;
  if (!set || (set.number === 1 && set.board === 1)) {
    return;
  }
  // A finished board or set is read by the watch above already.
  const read = playing.value?.phase === 'finished' || set.finished;
  if (!read && set.board > 1 && !history.sets[set.id]) {
    await history.loadSet(set.id).catch(() => null);
  }
  if (reviewable.value.length === 0) {
    await history.loadHistory(null).catch(() => null);
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
  const { alert, explanation } = alertDraft.value;
  const text = explanation.trim();
  const draft: AlertDraft | null =
    alert || text ? { alert: true, explanation: text || null } : null;
  try {
    await game.call(bid.id, draft);
    alertDraft.value = { alert: false, explanation: '' };
  } catch (e) {
    // A 422 means the bid list no longer matches the server's (a reseeded
    // database).
    await refused(e, 'Your call could not be made. Please try again.', () => loadBids(true));
  } finally {
    calling.value = false;
  }
}

// Ask the opponents what their call at `index` means. A robot's answer is
// in the state we get back (the call's pop-up shows it at once); a human's
// comes later, over our own channel.
async function askAbout(index: number) {
  if (noting.value) {
    return;
  }
  noting.value = true;
  try {
    await game.askAboutCall(index);
  } catch (e) {
    await refused(e, 'Your question could not be sent. Please try again.');
  } finally {
    noting.value = false;
  }
}

// Our explanation of the call in the sheet, for both opponents. A 422 (too
// long, or empty) keeps the sheet open to fix it; anything else closes it.
async function sendExplanation(explanation: string) {
  const index = explainIndex.value;
  if (index === null || noting.value) {
    return;
  }
  noting.value = true;
  try {
    await game.explainCall(index, explanation);
    explainIndex.value = null;
  } catch (e) {
    if (statusOf(e) !== 422) {
      explainIndex.value = null;
    }
    await refused(e, 'Your explanation could not be sent. Please try again.');
  } finally {
    noting.value = false;
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

// Our chat message, to `to`, about the call attached if any. Refused (409
// before the first deal, 422, 429 for too many at once…), it is said in a
// toast and the text stays, to send again.
async function sendChat(to: ChatTo) {
  const body = chatDraft.value.trim();
  if (chatSending.value || body === '') {
    return;
  }
  chatSending.value = true;
  try {
    await chat.send(body, to);
    chatDraft.value = '';
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
    } else {
      showToast(errorMessage(e, 'Your message could not be sent. Please try again.'), 'danger', 'top');
    }
  } finally {
    chatSending.value = false;
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

// Deal now: ask for the next board before its time, for ourselves only
// (nobody asks for anyone else). The last human to ask deals it, and the new
// board replaces this one.
async function askNext() {
  if (asking.value) {
    return;
  }
  asking.value = true;
  try {
    await game.next();
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

// A manager fills an empty seat, as on the table's page: the player picked
// in the search (yourself is a plain seat change here), or a robot.
async function seatPlayer(user: SearchedUser) {
  const seat = seatingAt.value;
  seatingAt.value = null;
  if (!seat) {
    return;
  }
  await fillSeat(
    seat,
    () =>
      user.id === me.value
        ? tablesStore.join(tableId.value, seat)
        : tablesStore.seatUser(tableId.value, user.id, seat),
    user.id === me.value ? `You now sit at ${seat}.` : `${user.username} now sits at ${seat}.`,
    'Could not seat that player. Please try again.',
  );
}

async function addRobot(seat: Seat) {
  await fillSeat(
    seat,
    () => tablesStore.seatRobot(tableId.value, seat),
    `A robot now sits at ${seat}.`,
    'Could not add a robot. Please try again.',
  );
}

// 409: the seat was taken (or the player sat down elsewhere) meanwhile.
// 403: we no longer manage the table. Either way its copy is stale, so it
// is read again; the game itself is untouched.
async function fillSeat(seat: Seat, request: () => Promise<unknown>, done: string, fallback: string) {
  if (fillingSeat.value !== null) {
    return;
  }
  fillingSeat.value = seat;
  try {
    await request();
    showToast(done, 'success');
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    showToast(errorMessage(e, fallback), 'danger');
    await tablesStore.loadTable(tableId.value).catch(() => {
      // The next update or refresh says how the seats stand.
    });
  } finally {
    fillingSeat.value = null;
  }
}

// Leaving between boards: free, since the board is over, unless the set
// goes on: then the seat is held for a few minutes, and not coming back
// loses the set for our side.
async function leave() {
  if (asking.value) {
    return;
  }
  const stake = table.value ? tablesStore.stakeOf(table.value) : null;
  const confirmed = await confirmLeave(
    table.value,
    me.value,
    playing.value?.phase ?? null,
    playing.value?.board?.number ?? null,
    stake,
  );
  if (!confirmed) {
    return;
  }
  asking.value = true;
  try {
    const { tableDeleted, held } = await tablesStore.leave(tableId.value);
    game.clear();
    let message = 'You left the table.';
    if (held) {
      message = heldNotice(stake);
    } else if (tableDeleted) {
      message = 'You left the table. Nobody was left, so it was deleted.';
    }
    await showToast(message, held ? 'warning' : 'success');
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

/* Room for the chat beside the table on a wide screen. The chat panel
   (`.chat-side`) takes 8 + 320 px from the right of the content, which pads
   16 px, so reserving 328 px of padding (outside `max-width`, hence
   content-box) centres the column in what the chat leaves, as far from the
   chat as from the left edge. Where the column centred on the whole content
   already clears the chat by that much (100 % >= 520 + 2 x 328 px), the
   clamp() steps the padding down to 0, so opening the chat doesn't move the
   board. 100 % is the content's width, with or without the side menu. */
.play.with-chat-side {
  box-sizing: content-box;
  padding-right: calc(328px - clamp(0px, (100% - 1176px) * 1000, 328px));
}

/* Room to scroll the bidding box and the hand above a phone's chat sheet. */
.play.with-chat-sheet {
  padding-bottom: 50vh;
}

.chat-side {
  top: 8px;
  right: 8px;
  bottom: 8px;
  width: 320px;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 12px;
  background: var(--ion-background-color, #fff);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.chat-badge {
  margin-left: 4px;
}

@media (max-width: 575px) {
  .chat-toggle-label {
    display: none;
  }
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

.set-bar {
  margin: 0 0 8px;
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
  color: var(--ion-color-primary);
}

.set-bar-over {
  color: var(--ion-color-medium);
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

.outcome .outcome-you {
  margin-top: 4px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--ion-color-primary);
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

.claim-button {
  margin: 0 0 16px;
}
</style>
