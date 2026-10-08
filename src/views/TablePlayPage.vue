<template>
  <ion-page>
    <AppHeader :title="headerTitle" :subtitle="headerSubtitle">
      <template #end>
        <!-- The board's chat, with how many messages came since we looked. -->
        <ion-button
          v-if="chatOn"
          class="chat-toggle"
          :aria-label="chatAria"
          :aria-expanded="chat.open"
          @click="showChat(!chat.open)"
        >
          <ion-icon slot="start" :icon="chatbubblesOutline" />
          <span class="chat-toggle-label">Chat</span>
          <ion-badge v-if="chat.unread > 0" color="action" class="chat-badge">{{ chat.unread }}</ion-badge>
        </ion-button>
        <!-- Look back at the finished boards without leaving the table. -->
        <ion-button v-if="reviewable.length > 0" class="review-boards" @click="reviewOpen = true">
          Last board
        </ion-button>
        <!-- The way off the seat (#181), whatever the board is doing: the
             confirmation says what leaving costs now. Never on the table. -->
        <ion-button v-if="seatedHere" class="leave-table" :disabled="asking" @click="leave">
          Leave
        </ion-button>
        <!-- Watching without a seat (#182): said, and the way out. -->
        <template v-if="watching">
          <span class="watching-pill" role="status" aria-label="Watching">
            <ion-icon :icon="eyeOutline" aria-hidden="true" />
            <span>Watching</span>
          </span>
          <ion-button class="stop-watching" :disabled="asking" @click="stopWatching">
            Stop watching
          </ion-button>
        </template>
      </template>
    </AppHeader>
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" v-ion-event:ion-refresh="refresh">
        <ion-refresher-content />
      </ion-refresher>

      <!-- On a wide screen the chat sits beside the table, which stays
           centred in the room left of it; on a phone it is a bottom sheet
           (below). Pop-ups treat the panel as the screen's right edge. -->
      <aside v-if="chatSide" slot="fixed" class="chat-side" data-right-edge>
        <BoardChat v-bind="chatProps" v-model:draft="chatDraft" v-on="chatEvents" />
      </aside>

      <!-- A wide screen with room for it (#163): the table takes boards
           A/B's layout (BridgeTable's `wide`) and, during the auction, the
           auction and the bidding box in its centre. -->
      <div
        ref="playEl"
        class="play"
        :class="{ 'with-chat-side': chatSide, 'with-chat-sheet': chatSheet, 'play-wide': wideTable }"
      >
        <div v-if="notFound" class="gone">
          <p>This table no longer exists.</p>
          <ion-button router-link="/tables" router-direction="back">Back to tables</ion-button>
        </div>

        <!-- 403: only the four players seated here may see the board. The
             table itself is anyone's to look at: its plates, and its free
             seats to take (a link to a table we don't sit at, say). -->
        <div v-else-if="notSeated" class="not-seated">
          <template v-if="table">
            <p class="not-seated-note">{{ notSeatedText }}</p>
            <!-- Only robots sit here since the last person left: they wait
                 for somebody to take over, and the backend deletes the table
                 after a few minutes if nobody does. -->
            <p v-if="table.unattended_since" class="unattended">
              Robots only — sit down to take over. You'll manage the table, and it is
              deleted {{ UNATTENDED_MINUTES }} minutes after the last player left if nobody does.
            </p>
            <!-- The header's Your table leads back there. -->
            <p v-if="seatedElsewhere" class="seated-elsewhere">
              You sit at <strong>{{ seatedElsewhere.name || `table #${seatedElsewhere.id}` }}</strong>.
              Taking a seat here moves you.
            </p>
            <BridgeTable
              :players="tablePlayers"
              :my-seat="null"
              :board="null"
              :turn="null"
              :away="awayTags"
              seatable
              :menu-seat="seatMenu?.seat ?? null"
              :busy="seatBusy"
              @select="player = $event"
              @empty="openSeatMenu"
            >
              <template #menu>
                <SeatMenu v-bind="seatMenuProps" @sit="sit" @player="seatingAt = $event" @robot="addRobot" @close="seatMenu = null" />
              </template>
              <p class="waiting-title">{{ table.free_seats.length > 0 ? 'Free seats' : 'Table full' }}</p>
              <p class="waiting-count">{{ 4 - table.free_seats.length }} of 4 seated</p>
            </BridgeTable>
          </template>
          <p v-else>You don't sit at this table, so you can't see its board.</p>
          <!-- A table that allows it may be watched without a seat (#182). -->
          <ion-button
            v-if="table?.allow_kibitzers && !auth.isBanned && !seatedElsewhere"
            class="watch-table"
            :disabled="asking"
            @click="watchHere"
          >
            Watch
          </ion-button>
          <ion-button fill="outline" router-link="/tables" router-direction="back">Back to tables</ion-button>
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

          <!-- Our own seat left mid-set or marked away: opening the table
               brings us back by itself (load), this says so until the
               backend takes the mark back. -->
          <AwayNotice :table="table" :me="me" held />

          <!-- No board yet (or a finished one with new players, or a set
               over): the table itself is the waiting room (#181). Its plates
               are the table's seats with their ticks, its centre the Start,
               an empty seat a tap away from being filled, a player's plate
               from their profile (and a manager's Remove). -->
          <BridgeTable
            :players="waitingRoom ? tablePlayers : players"
            :my-seat="showStart ? tableSeat : mySeat"
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
            :forced-seconds="autoPlay.card.value ? autoPlay.secondsLeft.value : null"
            :claim="pendingClaim ? { seat: pendingClaim.claim.seat, cards: pendingClaim.claim.hand } : null"
            :deal="playing.phase === 'finished' ? playing.deal : null"
            :away="awayTags"
            :banks="turnClock.banks.value"
            :ready="readySeats"
            :calls="playing.phase === 'auction' ? (playing.auction ?? []) : null"
            :board-label="playing.set ? boardPosition(playing.set) : null"
            :wide="wideTable"
            :seatable="waitingRoom"
            :menu-seat="seatMenu?.seat ?? null"
            :busy="sendingCard !== null || seatBusy"
            :sending-id="sendingCard"
            @select="player = $event"
            @play="playCard"
            @empty="openSeatMenu"
          >
            <!-- An empty seat tapped: its menu at the plate (#192). -->
            <template #menu>
              <SeatMenu v-bind="seatMenuProps" @sit="sit" @player="seatingAt = $event" @robot="addRobot" @close="seatMenu = null" />
            </template>
            <!-- The board's details in the table's corners (#171), where
                 they take no room of their own: who is vulnerable, in
                 words, for the whole board (#151) top left; the contract
                 and the tricks through the play top right; the Auction
                 button from the first call on (the only place the auction
                 shows once the bidding is over) bottom left; Claim bottom
                 right. The board's place in its set is in the header, the
                 dealer the D on their plate. -->
            <template #top-left>
              <VulnerabilityLabel
                v-if="vulnerable !== null"
                class="corner-vul"
                compact
                :vulnerable="vulnerable"
                :my-seat="mySeat"
              />
            </template>
            <template #top-right>
              <div class="corner-contract" aria-live="polite">
                <template v-if="playing.phase === 'play' && playing.contract">
                  <p class="contract-line">
                    <CallLabel :bid="playing.contract.bid" />{{ doubledMark(playing.contract.doubled) }}
                    by {{ SEAT_NAMES[playing.contract.declarer] }}
                  </p>
                  <p v-if="playing.tricks_won" class="tricks-won">
                    <span>NS {{ playing.tricks_won.ns }}</span>
                    <span aria-hidden="true">·</span>
                    <span>EW {{ playing.tricks_won.ew }}</span>
                  </p>
                  <!-- A robot declarer hands its game to us, its dummy. -->
                  <p v-if="forDeclarer" class="contract-you">you play it</p>
                </template>
              </div>
              <!-- Between sets the corner has the table's time for a set
                   instead (#181): a manager's gear opens the settings, the
                   others read it. -->
              <template v-if="settingsCorner">
                <button
                  v-if="table!.can_manage"
                  type="button"
                  class="settings-gear"
                  :aria-label="`Table settings: ${setClockText(tableMinutes)}`"
                  @click="settingsOpen = true"
                >
                  <ion-icon :icon="settingsOutline" aria-hidden="true" />
                  <span>{{ setMinutesShort(tableMinutes) }}</span>
                </button>
                <p v-else class="corner-minutes" :title="setClockText(tableMinutes)">
                  <span class="sr-only">Time for a set: </span>{{ setMinutesShort(tableMinutes) }}
                </p>
                <p class="corner-kibitzers">
                  {{ table!.allow_kibitzers ? 'Kibitzers allowed' : 'No kibitzers' }}
                </p>
              </template>
              <!-- The result dialog closed to look at the deal: this opens
                   it again, with the countdown to the next board. -->
              <ResultPill
                v-if="finishedId !== null && !resultOpen"
                :next-board-at="resultVote ? (playing.next_board_at ?? null) : null"
                @open="resultDismissed = null"
              />
            </template>
            <template #bottom-left>
              <AuctionPopover
                v-if="auctionButton"
                class="corner-auction"
                :auction="playing.auction!"
                :board="playing.board"
                :my-seat="mySeat"
                :turn="playing.phase === 'auction' ? playing.turn : null"
                :players="players"
                :live="playing.phase !== 'finished'"
                :busy="noting"
                :bidding="playing.phase === 'auction'"
                v-on="auctionEvents"
              />
            </template>
            <!-- Ending the play early: any player but dummy, while no claim
                 is pending. After a refused claim, nobody claims until the
                 next card: the button stays, grey ("Claim · locked"), and
                 says why when tapped. -->
            <template #bottom-right>
              <ClaimButton
                v-if="mayClaim || claimBlocked"
                :locked="claimBlocked"
                :disabled="sendingCard !== null || claiming"
                @claim="claimOpen = true"
              />
            </template>

            <p class="waiting-title">
              {{ seatedCount < 4 ? 'Waiting for 4 players' : 'Waiting for Start' }}
            </p>
            <p class="waiting-count">{{ seatedCount }} of 4 seated</p>

            <!-- Waiting for Start: who the board waits for, Start (or
                 Cancel), and the Start timer's countdown (bb#142). The last
                 Start deals the board here. -->
            <template v-if="showStart && table" #centre>
              <StartBox :table="table" :me="me" :busy="asking" @start="start" @cancel="cancelStart" />
            </template>
            <!-- A wide table's auction: the calls so far and, on our turn,
                 the bidding box under them, in the middle of the table. It
                 keeps the height it reached until the next board, so the
                 table doesn't shrink when the box goes after our call. -->
            <template v-else-if="auctionCentre" #centre>
              <div ref="auctionEl" class="centre-auction">
                <AuctionHistory v-bind="liveAuctionProps" v-on="auctionEvents" />
                <template v-if="canBid">
                  <BiddingBox v-if="game.bids.length > 0" v-bind="biddingProps" v-on="biddingEvents" />
                  <div v-else class="bids-missing">
                    <p v-if="bidsError">{{ bidsError }}</p>
                    <p v-else><ion-spinner name="dots" /> Loading the bidding box…</p>
                    <ion-button v-if="bidsError" size="small" fill="outline" @click="loadBids()">
                      Try again
                    </ion-button>
                  </div>
                </template>
              </div>
            </template>
            <!-- Once the board is over the centre goes back to the board's
                 details, after the last trick's moment on show. -->
            <template
              v-else-if="playing.contract && (playing.phase === 'play' || finishedTrick)"
              #centre
            >
              <TrickArea
                :cards="shownTrick.cards"
                :my-seat="mySeat"
                :winner="shownTrick.winner"
                :trump="playing.contract!.bid.strain"
                :my-slot="playing.phase === 'play' && !watching"
              />
              <div class="trick-foot">
                <p class="trick-caption" aria-live="polite">{{ shownTrick.caption }}</p>
                <!-- The last trick in a pop-up, so the trick in progress
                     stays in the middle. Its row stays when it has no pill
                     (the first trick, a trick held), so the centre keeps its
                     height. -->
                <span class="trick-peek">
                  <LastTrickPopover v-if="peekTrick" :trick="peekTrick" :my-seat="mySeat" />
                </span>
              </div>
            </template>
          </BridgeTable>

          <!-- Somebody away mid-set: their seats' tags count down to the
               robots (bb#138), this says once what for. -->
          <AwayNotice :table="table" :me="me" />

          <!-- The turn clock line (Daylight, #161): what the board waits
               for ("Your call", "Your turn · follow in ♦", "Waiting for
               East", "robot-1 is thinking…"), the turn clock on the right
               (turn_deadline, bb#120: "0:42", "Set 0:42" when the time for
               the set ends first, bb#131) and the move's minute as a bar,
               orange on our move and red in its last seconds. "Waiting for
               East (away)" with no clock when the board waits for an away
               player, whose seat counts down (bb#138). Empty while a
               claim's banner says it all. There all through the auction
               and the play, always as tall, so nothing moves from call to
               call or card to card (#133). -->
          <TurnClockLine
            v-if="playing.phase === 'auction' || playing.phase === 'play'"
            :text="lineText"
            :time="pendingClaim ? '' : turnClock.time.value"
            :fraction="pendingClaim ? null : turnClock.fraction.value"
            :mine="myTurn && !pendingClaim"
            :urgent="turnClock.urgent.value"
            :robot="robotActing && !pendingClaim"
          />

          <!-- Alerted calls stand out (partner's only once the auction is
               over); until the board is over, an opponent's call may be
               asked about and ours answered. -->
          <AuctionHistory
            v-if="playing.phase === 'auction' && playing.auction && !auctionCentre"
            v-bind="liveAuctionProps"
            v-on="auctionEvents"
          />

          <!-- A finished board shows every hand on the table instead. -->
          <section
            v-if="(playing.phase === 'auction' || playing.phase === 'play') && !watching"
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
              :forced-seconds="autoPlay.card.value ? autoPlay.secondsLeft.value : null"
              :class="{ 'turn-urgent': playFrom === 'own' && turnClock.urgent.value }"
              @play="playCard"
            />
            <div v-else class="dealing">
              <ion-spinner name="dots" />
              <span>Dealing…</span>
            </div>
          </section>

          <template v-if="canBid && !auctionCentre">
            <BiddingBox v-if="game.bids.length > 0" v-bind="biddingProps" v-on="biddingEvents" />
            <div v-else class="bids-missing">
              <p v-if="bidsError">{{ bidsError }}</p>
              <p v-else><ion-spinner name="dots" /> Loading the bidding box…</p>
              <ion-button v-if="bidsError" size="small" fill="outline" @click="loadBids()">
                Try again
              </ion-button>
            </div>
          </template>

          <!-- The set is over and the table waits for Start (#191): its
               results under the table, whether it ended mid-board or on its
               last board, until the next set's first deal. Never above the
               table, which keeps its place from the waiting state through
               the next deal. -->
          <SetResultsPanel v-if="setResultsBelow" class="set-results-below" :set="endedSet!" :my-seat="mySeat" />

          <OfflineRefresh :table-id="tableId" :disabled="loading" @refresh="load()" />
        </template>
      </div>

      <PlayerProfileSheet
        :player="player"
        :removable="profileRemovable"
        :remove-blocked="profileRemoveBlocked"
        :busy="seatBusy"
        @remove="removePlayer"
        @close="player = null"
      />
      <SeatPlayerSheet :seat="seatingAt" @select="seatPlayer" @close="seatingAt = null" />
      <TableSettingsDialog
        :open="settingsOpen"
        :minutes="tableMinutes"
        :allow-kibitzers="table?.allow_kibitzers ?? true"
        :busy="savingMinutes"
        :picker-key="minutesKey"
        @change="changeMinutes"
        @kibitzers="changeKibitzers"
        @close="settingsOpen = false"
      />
      <ClaimSheet
        :open="claimOpen"
        :remaining="playing ? tricksLeft(playing) : 0"
        :for-seat="forDeclarer ? claimSeat : null"
        :state="playing"
        :seat="claimSeat"
        :busy="claiming"
        @claim="sendClaim"
        @close="claimOpen = false"
      />
      <!-- A claim waiting for its answers (#186): a dialog over the table,
           which never moves for it. Play stops until it is settled. -->
      <ClaimAnswerDialog
        :open="claimAnswerOpen"
        :state="pendingClaim"
        :my-seat="mySeat"
        :acts-for="claimSeat"
        :players="players"
        :busy="claiming"
        @accept="answerClaim(true)"
        @reject="answerClaim(false)"
        @withdraw="withdrawClaim"
        @close="claimDismissed = claimKey"
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
        @did-dismiss="sheetOpen = false"
      >
        <ion-content class="ion-padding">
          <BoardChat v-if="chatSheet" v-bind="chatProps" v-model:draft="chatDraft" v-on="chatEvents" />
        </ion-content>
      </ion-modal>
      <!-- The finished board's result, its countdown and the vote to deal
           the next board now. After a set's last board, the board's result
           with no vote and a line pointing to the set's results under the
           table. -->
      <BoardResultDialog
        :open="resultOpen"
        :result="playing?.result ?? null"
        :set-over="endedSet?.number ?? null"
        :my-seat="mySeat"
        :players="players"
        :extras="boardExtras"
        :others="othersOfBoard"
        :others-loading="!othersSettled"
        :playing-id="playing?.playing_id ?? null"
        :board-id="finishedBoardId"
        :double-dummy="doubleDummy.analysis.value"
        :dd-loading="!doubleDummy.settled.value"
        :vote="resultVote"
        :ready="playing?.ready ?? []"
        :next-board-at="playing?.next_board_at ?? null"
        :busy="asking"
        @close="resultDismissed = finishedId"
        @next="askNext"
      />
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
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
import { vIonEvent } from '@/directives/ionEvent';
import { chatbubblesOutline, eyeOutline, settingsOutline } from 'ionicons/icons';
import AppHeader from '@/components/AppHeader.vue';
import AuctionHistory from '@/components/AuctionHistory.vue';
import AuctionPopover from '@/components/AuctionPopover.vue';
import AwayNotice from '@/components/AwayNotice.vue';
import BiddingBox from '@/components/BiddingBox.vue';
import BoardChat from '@/components/BoardChat.vue';
import BoardResultDialog from '@/components/BoardResultDialog.vue';
import BoardReviewModal from '@/components/BoardReviewModal.vue';
import BridgeTable from '@/components/BridgeTable.vue';
import CallLabel from '@/components/CallLabel.vue';
import ClaimButton from '@/components/ClaimButton.vue';
import ClaimAnswerDialog from '@/components/ClaimAnswerDialog.vue';
import ClaimSheet from '@/components/ClaimSheet.vue';
import ExplainCallSheet from '@/components/ExplainCallSheet.vue';
import HandView from '@/components/HandView.vue';
import LastTrickPopover from '@/components/LastTrickPopover.vue';
import OfflineRefresh from '@/components/OfflineRefresh.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import ResultPill from '@/components/ResultPill.vue';
import SeatMenu from '@/components/SeatMenu.vue';
import SeatPlayerSheet from '@/components/SeatPlayerSheet.vue';
import SetResultsPanel from '@/components/SetResultsPanel.vue';
import StartBox from '@/components/StartBox.vue';
import TableSettingsDialog from '@/components/TableSettingsDialog.vue';
import TrickArea from '@/components/TrickArea.vue';
import TurnClockLine from '@/components/TurnClockLine.vue';
import VulnerabilityLabel from '@/components/VulnerabilityLabel.vue';
import { useAwayTags } from '@/composables/useAwayTags';
import { useDoubleDummy } from '@/composables/useDoubleDummy';
import { useForcedPlay } from '@/composables/useForcedPlay';
import { useElementWidth } from '@/composables/useElementWidth';
import { useMediaQuery } from '@/composables/useMediaQuery';
import { useStaleDeadline } from '@/composables/useStaleDeadline';
import { useSteadyHeight } from '@/composables/useSteadyHeight';
import { useTurnClock } from '@/composables/useTurnClock';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useGameStore } from '@/stores/game';
import { useHistoryStore } from '@/stores/history';
import { useTablesStore } from '@/stores/tables';
import { DEFAULT_SET_MINUTES, UNATTENDED_MINUTES, canRemove, seatsOf } from '@/services/tables';
import type { Seat, SetMinutes } from '@/services/tables';
import type { ChatTo } from '@/services/chat';
import type { AlertDraft, Bid, Card, Claim, PlayedCard, Playing, Trick, Vulnerability } from '@/services/game';
import type { PublicUser, SearchedUser } from '@/services/users';
import { openQuestion } from '@/utils/alerts';
import { SEAT_NAMES, contractLabel } from '@/utils/auction';
import { SUIT_SYMBOLS, rankLabel } from '@/utils/cards';
import type { ScreenSide } from '@/utils/cards';
import { canClaim, claimLocked, claimOffText, claimSeatOf, tricksLeft } from '@/utils/claim';
import {
  autoPlaysForced,
  cardsToPlay,
  forcedCard,
  handToPlay,
  legalCards,
  playsForDeclarer,
} from '@/utils/play';
import { errorMessage, logUnexpected, statusOf } from '@/utils/errors';
import { playingExtras } from '@/utils/export';
import { doubledMark, resultSummary } from '@/utils/result';
import { confirmLeave, confirmMove, confirmRemove, heldNotice, removeBlocked, removeCost } from '@/utils/seatMove';
import { setClockText, setMinutesShort } from '@/utils/setClock';
import { boardPosition, currentSet, runningSet, setLabel } from '@/utils/sets';
import { reviewChoices } from '@/utils/review';
import type { SeenBoard } from '@/utils/review';
import { startNeeded } from '@/utils/start';
import { WIDE_TABLE_MIN_PX } from '@/utils/layout';
import { turnNotice } from '@/utils/turn';
import { TIME_UP_TEXT, actingSeat, awayOnTurn, turnClockText, turnDeadline } from '@/utils/turnClock';
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
// the seat a player or robot (or we ourselves) is on its way to, or a
// player being taken out of.
const seatingAt = ref<Seat | null>(null);
const fillingSeat = ref<Seat | null>(null);
// The empty seat whose menu is open (Sit here, Seat a player, Add robot),
// with the plate tapped and the table's side it is on (#192).
const seatMenu = ref<{ seat: Seat; plate: HTMLElement; side: ScreenSide } | null>(null);
// The table's settings dialog (a manager's gear), a change of the time for
// a set on its way, and the picker's key, bumped to put it back on the
// table's value after a refusal.
const settingsOpen = ref(false);
const savingMinutes = ref(false);
const minutesKey = ref(0);
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
// A phone's chat sheet, which would cover the cards: closed until asked for.
const sheetOpen = ref(false);
// The page's column, as wide as the window, the menu and the chat leave it.
const playEl = ref<HTMLElement | null>(null);
const playWidth = useElementWidth(playEl);
// The wide table's auction in the middle of the table (see useSteadyHeight).
const auctionEl = ref<HTMLElement | null>(null);

const me = computed(() => auth.user?.id ?? null);

// The game store holds one table's board; only trust it for this route's table.
const playing = computed(() => (game.tableId === tableId.value ? game.playing : null));

// The turn clock of the board on show (bb#120): ours, or whoever's turn it
// is, counted down from `turn_deadline`; and each seat's time for the set
// (bb#131), the acting one's counted down from `turn_started_at`.
const turnClock = useTurnClock(
  () => playing.value,
  () => me.value,
);

const table = computed(() => {
  if (tablesStore.currentTable?.id === tableId.value) {
    return tablesStore.currentTable;
  }
  return tablesStore.tables.find((t) => t.id === tableId.value) ?? null;
});

// Who sits where at the table now (its seats, not a board's snapshot).
const tablePlayers = computed<Partial<Record<Seat, PublicUser | null>>>(() =>
  Object.fromEntries((table.value ? seatsOf(table.value) : []).map(({ seat, user }) => [seat, user])),
);

// Once a board is dealt the playing's own seat snapshot names the players;
// while waiting there is none, so the table's seats do.
const players = computed<Partial<Record<Seat, PublicUser | null>>>(
  () => playing.value?.players ?? tablePlayers.value,
);

// Our seat at the table now, and whether we have one.
const tableSeat = computed<Seat | null>(
  () => table.value?.seats.find((s) => s.user_id === me.value)?.seat ?? null,
);
const seatedHere = computed(() => tableSeat.value !== null);

// Watching the table without a seat, as a kibitzer (#182): the same table,
// read-only. The game state is the public one (no seat, no hand); no
// bidding box, Claim or chat, and the result without the vote.
const watching = computed(() => tablesStore.kibitzingId === tableId.value && !seatedHere.value);

// Another table the user sits at, which sitting down here gives up.
const seatedElsewhere = computed(() =>
  tablesStore.myTable && tablesStore.myTable.id !== tableId.value ? tablesStore.myTable : null,
);

const notSeatedText = computed(() =>
  table.value && table.value.free_seats.length > 0
    ? "You don't sit at this table. Take a free seat to play."
    : "You don't sit at this table, and all four seats are taken.",
);

const mySeat = computed<Seat | null>(() => {
  // Watching: no seat, even on a board we held one on (#182).
  if (watching.value) {
    return null;
  }
  if (playing.value?.my_seat) {
    return playing.value.my_seat;
  }
  const entry = Object.entries(players.value).find(([, user]) => user?.id === me.value);
  return (entry?.[0] as Seat | undefined) ?? null;
});

// Who is vulnerable on the board in hand (auction, play and finished), for
// the label above the table; null with no board dealt.
const vulnerable = computed<Vulnerability | null>(() =>
  playing.value?.board && playing.value.phase !== 'waiting' ? playing.value.board.vulnerable : null,
);

// The others' seats marked away mid-set, each with its clock (ours is
// vouched for while we look).
const awayTags = useAwayTags(
  () => table.value,
  () => me.value,
);


// acting_user_id is who must act for `turn`: declarer on dummy's turn.
const myTurn = computed(
  () => !!playing.value?.acting_user_id && playing.value.acting_user_id === me.value,
);

// Our call to make: the box shows only then.
const canBid = computed(
  () => playing.value?.phase === 'auction' && myTurn.value && mySeat.value !== null,
);

// A wide screen whose column has room for boards A/B's table (#163): side
// plates, and a centre for the auction and the bidding box. With the menu
// pinned and the chat open, a screen just over 1100 px hasn't, and keeps
// the table it has below.
const wideTable = computed(() => chatWide.value && playWidth.value >= WIDE_TABLE_MIN_PX);

// The auction in the wide table's centre, with the bidding box under it.
const auctionCentre = computed(
  () => wideTable.value && playing.value?.phase === 'auction' && !!playing.value.auction,
);
useSteadyHeight(auctionEl, () => playing.value?.playing_id);

// The Auction button top left (#165): from the first call to the end of
// the board, the only way to see the auction once the bidding is over.
const auctionButton = computed(() => {
  const state = playing.value;
  return !!state && state.phase !== 'waiting' && (state.auction?.length ?? 0) > 0;
});

// The auction while it lasts, below the table or in its centre: an
// opponent's call may be asked about and ours answered.
const liveAuctionProps = computed(() => ({
  auction: playing.value?.auction ?? [],
  board: playing.value?.board ?? null,
  mySeat: mySeat.value,
  turn: playing.value?.turn ?? null,
  players: players.value,
  live: true,
  bidding: true,
  busy: noting.value,
}));

const auctionEvents = {
  ask: askAbout,
  explain: (index: number) => (explainIndex.value = index),
  chat: askInChat,
};

// The bidding box on our turn, its alert typed into the page's draft.
const biddingProps = computed(() => ({
  alert: alertDraft.value.alert,
  explanation: alertDraft.value.explanation,
  bids: game.bids,
  auction: playing.value?.auction ?? [],
  seat: mySeat.value!,
  busy: calling.value,
  class: { 'turn-urgent': turnClock.urgent.value },
}));

const biddingEvents = {
  call: makeCall,
  'update:alert': (alert: boolean) => (alertDraft.value.alert = alert),
  'update:explanation': (explanation: string) => (alertDraft.value.explanation = explanation),
};

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

// The pending claim, told apart from the next one: the dialog put away
// (the X, the backdrop) stays away for this claim only. Nobody claims twice
// before the next card (`claim_locked`), so the cards played tell them apart.
const claimKey = computed(() => {
  const state = pendingClaim.value;
  return state
    ? `${state.playing_id}:${state.tricks?.length ?? 0}:${state.current_trick?.length ?? 0}:${state.claim.seat}`
    : null;
});
const claimDismissed = ref<string | null>(null);
// Everyone at the table sees it, a kibitzer too; never over the review or
// with the view left.
const claimAnswerOpen = computed(
  () => claimKey.value !== null && viewActive.value && !reviewOpen.value && claimDismissed.value !== claimKey.value,
);

// The Claim button: any player but dummy (unless dummy plays for a robot
// declarer), while no claim is pending and none was refused since the last
// card. `claimBlocked`: refused, so no claim until the next card (bb#115).
const mayClaim = computed(() => !!playing.value && canClaim(playing.value, claimSeat.value));
const claimBlocked = computed(() => !!playing.value && claimLocked(playing.value, claimSeat.value));

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

// The turn clock line's words: what the board waits for, during the
// auction and the play. Nothing while a claim is pending (its banner says
// it); for an away player, the turn clock's own words; once the time is up,
// "Time is up…" until the backend's update lands.
const lineText = computed(() => {
  const state = playing.value;
  if (!state || (state.phase !== 'auction' && state.phase !== 'play') || pendingClaim.value) {
    return '';
  }
  const clock = turnClock.clock.value;
  if (awayOnTurn(clock)) {
    return turnClockText(clock!);
  }
  if (clock?.seconds === 0) {
    return TIME_UP_TEXT;
  }
  if (state.phase === 'auction') {
    return myTurn.value ? 'Your call' : waitingFor(state);
  }
  return playLine(state);
});

// Who must act for `turn` (declarer on dummy's turn), from the players.
const actor = computed(() => {
  const state = playing.value;
  return Object.values(state?.players ?? {}).find((u) => u.id === state?.acting_user_id) ?? null;
});

// A robot's move is due: it comes by itself about a second later
// (PlayingUpdated), so the page says it is thinking rather than waiting.
const robotActing = computed(() => !!actor.value?.is_robot);

// "Waiting for East", or "robot-1 is thinking…"; `from` goes before the end.
function waitingFor(state: Playing, from = ''): string {
  if (robotActing.value) {
    return `${actor.value!.username} is thinking${from}…`;
  }
  const seat = actingSeat(state);
  return seat ? `Waiting for ${SEAT_NAMES[seat]}${from}` : '';
}

// Our move in the play: "Your lead", "Your turn · follow in ♦", "Your turn
// from dummy · ♠Q plays in 3"; else whom the play waits for.
function playLine(state: Playing): string {
  if (sendingCard.value !== null) {
    return 'Playing your card…';
  }
  const turn = state.turn;
  if (playFrom.value) {
    const leading = (state.current_trick ?? []).length === 0;
    const from = {
      own: forDeclarer.value ? ' from your own hand' : '',
      dummy: ' from dummy',
      declarer: ` from ${SEAT_NAMES[turn!]}'s hand`,
    }[playFrom.value];
    const base = `${leading ? 'Your lead' : 'Your turn'}${from}`;
    const auto = autoPlay.card.value;
    if (auto) {
      return `${base} · ${cardLabel(auto)} plays in ${autoPlay.secondsLeft.value}`;
    }
    return mustFollow.value ? `${base} · follow in ${SUIT_SYMBOLS[mustFollow.value]}` : base;
  }
  if (iAmDummy.value && !forDeclarer.value) {
    return 'Declarer plays your cards';
  }
  if (!actor.value) {
    return '';
  }
  return waitingFor(state, turn && turn === state.contract?.dummy ? ', from dummy' : '');
}

// The next board waits for every human's Start: none dealt yet (or one
// abandoned), or a finished board whose four players aren't all still in
// their seats. The table's seats say who sits here: a newcomer isn't in the
// finished board's players.
const showStart = computed(
  () => !!table.value && seatedHere.value && startNeeded(table.value, playing.value),
);

// A kibitzer between sets (no set running): the table's free seats are
// theirs to take, like anyone's. Mid-set, no Sit.
const watchSit = computed(
  () => watching.value && !!table.value && !runningSet(table.value, playing.value),
);

// The waiting table: its own seats with their ticks, an empty one a button.
const waitingRoom = computed(() => showStart.value || watchSit.value);

// The seats that pressed Start, ticked on the table while a Start is
// awaited.
const readySeats = computed<Seat[]>(() =>
  waitingRoom.value && table.value ? table.value.seats.filter((s) => s.ready).map((s) => s.seat) : [],
);

// The player whose profile is open, if they sit here and the viewer may
// take them out (a manager; anyone for a robot of an unattended table): the
// profile sheet's Remove (#181).
const profileRemovable = computed(() => {
  const current = table.value;
  const held = current?.seats.find((s) => s.user_id === player.value?.id);
  return !!current && !!held && canRemove(current, held.user, auth.user);
});

// ...but not while the set is running (#190, bb#147): Remove greyed out,
// with the reason. An admin still may, as may anyone a robot of an
// unattended table.
const profileRemoveBlocked = computed(() => {
  const current = table.value;
  const held = current?.seats.find((s) => s.user_id === player.value?.id);
  return !!current && !!held && removeBlocked(current, playing.value, held.user, auth.user);
});

// A seat being taken, filled or emptied: one at a time.
const seatBusy = computed(() => fillingSeat.value !== null);

// An empty seat's menu, at its plate: take it (a seat change when we sit
// here already), and for a manager, Seat a player or Add robot.
const seatMenuProps = computed(() => ({
  seat: seatMenu.value?.seat ?? null,
  anchor: seatMenu.value?.plate ?? null,
  side: seatMenu.value?.side ?? 'top',
  moveHere: seatedHere.value,
  canManage: !!table.value?.can_manage,
}));

// A tap on an empty seat opens its menu there (from another seat's, it
// moves); on the seat whose menu is open, closes it.
function openSeatMenu(seat: Seat, plate: HTMLElement, side: ScreenSide) {
  seatMenu.value = seatMenu.value?.seat === seat ? null : { seat, plate, side };
}

// The seat taken meanwhile (a TableUpdated), or no seat to take any more
// (a board dealt): its menu goes.
watch(
  () => {
    const seat = seatMenu.value?.seat;
    const taken = !!seat && !!table.value?.seats.some((s) => s.seat === seat);
    return taken || (!!seat && !notSeated.value && !waitingRoom.value);
  },
  (gone) => {
    if (gone) {
      seatMenu.value = null;
    }
  },
);

const seatedCount = computed(() => Object.values(players.value).filter(Boolean).length);

// Each player's time for a set at this table, which a manager changes from
// the table's corner while no set runs: a set copies it when it opens, so
// the backend refuses a change mid-set (409).
const tableMinutes = computed<SetMinutes>(() => table.value?.set_minutes ?? DEFAULT_SET_MINUTES);

// The set the table is on (or ended last): the board's own `set`, updated
// by the table's events (a set broken off between boards comes as a
// TableUpdated only).
const shownSet = computed(() => currentSet(table.value, playing.value));

// While waiting for Start between sets (not for a seat refilled mid-set),
// the top-right corner has the set time: a manager's gear, else the text.
const settingsCorner = computed(() => showStart.value && !(shownSet.value && !shownSet.value.finished));

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

// The finished board's double dummy table (bb#114), read once it is over
// here (the backend refuses earlier): one line in its result dialog. Its
// results at every table too: the other tables (failures quiet, the list
// just stays away). `othersSettledFor`: the board whose read has answered.
const finishedBoardId = computed(() =>
  playing.value?.phase === 'finished' ? (playing.value.board?.id ?? null) : null,
);
const doubleDummy = useDoubleDummy(() => finishedBoardId.value);
const othersSettledFor = ref<number | null>(null);
watch(
  finishedBoardId,
  (boardId) => {
    if (boardId) {
      doubleDummy.load();
      history
        .loadResults(boardId)
        .catch(() => null)
        .finally(() => (othersSettledFor.value = boardId));
    }
  },
  { immediate: true },
);
const othersOfBoard = computed(() => {
  const id = finishedBoardId.value;
  return id ? (history.results[id] ?? null) : null;
});
// Read already (or kept from before): the dialog has its rows.
const othersSettled = computed(() => {
  const id = finishedBoardId.value;
  return !!id && (othersSettledFor.value === id || !!history.results[id]);
});

// The set is over and its results are in. Nothing to show for a set broken
// off before any board was finished.
const endedSet = computed(() => {
  const results = setResults.value;
  if (!shownSet.value?.finished || !results?.finished) {
    return null;
  }
  return results.boards.length > 0 ? results : null;
});
// Under the table while it waits for the next set's Start (#191); the next
// set's first deal ends both.
const setResultsBelow = computed(() => endedSet.value !== null && showStart.value);

// The finished board whose result the dialog shows (#174).
const finishedId = computed(() =>
  playing.value?.phase === 'finished' && playing.value.result ? playing.value.playing_id : null,
);
// The board whose dialog was closed (the X, the backdrop, a confirmation
// over it): it stays closed until the pill or coming back to the page.
const resultDismissed = ref<number | null>(null);
// The board whose dialog has waited long enough for its other tables.
const resultWaited = ref<number | null>(null);
// Its rows read, so it opens without jumping: the other tables, and after
// a set's last board the set's results (for its "Set 1 is over" line). Or
// RESULT_WAIT_MS gone by: the rows still missing hold a skeleton line.
const resultSettled = computed(
  () => othersSettled.value && (!shownSet.value?.finished || endedSet.value !== null),
);
const resultOpen = computed(
  () =>
    finishedId.value !== null &&
    viewActive.value &&
    !reviewOpen.value &&
    resultDismissed.value !== finishedId.value &&
    (resultSettled.value || resultWaited.value === finishedId.value),
);
// The same four go on to the set's next board: the dialog counts down to it
// and takes our vote. Not once the set is over or the players changed:
// everyone's Start on the page deals then.
const resultVote = computed(() => !showStart.value && !endedSet.value && !watching.value);

// How long a finished board's dialog waits for its other tables at most.
const RESULT_WAIT_MS = 1000;
let resultTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  finishedId,
  (id) => {
    clearTimeout(resultTimer);
    if (id !== null) {
      resultTimer = setTimeout(() => (resultWaited.value = id), RESULT_WAIT_MS);
    }
  },
  { immediate: true },
);

// The finished boards the review modal offers: the running set's, else the
// last one seen here, else (after a reload) the latest in our history.
const reviewable = computed(() => {
  // A kibitzer may review only boards they finished themselves (403
  // otherwise): none of this table's, as far as we can tell.
  if (watching.value) {
    return [];
  }
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
// The players' alone: a kibitzer has none (#182).
const chatOn = computed(() => !!playing.value?.playing_id && seatedHere.value);
// On show while the page is: beside the table as the player left it (open
// until they collapse it), a phone's sheet only when they open it.
const chatWanted = computed(
  () => chatOn.value && viewActive.value && (chatWide.value ? chat.keepOpen : sheetOpen.value),
);
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
  close: () => showChat(false),
  'clear-about': () => (chat.about = null),
};

// The table's name, and under it the board's place in its set ("Board 2 of
// 4 · Set 3", "· set over" once it is), never the board's number in the
// database (#171).
const headerTitle = computed(
  () => table.value?.name || (tableId.value ? `Table #${tableId.value}` : 'Table'),
);

const headerSubtitle = computed(() => {
  const set = playing.value?.set;
  if (!set) {
    return null;
  }
  return `${setLabel(set)}${shownSet.value?.finished ? ' · set over' : ''}`;
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
  // A finished board's result shows again on coming back.
  resultDismissed.value = null;
  load(false);
});

// Off screen (another page pushed on top): no card plays itself meanwhile,
// and the review closes (with its export sheet and any printout); so does
// the result dialog (`viewActive`).
onIonViewWillLeave(() => {
  viewActive.value = false;
  reviewOpen.value = false;
  explainIndex.value = null;
  seatingAt.value = null;
  seatMenu.value = null;
  settingsOpen.value = false;
});

// The chat's store follows what is on show (its unread count stops while
// it is), also after anything else opened or closed it.
watch(
  () => [chatWanted.value, chat.open] as const,
  ([wanted, open]) => {
    if (wanted !== open) {
      chat.setOpen(wanted);
    }
  },
  { immediate: true },
);

// The Chat button and Close: beside the table the choice sticks (next
// board, page, reload); a phone's sheet opens and closes for now.
function showChat(value: boolean) {
  if (chatWide.value) {
    chat.setKeepOpen(value);
  } else {
    sheetOpen.value = value;
  }
}

// Ask in the chat from a call's pop-up: the chat on show, the call attached.
function askInChat(index: number) {
  showChat(true);
  chat.askAbout(index);
}

// The chat follows the board on show: read on entering the table, emptied
// for a new board, read again once a board is finished (its every message
// is public then). Only from a seat: a kibitzer has none (#182).
watch(
  () => [tableId.value, playing.value?.playing_id ?? null, playing.value?.phase ?? null, seatedHere.value] as const,
  ([id, playingId, phase]) => {
    if (id && playing.value && seatedHere.value) {
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
// Replaced by a robot (our turn clock ran out): the set's results instead.
watch(
  () => tablesStore.kickedFrom,
  (kicked) => {
    if (kicked !== null && kicked === tableId.value) {
      tablesStore.kickedFrom = null;
      const replaced = tablesStore.replacedFrom;
      ionRouter.navigate(replaced?.tableId === kicked ? `/sets/${replaced.id}` : '/tables', 'back', 'replace');
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

// And for the turn clock: still on the same turn 2 s after `turn_deadline`,
// the robot that took the seat over (or the move that beat the clock) may
// have been lost. The backend checks every 10 s, so "Time is up…" may show
// a little longer; the TableUpdated that replaces the player ends it.
useStaleDeadline(
  () => (viewActive.value ? turnDeadline(playing.value) : null),
  reloadQuietly,
);

function reloadQuietly() {
  game.load(tableId.value).catch(() => {
    // The next update, or the offline note's Refresh, tells the rest.
  });
}

// A set started (or our seat went): no settings to change any more.
watch(settingsCorner, (shown) => {
  if (!shown) {
    settingsOpen.value = false;
  }
});

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
    // A kibitzer's read is a 403 (not a player of the set).
    if (!set || !state || watching.value || (state.phase !== 'finished' && !set.finished)) {
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
        position: playing.value!.set?.board ?? null,
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

onBeforeUnmount(() => {
  clearTimeout(pauseTimer);
  clearTimeout(resultTimer);
});

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
    // The board answered us without a seat here: we watch the table (a
    // reload while watching, #182), so its channel is followed again.
    if (!seatedHere.value) {
      tablesStore.resumeWatching(id);
    }
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
      // Somebody else's table: where we sit, if anywhere, is still to find,
      // for the header's "Your table" and for a move off it.
      tablesStore.findSeat();
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
  if (!set || (set.number === 1 && set.board === 1) || watching.value) {
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

// Deal next board (the result dialog's vote): ask for the next board
// before its time, for ourselves only
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

// A manager fills an empty seat from its menu: the player picked in
// the search (yourself is a plain seat change here), or a robot.
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

// Take a free seat here: a seat change when we sit here already, a move
// (confirmed first: it costs something there) when we sit at another table,
// else our first seat here, which opens the board to us.
async function sit(seat: Seat) {
  if (fillingSeat.value !== null) {
    return;
  }
  try {
    const current = table.value;
    if (!seatedHere.value && current && me.value) {
      const from = await tablesStore.seatedTable();
      if (
        from &&
        from.id !== tableId.value &&
        !(await confirmMove(from, current, me.value, game.phaseOf(from.id), tablesStore.stakeOf(from)))
      ) {
        return;
      }
    }
    fillingSeat.value = seat;
    await tablesStore.join(tableId.value, seat);
    notSeated.value = false;
    await load(false);
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    // 409 when somebody got there first (or the seat name is unknown).
    logUnexpected(e);
    showToast(errorMessage(e, 'Could not take that seat. Please try again.'), 'danger');
    await tablesStore.loadTable(tableId.value).catch(() => {
      // The next update or refresh says how the seats stand.
    });
  } finally {
    fillingSeat.value = null;
  }
}

// A manager picks another time for a set in the settings dialog. A set
// started meanwhile (409) or a role gone (403) leaves the page stale: the
// refusal is toasted, the table read again and the picker put back. A
// change takes back every Start (bb#142): the players are told
// (the tables store), and press again.
async function changeMinutes(minutes: SetMinutes) {
  if (savingMinutes.value) {
    return;
  }
  savingMinutes.value = true;
  try {
    await tablesStore.updateSettings(tableId.value, { set_minutes: minutes });
    showToast(`Each player now has ${minutes} minutes for a set.`, 'success');
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    minutesKey.value++;
    showToast(errorMessage(e, 'Could not change the time for a set. Please try again.'), 'danger');
    await tablesStore.loadTable(tableId.value).catch(() => {
      // The next update or refresh says how the table stands.
    });
  } finally {
    savingMinutes.value = false;
  }
}

// A manager allows kibitzers or stops allowing them (#182), between sets
// like the time for a set. Turned off, everyone watching is sent back to
// the lobby (the backend tells them). Refused like the time.
async function changeKibitzers(allow: boolean) {
  if (savingMinutes.value) {
    return;
  }
  savingMinutes.value = true;
  try {
    await tablesStore.updateSettings(tableId.value, { allow_kibitzers: allow });
    showToast(allow ? 'Kibitzers may watch this table.' : 'Kibitzers are no longer allowed here.', 'success');
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    minutesKey.value++;
    showToast(errorMessage(e, 'Could not change the table settings. Please try again.'), 'danger');
    await tablesStore.loadTable(tableId.value).catch(() => {
      // The next update or refresh says how the table stands.
    });
  } finally {
    savingMinutes.value = false;
  }
}

// Stop watching (#182): back to the lobby, whatever the backend says (a 409
// or 404 is the same already; anything else is told on the way).
async function stopWatching() {
  if (asking.value) {
    return;
  }
  asking.value = true;
  try {
    await tablesStore.stopWatching();
  } catch (e) {
    logUnexpected(e);
    showToast(errorMessage(e, 'Could not stop watching the table.'), 'danger');
  } finally {
    asking.value = false;
  }
  game.clear();
  ionRouter.navigate('/tables', 'back', 'replace');
}

// Watch this table from its page (a link to a table we don't sit at): its
// board then shows as a kibitzer's.
async function watchHere() {
  if (asking.value) {
    return;
  }
  asking.value = true;
  try {
    await tablesStore.watch(tableId.value);
    notSeated.value = false;
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    showToast(errorMessage(e, 'Could not watch this table. Please try again.'), 'danger');
    return;
  } finally {
    asking.value = false;
  }
  await load(false);
}

// Our own sheets and modals go before a confirmation, so nothing of the
// page's stands over the alert (#121): closed, and drawn closed.
async function closeOverlays() {
  player.value = null;
  seatMenu.value = null;
  settingsOpen.value = false;
  reviewOpen.value = false;
  resultDismissed.value = finishedId.value;
  claimDismissed.value = claimKey.value;
  claimOpen.value = false;
  explainIndex.value = null;
  seatingAt.value = null;
  sheetOpen.value = false;
  await nextTick();
}

// A manager takes a player out from their profile sheet (#181; anyone a
// robot of an unattended table). The sheet closes before the confirmation,
// which is inside the try, so nothing fails unseen (#121). Never mid-set
// (#190): the sheet's Remove is greyed out then, so nothing is asked; a set
// that started meanwhile is the backend's 409, told like any refusal.
async function removePlayer(target: PublicUser) {
  const current = table.value;
  const held = current?.seats.find((s) => s.user_id === target.id);
  if (!current || !held || fillingSeat.value !== null) {
    return;
  }
  if (removeBlocked(current, playing.value, held.user, auth.user)) {
    return;
  }
  const { seat, user } = held;
  try {
    await closeOverlays();
    if (!(await confirmRemove(user, seat, removeCost(current, playing.value, seat)))) {
      return;
    }
    fillingSeat.value = seat;
    const { tableDeleted } = await tablesStore.removePlayer(tableId.value, user.id);
    if (tableDeleted) {
      // The last robot of an unattended table: the id is dead.
      showToast(`${user.username} was removed and the table was deleted.`, 'success');
      ionRouter.navigate('/tables', 'back', 'replace');
      return;
    }
    showToast(`${user.username} was removed from the table.`, 'success');
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    // 403: we no longer manage the table. 404: they already left. 409: a
    // set started meanwhile.
    logUnexpected(e);
    showToast(errorMessage(e, 'Could not remove that player. Please try again.'), 'danger');
    await tablesStore.loadTable(tableId.value).catch(() => {
      // The next update or refresh says how the seats stand.
    });
  } finally {
    fillingSeat.value = null;
  }
}

// Leaving (the header's Leave, or the result dialog's): free between sets,
// since nothing is at stake; mid-board it abandons the board, and mid-set
// the seat is held, a robot taking it if we don't come back in time
// (confirmLeave says which). The confirmation is inside the try, so nothing
// fails unseen (#121).
async function leave() {
  if (asking.value) {
    return;
  }
  try {
    await closeOverlays();
    const stake = table.value ? tablesStore.stakeOf(table.value) : null;
    const confirmed = await confirmLeave(
      table.value,
      me.value,
      playing.value?.phase ?? null,
      playing.value?.set?.board ?? null,
      stake,
    );
    if (!confirmed) {
      return;
    }
    asking.value = true;
    const { tableDeleted, held } = await tablesStore.leave(tableId.value);
    game.clear();
    let message = 'You left the table.';
    if (held) {
      message = heldNotice();
    } else if (tableDeleted) {
      message = 'You left the table. Nobody was left, so it was deleted.';
    }
    await showToast(message, held ? 'warning' : 'success');
    ionRouter.navigate('/tables', 'back', 'replace');
  } catch (e) {
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
    } else {
      logUnexpected(e);
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
/* Wide enough for dummy's 13 cards on one row across the top of the table
   at their usual overlap, Extra large ones included (#172): 120 + 12 x 55.2
   px (the card, then the strip each other one shows, cardSize.ts and
   handRow.ts) + 3 x 4 px between the suits = 794.4 px, plus the table's
   padding (2 x 12 px) = 818.4 px, rounded up. Narrower, dummy's cards
   overlap more instead (HandView's `singleRow`). */
.play {
  max-width: 832px;
  margin: 0 auto;
}

/* Room for the chat beside the table on a wide screen. The chat panel
   (`.chat-side`) takes 8 + 320 px from the right of the content, which pads
   16 px, so reserving 328 px of padding (outside `max-width`, hence
   content-box) centres the column in what the chat leaves, as far from the
   chat as from the left edge. Where the column centred on the whole content
   already clears the chat by that much (100 % >= 832 + 2 x 328 px), the
   clamp() steps the padding down to 0, so opening the chat doesn't move the
   board. 100 % is the content's width, with or without the side menu. */
.play.with-chat-side {
  box-sizing: content-box;
  padding-right: calc(328px - clamp(0px, (100% - 1488px) * 1000, 328px));
}

/* A wide table (#163): room for side plates and the auction in the centre.
   With the chat beside it, the clamp() below steps its padding down where
   the column centred on the whole content already clears the chat (100 % >=
   1040 + 2 x 328 px). */
.play.play-wide {
  max-width: 1040px;
}

.play.play-wide.with-chat-side {
  padding-right: calc(328px - clamp(0px, (100% - 1696px) * 1000, 328px));
}

/* The auction and the bidding box, two cards on the table's navy (board
   A), as wide as the centre allows up to the bidding box's comfort. */
.centre-auction {
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  color: var(--bridge-ink);
  text-align: left;
}

.centre-auction > * {
  margin: 0;
}

.play .centre-auction :deep(.empty) {
  color: var(--bridge-muted);
}

.centre-auction .bids-missing {
  padding: 12px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
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
  border: 1px solid var(--bridge-line);
  border-radius: var(--bridge-radius-panel);
  background: var(--bridge-surface);
  box-shadow: 0 4px 16px var(--bridge-shadow);
}

.chat-badge {
  margin-left: 4px;
}

@media (max-width: 575px) {
  .chat-toggle-label {
    display: none;
  }
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
  font-weight: 700;
}

.waiting-count {
  font-size: 0.8rem;
  color: var(--bridge-on-table-muted);
}

/* Our hand or the bidding box in our clock's last seconds: ringed in red,
   pulsing unless motion is reduced. */
.turn-urgent {
  border-radius: 8px;
  outline: 2px solid var(--ion-color-danger);
  outline-offset: 4px;
  animation: turn-urgent-pulse 1s ease-in-out infinite alternate;
}

@keyframes turn-urgent-pulse {
  from {
    outline-color: var(--ion-color-danger);
  }
  to {
    outline-color: rgba(var(--ion-color-danger-rgb), 0.25);
  }
}

@media (prefers-reduced-motion: reduce) {
  .turn-urgent {
    animation: none;
  }
}

.my-hand {
  margin: 8px 0 16px;
}

/* A set's results under the table between sets (#191). */
.play .set-results-below {
  margin-top: 16px;
}

/* The table's time for a set in its top-right corner between sets: a
   manager's gear (44 px to tap), or the text. */
.settings-gear {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: 22px;
  background: var(--bridge-on-table-chip);
  color: var(--bridge-on-table);
  font-family: var(--bridge-font-numbers);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
}

.settings-gear ion-icon {
  font-size: 1.25rem;
}

.settings-gear:focus-visible {
  outline: 2px solid var(--bridge-amber);
  outline-offset: 2px;
}

.corner-minutes {
  margin: 0;
  color: var(--bridge-on-table-muted);
  font-family: var(--bridge-font-numbers);
  font-size: 0.95rem;
  font-weight: 700;
}

/* Whether the table may be watched (#182), small under the set time. */
.corner-kibitzers {
  margin: 4px 0 0;
  color: var(--bridge-on-table-muted);
  font-size: 0.75rem;
  text-align: right;
}

/* The header's "Watching" (#182): a quiet navy pill beside Stop watching. */
.watching-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--bridge-radius-pill);
  background: var(--bridge-navy-tint);
  color: var(--bridge-navy-tint-text);
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
}

@media (max-width: 575px) {
  .watching-pill span {
    display: none;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.not-seated {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
  text-align: center;
}

.not-seated p {
  margin: 0;
}

.not-seated > ion-button {
  align-self: center;
}

.unattended {
  font-size: 0.9rem;
  color: var(--bridge-redouble-text);
}

.seated-elsewhere {
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

/* The caption over the Last trick pill, on two rows wherever it is: a
   centre cell too narrow for both on one row would wrap only while the
   pill shows. */
.trick-foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

/* The pill's height (LastTrickPopover), with or without it. */
.trick-peek {
  display: flex;
  justify-content: center;
  height: 22px;
}

.trick-caption {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ion-color-medium);
}

/* The contract and the tricks in the table's top-right corner (#171):
   white on the navy, right-aligned, wrapping to short lines in a narrow
   corner. */
.corner-contract {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  color: var(--bridge-on-table);
  font-size: 0.875rem;
  line-height: 1.2;
  text-align: right;
}

.corner-contract p {
  margin: 0;
}

.contract-line {
  font-weight: 700;
}

/* Hearts and diamonds stay readable on the navy. */
.contract-line :deep(.call.red) {
  color: var(--bridge-on-table-bad);
}

.corner-contract .tricks-won {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0 6px;
  font-family: var(--bridge-font-numbers);
  font-size: 0.9375rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.contract-you {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--bridge-on-table-accent);
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
</style>
