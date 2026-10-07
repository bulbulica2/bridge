<template>
  <!-- A set's results as the backend adds them up (GET /sets/{id}): who won,
       turned to the viewer's side, whom a robot replaced, each finished board
       (opening its review) with the viewer's side's score and matchpoints,
       and the matchpoints over the set. Scores aren't summed: each board is
       compared with the other tables that played it. The play page shows it
       once a set is over, the set's own page at any time. -->
  <section class="set-results" aria-live="polite">
    <!-- The navy hero card: the set, who won and the viewer's matchpoints
         over it. -->
    <div class="set-hero">
      <p class="set-title">{{ setTitle(set) }}</p>
      <p v-if="winner" class="set-winner" :class="wonClass">{{ winner }}</p>
      <div v-if="set.boards.length > 0" class="set-totals">
        <p v-if="totals.percent !== null" class="set-total-mine">
          <span class="set-total-label">
            {{ mySeat ? 'Your matchpoints' : `${SIDE_LABELS[totals.side]} matchpoints` }}
          </span>
          <span class="set-total-value bridge-number">{{ percentText(totals.percent) }}</span>
          <span class="set-total-mp">{{ totals.matchpoints }} of {{ totals.top }}</span>
        </p>
        <p v-else class="set-total-none">No other table has played these boards yet.</p>
      </div>
      <p v-for="line in replaced" :key="line" class="set-replaced">{{ line }}</p>
    </div>

    <p v-if="set.boards.length === 0" class="set-empty">No board of this set was finished.</p>
    <ion-list v-else class="set-boards" lines="full">
      <ion-item
        v-for="row in set.boards"
        :key="row.playing_id"
        button
        detail
        :router-link="`/playings/${row.playing_id}`"
        class="set-board"
      >
        <div class="set-row">
          <div class="set-row-main">
            <p class="set-row-board">
              {{ row.position }}. Board {{ row.board.number }}
            </p>
            <p class="set-row-contract">
              <template v-if="row.contract && row.declarer">
                <CallLabel :bid="row.contract" />{{ doubledMark(row.doubled) }}
                by {{ row.declarer }} {{ madeSuffix(row.made_by)
                }}<template v-if="row.claimed"> · by claim</template>
              </template>
              <template v-else>Passed out</template>
            </p>
          </div>
          <div class="set-row-figures">
            <span class="set-row-score bridge-number" :class="tone(scoreFor(row.score_ns, totals.side))">
              {{ formatScore(scoreFor(row.score_ns, totals.side)) }}
            </span>
            <span class="set-row-mp">{{ mpText(row.matchpoints[totals.side], row.top) }}</span>
          </div>
        </div>
      </ion-item>
    </ion-list>

    <!-- The set clock (bb#131): how much of their time for the set each
         human used (for a seat a robot took over, its player up to then). -->
    <div v-if="timeUsed.length > 0" class="set-time">
      <p class="set-time-title">Time used · {{ set.minutes }} minutes each</p>
      <p v-for="row in timeUsed" :key="row.seat" class="set-time-row">
        <span class="set-time-who">{{ row.who }}</span>
        <span class="set-time-value">{{ row.text }}</span>
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonItem, IonList } from '@ionic/vue';
import CallLabel from '@/components/CallLabel.vue';
import type { SetResults } from '@/services/history';
import type { Seat } from '@/services/tables';
import {
  SIDE_LABELS,
  doubledMark,
  formatScore,
  madeSuffix,
  matchpointPercent,
  percentText,
  scoreFor,
} from '@/utils/result';
import { timeUsedRows } from '@/utils/setClock';
import { replacedText, replacementsOf, setTitle, setTotals, setWinnerText, setWon } from '@/utils/sets';

const props = defineProps<{
  set: SetResults;
  // The viewer's seat in the set, if they played it (or a robot took it
  // over from them): scores are turned to their side (N-S otherwise).
  mySeat: Seat | null;
}>();

const totals = computed(() => setTotals(props.set, props.mySeat));
const winner = computed(() => setWinnerText(props.set, props.mySeat));
// "East didn't play in time: a robot took their seat.", one per robot.
const replaced = computed(() =>
  replacementsOf(props.set).map((entry) => replacedText(entry, entry.seat === props.mySeat)),
);
// Each human's time used of their time for the set.
const timeUsed = computed(() => timeUsedRows(props.set, props.mySeat));
const wonClass = computed(() => {
  const won = setWon(props.set, props.mySeat);
  return won === null ? '' : won ? 'score-plus' : 'score-minus';
});

// "MP 50 %", or "MP —" when no other table has played the board.
function mpText(matchpoints: number, top: number): string {
  const percent = matchpointPercent(matchpoints, top);
  return `MP ${percent === null ? '—' : percentText(percent)}`;
}

function tone(score: number): string {
  if (score === 0) {
    return 'score-zero';
  }
  return score > 0 ? 'score-plus' : 'score-minus';
}
</script>

<style scoped>
.set-results {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 0 12px;
}

.set-results p {
  margin: 0;
}

/* The navy hero card, as a board's result. */
.set-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px;
  border-radius: var(--bridge-radius-panel);
  background: var(--bridge-table);
  color: var(--bridge-on-table);
  text-align: center;
}

.set-title {
  font-size: 1.25rem;
  font-weight: 700;
}

.set-results .set-winner {
  font-weight: 700;
}

.set-results .set-replaced {
  font-size: 0.875rem;
  color: var(--bridge-on-table-muted);
}

.set-results .set-empty {
  font-size: 0.9rem;
  text-align: center;
  color: var(--bridge-muted);
}

.set-boards {
  margin: 0;
  padding: 6px 0;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
}

.set-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px 0;
}

.set-row-main {
  flex: 1;
  min-width: 0;
}

.set-row-board {
  font-weight: 700;
}

.set-results .set-row-contract {
  margin-top: 2px;
  font-size: 0.9rem;
}

.set-row-figures {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  white-space: nowrap;
}

.set-row-score {
  font-size: 1.0625rem;
}

.set-row-mp {
  font-size: 0.85rem;
  color: var(--bridge-muted);
}

.set-totals {
  margin-top: 8px;
}

.set-time {
  padding: 12px 14px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
}

.set-results .set-time-title {
  margin-bottom: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--bridge-muted);
}

.set-results .set-time-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.9rem;
}

.set-time-value {
  font-variant-numeric: tabular-nums;
}

.set-results .set-total-mine {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.set-total-label {
  font-size: 0.875rem;
  color: var(--bridge-on-table-muted);
}

.set-total-value {
  font-size: 2.75rem;
  line-height: 1.1;
}

.set-results .set-total-mp,
.set-results .set-total-none {
  font-size: 0.875rem;
  color: var(--bridge-on-table-muted);
}

/* Won and lost on the navy, plus and minus on the white list. */
.set-hero .score-plus {
  color: var(--bridge-on-table-good);
}

.set-hero .score-minus {
  color: var(--bridge-on-table-bad);
}

.set-row .score-plus {
  color: var(--bridge-pass-text);
}

.set-row .score-minus {
  color: var(--bridge-double-text);
}
</style>
