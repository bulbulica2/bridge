<template>
  <!-- Daylight's table (#160): a navy panel, the viewer always at the
       bottom, partner opposite, the opponents on the left and right (see
       screenSide). Each seat is a plate: avatar (initials, a robot's icon),
       name, seat and the player's time for the set (`banks`: grey when
       idle, solid while it runs, red under a minute; robots and admins have
       none). The seat on turn is ringed orange, an away seat's plate is red
       with its clock ("away · 0:42", AwaySeatTag), a seat that pressed
       Start (`ready`) has a green tick and an empty one is dashed. Once a
       board is dealt each seat is striped red when its side is vulnerable
       and green when it is not. During the auction each seat's last call
       sits by its plate (`calls`), an opponent's alerted one with the amber
       "!". Once dummy is face up its cards lie at its seat: across the top
       when the viewer is declarer (who plays them from there), in suit
       columns on a side seat for a defender, and not at all when the viewer
       is dummy, whose own hand below is the same cards. A robot declarer's
       dummy, who plays declarer's game, has declarer's cards (`declarer`,
       theirs alone to see) across the top instead. While a claim is
       pending, the claimer's cards lie face up at their seat (the viewer's
       own are below the table already). Once the board is over, the whole
       deal lies face up, each hand at its seat (in a replay, what is left
       of it, in the room the hand took as dealt). Dummy's and a robot
       declarer's cards read trumps first (`trump`, see suitOrder) and lie
       on one row whatever the width (HandView's `singleRow`, #172); the
       claimer's and the deal keep bridge order. With `wide` (the play page
       on a wide screen, #163) the table takes boards A/B's layout:
       partner top centre, the opponents' plates upright where room is
       short, and a centre wide enough for the auction and the bidding box.
       The four corners beside partner and the viewer (#171) hold whatever
       the page puts in the `top-left`, `top-right`, `bottom-left` and
       `bottom-right` slots (the play page: who is vulnerable, the contract
       and the tricks, Auction, Claim). They lie over the panel's corners,
       so they take no height of their own, and partner's and the viewer's
       plates keep clear of them. -->
  <div class="bridge-table" :class="{ 'table-wide': wide, 'with-corners': CORNERS.some((c) => $slots[c]) }">
    <template v-for="corner in CORNERS" :key="corner">
      <div v-if="$slots[corner]" class="corner" :class="`corner-${corner}`">
        <slot :name="corner" />
      </div>
    </template>
    <div
      v-for="side in SIDES"
      :key="side"
      class="seat"
      :class="[
        `side-${side}`,
        board ? (isVulnerable(seatOn[side], board.vulnerable) ? 'vul' : 'not-vul') : null,
        {
          'seat-turn': turn === seatOn[side],
          'seat-mine': side === 'bottom' && mySeat,
          'seat-wide': side === 'top' && (dummySide === 'top' || declarerSide === 'top'),
          'seat-away': !!away[seatOn[side]],
          'seat-ready': ready.includes(seatOn[side]),
        },
      ]"
      :data-seat="seatOn[side]"
    >
      <div class="plate-row">
        <div v-if="players[seatOn[side]]" class="plate">
          <span
            class="avatar"
            :class="{ 'avatar-robot': players[seatOn[side]]!.is_robot }"
            :title="players[seatOn[side]]!.is_robot ? 'Robot player' : undefined"
            aria-hidden="true"
          >
            <svg
              v-if="players[seatOn[side]]!.is_robot"
              class="robot-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="5" y="8" width="14" height="11" rx="3" />
              <path d="M12 4v4M9 13h.01M15 13h.01" />
            </svg>
            <template v-else>{{ initials(players[seatOn[side]]!.username) }}</template>
          </span>
          <span class="plate-text">
            <span class="plate-name">
              <button
                type="button"
                class="seat-user"
                :aria-label="profileLabel(players[seatOn[side]]!)"
                @click="emit('select', players[seatOn[side]]!)"
              >
                {{ players[seatOn[side]]!.username }}
              </button>
              <AdminBadge v-if="players[seatOn[side]]!.is_admin" />
            </span>
            <span class="plate-sub">
              <span class="seat-name">{{ SEAT_NAMES[seatOn[side]] }}</span>
              <span
                v-if="board?.dealer === seatOn[side]"
                class="dealer"
                title="Dealer"
                role="img"
                aria-label="dealer"
              >D</span>
              <span v-if="side === 'bottom' && mySeat" class="seat-you">you</span>
              <span v-if="dummy && dummy.seat === seatOn[side] && side !== 'bottom'" class="seat-dummy">
                dummy
              </span>
              <span v-if="declarerSide === side" class="seat-dummy">declarer</span>
              <AwaySeatTag v-if="away[seatOn[side]]" class="seat-away-tag" :tag="away[seatOn[side]]!" />
            </span>
          </span>
          <span
            v-if="banks[seatOn[side]]"
            class="seat-bank"
            :class="{ 'seat-bank-running': banks[seatOn[side]]!.running, 'seat-bank-low': banks[seatOn[side]]!.low }"
            :aria-label="bankLabel(seatOn[side], banks[seatOn[side]]!)"
          >
            {{ formatClock(banks[seatOn[side]]!.seconds) }}
          </span>
          <span v-if="ready.includes(seatOn[side])" class="seat-ready-mark" title="Pressed Start" aria-label="ready">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
        </div>
        <span v-else class="seat-empty">Empty · {{ SEAT_NAMES[seatOn[side]] }}</span>

        <!-- The seat's last call in the auction, kept in place (empty) until
             it has one, so nothing moves when it comes. -->
        <span v-if="calls" class="last-call">
          <span
            v-if="lastCalls[seatOn[side]]"
            class="last-call-chip"
            :class="{ alerted: lastCallAlerted(seatOn[side]) }"
          >
            <CallLabel :bid="lastCalls[seatOn[side]]!.bid" chip />
            <span v-if="lastCallAlerted(seatOn[side])" class="alert-mark" aria-label="alerted">!</span>
          </span>
        </span>
      </div>

      <!-- While a board has a turn, every seat keeps a line for the turn
           label, filled on the seat on turn only: the table keeps its
           height as the turn goes round. -->
      <span v-if="turn" class="turn-slot">
        <span v-if="turn === seatOn[side]" class="turn" :class="{ 'turn-thinking': !myTurn && thinking }">
          <span class="turn-dot" aria-hidden="true" />{{ turnLabel(side) }}
        </span>
      </span>

      <template v-if="dummySide === side">
        <HandView
          v-if="side === 'top'"
          class="dummy-hand"
          :cards="dummy!.cards"
          label="Dummy's hand"
          :playable="dummyPlayable"
          :busy="busy"
          :sending-id="sendingId"
          :forced-id="dummyForcedId"
          :forced-seconds="forcedSeconds"
          :order="trumpOrder"
          single-row
          @play="emit('play', $event)"
        />
        <DummyColumns v-else :cards="dummy!.cards" :order="trumpOrder" />
      </template>
      <HandView
        v-else-if="declarerSide === side"
        class="declarer-hand"
        :cards="declarer!.cards"
        :label="`Declarer's hand, ${SEAT_NAMES[declarer!.seat]}`"
        :playable="declarerPlayable"
        :busy="busy"
        :sending-id="sendingId"
        :forced-id="declarerForcedId"
        :forced-seconds="forcedSeconds"
        :order="trumpOrder"
        single-row
        @play="emit('play', $event)"
      />
      <DummyColumns
        v-else-if="claimSide === side"
        class="claim-hand"
        :cards="claim!.cards"
        :label="`${SEAT_NAMES[seatOn[side]]}'s hand, claiming`"
      />
      <DummyColumns
        v-else-if="deal"
        class="dealt-hand"
        :cards="deal[seatOn[side]]"
        :rows="reserve ? longestSuit(reserve[seatOn[side]]) : 0"
        :label="`${SEAT_NAMES[seatOn[side]]}'s ${replay ? 'cards left' : 'hand as dealt'}`"
      />
    </div>

    <div class="centre" :class="{ 'centre-slot': $slots.centre }">
      <slot v-if="$slots.centre" name="centre" />
      <template v-else-if="board">
        <p v-if="boardLabel !== null" class="board-number">{{ boardLabel ?? `Board ${board.number}` }}</p>
        <p class="board-line">Dealer {{ board.dealer }}</p>
        <p class="board-line">{{ vulnerabilityText(board.vulnerable, mySeat).text }}</p>
      </template>
      <slot v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import DummyColumns from '@/components/DummyColumns.vue';
import HandView from '@/components/HandView.vue';
import AdminBadge from '@/components/AdminBadge.vue';
import AwaySeatTag from '@/components/AwaySeatTag.vue';
import CallLabel from '@/components/CallLabel.vue';
import type { AuctionCall, Board, Card, Strain } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES } from '@/utils/auction';
import { formatClock } from '@/utils/away';
import type { AwayTag } from '@/utils/away';
import { isPartner } from '@/utils/alerts';
import { isVulnerable, longestSuit, seatAt, suitOrder, vulnerabilityText } from '@/utils/cards';
import { bankLabel } from '@/utils/setClock';
import type { SeatBank } from '@/utils/setClock';
import type { ScreenSide } from '@/utils/cards';

