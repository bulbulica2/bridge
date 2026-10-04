<template>
  <!-- A finished board's score, as the backend worked it out (`result`):
       the contract and how it went (by claim, when one ended the play), the score from the viewer's side, both
       sides' figures, the matchpoints when already read (a review), and the
       set's running score (GET /sets/{id}). -->
  <section class="result" aria-live="polite">
    <p class="result-title">
      <template v-if="contract">
        <CallLabel :bid="contract" />{{ doubledSuffix(result.doubled ?? 0) }}
        by {{ SEAT_NAMES[result.declarer!] }}
      </template>
      <template v-else>Passed out</template>
    </p>
    <p class="result-detail">
      <template v-if="contract && result.made_by !== null">
        {{ madeText(result.made_by) }} · {{ result.tricks_won }} tricks<template
          v-if="result.claimed"
        >, by claim</template>
      </template>
      <template v-else>Nobody bid, so the board scores 0.</template>
    </p>

    <p v-if="mine !== null" class="result-mine" :class="tone(mine)">
      <span class="result-mine-label">Your score</span>
      <span class="result-mine-value">{{ formatScore(mine) }}</span>
    </p>
    <p class="result-sides">
      <span :class="{ 'side-mine': mySide === 'ns' }">N-S {{ formatScore(result.score_ns) }}</span>
      <span aria-hidden="true">·</span>
      <span :class="{ 'side-mine': mySide === 'ew' }">
        E-W {{ formatScore(scoreFor(result.score_ns, 'ew')) }}
      </span>
    </p>
    <p class="result-summary">{{ resultSummary(result) }}</p>
    <p v-if="matchpoints" class="result-matchpoints">Matchpoints: {{ matchpoints }}</p>

    <p v-if="setSoFar && setSoFar.boards.length > 0" class="result-session">
      Set {{ setSoFar.number }} so far: {{ setSoFar.boards.length }} of {{ setSoFar.of }}
      boards,
      <strong :class="tone(setMine)">{{ mySeat ? 'you' : 'N-S' }} {{ formatScore(setMine) }}</strong>
      (N-S {{ formatScore(setSoFar.totals.score.ns) }})
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CallLabel from '@/components/CallLabel.vue';
import type { BoardResult } from '@/services/game';
import type { SetResults } from '@/services/history';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES, doubledSuffix } from '@/utils/auction';
import { matchpointsText } from '@/utils/export';
import type { ExportExtras } from '@/utils/export';
import {
  formatScore,
  madeText,
  resultSummary,
  scoreFor,
  sideOf,
  viewerScore,
} from '@/utils/result';
import { setTotals } from '@/utils/sets';

const props = withDefaults(
  defineProps<{
    result: BoardResult;
    mySeat: Seat | null;
    // The set this board belongs to, as far as it has got: its running score.
    setSoFar?: SetResults | null;
    // Its matchpoints against the other tables, when known.
    extras?: ExportExtras;
  }>(),
  { setSoFar: null, extras: () => ({}) },
);

const contract = computed(() => (props.result.declarer ? props.result.contract : null));
const mine = computed(() => viewerScore(props.result, props.mySeat));
const mySide = computed(() => (props.mySeat ? sideOf(props.mySeat) : null));
const matchpoints = computed(() => matchpointsText(props.extras));
const setMine = computed(() => (props.setSoFar ? setTotals(props.setSoFar, props.mySeat).score : 0));

function tone(score: number): string {
  if (score === 0) {
    return 'score-zero';
  }
  return score > 0 ? 'score-plus' : 'score-minus';
}
</script>

<style scoped>
.result {
  margin: 0 0 12px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.08);
  text-align: center;
}

.result p {
  margin: 0;
}

.result-title {
  font-size: 1.2rem;
  font-weight: 700;
}

.result .result-detail {
  margin-top: 2px;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}

.result .result-mine {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 8px;
}

.result-mine-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--ion-color-medium);
}

.result-mine-value {
  font-size: 1.8rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.result .result-sides {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
  color: var(--ion-color-medium);
}

.side-mine {
  font-weight: 700;
  color: var(--ion-text-color, #000);
}

.result .result-matchpoints {
  margin-top: 4px;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.result .result-summary {
  margin-top: 4px;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.result .result-session {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--ion-color-step-150, #e0e0e0);
  font-size: 0.85rem;
}

.score-plus {
  color: var(--ion-color-success-shade, #2dd36f);
}

.score-minus {
  color: var(--ion-color-danger, #eb445a);
}
</style>
