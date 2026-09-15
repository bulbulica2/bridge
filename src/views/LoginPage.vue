<template>
  <ion-page>
    <AppHeader title="Login" />
    <ion-content :fullscreen="true">
      <ExploreContainer name="Login" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonPage, IonContent } from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import ExploreContainer from '@/components/ExploreContainer.vue';
</script>