const props = withDefaults(
  defineProps<{
    players: Partial<Record<Seat, PublicUser | null>>;
    // Null for someone watching without a seat: then North is at the top.
    mySeat: Seat | null;
    board: Board | null;
    turn: Seat | null;
    // Whether the viewer acts for `turn` (declarer does on dummy's turn).
    // Left out, the bottom seat's turn is taken to be the viewer's.
    myTurn?: boolean | null;
    // Whether a robot acts for `turn` (dummy's turn included, when declarer
    // is one): the seat then reads "Thinking…" rather than "To act".
    thinking?: boolean;
    // The contract's strain: dummy's and a robot declarer's cards put it on
    // the left (null or NT: the base order).
    trump?: Strain | null;
    // Dummy's seat and remaining cards, once they are face up.
    dummy?: { seat: Seat; cards: Card[] } | null;
    // Dummy's cards declarer may play now (see HandView), else null.
    dummyPlayable?: number[] | null;
    // Dummy's only legal card, about to play itself (see HandView).
    dummyForcedId?: number | null;
    // A robot declarer's seat and remaining cards, for its dummy (the
    // viewer), who plays them; null for everyone else.
    declarer?: { seat: Seat; cards: Card[] } | null;
    // Declarer's cards the viewer may play now, and the only legal one about
    // to play itself, as for dummy's.
    declarerPlayable?: number[] | null;
    declarerForcedId?: number | null;
    // The seconds before dummy's or declarer's forced card plays itself.
    forcedSeconds?: number | null;
    // The claimer's seat and remaining cards while a claim is pending.
    claim?: { seat: Seat; cards: Card[] } | null;
    // All four hands as dealt, once the board is finished.
    deal?: Record<Seat, Card[]> | null;
    // `deal` is what is left of each hand at a step of a board's replay.
    replay?: boolean;
    // The hands as dealt, when `deal` holds fewer cards (a replay): each
    // hand keeps the height it had as dealt, so the table doesn't shrink as
    // the cards go.
    reserve?: Record<Seat, Card[]> | null;
    // Seats whose players are away mid-set, each with its tag (its clock
    // to the robot taking the seat, utils/away).
    away?: Partial<Record<Seat, AwayTag>>;
    // Each human's time for the set (utils/setClock), none for a robot or
    // an admin.
    banks?: Partial<Record<Seat, SeatBank>>;
    // The seats that pressed Start, while a Start is awaited.
    ready?: Seat[];
    // The auction so far, while it lasts: each seat's last call by its
    // plate. Null (the default) shows none.
    calls?: AuctionCall[] | null;
    // The centre's first line while it shows the board: left out, "Board 7"
    // (the board's number); the play page gives its place in the set
    // ("Board 2 of 4") or null for none, never the number (#165).
    boardLabel?: string | null;
    // A wide screen's layout (see the comment above).
    wide?: boolean;
    busy?: boolean;
    sendingId?: number | null;
  }>(),
  {
    myTurn: null,
    thinking: false,
    trump: null,
    dummy: null,
    dummyPlayable: null,
    dummyForcedId: null,
    declarer: null,
    declarerPlayable: null,
    declarerForcedId: null,
    forcedSeconds: null,
    claim: null,
    deal: null,
    replay: false,
    reserve: null,
    away: () => ({}),
    banks: () => ({}),
    ready: () => [],
    calls: null,
    boardLabel: undefined,
    wide: false,
    busy: false,
    sendingId: null,
  },
);

