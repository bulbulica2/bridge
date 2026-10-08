<template>
  <!-- A finished board's result in a small dialog in the middle of the
       screen (#174), over the table that still shows the deal: the contract
       and how it went with our side's score big, the matchpoints when known,
       the same board at up to four other tables, one double dummy line,
       then a ring counting down to the next board (`next_board_at`) and
       "Deal next board", our vote to deal it now (robots always count as
       having voted). After a set's last board (`set`) it shows the set's
       results instead, with no countdown and no vote: everyone's Start on
       the page deals the next set. The rows still being read hold their
       place as a skeleton line, so nothing jumps. The X, the backdrop and
       Escape close it; the parent owns whether it is open. No Leave or
       Review here (#188): leaving mid-set only marks a player away, and 15 s
       is no time to step through a board; the header has both. -->
  <ion-modal :is-open="open" class="result-dialog" aria-labelledby="result-dialog-title" @did-dismiss="dismissed">
    <div v-if="shown" class="result-sheet">
      <header class="result-head">
        <h2 id="result-dialog-title" class="result-title">{{ set ? 'Set results' : 'Board result' }}</h2>
        <ion-button fill="clear" size="small" class="result-close" aria-label="Close" @click="emit('close')">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </header>

      <div class="result-body">
        <SetResultsPanel v-if="set" :set="set" :my-seat="mySeat" />

        <template v-else-if="result">
          <div class="dialog-hero">
            <div class="dialog-head">
              <div class="dialog-main">
                <p class="dialog-contract">
                  <template v-if="contract">
                    <CallLabel :bid="contract" />{{ doubledMark(result.doubled) }} by
                    {{ SEAT_NAMES[result.declarer!] }}
                    <span class="dialog-made" :class="result.made_by! < 0 ? 'made-down' : 'made-ok'">{{
                      madeSuffix(result.made_by)
                    }}</span>
                  </template>
                  <template v-else>Passed out</template>
                </p>
                <span v-if="detail" class="dialog-detail">{{ detail }}</span>
              </div>
              <p class="dialog-score" :class="{ 'score-minus': score < 0 }">
                <span v-if="!mySeat" class="dialog-side">N-S</span>
                <span class="dialog-score-value bridge-number">{{ formatScore(score) }}</span>
              </p>
            </div>
            <div v-if="percent !== null" class="dialog-mp">
              <b class="dialog-mp-value bridge-number">{{ percentText(percent) }}</b>
              <div class="dialog-mp-track" aria-hidden="true">
                <div class="dialog-mp-bar" :style="{ width: `${percent}%` }" />
              </div>
            </div>
          </div>

          <!-- The same board at the other tables, best N-S first, ours
               tinted; the whole list one tap away when it is longer. -->
          <ion-skeleton-text v-if="othersLoading" animated class="dialog-skeleton others-skeleton" />
          <div v-else-if="rows.length > 0" class="others" role="table" aria-label="Other tables">
            <div class="others-row others-head" role="row">
              <span role="columnheader">Other tables</span>
              <span role="columnheader">N-S</span>
            </div>
            <div
              v-for="row in rows"
              :key="row.playingId"
              class="others-row"
              :class="{ 'others-mine': row.mine }"
              role="row"
              :aria-current="row.mine ? 'true' : undefined"
            >
              <span class="others-contract bridge-number" role="cell">{{ row.contract }}</span>
              <span class="others-score bridge-number" role="cell">{{ formatScore(row.scoreNs) }}</span>
            </div>
            <ion-button
              v-if="moreTables && boardId"
              fill="clear"
              size="small"
              class="others-compare"
              :router-link="`/boards/${boardId}/results`"
            >
              Compare with other tables
            </ion-button>
          </div>

          <ion-skeleton-text v-if="ddLoading && !ddLine" animated class="dialog-skeleton dd-skeleton" />
          <p v-else-if="ddLine" class="dialog-dd">{{ ddLine }}</p>
        </template>
      </div>

      <footer v-if="vote && !set" class="result-foot">
        <div class="vote">
          <div
            v-if="left !== null"
            class="vote-ring"
            :style="{ '--ring-fill': `${ringPercent}%` }"
            role="timer"
            :aria-label="`Next board in ${formatClock(left)}`"
          >
            <span class="vote-ring-face bridge-number">{{ formatClock(left) }}</span>
          </div>
          <ion-button color="action" class="vote-button" :disabled="busy || voted || left === 0" @click="emit('next')">
            <ion-spinner v-if="busy" name="crescent" />
            <span v-else>{{ voteLabel }}</span>
          </ion-button>
        </div>
      </footer>
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonButton, IonIcon, IonModal, IonSkeletonText, IonSpinner } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import CallLabel from '@/components/CallLabel.vue';
import SetResultsPanel from '@/components/SetResultsPanel.vue';
import { useNow } from '@/composables/useNow';
import type { BoardResult } from '@/services/game';
import type { BoardResults, DoubleDummy, SetResults } from '@/services/history';
import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES } from '@/utils/auction';
import { formatClock, secondsLeft } from '@/utils/away';
import { doubleDummyLine } from '@/utils/doubleDummy';
import type { ExportExtras } from '@/utils/export';
import {
  OTHER_TABLES_MAX,
  doubledMark,
  formatScore,
  madeSuffix,
  matchpointPercent,
  otherTableRows,
  percentText,
  scoreFor,
  sideOf,
} from '@/utils/result';
import { NEXT_BOARD_SECONDS } from '@/utils/sets';

