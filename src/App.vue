<template>
  <ion-app>
    <!-- Slow navigations: lazy page chunks and the guard's session check. -->
    <ion-progress-bar v-if="routeLoading" type="indeterminate" class="route-progress" />
    <AppMenu />
    <ion-router-outlet id="main-content" />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonProgressBar, IonRouterOutlet } from '@ionic/vue';
import AppMenu from '@/components/AppMenu.vue';
import { routeLoading } from '@/router/loading';
</script>

<style scoped>
/* Pinned over every page's header, above the menu and the page transition. */
.route-progress {
  position: fixed;
  top: var(--ion-safe-area-top, 0);
  left: 0;
  right: 0;
  z-index: 1000;
}
</style>
