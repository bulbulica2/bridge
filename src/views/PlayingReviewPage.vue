<template>
  <ion-page>
    <AppHeader :title="review?.board ? `Board ${review.board.number} review` : 'Board review'">
      <template #end>
        <ion-button v-if="review && !gone" aria-haspopup="menu" @click="exporter.open.value = true">
          <ion-icon slot="start" :icon="shareOutline" />
          Export
        </ion-button>
        <ion-button
          v-if="review?.board"
          :router-link="`/boards/${review.board.id}/results`"
          router-direction="back"
        >
          Results
        </ion-button>
      </template>
    </AppHeader>
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="review">
        <!-- A board you haven't finished (403), or no finished playing by
             that id (404): nothing to replay. -->
        <div v-if="gone" class="gone">
          <p>{{ gone }}</p>
          <ion-button router-link="/history" router-direction="back">My boards</ion-button>
        </div>

        <div v-else-if="loading && !review" class="loading" aria-busy="true">
          <ion-spinner name="crescent" />
          <p>Loading the board…</p>
        </div>

        <div v-if="!gone && loadError" class="load-error">
          <ion-text color="danger">
            <p>{{ loadError }}</p>
          </ion-text>
          <ion-button size="small" fill="outline" :disabled="loading" @click="load()">
            Try again
          </ion-button>
        </div>

        <template v-if="!gone && review">
          <BoardReview
            :key="entry"
            :review="review"
            :extras="exporter.extras.value"
            @select="player = $event"
          />

          <ion-button
            v-if="review.board"
            expand="block"
            fill="outline"
            class="results-link"
            :router-link="`/boards/${review.board.id}/results`"
            router-direction="back"
          >
            Results at every table
          </ion-button>
        </template>
      </div>

      <PlayerProfileSheet :player="player" @close="player = null" />

      <!-- Taking the board out of the app (src/utils/export.ts). Files and
           printing need a browser; a native shell only copies. -->
      <ion-action-sheet
        :is-open="exporter.open.value"
        header="Export board"
        :buttons="exporter.buttons.value"
        @did-dismiss="exporter.open.value = false"
      />
    </ion-content>

    <!-- Only while the print dialog is up (src/theme/print.css). -->
    <Teleport to="body">
      <BoardPrintout
        v-if="exporter.printing.value && review"
        :review="review"
        :extras="exporter.extras.value"
        :my-seat="mySeat"
      />
    </Teleport>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonText,
  IonSpinner,
  IonActionSheet,
  onIonViewWillEnter,
  onIonViewWillLeave,
  useIonRouter,
} from '@ionic/vue';
import { shareOutline } from 'ionicons/icons';
import AppHeader from '@/components/AppHeader.vue';
import BoardPrintout from '@/components/BoardPrintout.vue';
import BoardReview from '@/components/BoardReview.vue';
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue';
import { useBoardExport } from '@/composables/useBoardExport';
import { useAuthStore } from '@/stores/auth';
import { useHistoryStore } from '@/stores/history';
import type { PublicUser } from '@/services/users';
import { errorMessage, statusOf } from '@/utils/errors';
import { seatOfUser } from '@/utils/result';

const route = useRoute();
const ionRouter = useIonRouter();
const store = useHistoryStore();
const auth = useAuthStore();

const playingId = ref(0);
// Counts the entries: each one replays from before the opening lead, even
// for the playing shown last time.
const entry = ref(0);
const loading = ref(false);
const loadError = ref('');
// Why there is nothing to show (403, 404, a bad id), or ''.
const gone = ref('');
const player = ref<PublicUser | null>(null);

const review = computed(() => store.reviews[playingId.value] ?? null);

// The viewer's seat if they played it, for the printout's "(you)".
const mySeat = computed(() =>
  review.value ? seatOfUser(review.value.players, auth.user?.id) : null,
);

// Export: copy, download, print (the play page's review modal does the same).
const exporter = useBoardExport(() => review.value);

onIonViewWillLeave(() => exporter.reset());

// Ionic keeps the page alive, so read the param on every entry: opening
// another playing must not reuse the old id or step.
onIonViewWillEnter(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
  const id = Number(raw);
  entry.value++;
  if (!raw || !Number.isInteger(id) || id <= 0) {
    playingId.value = 0;
    gone.value = "This board doesn't exist.";
    return;
  }
  playingId.value = id;
  gone.value = '';
  load();
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    await store.loadReview(playingId.value);
  } catch (e) {
    const status = statusOf(e);
    // A 401 here means the session expired after the router guard let us in.
    if (status === 401) {
      ionRouter.navigate('/login', 'root', 'replace');
    } else if (status === 403) {
      gone.value =
        'You can review a board once you have finished it yourself, since you might still be dealt it.';
    } else if (status === 404) {
      gone.value = "This board doesn't exist or isn't finished yet.";
    } else {
      loadError.value = errorMessage(e, 'Could not load the board. Please try again.');
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
/* As wide as the play page: the same table. */
.review {
  max-width: 832px;
  margin: 0 auto;
}

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

.gone {
  padding: 32px 0;
  text-align: center;
}

.load-error {
  margin: 16px 0;
  text-align: center;
}

.results-link {
  margin-top: 12px;
}
</style>
