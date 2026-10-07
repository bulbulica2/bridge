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

            <!-- A robot took our seat over in a set (our turn clock ran out
                 while we were away from it; told live, or on the next
                 visit): the set's results are a tap away. -->
            <ion-card v-if="tablesStore.replacedFrom" class="replaced-from" color="warning">
              <ion-card-header>
                <ion-card-subtitle>Set {{ tablesStore.replacedFrom.number }}: a robot took your seat</ion-card-subtitle>
              </ion-card-header>
              <ion-card-content>
                <p>{{ replacedFromText(tablesStore.replacedFrom) }}</p>
                <div class="replaced-from-actions">
                  <ion-button size="small" :router-link="`/sets/${tablesStore.replacedFrom.id}`">
                    See the set
                  </ion-button>
                  <ion-button size="small" fill="clear" color="dark" @click="tablesStore.dismissReplaced()">
                    Dismiss
                  </ion-button>
                </div>
              </ion-card-content>
            </ion-card>

            <!-- Our table, one tap back (the Lobby board's hero). -->
            <YourTableHero v-if="myTable" />

            <section v-else-if="tablesStore.loaded" class="lobby-card no-table">
              <h2>You're not at a table</h2>
              <p>Take a free seat at an open table, or start one of your own.</p>
              <ion-button color="action" router-link="/tables" router-direction="root">
                Find a table
              </ion-button>
            </section>

            <!-- How we have been playing, and our last boards. -->
            <div class="home-aside">
              <YourForm ref="form" />
              <RecentBoards ref="recent" />
            </div>
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
  IonCardContent,
  IonText,
  IonSkeletonText,
  onIonViewWillEnter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import RecentBoards from '@/components/RecentBoards.vue';
import YourForm from '@/components/YourForm.vue';
import YourTableHero from '@/components/YourTableHero.vue';
import { useAuthStore } from '@/stores/auth';
import { useTablesStore } from '@/stores/tables';
import { replacedFromText } from '@/utils/sets';
import { errorMessage } from '@/utils/errors';

const auth = useAuthStore();
const tablesStore = useTablesStore();
const { myTable } = storeToRefs(tablesStore);
const form = ref<InstanceType<typeof YourForm> | null>(null);
const recent = ref<InstanceType<typeof RecentBoards> | null>(null);

const loading = ref(false);
const loadError = ref('');

// A user holds at most one seat, and GET /tables is where to find it. Loaded
// on every enter (the list has no live channel), and again when somebody logs
// in while Home is already the page on screen; the stats and recent boards
// follow once it is in (the local backend answers one request at a time).
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
  form.value?.load();
  recent.value?.load();
}
</script>

<style scoped>
.home {
  max-width: 960px;
  margin: 0 auto;
}

.home-aside {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 16px;
  margin-top: 16px;
}

.no-table h2 {
  margin: 0;
  font-size: 1.1875rem;
}

.no-table p {
  margin: 0;
  color: var(--bridge-muted);
}

.no-table ion-button {
  margin: 0;
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

.replaced-from p {
  margin: 0 0 8px;
}

.replaced-from-actions {
  display: flex;
  gap: 8px;
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