const emit = defineEmits<{ select: [user: PublicUser]; play: [card: Card] }>();

const SIDES: ScreenSide[] = ['top', 'left', 'right', 'bottom'];
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

const seatOn = computed(
  () =>
    Object.fromEntries(SIDES.map((side) => [side, seatAt(side, props.mySeat)])) as Record<
      ScreenSide,
      Seat
    >,
);

const trumpOrder = computed(() => suitOrder(props.trump));

// Where dummy's cards are drawn: nowhere for dummy themselves (their own hand
// is below the table).
const dummySide = computed<ScreenSide | null>(() => {
  const dummy = props.dummy;
  if (!dummy) {
    return null;
  }
  const side = SIDES.find((s) => seatOn.value[s] === dummy.seat);
  return side && side !== 'bottom' ? side : null;
});

// Where a robot declarer's cards are drawn for its dummy: opposite them,
// across the top.
const declarerSide = computed<ScreenSide | null>(() => {
  const declarer = props.declarer;
  const side = declarer ? SIDES.find((s) => seatOn.value[s] === declarer.seat) : undefined;
  return side && side !== 'bottom' ? side : null;
});

// Where the claimer's cards are drawn: nowhere when the claimer is the
// viewer, whose own hand is below the table.
const claimSide = computed<ScreenSide | null>(() => {
  const claim = props.claim;
  const side = claim ? SIDES.find((s) => seatOn.value[s] === claim.seat) : undefined;
  return side && side !== 'bottom' ? side : null;
});

