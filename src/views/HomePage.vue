<template>
  <ion-page>
    <AppHeader title="Home" />
    <ion-content :fullscreen="true">
      <ExploreContainer name="Home" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonPage, IonContent } from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import ExploreContainer from '@/components/ExploreContainer.vue';
</script>
