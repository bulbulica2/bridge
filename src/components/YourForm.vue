<template>
  <!-- The lobby's "Your form" (Tables and Home): the logged-in user's own
       stats (GET /api/user/stats) in three figures, the average board
       percentage, sets won of those played and boards played. The page
       reads them on every showing (`load()`), since they change after every
       board; until they are in (or if they can't be read) each figure is
       "—". -->
  <section class="your-form lobby-card" aria-labelledby="your-form-title">
    <h2 id="your-form-title">Your form</h2>
    <div class="form-figures">
      <p class="form-figure">
        <b class="bridge-number">{{ stats ? averageText(stats.boards.average_percent) : NO_FIGURE }}</b>
        <span>avg. board</span>
      </p>
      <p class="form-figure">
        <b class="bridge-number">{{ stats ? `${stats.sets.won} / ${stats.sets.played}` : NO_FIGURE }}</b>
        <span>sets won</span>
      </p>
      <p class="form-figure">
        <b class="bridge-number">{{ stats ? stats.boards.played : NO_FIGURE }}</b>
        <span>boards</span>
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useUsersStore } from '@/stores/users';
import { NO_FIGURE, averageText } from '@/utils/stats';

const auth = useAuthStore();
const users = useUsersStore();

const stats = computed(() => (auth.user ? (users.stats[auth.user.id] ?? null) : null));

// Failures stay quiet: the lobby works without them.
async function load() {
  await users.loadStats(null).catch(() => null);
}

defineExpose({ load });
</script>

<style scoped>
.your-form h2 {
  margin: 0;
  font-size: 1.0625rem;
}

.form-figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.form-figure {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 10px;
  border-radius: 12px;
  background: var(--bridge-ground);
}

.form-figure b {
  font-size: 1.5rem;
  white-space: nowrap;
}

.form-figure span {
  font-size: 0.75rem;
  color: var(--bridge-muted);
}
</style>