// Each seat's latest call, while the auction lasts.
const lastCalls = computed(() => {
  const last: Partial<Record<Seat, AuctionCall>> = {};
  for (const call of props.calls ?? []) {
    last[call.seat] = call;
  }
  return last;
});

// An alerted last call shows its "!", but never partner's: alerts are for
// the opponents during the auction.
function lastCallAlerted(seat: Seat): boolean {
  return !!lastCalls.value[seat]?.alert && !isPartner(seat, props.mySeat);
}

// Two letters for the avatar: "bulbulica" reads BU.
function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

function profileLabel(user: PublicUser): string {
  return `${user.username}'s profile${user.is_robot ? ', robot' : ''}`;
}

function turnLabel(side: ScreenSide): string {
  const mine = props.myTurn ?? side === 'bottom';
  if (mine) {
    return 'Your turn';
  }
  return props.thinking ? 'Thinking…' : 'To act';
}
</script>

<style scoped>
/* The navy panel. Everything on it reads `--bridge-on-table`; a playable
   card on it is ringed amber (HandView's `--playable-ring`). */
.bridge-table {
  --playable-ring: var(--bridge-amber);
  --call-chip-bg: var(--bridge-card-face);
  --call-chip-ink: var(--bridge-card-ink);
  --call-chip-red: var(--bridge-card-red);
  /* The corners' room (see .corner): a share of the table's width (a
     table with corners is its own container), inset by the panel's
     padding, and the gap partner's and the viewer's plates keep from
     them. */
  --corner-w: clamp(84px, 24cqi, 128px);
  --corner-gap: 8px;
  --corner-x: 12px;
  --corner-top: 12px;
  --corner-bottom: 12px;
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1.1fr 1fr;
  gap: 10px 8px;
  padding: 12px;
  border-radius: var(--bridge-radius-panel);
  background: var(--bridge-table);
  color: var(--bridge-on-table);
}

.side-top {
  grid-column: 2;
  grid-row: 1;
}

.side-left {
  grid-column: 1;
  grid-row: 2;
}

.centre {
  grid-column: 2;
  grid-row: 2;
}

.side-right {
  grid-column: 3;
  grid-row: 2;
}

.side-bottom {
  grid-column: 2;
  grid-row: 3;
}

/* Partner and the viewer take the whole width (their plate and last call
   side by side, and dummy across the top for declarer, or declarer for a
   robot declarer's dummy, like the viewer's own hand); the opponents the
   middle row's sides. */
.side-top,
.side-bottom {
  grid-column: 1 / 4;
}

.dummy-hand,
.declarer-hand,
.claim-hand,
.dealt-hand {
  margin-top: 4px;
}

.seat,
.centre {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  text-align: center;
}

