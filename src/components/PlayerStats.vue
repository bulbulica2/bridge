<template>
  <!-- A player's stats (GET /users/{id}/stats, or the user's own): a card
       with sets, boards and sets left early, or (compact) one line for the
       profile sheet. The parent calls load() each time it shows them, since
       they change after every board. Never mounted for a robot. -->
  <section class="player-stats" :class="{ compact }" aria-label="Stats">
    <h3 v-if="!compact" class="stats-title">Stats</h3>

    <!-- Nothing to show yet: skeleton lines where the figures will be. -->
    <div v-if="!stats && loading" class="stats-loading" aria-busy="true">
      <ion-skeleton-text v-for="line in compact ? 1 : 3" :key="line" :animated="true" class="stats-skeleton" />
    </div>

    <template v-if="stats">
      <p v-if="compact" class="stats-summary">{{ statsSummary(stats) }}</p>
      <template v-else>
        <dl class="stats-groups">
          <div class="stats-group">
            <dt>Sets</dt>
            <dd class="stats-sets">{{ setsLine(stats) }}</dd>
          </div>
          <div class="stats-group">
            <dt>Boards</dt>
            <dd class="stats-boards">{{ boardsLine(stats) }}</dd>
            <dd v-if="comparedNote(stats)" class="stats-note stats-compared">{{ comparedNote(stats) }}</dd>
          </div>
          <div class="stats-group">
            <dt>Left early</dt>
            <dd class="stats-leaving">{{ leavingLine(stats) }}</dd>
            <dd v-if="leavingReasons(stats)" class="stats-note stats-reasons">{{ leavingReasons(stats) }}</dd>
          </div>
        </dl>
        <p class="stats-explained">{{ STATS_EXPLAINED }}</p>
      </template>
    </template>

    <p v-if="failed" class="stats-error">
      Couldn't load the stats.
      <ion-button size="small" fill="clear" :disabled="loading" @click="load">Retry</ion-button>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonButton, IonSkeletonText, useIonRouter } from '@ionic/vue';
import { useAuthStore } from '@/stores/auth';
import { useUsersStore } from '@/stores/users';
import { statusOf } from '@/utils/errors';
import {
  STATS_EXPLAINED,
  boardsLine,
  comparedNote,
  leavingLine,
  leavingReasons,
  setsLine,
  statsSummary,
} from '@/utils/stats';

const props = withDefaults(
  defineProps<{
    // null for the logged-in user's own stats (GET /api/user/stats).
    userId: number | null;
    compact?: boolean;
  }>(),
  { compact: false },
);

const store = useUsersStore();
const auth = useAuthStore();
const ionRouter = useIonRouter();

const loading = ref(false);
const failed = ref(false);
// Only the latest read settles the loading state: the sheet may switch
// players while one is on its way.
let latest = 0;

const stats = computed(() => {
  const id = props.userId ?? auth.user?.id;
  return id === undefined ? null : (store.stats[id] ?? null);
});

// Reads them again; figures already shown stay up meanwhile.
async function load() {
  const mine = ++latest;
  loading.value = true;
  failed.value = false;
  try {
    await store.loadStats(props.userId);
  } catch (e) {
    if (mine !== latest) {
      return;
    }
    // A 401 means the session expired after the router guard let us in.
    if (statusOf(e) === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
      return;
    }
    failed.value = true;
  } finally {
    if (mine === latest) {
      loading.value = false;
    }
  }
}

defineExpose({ load });
</script>

<style scoped>
.player-stats {
  padding: 16px;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 8px;
  margin-bottom: 16px;
  text-align: left;
}

.player-stats.compact {
  padding: 0;
  border: 0;
  margin-bottom: 12px;
  text-align: center;
}

.stats-title {
  margin: 0 0 12px;
  font-size: 1.1rem;
  font-weight: 600;
}

.stats-skeleton {
  width: 80%;
  height: 1rem;
  margin: 0 0 10px;
}

.compact .stats-skeleton {
  width: 60%;
  margin: 0 auto;
}

.stats-groups {
  margin: 0;
}

.stats-group + .stats-group {
  margin-top: 10px;
}

.stats-group dt {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--ion-color-medium);
}

.stats-group dd {
  margin: 2px 0 0;
}

.stats-note {
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.stats-explained {
  margin: 12px 0 0;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.stats-summary {
  margin: 0;
}

.stats-error {
  margin: 0;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}
</style>
