<template>
  <!-- One finished board from a player's history: the board, the contract
       and how it went, the seat and partner, and the score from that
       player's side. Opens its replay, which links on to the board's results
       at every table. -->
  <ion-item button :router-link="`/playings/${entry.playing_id}`" detail lines="full">
    <div class="entry">
      <div class="entry-main">
        <p class="entry-board">
          Board {{ entry.board.number }}
          <span class="entry-when">{{ when }}</span>
        </p>
        <p class="entry-contract">
          <template v-if="entry.contract && entry.declarer">
            <CallLabel :bid="entry.contract" />{{ doubledMark(entry.doubled) }}
            by {{ entry.declarer }} {{ madeSuffix(entry.made_by) }}
          </template>
          <template v-else>Passed out</template>
        </p>
        <p class="entry-seat">
          {{ mine ? 'You sat' : 'Sat' }} {{ SEAT_NAMES[entry.seat] }}
          <template v-if="entry.partner">with {{ entry.partner.username }}</template>
          · {{ entry.table_id !== null ? `table ${entry.table_id}` : 'table closed' }}
        </p>
      </div>
      <span class="entry-score" :class="tone" :aria-label="`Score ${formatScore(entry.score)}`">
        {{ formatScore(entry.score) }}
      </span>
    </div>
  </ion-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonItem } from '@ionic/vue';
import CallLabel from '@/components/CallLabel.vue';
import type { PlayingHistoryEntry } from '@/services/history';
import { SEAT_NAMES } from '@/utils/auction';
import { doubledMark, formatScore, madeSuffix } from '@/utils/result';

const props = withDefaults(
  defineProps<{
    entry: PlayingHistoryEntry;
    // The logged-in user's own history ("You sat…") or someone else's.
    mine?: boolean;
  }>(),
  { mine: true },
);

const when = computed(() =>
  new Date(props.entry.finished_at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
);

const tone = computed(() => {
  const score = props.entry.score;
  if (score === 0) {
    return 'score-zero';
  }
  return score > 0 ? 'score-plus' : 'score-minus';
});
</script>

<style scoped>
.entry {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 0;
}

.entry-main {
  flex: 1;
  min-width: 0;
}

.entry p {
  margin: 0;
}

.entry-board {
  font-weight: 600;
}

.entry-when {
  margin-left: 6px;
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.entry-contract {
  margin-top: 2px;
}

.entry .entry-seat {
  margin-top: 2px;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
  overflow-wrap: anywhere;
}

.entry-score {
  font-size: 1.1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.score-plus {
  color: var(--bridge-pass-text);
}

.score-minus {
  color: var(--bridge-double-text);
}
</style>