.plate-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 8px;
  box-sizing: border-box;
  max-width: 100%;
}

/* The corners (#171): laid over the panel's four corners, beside partner
   and the viewer, so no row grows because of them. Their text wraps to
   their width rather than widen anything, and partner's and the viewer's
   plates keep that width (and a gap) clear on both sides, so they stay
   centred and nothing covers them. A hand across the top or the bottom
   starts below the plate, lower than a corner reaches. */
.corner {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  max-width: var(--corner-w);
}

.bridge-table.with-corners {
  container-type: inline-size;
}

.corner-top-left,
.corner-bottom-left {
  left: var(--corner-x);
  align-items: flex-start;
  text-align: left;
}

.corner-top-right,
.corner-bottom-right {
  right: var(--corner-x);
  align-items: flex-end;
  text-align: right;
}

.corner-top-left,
.corner-top-right {
  top: var(--corner-top);
}

.corner-bottom-left,
.corner-bottom-right {
  bottom: var(--corner-bottom);
}

.with-corners .side-top > .plate-row,
.with-corners .side-bottom > .plate-row {
  padding-inline: calc(var(--corner-w) + var(--corner-gap));
}

/* A seat's plate: avatar, name over seat, the set's clock on the right. */
.plate {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: 6px 10px 6px 6px;
  border-radius: 14px;
  background: var(--bridge-table-inner);
  text-align: left;
}

/* The usual convention, on the plate's top edge: red for a vulnerable
   side, green for not. */
.seat.vul .plate {
  box-shadow: inset 0 3px 0 var(--bridge-vul-stripe);
}

.seat.not-vul .plate {
  box-shadow: inset 0 3px 0 var(--bridge-not-vul-stripe);
}

/* On turn: the orange ring (over the stripe). */
.seat-turn .plate,
.seat-turn.vul .plate,
.seat-turn.not-vul .plate {
  box-shadow: 0 0 0 3px var(--bridge-action);
}

/* Away mid-set: a red plate with its clock. */
.seat-away .plate {
  background: var(--bridge-plate-away);
}

.seat-away .avatar {
  background: var(--bridge-avatar-away);
  color: var(--bridge-avatar-away-ink);
}

.avatar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--bridge-avatar);
  color: var(--bridge-avatar-ink);
  font-size: 0.75rem;
  font-weight: 700;
}

.avatar-robot {
  background: var(--bridge-avatar-robot);
}

.robot-icon {
  width: 18px;
  height: 18px;
}

.plate-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.plate-name {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.seat-user {
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.seat-user:hover,
.seat-user:focus-visible {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.seat-user:focus-visible {
  outline: 2px solid var(--bridge-amber);
  outline-offset: 2px;
}

.plate-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  font-size: 0.75rem;
  color: var(--bridge-on-table-muted);
}

.seat-away .plate-sub {
  color: var(--bridge-on-plate-away);
}

.seat-away-tag {
  --away-tag-color: var(--bridge-on-plate-away);
  --away-tag-urgent: var(--bridge-on-table);
  font-size: 0.7rem;
}

.dealer {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bridge-amber);
  color: var(--bridge-on-amber);
  font-size: 0.65rem;
  font-weight: 700;
}

.seat-dummy,
.seat-you {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
}

/* A player's time for the set: grey while idle, solid while it runs, red
   under a minute. */
.seat-bank {
  flex: none;
  padding: 2px 7px;
  border-radius: 7px;
  background: var(--bridge-on-table-chip);
  color: var(--bridge-on-table-muted);
  font-family: var(--bridge-font-numbers);
  font-size: 0.95rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.seat-bank-running {
  background: var(--bridge-bank-running);
  color: var(--bridge-on-bank-running);
}

.seat-bank-low {
  background: var(--bridge-bank-low);
  color: var(--bridge-on-bank-low);
}

.seat-ready-mark {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bridge-ready);
  color: var(--bridge-on-ready);
}

.seat-ready-mark svg {
  width: 14px;
  height: 14px;
}

/* An empty seat: dashed, waiting for a player. */
.seat-empty {
  padding: 10px 14px;
  border: 2px dashed var(--bridge-action);
  border-radius: 14px;
  background: var(--bridge-action-tint);
  color: var(--bridge-action-text);
  font-size: 0.9rem;
  font-weight: 700;
}

/* The seat's last call, the height of a chip whether it has one or not. */
.last-call {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
}

.last-call-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 9px;
}

