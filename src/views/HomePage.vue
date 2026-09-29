<template>
  <ion-page>
    <AppHeader title="Home" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="home">
        <template v-if="!auth.isAuthenticated">
          <div class="intro">
            <h1>Bridge</h1>
            <p>
              Play contract bridge online. Four players sit at a table in two
              partnerships, North–South against East–West. Each hand starts with
              an auction, where the partnerships bid for the contract, and is then
              played out over 13 tricks.
            </p>
          </div>
          <ion-button expand="block" router-link="/login" router-direction="root">
            Log in
          </ion-button>
          <ion-button expand="block" fill="outline" router-link="/create-account">
            Create account
          </ion-button>
        </template>

        <template v-else>
          <h1 class="greeting">Welcome back, {{ auth.user?.name }}!</h1>

          <!-- First visit: nothing to show yet, so a skeleton card. -->
          <ion-card v-if="loading && !tablesStore.loaded" aria-busy="true">
            <ion-card-header>
              <ion-skeleton-text animated class="skeleton-title" />
            </ion-card-header>
            <ion-card-content>
              <ion-skeleton-text animated class="skeleton-line" />
            </ion-card-content>
          </ion-card>

          <template v-else>
            <ion-text v-if="loadError" color="danger">
              <p class="error">{{ loadError }}</p>
            </ion-text>

            <ion-card v-if="myTable" class="your-table">
              <ion-card-header>
                <ion-card-subtitle>Your table</ion-card-subtitle>
                <ion-card-title>{{ myTable.name || `Table #${myTable.id}` }}</ion-card-title>
              </ion-card-header>
              <ion-card-content>
                <ion-badge v-if="myTable.board_id !== null" color="success" class="board">
                  Board in progress
                </ion-badge>
                <ul class="players">
                  <li v-for="{ seat, user } in seatsOf(myTable)" :key="seat">
                    <span class="seat-name">{{ seat }}</span>
                    <span v-if="user">
                      {{ user.username }}<span v-if="user.id === auth.user?.id"> (you)</span>
                    </span>
                    <span v-else class="empty-seat">empty</span>
                  </li>
                </ul>
                <ion-button
                  expand="block"
                  :router-link="`/tables/${myTable.id}`"
                  router-direction="forward"
                >
                  Go to table
                  <ion-icon slot="end" :icon="chevronForwardOutline" />
                </ion-button>
              </ion-card-content>
            </ion-card>

            <ion-card v-else-if="tablesStore.loaded">
              <ion-card-header>
                <ion-card-title>You're not at a table</ion-card-title>
              </ion-card-header>
              <ion-card-content>
                <p>Take a free seat at an open table, or create your own.</p>
                <ion-button expand="block" router-link="/tables" router-direction="root">
                  Find a table
                </ion-button>
              </ion-card-content>
            </ion-card>
          </template>
        </template>

        <section class="how-to-play">
          <h2>How to play</h2>
          <ul>
            <li>Partners sit opposite each other: North–South play against East–West.</li>
            <li>
              In the auction, players bid in turn, clockwise, for how many tricks
              over six their side will take and in which trump suit (or no trumps).
              The highest bid becomes the contract.
            </li>
            <li>
              In the play, each trick is one card from each player; you must follow
              the suit led if you can. The highest trump, or else the highest card of
              the suit led, wins.
            </li>
            <li>
              The declaring side scores if it makes its contract; otherwise the
              defenders score for every trick it falls short.
            </li>
          </ul>
        </section>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  IonPage,
  IonContent,
  IonButton,
  IonCard,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonCardContent,
  IonBadge,
  IonIcon,
  IonText,
  IonSkeletonText,
  onIonViewWillEnter,
} from '@ionic/vue';
import { chevronForwardOutline } from 'ionicons/icons';
import AppHeader from '@/components/AppHeader.vue';
import { useAuthStore } from '@/stores/auth';
import { useTablesStore } from '@/stores/tables';
import { seatsOf } from '@/services/tables';
import { errorMessage } from '@/utils/errors';

const auth = useAuthStore();
const tablesStore = useTablesStore();
const { myTable } = storeToRefs(tablesStore);

const loading = ref(false);
const loadError = ref('');

// A user holds at most one seat, and GET /tables is where to find it. Loaded
// on every enter (the list has no live channel), and again when somebody logs
// in while Home is already the page on screen.
onIonViewWillEnter(() => {
  load();
});
watch(
  () => auth.isAuthenticated,
  (loggedIn) => {
    if (loggedIn) {
      load();
    }
  },
);

async function load() {
  if (!auth.isAuthenticated || loading.value) {
    return;
  }
  loading.value = true;
  loadError.value = '';
  try {
    await tablesStore.load();
  } catch (e) {
    loadError.value = errorMessage(e, 'Could not check your table. Please try again.');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.home {
  max-width: 560px;
  margin: 0 auto;
}

.intro {
  text-align: center;
}

.greeting {
  margin: 8px 0 16px;
}

ion-card {
  margin-left: 0;
  margin-right: 0;
}

.board {
  margin-bottom: 8px;
}

.players {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 16px;
}

.seat-name {
  font-weight: 600;
  color: var(--ion-color-medium);
  margin-right: 6px;
}

.empty-seat {
  color: var(--ion-color-medium);
  font-style: italic;
}

.skeleton-title {
  width: 50%;
  height: 20px;
}

.skeleton-line {
  width: 80%;
  height: 16px;
}

.error {
  margin: 8px 0;
}

.how-to-play {
  margin-top: 32px;
}

.how-to-play h2 {
  font-size: 1.1rem;
}

.how-to-play li {
  margin-bottom: 8px;
}
</style>
