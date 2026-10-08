<template>
  <!-- The lobby's "Recent boards" (Tables and Home): the user's last few
       finished boards from the first page of their history (GET
       /api/user/playings), each opening its review, then all of them. The
       page reads it on every showing (`load()`). -->
  <section class="recent-boards lobby-card" aria-labelledby="recent-boards-title">
    <h2 id="recent-boards-title">Recent boards</h2>
    <p v-if="entries.length === 0" class="recent-empty">
      {{ list ? 'No boards played yet.' : 'Your last boards show here.' }}
    </p>
    <router-link
      v-for="entry in entries"
      :key="entry.playing_id"
      class="recent-row"
      :to="`/playings/${entry.playing_id}`"
    >
      <span class="recent-contract">{{ contractShort(entry) ?? 'Passed out' }}</span>
      <span class="recent-where">{{ where(entry) }}</span>
      <b class="recent-score bridge-number">{{ formatScore(entry.score) }}</b>
    </router-link>
    <router-link class="recent-all" to="/history">All my boards</router-link>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PlayingHistoryEntry } from '@/services/history';
import { useHistoryStore } from '@/stores/history';
import { contractShort, formatScore } from '@/utils/result';

const props = withDefaults(defineProps<{ count?: number }>(), { count: 3 });

const history = useHistoryStore();

const list = computed(() => history.listOf(null));
const entries = computed(() => list.value?.entries.slice(0, props.count) ?? []);

// "Set 2 · B3", or plain "Board" for a board outside any set (never its
// number in the database, #189).
function where(entry: PlayingHistoryEntry): string {
  return entry.set ? `Set ${entry.set.number} · B${entry.set.board}` : 'Board';
}

// Failures stay quiet: the lobby works without it.
async function load() {
  await history.loadHistory(null).catch(() => null);
}

defineExpose({ load });
</script>

<style scoped>
.recent-boards {
  gap: 4px;
}

.recent-boards h2 {
  margin: 0 0 8px;
  font-size: 1.0625rem;
}

.recent-empty {
  margin: 0 0 4px;
  font-size: 0.875rem;
  color: var(--bridge-muted);
}

.recent-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 10px;
  color: var(--bridge-ink);
  text-decoration: none;
}

.recent-row:hover {
  background: var(--bridge-ground);
}

.recent-contract {
  min-width: 72px;
  font-weight: 700;
  white-space: nowrap;
}

.recent-where {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  color: var(--bridge-muted);
}

.recent-score {
  font-size: 1.0625rem;
}

.recent-all {
  padding: 8px;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--bridge-redouble-text);
}
</style>
