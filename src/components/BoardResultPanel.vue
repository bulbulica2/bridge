<template>
  <!-- A finished board's score, as the backend worked it out (`result`),
       written the way it is at the table: one big row with the contract and
       how it went ("2♣ by West +2") and the score from the viewer's side
       (N-S's, tagged, for someone who didn't play it), the tricks under it,
       then where the board stands in its set and, once other tables have
       played it, its matchpoints. At the table, given `doubleDummy`, one
       line says what the contract makes double dummy, with a way to the
       review (the whole grid is there). Scores aren't added up over a set: each
       board is compared with the other tables. -->
  <section class="result" aria-live="polite">
    <div class="result-head">
      <p class="result-contract">
        <template v-if="contract">
          <CallLabel :bid="contract" />{{ doubledMark(result.doubled) }}
          by {{ SEAT_NAMES[result.declarer!] }}
          <span class="result-made">{{ madeSuffix(result.made_by) }}</span>
        </template>
        <template v-else>Passed out</template>
      </p>
      <p class="result-score" :class="tone(score)">
        <span v-if="!mySeat" class="result-side">N-S</span>
        <span class="result-score-value">{{ formatScore(score) }}</span>
      </p>
    </div>
    <p v-if="detail" class="result-detail">{{ detail }}</p>
    <p v-if="ddLine" class="result-dd">
      <span>{{ ddLine }}</span>
      <ion-button
        v-if="reviewable"
        fill="clear"
        size="small"
        class="result-dd-review"
        @click="emit('review')"
      >
        Review
      </ion-button>
    </p>

    <p v-if="setLine || percent !== null" class="result-set">
      <span v-if="setLine">{{ setLine }}</span>
      <span v-if="setLine && percent !== null" aria-hidden="true"> · </span>
      <span v-if="percent !== null">Matchpoints {{ percentText(percent) }}</span>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonButton } from '@ionic/vue';
import CallLabel from '@/components/CallLabel.vue';
import type { BoardResult } from '@/services/game';
import type { DoubleDummy, SetResults } from '@/services/history';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { doubleDummyLine } from '@/utils/doubleDummy';
import type { ExportExtras } from '@/utils/export';
import {
  doubledMark,
  formatScore,
  madeSuffix,
  matchpointPercent,
  percentText,
  scoreFor,
  sideOf,
} from '@/utils/result';

const props = withDefaults(
  defineProps<{
    result: BoardResult;
    mySeat: Seat | null;
    // The set this board belongs to, as far as it has got: its position.
    setSoFar?: SetResults | null;
    // Its matchpoints against the other tables, when known.
    extras?: ExportExtras;
    // The board's double dummy table, at the table only: one line from it.
    doubleDummy?: DoubleDummy | null;
    // Offer the review, where the whole analysis is (`review` event).
    reviewable?: boolean;
  }>(),
  { setSoFar: null, extras: () => ({}), doubleDummy: null, reviewable: false },
);

const emit = defineEmits<{ review: [] }>();

const contract = computed(() => (props.result.declarer ? props.result.contract : null));
// The viewer's side, or N-S for someone who didn't play the board.
const side = computed(() => (props.mySeat ? sideOf(props.mySeat) : 'ns'));
const score = computed(() => scoreFor(props.result.score_ns, side.value));
// "10 tricks · by claim" under a contract; nothing for a passed-out board.
const detail = computed(() => {
  const tricks = props.result.tricks_won;
  if (!contract.value || tricks === null) {
    return null;
  }
  return `${tricks} trick${tricks === 1 ? '' : 's'}${props.result.claimed ? ' · by claim' : ''}`;
});
// "Double dummy: 4♠ by South makes 10", or the note while it is solved.
const ddLine = computed(() => doubleDummyLine(props.doubleDummy, props.result));
// "Set 2 · 3 of 4 boards played".
const setLine = computed(() => {
  const set = props.setSoFar;
  if (!set || set.boards.length === 0) {
    return null;
  }
  return `Set ${set.number} · ${set.boards.length} of ${set.of} board${set.of === 1 ? '' : 's'} played`;
});
// This board's matchpoints for the same side, once another table played it.
const percent = computed(() => {
  const { matchpoints, top } = props.extras;
  return matchpoints && top ? matchpointPercent(matchpoints[side.value], top) : null;
});

function tone(value: number): string {
  if (value === 0) {
    return 'score-zero';
  }
  return value > 0 ? 'score-plus' : 'score-minus';
}
</script>

<style scoped>
.result {
  margin: 0 0 12px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.08);
}

.result p {
  margin: 0;
}

/* One row: the contract on the left, the score on the right; on a narrow
   phone the score wraps under the contract, still large. */
.result-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  column-gap: 16px;
  row-gap: 4px;
}

.result-contract {
  font-size: 1.6rem;
  font-weight: 800;
  line-height: 1.2;
}

.result-made {
  font-variant-numeric: tabular-nums;
}

.result-score {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-left: auto;
}

.result-score-value {
  font-size: 1.8rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.result-side {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ion-color-medium);
}

.result .result-detail {
  margin-top: 4px;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

.result .result-dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 4px;
  margin-top: 4px;
  font-size: 0.9rem;
}

.result-dd-review {
  margin: 0;
}

.result .result-set {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--ion-color-step-150, #e0e0e0);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.score-plus {
  color: var(--ion-color-success-shade, #2dd36f);
}

.score-minus {
  color: var(--ion-color-danger, #eb445a);
}
</style>