const props = withDefaults(
  defineProps<{
    open: boolean;
    // The finished board's result; `set` in its place after a set's last
    // board.
    result: BoardResult | null;
    set?: SetResults | null;
    mySeat: Seat | null;
    players?: Partial<Record<Seat, PublicUser | null>>;
    // This board's matchpoints against the other tables, when known.
    extras?: ExportExtras;
    // The board at every table (GET /boards/{id}/results), still being read
    // or not, and which playing is ours in it.
    others?: BoardResults | null;
    othersLoading?: boolean;
    playingId?: number | null;
    boardId?: number | null;
    // The board's double dummy table, still being read or not.
    doubleDummy?: DoubleDummy | null;
    ddLoading?: boolean;
    // The same four are to play the set's next board: the countdown and the
    // vote. Who has voted (the state's `ready`), and when it comes by itself.
    vote?: boolean;
    ready?: Seat[];
    nextBoardAt?: string | null;
    // The vote is on its way.
    busy?: boolean;
  }>(),
  {
    set: null,
    players: () => ({}),
    extras: () => ({}),
    others: null,
    othersLoading: false,
    playingId: null,
    boardId: null,
    doubleDummy: null,
    ddLoading: false,
    vote: false,
    ready: () => [],
    nextBoardAt: null,
    busy: false,
  },
);

const emit = defineEmits<{ close: []; next: [] }>();

// The content stays until the dialog has finished closing, so it never
// empties while it animates out.
const shown = ref(props.open);
watch(
  () => props.open,
  (open) => {
    if (open) {
      shown.value = true;
    }
  },
);

// Closed by the backdrop or Escape while the parent still had it open: tell
// it. Closed by the parent (a new board, the page left), nothing to say.
function dismissed() {
  shown.value = false;
  if (props.open) {
    emit('close');
  }
}

const contract = computed(() => (props.result?.declarer ? props.result.contract : null));
// Our side, or N-S for someone who didn't play the board.
const side = computed(() => (props.mySeat ? sideOf(props.mySeat) : 'ns'));
const score = computed(() => (props.result ? scoreFor(props.result.score_ns, side.value) : 0));

// "11 tricks · by claim" under a contract; nothing for a passed-out board.
const detail = computed(() => {
  const tricks = props.result?.tricks_won ?? null;
  if (!contract.value || tricks === null) {
    return null;
  }
  return `${tricks} trick${tricks === 1 ? '' : 's'}${props.result!.claimed ? ' · by claim' : ''}`;
});

const percent = computed(() => {
  const { matchpoints, top } = props.extras;
  return matchpoints && top ? matchpointPercent(matchpoints[side.value], top) : null;
});

const rows = computed(() => otherTableRows(props.others, props.playingId, OTHER_TABLES_MAX));
const moreTables = computed(() => (props.others?.results.length ?? 0) > OTHER_TABLES_MAX);

// "Double dummy: 4♠ by South makes 10", only once the analysis is ready.
const ddLine = computed(() =>
  props.doubleDummy?.status === 'ready' && props.result ? doubleDummyLine(props.doubleDummy, props.result) : null,
);

// The countdown only redraws itself; the deadline is the backend's.
const now = useNow(() => props.open && props.vote && !!props.nextBoardAt);
const left = computed(() => (props.nextBoardAt ? secondsLeft(props.nextBoardAt, now.value) : null));
const ringPercent = computed(() => Math.min(100, Math.round(((left.value ?? 0) / NEXT_BOARD_SECONDS) * 100)));

