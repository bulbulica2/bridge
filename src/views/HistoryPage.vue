<template>
  <ion-page>
    <AppHeader title="My boards" />
    <ion-content :fullscreen="true" class="ion-padding">
      <ion-refresher slot="fixed" v-ion-event:ion-refresh="refresh">
        <ion-refresher-content />
      </ion-refresher>

      <div class="history-page">
        <HistoryList
          ref="history"
          :owner="null"
          empty-text="You haven't finished a board yet. Take a seat at a table to play one."
        />
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  onIonViewWillEnter,
} from '@ionic/vue';
import { vIonEvent } from '@/directives/ionEvent';
import AppHeader from '@/components/AppHeader.vue';
import HistoryList from '@/components/HistoryList.vue';

const history = ref<InstanceType<typeof HistoryList> | null>(null);

// Every entry: a board may have finished since the last visit.
onIonViewWillEnter(() => {
  history.value?.load();
});

async function refresh(event: CustomEvent) {
  await history.value?.load();
  (event.target as HTMLIonRefresherElement).complete();
}
</script>

<style scoped>
.history-page {
  max-width: 640px;
  margin: 0 auto;
}
</style>
