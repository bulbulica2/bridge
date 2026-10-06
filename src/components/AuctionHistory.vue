<template>
  <!-- The auction as players write it down: one column per seat, in the
       table's rotation (the viewer's column last, so South sees W N E S),
       rows of four starting in the dealer's column. Alerted calls stand
       out, with their explanation a hover or a tap away (AuctionCallCell).
       Daylight (#160): a white card of chips, the vulnerable side's seats
       in red, the call awaited a "?" ringed orange. -->
  <section class="auction" aria-label="Auction">
    <table>
      <thead>
        <tr>
          <th
            v-for="seat in columns"
            :key="seat"
            scope="col"
            :class="{ mine: seat === mySeat, vul: board && isVulnerable(seat, board.vulnerable) }"
          >
            <span class="seat">{{ seat }}</span>
            <span v-if="players[seat]" class="player">{{ players[seat]!.username }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, r) in rows" :key="r">
          <td v-for="(cell, c) in row" :key="c" :data-seat="columns[c]">
            <AuctionCallCell
              v-if="cell.kind === 'call'"
              :call="cell.call"
              :index="cell.index"
              :my-seat="mySeat"
              :live="live"
              :busy="busy"
              :bidding="bidding"
              @ask="emit('ask', $event)"
              @explain="emit('explain', $event)"
              @chat="emit('chat', $event)"
            />
            <span v-else-if="cell.kind === 'next'" class="next" aria-label="To call">?</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="auction.length === 0 && !turn" class="empty">No calls yet.</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AuctionCallCell from '@/components/AuctionCallCell.vue';
import type { AuctionCall, Board } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { auctionColumns, auctionRows } from '@/utils/auction';
import { isVulnerable } from '@/utils/cards';

const props = withDefaults(
  defineProps<{
    auction: AuctionCall[];
    board: Board | null;
    mySeat: Seat | null;
    // Whose call is awaited: a "?" marks their cell. Null once it is over.
    turn?: Seat | null;
    players?: Partial<Record<Seat, PublicUser | null>>;
    // The board is still on: opponents' calls may be asked about, in a
    // word or in the chat, and our own answered (`ask`/`chat`/`explain`
    // with the call's index).
    live?: boolean;
    // A question or an answer is on its way.
    busy?: boolean;
    // The auction is still on: partner's alerts stay hidden.
    bidding?: boolean;
  }>(),
  { turn: null, players: () => ({}), live: false, busy: false, bidding: false },
);

const emit = defineEmits<{
  ask: [index: number];
  explain: [index: number];
  chat: [index: number];
}>();

const columns = computed(() => auctionColumns(props.mySeat));

const rows = computed(() =>
  props.board ? auctionRows(props.auction, props.board.dealer, columns.value, props.turn) : [],
);
</script>

<style scoped>
.auction {
  margin: 12px 0;
  padding: 8px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
  box-shadow: 0 1px 0 var(--bridge-line);
}

table {
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 4px;
  text-align: center;
}

th {
  padding: 0;
  font-weight: 400;
}

/* Each seat a pill; the vulnerable side's red. */
th .seat {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  border-radius: 6px;
  background: var(--bridge-chip);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--bridge-ink);
}

th.vul .seat {
  background: #c8102e;
  color: #fff;
}

th.mine .seat::after {
  content: '· you';
  margin-left: 4px;
  font-weight: 400;
}

.player {
  display: block;
  overflow: hidden;
  margin-top: 2px;
  font-size: 0.75rem;
  color: var(--bridge-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

td {
  height: 32px;
  padding: 0;
  font-size: 1rem;
}

.next {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 40px;
  height: 30px;
  border-radius: 8px;
  box-shadow: inset 0 0 0 2px var(--bridge-action);
  font-weight: 700;
  color: var(--bridge-action-text);
}

.empty {
  margin: 8px 0 0;
  text-align: center;
  font-size: 0.85rem;
  color: var(--bridge-muted);
}
</style>
