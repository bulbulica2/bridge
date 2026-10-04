<template>
  <!-- A player's finished boards, latest first, grouped by the set they were
       dealt in (each set's header opens its results), paged in as the list scrolls
       (the infinite scroll finds the page's ion-content). The page calls
       load() when it enters and on pull-to-refresh. -->
  <div class="history">
    <!-- Nothing to show yet: a big spinner where the list will be. -->
    <div v-if="loading && !list" class="loading" aria-busy="true">
      <ion-spinner name="crescent" />
      <p>Loading boards…</p>
    </div>

    <ion-text v-if="loadError" color="danger">
      <p class="error">{{ loadError }}</p>
    </ion-text>

    <template v-if="list">
      <div v-if="loading" class="refreshing">
        <ion-spinner name="crescent" />
        <span>Refreshing…</span>
      </div>

      <p v-if="list.entries.length === 0" class="empty">{{ emptyText }}</p>

      <template v-else>
        <p class="count">
          {{ list.total }} board{{ list.total === 1 ? '' : 's' }} played. Tap a set for its
          results, or a board to replay it.
        </p>
        <ion-list>
          <template v-for="group in groups" :key="group.key">
            <ion-item
              v-if="group.set"
              button
              detail
              lines="full"
              class="set-header"
              :router-link="`/sets/${group.set.id}`"
            >
              <div class="set-head">
                <span class="set-head-title">
                  Set {{ group.set.number }} ·
                  {{ group.tableId !== null ? `table ${group.tableId}` : 'table closed' }}
                </span>
                <span class="set-head-count">
                  {{ group.entries.length }} of {{ group.set.of }} board{{
                    group.set.of === 1 ? '' : 's'
                  }}
                </span>
              </div>
              <span
                v-if="percentOf(group) !== null"
                slot="end"
                class="set-head-mp"
                :aria-label="`Set matchpoints ${percentText(percentOf(group)!)}`"
              >
                {{ percentText(percentOf(group)!) }}
              </span>
            </ion-item>
            <HistoryEntryItem
              v-for="entry in group.entries"
              :key="entry.playing_id"
              :entry="entry"
              :mine="owner === null"
            />
          </template>
        </ion-list>
      </template>

      <ion-text v-if="moreError" color="danger">
        <p class="error">{{ moreError }}</p>
      </ion-text>

      <ion-infinite-scroll :disabled="!store.hasMore(owner) || loading" @ionInfinite="more($event)">
        <ion-infinite-scroll-content loading-text="Loading older boards…" />
      </ion-infinite-scroll>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonItem,
  IonList,
  IonSpinner,
  IonText,
  useIonRouter,
} from '@ionic/vue';
import HistoryEntryItem from '@/components/HistoryEntryItem.vue';
import { useHistoryStore } from '@/stores/history';
import type { HistoryOwner } from '@/stores/history';
import { errorMessage, statusOf } from '@/utils/errors';
import { percentText } from '@/utils/result';
import { groupBySet, setPercent } from '@/utils/sets';
import type { HistorySetGroup } from '@/utils/sets';

const props = withDefaults(
  defineProps<{
    // null for the logged-in user's own boards.
    owner: HistoryOwner;
    emptyText?: string;
  }>(),
  { emptyText: 'No finished boards yet.' },
);

const store = useHistoryStore();
const ionRouter = useIonRouter();

const loading = ref(false);
const loadError = ref('');
const moreError = ref('');

const list = computed(() => store.listOf(props.owner));
// Each set's boards under one header.
const groups = computed(() => groupBySet(list.value?.entries ?? []));

// The owner's matchpoints over a set, when its results have been read (its
// page, or the play page after each board) and another table has played its
// boards. Nothing is fetched for them here; scores aren't added up.
function percentOf(group: HistorySetGroup): number | null {
  return group.set ? setPercent(store.sets[group.set.id], group.seat) : null;
}

// The first page again; rows already shown stay up while it loads.
async function load() {
  loading.value = true;
  loadError.value = '';
  moreError.value = '';
  try {
    await store.loadHistory(props.owner);
  } catch (e) {
    handle(e, loadError, 'Could not load the boards. Please try again.');
  } finally {
    loading.value = false;
  }
}

async function more(event: CustomEvent) {
  moreError.value = '';
  try {
    await store.loadMore(props.owner);
  } catch (e) {
    handle(e, moreError, 'Could not load older boards. Pull down to try again.');
  } finally {
    (event.target as HTMLIonInfiniteScrollElement).complete();
  }
}

function handle(e: unknown, target: typeof loadError, fallback: string) {
  // A 401 means the session expired after the router guard let us in.
  if (statusOf(e) === 401) {
    ionRouter.navigate('/login', 'root', 'replace');
    return;
  }
  target.value = errorMessage(e, fallback);
}

defineExpose({ load });
</script>

<style scoped>
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--ion-color-medium);
}

.loading ion-spinner {
  width: 48px;
  height: 48px;
}

.loading p {
  margin: 0;
}

.refreshing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 0 12px;
  color: var(--ion-color-medium);
  font-size: 0.9rem;
}

.refreshing ion-spinner {
  width: 18px;
  height: 18px;
}

.count,
.empty {
  margin: 0 0 8px;
  color: var(--ion-color-medium);
}

.empty {
  padding: 24px 0;
  text-align: center;
}

.error {
  margin: 16px 0;
}

.set-header {
  --background: rgba(var(--ion-color-primary-rgb, 0, 84, 233), 0.08);
  margin-top: 8px;
}

.set-head {
  display: flex;
  flex-direction: column;
  padding: 6px 0;
}

.set-head-title {
  font-weight: 700;
}

.set-head-count {
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.set-head-mp {
  font-size: 1.1rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
</style>
