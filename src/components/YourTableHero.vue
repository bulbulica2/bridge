<template>
  <!-- The table the user sits at, on the lobby's navy hero card (Tables and
       Home): its name, "Set 3 · Board 2 of 4 · you sit South with radu",
       the set's boards so far, and one orange way back (the game once a
       board is dealt, else the table's page: useYourTable). A seat held for
       us (we left mid-set, or were marked away) says so, counting down, and
       the button comes back to it. The page may add actions (`actions`
       slot: the Tables page's Leave). Nothing for a guest, a banned user or
       somebody not seated. -->
  <section v-if="table && target" class="your-table" aria-label="Your table">
    <div class="your-table-main">
      <span class="your-table-kicker">Your table</span>
      <span class="your-table-name">{{ label }}</span>
      <span class="your-table-line">{{ line }}</span>
    </div>
    <SetStrip
      v-if="set"
      class="your-table-strip"
      on-table
      :number="set.number"
      :of="set.of"
      :current="set.finished ? null : set.board"
      :boards="setResults?.boards ?? []"
      :side="side"
    />
    <div class="your-table-actions">
      <ion-button color="action" class="your-table-go" :router-link="target" router-direction="forward">
        {{ held ? 'Come back' : 'Back to the table' }}
      </ion-button>
      <slot name="actions" />
    </div>
    <AwayNotice v-if="held" class="your-table-held" :table="table" :me="me" held />
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { IonButton } from '@ionic/vue';
import AwayNotice from '@/components/AwayNotice.vue';
import SetStrip from '@/components/SetStrip.vue';
import { useYourTable } from '@/composables/useYourTable';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useHistoryStore } from '@/stores/history';
import { yourTableLine } from '@/utils/lobby';
import { sideOf } from '@/utils/result';
import { currentSet } from '@/utils/sets';

const auth = useAuthStore();
const game = useGameStore();
const history = useHistoryStore();
const { table, target, label, status } = useYourTable();

const me = computed(() => auth.user?.id ?? null);
const held = computed(() => status.value === 'away');

// The set the table is on: the table's copy, or the board's if we hold it.
const set = computed(() => {
  const t = table.value;
  return t ? currentSet(t, game.tableId === t.id ? game.playing : null) : null;
});
const setResults = computed(() => (set.value ? (history.sets[set.value.id] ?? null) : null));

const mySeat = computed(() => table.value?.seats.find((s) => s.user_id === me.value)?.seat ?? null);
const side = computed(() => (mySeat.value ? sideOf(mySeat.value) : 'ns'));

const line = computed(() => (table.value ? yourTableLine(table.value, me.value, set.value) : ''));

// The strip's matchpoints: the set's results once a board of it is over
// here (the first board's can't be), read again as the set moves on.
// Failures stay quiet: the strip just shows no figures.
watch(
  () => {
    const s = set.value;
    return s && (s.board > 1 || s.finished) ? `${s.id}:${s.board}:${s.finished}` : null;
  },
  (key) => {
    if (key && set.value) {
      history.loadSet(set.value.id).catch(() => null);
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.your-table {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 24px;
  padding: 20px 24px;
  border-radius: var(--bridge-radius-panel);
  background: var(--bridge-table);
  color: var(--bridge-on-table);
}

.your-table-main {
  display: flex;
  flex: 1 1 260px;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.your-table-kicker {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--bridge-on-table-accent);
}

.your-table-name {
  overflow: hidden;
  font-size: 1.5rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.your-table-line {
  font-size: 0.9375rem;
  color: var(--bridge-on-table-muted);
}

.your-table-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.your-table-go {
  height: 50px;
  margin: 0;
}

/* The held seat's countdown, light on the navy. */
.your-table-held {
  flex-basis: 100%;
  margin: 0;
  color: var(--bridge-on-table);
}

@media (max-width: 575px) {
  .your-table {
    padding: 18px;
  }

  .your-table-actions,
  .your-table-go {
    flex: 1 1 100%;
  }
}
</style>
