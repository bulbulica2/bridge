<template>
  <!-- A finished board's score, as the backend worked it out (`result`), on
       Daylight's navy hero card: who declared, the contract and how it went
       ("4♠ +1"), the tricks under it, the score from the viewer's side big on
       the right (N-S's, tagged, for someone who didn't play it) and, once
       other tables have played it, its matchpoints with a bar. The review's
       last step; at the table the result dialog shows it (#174). -->
  <section class="result" aria-live="polite">
    <div class="result-hero">
      <div class="result-head">
        <div class="result-main">
          <span class="result-who">{{ who }}</span>
          <p class="result-contract">
            <template v-if="contract">
              <CallLabel :bid="contract" />{{ doubledMark(result.doubled) }}
              <span class="result-made" :class="result.made_by! < 0 ? 'made-down' : 'made-ok'">{{
                madeSuffix(result.made_by)
              }}</span>
            </template>
            <template v-else>Passed out</template>
          </p>
          <span v-if="detail" class="result-detail">{{ detail }}</span>
        </div>
        <p class="result-score" :class="tone(score)">
          <span v-if="!mySeat" class="result-side">N-S</span>
          <span class="result-score-value bridge-number">{{ formatScore(score) }}</span>
        </p>
      </div>
      <div v-if="percent !== null" class="result-mp">
        <p class="result-mp-line">
          <span>Against the other tables</span>
          <b class="bridge-number">{{ percentText(percent) }}</b>
        </p>
        <div class="result-mp-track" aria-hidden="true">
          <div class="result-mp-bar" :style="{ width: `${percent}%` }" />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CallLabel from '@/components/CallLabel.vue';
import type { BoardResult } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import type { ExportExtras } from '@/utils/export';
import {
  declaredText,
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
    // Who sat where, to name the declarer ("radu declared").
    players?: Partial<Record<Seat, PublicUser | null>>;
    // Its matchpoints against the other tables, when known.
    extras?: ExportExtras;
  }>(),
  {
    players: () => ({}),
    extras: () => ({}),
  },
);

const contract = computed(() => (props.result.declarer ? props.result.contract : null));
// The viewer's side, or N-S for someone who didn't play the board.
const side = computed(() => (props.mySeat ? sideOf(props.mySeat) : 'ns'));
const score = computed(() => scoreFor(props.result.score_ns, side.value));
// "You declared", "radu declared"; nobody did on a passed-out board.
const who = computed(() =>
  props.result.declarer ? declaredText(props.result.declarer, props.mySeat, props.players) : 'All four passed',
);
// "10 tricks · by claim" under a contract; nothing for a passed-out board.
const detail = computed(() => {
  const tricks = props.result.tricks_won;
  if (!contract.value || tricks === null) {
    return null;
  }
  return `${tricks} trick${tricks === 1 ? '' : 's'}${props.result.claimed ? ' · by claim' : ''}`;
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
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 0 12px;
}

.result p {
  margin: 0;
}

/* The navy hero card. */
.result-hero {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: var(--bridge-radius-panel);
  background: var(--bridge-table);
  color: var(--bridge-on-table);
}

/* The contract on the left, the score on the right; on a narrow phone the
   score wraps under the contract, still large. */
.result-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 16px;
}

.result-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.result-who,
.result-detail {
  font-size: 0.875rem;
  color: var(--bridge-on-table-muted);
}

.result-contract {
  font-size: 2.125rem;
  font-weight: 700;
  line-height: 1;
}

/* Hearts and diamonds stay readable on the navy. */
.result-contract :deep(.call.red) {
  color: var(--bridge-on-table-bad);
}

.result-made {
  font-variant-numeric: tabular-nums;
}

.made-ok {
  color: var(--bridge-on-table-good);
}

.made-down {
  color: var(--bridge-on-table-bad);
}

.result-score {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-left: auto;
}

.result-score-value {
  font-size: 2.75rem;
  line-height: 1;
}

.score-minus .result-score-value {
  color: var(--bridge-on-table-bad);
}

.result-side {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--bridge-on-table-muted);
}

.result-mp {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result .result-mp-line {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
}

.result-mp-line b {
  font-size: 1rem;
}

.result-mp-track {
  height: 10px;
  border-radius: 5px;
  background: var(--bridge-table-inner);
}

.result-mp-bar {
  height: 10px;
  border-radius: 5px;
  background: var(--bridge-amber);
}
</style>