.last-call-chip.alerted {
  box-shadow: 0 0 0 2px var(--bridge-amber);
}

.alert-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 4px;
  border-radius: 50%;
  background: var(--bridge-amber);
  color: var(--bridge-on-amber);
  font-size: 0.7rem;
  font-weight: 700;
}

/* One line of the label's size, empty or not. */
.turn-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 1.25em;
  font-size: 0.75rem;
  line-height: 1.25;
}

.turn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 700;
  color: var(--bridge-on-table-turn);
}

.turn.turn-thinking {
  color: var(--bridge-on-table-thinking);
}

.turn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}

@media (prefers-reduced-motion: reduce) {
  .turn-dot {
    animation: none;
  }
}

.centre {
  min-height: 88px;
  padding: 8px 6px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-on-table-wash);
}

/* The trick's cards fit the centre's width (TrickArea's `--card-max`). */
.centre.centre-slot {
  container-type: inline-size;
  padding: 6px 4px;
  background: none;
}

.centre p {
  margin: 0;
}

/* Anything the page lays on the table reads on its navy. */
.bridge-table :deep(.empty) {
  color: var(--bridge-on-table-muted);
}

.board-number {
  font-weight: 700;
}

.board-line {
  font-size: 0.8rem;
  color: var(--bridge-on-table-muted);
}

/* A wide screen (#163, boards A/B): roomier, the side seats as wide as
   their plates (upright where the table is short of room) and the centre
   all the rest, room for the auction and the bidding box. The table is its
   own container, so the seats follow its width rather than the window's
   (the menu and the chat take their share of a wide screen); the corners
   too (cqi resolves against the table where --corner-w is used). */
.bridge-table.table-wide {
  --corner-w: clamp(120px, 18cqi, 190px);
  --corner-x: 24px;
  --corner-top: 20px;
  --corner-bottom: 24px;
  container: bridge-table / inline-size;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px 20px;
  padding: 20px 24px 24px;
  border-radius: 28px;
}

.table-wide .side-left,
.table-wide .side-right {
  min-width: clamp(84px, 18cqi, 190px);
}

.table-wide .side-left {
  align-items: flex-start;
}

.table-wide .side-right {
  align-items: flex-end;
}

.table-wide .centre {
  min-height: 160px;
}

@container bridge-table (max-width: 759px) {
  .side-left .plate-row,
  .side-right .plate-row {
    flex-direction: column;
  }

  .side-left .plate,
  .side-right .plate {
    flex-direction: column;
    gap: 4px;
    width: 84px;
    padding: 6px 4px;
    text-align: center;
  }

  .side-left .plate-text,
  .side-right .plate-text {
    align-items: center;
    max-width: 100%;
  }

  .side-left .plate-sub,
  .side-right .plate-sub {
    justify-content: center;
  }

  .side-left .seat-user,
  .side-right .seat-user {
    max-width: 76px;
  }
}

/* A phone: the side seats take only what their plate and any hand need,
   and the centre all the rest, so the trick's cards stay large. Their
   plates stand upright: avatar over name over seat, a fixed width so a
   turn label coming and going never moves the centre. */
@media (max-width: 575px) {
  .bridge-table {
    --corner-gap: 4px;
    --corner-x: 8px;
    --corner-top: 10px;
    --corner-bottom: 10px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px 6px;
    padding: 10px 8px;
    border-radius: 18px;
  }

  /* A side seat's last call under its plate. */
  .side-left .plate-row,
  .side-right .plate-row {
    flex-direction: column;
  }

  .side-left .plate,
  .side-right .plate {
    flex-direction: column;
    gap: 4px;
    width: 76px;
    padding: 6px 4px;
    text-align: center;
  }

  .side-left .plate-text,
  .side-right .plate-text {
    align-items: center;
    max-width: 100%;
  }

  .side-left .plate-sub,
  .side-right .plate-sub {
    justify-content: center;
  }

  .side-left .seat-user,
  .side-right .seat-user {
    max-width: 68px;
  }

  .avatar {
    width: 30px;
    height: 30px;
  }
}
</style>
