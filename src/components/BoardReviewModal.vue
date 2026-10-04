<template>
  <!-- The play page's look back at the table's finished boards, without
       leaving the table: the same review and export as /playings/:id, with
       a switcher between the running set's boards. The game goes on
       underneath; when it waits for the user, `notice` says so with a way
       back. The parent owns whether it is open. -->
  <ion-modal :is-open="open" class="board-review-modal" @did-dismiss="emit('close')">
    <template v-if="open">
      <ion-header>
        <ion-toolbar>
          <ion-title>{{ title }}</ion-title>
          <ion-buttons slot="end">
            <ion-button
              v-if="review"
              class="export-board"
              aria-label="Export"
              aria-haspopup="menu"
              @click="exporter.open.value = true"
            >
              <ion-icon slot="icon-only" :icon="shareOutline" />
            </ion-button>
            <ion-button class="close-review" @click="emit('close')">Close</ion-button>
          </ion-buttons>
        </ion-toolbar>
        <!-- Our turn at the table: said here, never by closing the review. -->
        <ion-toolbar v-if="notice" color="warning" class="turn-notice">
          <p class="turn-text" role="status">{{ notice }}</p>
          <ion-buttons slot="end">
            <ion-button class="back-to-table" fill="solid" @click="emit('close')">
              To the table
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>

      <ion-content class="ion-padding">
        <div class="review">
          <ion-segment
            v-if="choices.length > 1"
            scrollable
            class="board-switch"
            :value="String(shownId)"
            @ion-change="pick($event.detail.value)"
          >
            <ion-segment-button
              v-for="choice in choices"
              :key="choice.playingId"
              :value="String(choice.playingId)"
            >
              <ion-label>Board {{ choice.number ?? '?' }}</ion-label>
            </ion-segment-button>
          </ion-segment>

          <div v-if="loading && !review" class="loading" aria-busy="true">
            <ion-spinner name="crescent" />
            <p>Loading the board…</p>
          </div>

          <div v-if="loadError" class="load-error">
            <ion-text color="danger">
              <p>{{ loadError }}</p>
            </ion-text>
            <ion-button size="small" fill="outline" :disabled="loading" @click="load()">
              Try again
            </ion-button>
          </div>

          <BoardReview v-if="review" :review="review" :extras="exporter.extras.value" />
        </div>

        <ion-action-sheet
          :is-open="exporter.open.value"
          header="Export board"
          :buttons="exporter.buttons.value"
          @did-dismiss="exporter.open.value = false"
        />
      </ion-content>
    </template>
  </ion-modal>

  <!-- Only while the print dialog is up (src/theme/print.css). -->
  <Teleport to="body">
    <BoardPrintout
      v-if="exporter.printing.value && review"
      :review="review"
      :extras="exporter.extras.value"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
  IonText,
  IonActionSheet,
} from '@ionic/vue';
import { shareOutline } from 'ionicons/icons';
import BoardPrintout from '@/components/BoardPrintout.vue';
import BoardReview from '@/components/BoardReview.vue';
import { useBoardExport } from '@/composables/useBoardExport';
import { useHistoryStore } from '@/stores/history';
import { errorMessage } from '@/utils/errors';
import type { ReviewChoice } from '@/utils/review';

const props = withDefaults(
  defineProps<{
    open: boolean;
    // The boards to switch between, oldest first (src/utils/review.ts
    // reviewChoices); it opens on the last.
    choices: ReviewChoice[];
    // What the game waits for us to do (src/utils/turn.ts), if anything.
    notice?: string | null;
  }>(),
  { notice: null },
);

const emit = defineEmits<{ close: [] }>();

const history = useHistoryStore();

// The board picked in the switcher; null is the latest.
const picked = ref<number | null>(null);
const loading = ref(false);
const loadError = ref('');

const shownId = computed(() => {
  const latest = props.choices.at(-1)?.playingId ?? null;
  return props.choices.some((c) => c.playingId === picked.value) ? picked.value : latest;
});

// Cached by the history store: a finished playing never changes.
const review = computed(() => (shownId.value ? (history.reviews[shownId.value] ?? null) : null));

const title = computed(() =>
  review.value?.board ? `Board ${review.value.board.number} review` : 'Board review',
);

const exporter = useBoardExport(() => review.value);

function pick(value: unknown) {
  const id = Number(value);
  if (Number.isInteger(id) && id > 0) {
    picked.value = id;
  }
}

// Each opening starts on the latest board; closing takes the export sheet
// and any printout with it.
watch(
  () => props.open,
  (open) => {
    picked.value = null;
    if (!open) {
      exporter.reset();
    }
  },
);

// Read the board shown, once open (the history store keeps it).
watch(
  () => [props.open, shownId.value] as const,
  ([open, id]) => {
    loadError.value = '';
    if (open && id && !history.reviews[id]) {
      load();
    }
  },
  { immediate: true },
);

async function load() {
  const id = shownId.value;
  if (!id) {
    return;
  }
  loading.value = true;
  loadError.value = '';
  try {
    await history.loadReview(id);
  } catch (e) {
    if (id === shownId.value) {
      loadError.value = errorMessage(e, 'Could not load the board. Please try again.');
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
/* Full height on a wide screen too: the table, the stepper and the auction
   need the room. */
ion-modal.board-review-modal {
  --height: 100%;
  --width: min(100%, 600px);
}

.review {
  max-width: 520px;
  margin: 0 auto;
}

.turn-text {
  margin: 0;
  padding: 0 12px;
  font-weight: 700;
}

.board-switch {
  margin: 0 0 12px;
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

.load-error {
  margin: 16px 0;
  text-align: center;
}
</style>
