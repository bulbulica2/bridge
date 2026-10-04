<template>
  <!-- A set's results as the backend adds them up (GET /sets/{id}): who won,
       turned to the viewer's side, a forfeit's reason, each finished board
       (opening its review) with the viewer's side's score and matchpoints,
       and the matchpoints over the set. Scores aren't summed: each board is
       compared with the other tables that played it. The play page shows it
       once a set is over, the set's own page at any time. -->
  <section class="set-results" aria-live="polite">
    <p class="set-title">{{ setTitle(set) }}</p>
    <p v-if="winner" class="set-winner" :class="wonClass">{{ winner }}</p>
    <p v-if="forfeit" class="set-forfeit">{{ forfeit }}</p>

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
            <span class="set-row-score" :class="tone(scoreFor(row.score_ns, totals.side))">
              {{ formatScore(scoreFor(row.score_ns, totals.side)) }}
            </span>
            <span class="set-row-mp">{{ mpText(row.matchpoints[totals.side], row.top) }}</span>
          </div>
        </div>
      </ion-item>
    </ion-list>

    <div v-if="set.boards.length > 0" class="set-totals">
      <p v-if="totals.percent !== null" class="set-total-mine">
        <span class="set-total-label">
          {{ mySeat ? 'Your matchpoints' : `${SIDE_LABELS[totals.side]} matchpoints` }}
        </span>
        <span class="set-total-value">{{ percentText(totals.percent) }}</span>
        <span class="set-total-mp">{{ totals.matchpoints }} of {{ totals.top }}</span>
      </p>
      <p v-else class="set-total-none">No other table has played these boards yet.</p>
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
import { forfeitText, setTitle, setTotals, setWinnerText, setWon } from '@/utils/sets';

const props = withDefaults(
  defineProps<{
    set: SetResults;
    // The viewer's seat in the set, if they played it: scores are turned to
    // their side (N-S otherwise).
    mySeat: Seat | null;
    // The seat whose player cost their side the set, when the page can tell.
    gone?: Seat | null;
  }>(),
  { gone: null },
);

const totals = computed(() => setTotals(props.set, props.mySeat));
const winner = computed(() => setWinnerText(props.set, props.mySeat));
const forfeit = computed(() => forfeitText(props.set, props.gone));
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
  margin: 0 0 12px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.08);
}

.set-results p {
  margin: 0;
}

.set-title {
  font-size: 1.2rem;
  font-weight: 700;
  text-align: center;
}

.set-results .set-winner {
  margin-top: 2px;
  font-weight: 700;
  text-align: center;
}

.set-results .set-forfeit,
.set-results .set-empty {
  margin-top: 4px;
  font-size: 0.9rem;
  text-align: center;
  color: var(--ion-color-medium);
}

.set-boards {
  margin: 8px 0 0;
  padding: 0;
  border-radius: 8px;
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
  font-weight: 600;
}

.set-results .set-row-contract {
  margin-top: 2px;
  font-size: 0.9rem;
}

.set-row-figures {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.set-row-score {
  font-weight: 700;
}

.set-row-mp {
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.set-totals {
  margin-top: 8px;
  text-align: center;
}

.set-results .set-total-mine {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.set-total-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--ion-color-medium);
}

.set-total-value {
  font-size: 1.8rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.set-results .set-total-mp,
.set-results .set-total-none {
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.score-plus {
  color: var(--ion-color-success-shade, #2dd36f);
}

.score-minus {
  color: var(--ion-color-danger, #eb445a);
}
</style>