const voted = computed(() => !!props.mySeat && props.ready.includes(props.mySeat));

// The humans who haven't voted yet: robots never hold the deal up.
const waitingFor = computed(() =>
  SEATS.filter((seat) => !props.ready.includes(seat) && !props.players[seat]?.is_robot).map(
    (seat) => props.players[seat]?.username ?? SEAT_NAMES[seat],
  ),
);

// "Deal next board"; once we voted, whom it waits for; at 0, the deal.
const voteLabel = computed(() => {
  if (left.value === 0 || (voted.value && waitingFor.value.length === 0)) {
    return 'Dealing…';
  }
  return voted.value ? `Waiting for ${waitingFor.value.join(', ')}…` : 'Deal next board';
});
</script>

<style scoped>
/* Centred, as tall as its content (ClaimSheet's dialog, #173). */
ion-modal.result-dialog {
  --width: min(420px, calc(100vw - 32px));
  --height: auto;
  --border-radius: 16px;
  --box-shadow: 0 12px 40px var(--bridge-shadow-strong);
  /* Ionic shows no backdrop behind a phone's (full-screen) modal. */
  --backdrop-opacity: var(--ion-backdrop-opacity, 0.4);
}

.result-sheet {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100vh - 48px);
  padding: 8px 16px 16px;
  box-sizing: border-box;
  background: var(--bridge-surface);
  color: var(--bridge-ink);
}

.result-sheet p {
  margin: 0;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-right: -10px;
}

.result-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
}

/* A 44 px tap area in the corner. */
.result-close {
  flex: none;
  width: 44px;
  height: 44px;
  margin: 0;
  --color: var(--bridge-muted);
}

/* A set's results may be taller than a phone: they scroll, the footer
   stays. */
.result-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

.result-body :deep(.set-results) {
  margin: 0;
}

/* The navy hero: the contract left, our score big on the right. */
.dialog-hero {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--bridge-radius-panel);
  background: var(--bridge-table);
  color: var(--bridge-on-table);
}

.dialog-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.dialog-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dialog-contract {
  font-size: 1.375rem;
  font-weight: 700;
  line-height: 1.15;
}

/* Hearts and diamonds stay readable on the navy. */
.dialog-contract :deep(.call.red) {
  color: var(--bridge-on-table-bad);
}

.made-ok {
  color: var(--bridge-on-table-good);
}

.made-down {
  color: var(--bridge-on-table-bad);
}

.dialog-detail,
.dialog-side {
  font-size: 0.8125rem;
  color: var(--bridge-on-table-muted);
}

.dialog-side {
  font-weight: 700;
}

.dialog-score {
  display: flex;
  flex: none;
  align-items: baseline;
  gap: 6px;
}

.dialog-score-value {
  font-size: 2.5rem;
  line-height: 1;
}

.score-minus .dialog-score-value {
  color: var(--bridge-on-table-bad);
}

.dialog-mp {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dialog-mp-value {
  flex: none;
  font-size: 1.125rem;
}

.dialog-mp-track {
  flex: 1;
  height: 10px;
  border-radius: 5px;
  background: var(--bridge-table-inner);
}

.dialog-mp-bar {
  height: 10px;
  border-radius: 5px;
  background: var(--bridge-amber);
}

/* One line held for a row still being read. */
.dialog-skeleton {
  height: 20px;
  margin: 0;
  border-radius: 6px;
}

.others {
  display: flex;
  flex-direction: column;
}

.others-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 0.9375rem;
}

.others-head {
  padding-top: 0;
  padding-bottom: 2px;
  font-size: 0.75rem;
  color: var(--bridge-muted);
}

.others-mine {
  background: var(--bridge-action-tint);
  box-shadow: inset 0 0 0 1.5px var(--bridge-action-line);
  font-weight: 700;
}

.others-compare {
  align-self: flex-start;
  height: 44px;
  margin: 0;
  --color: var(--bridge-action-text);
  font-weight: 700;
}

.dialog-dd {
  font-size: 0.875rem;
  color: var(--bridge-muted);
}

.vote {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* The countdown ring: the action colour empties clockwise over the wait. */
.vote-ring {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: conic-gradient(var(--bridge-action) 0 var(--ring-fill), var(--bridge-line) var(--ring-fill) 100%);
}

.vote-ring-face {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bridge-surface);
  font-size: 0.9375rem;
}

.vote-button {
  flex: 1;
  min-width: 0;
  margin: 0;
}
</style>
