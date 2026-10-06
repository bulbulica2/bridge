<template>
  <!-- A finished board laid out for paper (Print / Save as PDF on the review
       page): the board, the four hands as dealt round a compass, the auction
       and the play trick by trick. It only exists while printing, outside
       the app (teleported to <body>); src/theme/print.css hides the rest. -->
  <article class="board-printout">
    <header>
      <h1>Board {{ review.board?.number ?? '?' }}</h1>
      <p class="meta">
        Dealer {{ review.board ? SEAT_NAMES[review.board.dealer] : '?' }} ·
        {{ review.board ? vulnerabilityText(review.board.vulnerable, mySeat).text : 'Vulnerable: ?' }} ·
        Playing #{{ review.playing_id ?? '?' }}
      </p>
      <p v-if="review.result" class="meta">
        <strong>{{ resultSummary(review.result) }}</strong>
        <template v-if="matchpoints"> · Matchpoints {{ matchpoints }}</template>
      </p>
    </header>

    <section class="compass" aria-label="Hands as dealt">
      <div v-for="seat in SEATS" :key="seat" class="hand" :class="`hand-${seat}`">
        <p class="who">
          <strong>{{ SEAT_NAMES[seat] }}</strong>
          <span v-if="review.board && isVulnerable(seat, review.board.vulnerable)" class="vul">vul</span>
          <br />
          {{ playerLabel(review.players[seat]) }}
        </p>
        <p v-for="suit in SUITS" :key="suit" class="suit" :class="{ red: isRed(suit) }">
          <span class="symbol">{{ SUIT_SYMBOLS[suit] }}</span>
          {{ suitRanks(review.deal?.[seat] ?? [], suit) }}
        </p>
      </div>
      <div class="centre">
        <span class="c-N">N</span>
        <span class="c-W">W</span>
        <span class="c-E">E</span>
        <span class="c-S">S</span>
      </div>
    </section>

    <p v-if="!recorded" class="note">The auction and play of this board weren't recorded.</p>

    <div v-if="recorded" class="columns">
      <section class="auction">
        <h2>Auction</h2>
        <table>
          <thead>
            <tr>
              <th v-for="seat in WRITTEN_SEATS" :key="seat" scope="col">{{ seat }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, r) in auction" :key="r">
              <td v-for="(cell, c) in row" :key="c">
                <span
                  v-if="cell.kind === 'call'"
                  :class="{ red: isRedStrain(cell.bid.strain) && isContractBid(cell.bid) }"
                >
                  {{ callLabel(cell.bid) }}<sup v-if="cell.call.alert" class="alert-mark">!</sup>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <ul v-if="alerts.length > 0" class="alerts" aria-label="Alerts">
          <li v-for="(line, i) in alerts" :key="i">! {{ line }}</li>
        </ul>
        <p class="contract">
          <template v-if="review.contract">
            {{ contractLabel(review.contract) }}
            <template v-if="lead">
              <br />Lead {{ cardText(lead.card) }} by {{ SEAT_NAMES[lead.seat] }}
            </template>
          </template>
          <template v-else>Passed out</template>
        </p>
      </section>

      <section v-if="tricks.length > 0" class="play">
        <h2>Play</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th v-for="seat in WRITTEN_SEATS" :key="seat" scope="col">{{ seat }}</th>
              <th scope="col">Won</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tricks" :key="row.number">
              <td>{{ row.number }}</td>
              <td
                v-for="seat in WRITTEN_SEATS"
                :key="seat"
                :class="{ lead: seat === row.leader, red: isRedCard(row, seat) }"
              >
                {{ cardAt(row, seat) }}
              </td>
              <td>{{ row.winner ?? '–' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="key">The card led to each trick is in bold.</p>
      </section>
    </div>

    <p v-if="claim" class="note">{{ claim }}</p>
    <p v-if="review.result && review.result.declarer && review.result.tricks_won !== null" class="note">
      Declarer took {{ review.result.tricks_won }} tricks.
    </p>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { PlayingReview } from '@/services/history';
import { alertLines } from '@/utils/alerts';
import {
  auctionRows,
  callLabel,
  contractLabel,
  isContractBid,
  isRedStrain,
  SEAT_NAMES,
} from '@/utils/auction';
import { isRed, isVulnerable, SUIT_SYMBOLS, SUITS, vulnerabilityText } from '@/utils/cards';
import {
  cardText,
  claimNote,
  matchpointsText,
  openingLead,
  playerLabel,
  suitRanks,
  trickRows,
  WRITTEN_SEATS,
} from '@/utils/export';
import type { ExportExtras, TrickRow } from '@/utils/export';
import { resultSummary } from '@/utils/result';
import { isRecorded } from '@/utils/review';

// `mySeat`: the viewer's seat if they played the board, for "(you)" after
// who is vulnerable.
const props = withDefaults(
  defineProps<{ review: PlayingReview; extras?: ExportExtras; mySeat?: Seat | null }>(),
  { extras: () => ({}), mySeat: null },
);

const recorded = computed(() => isRecorded(props.review));
const auction = computed(() =>
  auctionRows(props.review.auction ?? [], props.review.board?.dealer ?? 'W', [...WRITTEN_SEATS]),
);
const alerts = computed(() => alertLines(props.review.auction ?? []));
const tricks = computed(() => trickRows(props.review));
const lead = computed(() => openingLead(props.review));
const claim = computed(() => claimNote(props.review));
const matchpoints = computed(() => matchpointsText(props.extras));

function cardAt(row: TrickRow, seat: Seat): string {
  const played = row.cards.find((c) => c.seat === seat);
  return played ? cardText(played.card) : '';
}

function isRedCard(row: TrickRow, seat: Seat): boolean {
  const played = row.cards.find((c) => c.seat === seat);
  return !!played && isRed(played.card.suit);
}
</script>

<style scoped>
/* Paper, not the app's theme: black on white whatever the colour scheme. */
.board-printout {
  color: #000;
  background: #fff;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 10.5pt;
  line-height: 1.3;
}

h1 {
  margin: 0 0 2pt;
  font-size: 18pt;
}

h2 {
  margin: 0 0 4pt;
  font-size: 12pt;
}

p {
  margin: 0;
}

.meta {
  margin-bottom: 2pt;
}

.red {
  color: #c00;
}

.compass {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-areas:
    '. n .'
    'w c e'
    '. s .';
  gap: 6pt 18pt;
  align-items: center;
  margin: 12pt 0;
  break-inside: avoid;
}

.hand-N {
  grid-area: n;
}

.hand-S {
  grid-area: s;
}

.hand-W {
  grid-area: w;
  justify-self: end;
}

.hand-E {
  grid-area: e;
}

.who {
  margin-bottom: 2pt;
}

.vul {
  margin-left: 4pt;
  padding: 0 3pt;
  border: 1px solid #c00;
  border-radius: 2pt;
  color: #c00;
  font-size: 8pt;
  text-transform: uppercase;
}

.suit {
  white-space: nowrap;
}

.symbol {
  display: inline-block;
  width: 1.2em;
}

.centre {
  grid-area: c;
  position: relative;
  width: 70pt;
  height: 70pt;
  border: 1px solid #000;
  font-weight: 700;
}

.centre span {
  position: absolute;
}

.c-N {
  top: 3pt;
  left: 50%;
  transform: translateX(-50%);
}

.c-S {
  bottom: 3pt;
  left: 50%;
  transform: translateX(-50%);
}

.c-W {
  left: 4pt;
  top: 50%;
  transform: translateY(-50%);
}

.c-E {
  right: 4pt;
  top: 50%;
  transform: translateY(-50%);
}

.columns {
  display: flex;
  gap: 24pt;
  align-items: flex-start;
}

.auction {
  flex: 0 0 auto;
  break-inside: avoid;
}

.play {
  flex: 1 1 auto;
}

table {
  border-collapse: collapse;
}

th,
td {
  min-width: 30pt;
  padding: 1pt 4pt;
  border-bottom: 1px solid #ccc;
  text-align: left;
  white-space: nowrap;
}

th {
  border-bottom-color: #000;
}

tr {
  break-inside: avoid;
}

td.lead {
  font-weight: 700;
}

.contract {
  margin-top: 6pt;
}

.alert-mark {
  font-weight: 700;
}

.alerts {
  margin: 4pt 0 0;
  padding: 0;
  list-style: none;
  font-size: 8.5pt;
}

.key {
  margin-top: 4pt;
  font-size: 8.5pt;
}

.note {
  margin-top: 8pt;
}
</style>
