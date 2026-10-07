<template>
  <!-- A finished board's score, as the backend worked it out (`result`), on
       Daylight's navy hero card: who declared, the contract and how it went
       ("4♠ +1"), the tricks under it, the score from the viewer's side big on
       the right (N-S's, tagged, for someone who didn't play it) and, once
       other tables have played it, its matchpoints with a bar. Then the
       same board at the other tables (`others`, their N-S scores, ours
       named "You"), the double dummy line with a tick when declarer found
       every trick (at the table: `doubleDummy`, with a way to the review),
       and the set's boards so far. Scores aren't added up over a set: each
       board is compared with the other tables. -->
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

    <!-- The board at every other table that has played it, best N-S first:
         a result row has no table name, so its players name it. -->
    <div v-if="rows.length > 0" class="elsewhere" role="table" aria-label="Same board elsewhere">
      <div class="elsewhere-row elsewhere-head" role="row">
        <span role="columnheader">Same board elsewhere</span>
        <span role="columnheader">Contract</span>
        <span role="columnheader">N-S</span>
      </div>
      <div
        v-for="row in rows"
        :key="row.playingId"
        class="elsewhere-row"
        :class="{ 'elsewhere-mine': row.mine }"
        role="row"
      >
        <span class="elsewhere-who" role="cell" :title="row.players">{{ row.label }}</span>
        <span class="elsewhere-contract bridge-number" role="cell">{{ row.contract }}</span>
        <span class="elsewhere-score bridge-number" role="cell">{{ formatScore(row.scoreNs) }}</span>
      </div>
    </div>

    <div v-if="ddLine" class="result-dd" :class="{ 'dd-found': ddFound }">
      <span v-if="ddFound" class="dd-tick" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg>
      </span>
      <span class="dd-text">{{ ddLine }}<template v-if="verdict">. {{ verdict }}</template></span>
      <ion-button
        v-if="reviewable"
        fill="clear"
        size="small"
        class="result-dd-review"
        @click="emit('review')"
      >
        Review
      </ion-button>
    </div>

    <SetStrip
      v-if="strip"
      class="result-strip"
      :number="strip.number"
      :of="strip.of"
      :current="strip.board"
      :boards="setSoFar?.boards ?? []"
      :side="side"
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonButton } from '@ionic/vue';
import CallLabel from '@/components/CallLabel.vue';
import SetStrip from '@/components/SetStrip.vue';
import type { BoardResult, SetPosition } from '@/services/game';
import type { BoardResults, DoubleDummy, SetResults } from '@/services/history';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { doubleDummyDiff, doubleDummyLine, doubleDummyVerdict } from '@/utils/doubleDummy';
import type { ExportExtras } from '@/utils/export';
import {
  declaredText,
  doubledMark,
  formatScore,
  madeSuffix,
  matchpointPercent,
  otherTableRows,
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
    // This board's place in its set (the game state's `set`): the strip.
    setPosition?: Pick<SetPosition, 'number' | 'board' | 'of'> | null;
    // The set as far as it has got (GET /sets/{id}): the strip's matchpoints.
    setSoFar?: SetResults | null;
    // Its matchpoints against the other tables, when known.
    extras?: ExportExtras;
    // The board at every table (GET /boards/{id}/results), and which
    // playing is ours in it.
    others?: BoardResults | null;
    playingId?: number | null;
    // The board's double dummy table, at the table only: one line from it.
    doubleDummy?: DoubleDummy | null;
    // Offer the review, where the whole analysis is (`review` event).
    reviewable?: boolean;
  }>(),
  {
    players: () => ({}),
    setPosition: null,
    setSoFar: null,
    extras: () => ({}),
    others: null,
    playingId: null,
    doubleDummy: null,
    reviewable: false,
  },
);

const emit = defineEmits<{ review: [] }>();

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
// "Double dummy: 4♠ by South makes 10", or the note while it is solved…
const ddLine = computed(() => doubleDummyLine(props.doubleDummy, props.result));
// …then how declarer did against it, ticked when every trick was found.
const verdict = computed(() => doubleDummyVerdict(props.doubleDummy, props.result, props.mySeat));
const ddFound = computed(() => {
  const diff = doubleDummyDiff(props.doubleDummy, props.result);
  return diff !== null && diff >= 0;
});
// This board's matchpoints for the same side, once another table played it.
const percent = computed(() => {
  const { matchpoints, top } = props.extras;
  return matchpoints && top ? matchpointPercent(matchpoints[side.value], top) : null;
});
const rows = computed(() => otherTableRows(props.others, props.playingId));
// The set's boards: from the board's own position, else its read results.
const strip = computed(() => {
  if (props.setPosition) {
    return props.setPosition;
  }
  const set = props.setSoFar;
  return set ? { number: set.number, board: set.boards.length, of: set.of } : null;
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

/* Same board elsewhere. */
.elsewhere {
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
}

.elsewhere-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 60px;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 0.875rem;
}

.elsewhere-row > span:not(:first-child) {
  text-align: right;
}

.elsewhere-head {
  padding-bottom: 4px;
  font-size: 0.75rem;
  color: var(--bridge-muted);
}

.elsewhere-who {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.elsewhere-contract {
  font-size: 0.9375rem;
}

.elsewhere-score {
  font-size: 1.0625rem;
}

.elsewhere-mine {
  background: var(--bridge-action-tint);
  box-shadow: inset 0 0 0 1.5px var(--bridge-action-line);
}

.elsewhere-mine .elsewhere-who {
  font-weight: 700;
}

/* The double dummy line, ticked green when declarer found every trick. */
.result-dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 12px 14px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
  font-size: 0.875rem;
  line-height: 1.4;
}

.dd-tick {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--bridge-pass-bg);
  color: var(--bridge-pass-text);
}

.dd-text {
  flex: 1;
  min-width: 0;
}

.result-dd-review {
  margin: 0;
}
</style>
