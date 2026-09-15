<!--
  Plain page template. Replace __TITLE__ and fill in the content.
  Save as src/views/<Name>Page.vue and add a lazy route in src/router/index.ts.
-->
<template>
  <ion-page>
    <AppHeader title="__TITLE__" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="page">
        <!-- page content -->
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonPage, IonContent } from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
</script>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
}
</style>
