<template>
  <!-- A board's double dummy table (bridge_backend GAME-RULES.md §6): the
       tricks each declarer makes in each strain with all four hands in
       view and best play on both sides, declarers N E S W down the side
       and ♣ ♦ ♥ ♠ NT across, as it is usually drawn. Plain tricks, not
       levels. `highlight` marks one cell, the contract played; while the
       backend is still solving it, a note instead. Nothing before it is
       read. -->
  <section v-if="analysis" class="double-dummy" aria-label="Double dummy">
    <h3 class="dd-title">Double dummy</h3>
    <p v-if="analysis.status === 'pending'" class="dd-note" aria-live="polite">
      {{ DOUBLE_DUMMY_PENDING }}
    </p>
    <p v-else-if="!table" class="dd-note">{{ DOUBLE_DUMMY_UNAVAILABLE }}</p>
    <template v-else>
      <table class="dd-table">
        <caption class="dd-caption">
          Tricks each declarer makes with every card in view and best play on both sides.
        </caption>
        <thead>
          <tr>
            <th scope="col" class="dd-corner"><span class="sr-only">Declarer</span></th>
            <th
              v-for="strain in DD_STRAINS"
              :key="strain"
              scope="col"
              class="dd-strain"
              :class="{ red: isRedStrain(strain) }"
              :aria-label="strainName(strain)"
            >
              {{ strainSymbol(strain) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="seat in DD_SEATS" :key="seat">
            <th scope="row" class="dd-seat" :aria-label="SEAT_NAMES[seat]">{{ seat }}</th>
            <td
              v-for="strain in DD_STRAINS"
              :key="strain"
              class="dd-cell"
              :class="{ played: isPlayed(seat, strain) }"
              :data-cell="`${seat}${strain}`"
            >
              {{ table[seat][strain]
              }}<span v-if="isPlayed(seat, strain)" class="sr-only">
                ({{ highlightNote.toLowerCase() }})</span
              >
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="highlight" class="dd-legend">
        <span class="dd-swatch" aria-hidden="true" />{{ highlightNote }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Strain } from '@/services/game';
import type { DoubleDummy } from '@/services/history';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES, isRedStrain, strainSymbol } from '@/utils/auction';
import { SUIT_NAMES } from '@/utils/cards';
import {
  DD_SEATS,
  DD_STRAINS,
  DOUBLE_DUMMY_PENDING,
  DOUBLE_DUMMY_UNAVAILABLE,
} from '@/utils/doubleDummy';

const props = withDefaults(
  defineProps<{
    // The backend's answer, or null before it is read.
    analysis: DoubleDummy | null;
    // The contract played (its declarer and strain), to mark in the grid.
    highlight?: { declarer: Seat; strain: Strain } | null;
    // What the marked cell is, said under the grid.
    highlightNote?: string;
  }>(),
  { highlight: null, highlightNote: 'The contract played at this table' },
);

const table = computed(() =>
  props.analysis?.status === 'ready' ? (props.analysis.table ?? null) : null,
);

function isPlayed(seat: Seat, strain: Strain): boolean {
  return props.highlight?.declarer === seat && props.highlight.strain === strain;
}

function strainName(strain: Strain): string {
  return strain === 'NT' ? 'no trump' : SUIT_NAMES[strain];
}
</script>

<style scoped>
.double-dummy {
  margin: 16px 0;
}

.dd-title {
  margin: 0 0 4px;
  font-size: 1rem;
  font-weight: 700;
}

.dd-note {
  margin: 0;
  color: var(--ion-color-medium);
}

.dd-table {
  width: 100%;
  max-width: 360px;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.dd-caption {
  caption-side: top;
  padding: 0 0 6px;
  font-size: 0.8rem;
  text-align: left;
  color: var(--ion-color-medium);
}

.dd-table th,
.dd-table td {
  padding: 4px 6px;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
}

.dd-strain {
  font-size: 1.05rem;
}

.dd-strain.red {
  color: #c62828;
}

.dd-seat {
  font-weight: 700;
}

.dd-cell {
  font-size: 1rem;
}

/* The contract played here. */
.dd-cell.played {
  background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.18);
  outline: 2px solid var(--ion-color-primary);
  outline-offset: -2px;
  font-weight: 800;
}

.dd-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.dd-swatch {
  width: 12px;
  height: 12px;
  border: 2px solid var(--ion-color-primary);
  background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.18);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
