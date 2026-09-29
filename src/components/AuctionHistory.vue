<template>
  <!-- The auction as players write it down: one column per seat, in the
       table's rotation (the viewer's column last, so South sees W N E S),
       rows of four starting in the dealer's column. -->
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
            <CallLabel v-if="cell.kind === 'call'" :bid="cell.bid" />
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
import CallLabel from '@/components/CallLabel.vue';
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
  }>(),
  { turn: null, players: () => ({}) },
);

const columns = computed(() => auctionColumns(props.mySeat));

const rows = computed(() =>
  props.board ? auctionRows(props.auction, props.board.dealer, columns.value, props.turn) : [],
);
</script>

<style scoped>
.auction {
  margin: 12px 0;
}

table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  text-align: center;
}

th {
  padding: 4px 2px 6px;
  border-bottom: 1px solid var(--ion-color-step-150, #e0e0e0);
  font-weight: 400;
}

/* Vulnerable seats in red, like the table's stripes. */
th .seat {
  display: block;
  font-weight: 700;
  color: var(--ion-color-medium);
}

th.vul .seat {
  color: var(--bridge-red-suit, #c62828);
}

th.mine .seat::after {
  content: ' (you)';
  font-weight: 400;
  font-size: 0.75rem;
}

.player {
  display: block;
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--ion-color-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

td {
  height: 28px;
  padding: 2px;
  font-size: 1rem;
}

.next {
  display: inline-block;
  min-width: 24px;
  border-radius: 4px;
  background: rgba(var(--ion-color-warning-rgb, 255, 196, 9), 0.25);
  font-weight: 700;
  color: var(--ion-color-warning-shade, #e0ac08);
}

.empty {
  margin: 8px 0 0;
  text-align: center;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}
</style>
