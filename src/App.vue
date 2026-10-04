<template>
  <ion-app>
    <!-- Slow navigations: lazy page chunks and the guard's session check. -->
    <ion-progress-bar v-if="routeLoading" type="indeterminate" class="route-progress" />
    <!-- The menu stays beside the page from md up, unless the user collapsed
         it (src/utils/menu.ts); below md it is the slide-in overlay. -->
    <ion-split-pane content-id="main-content" :when="menuPinned ? PINNED_FROM : false">
      <AppMenu />
      <ion-router-outlet id="main-content" />
    </ion-split-pane>
    <!-- Banned just now (UserBanned): why, until dismissed. -->
    <BanNotice />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonProgressBar, IonRouterOutlet, IonSplitPane } from '@ionic/vue';
import AppMenu from '@/components/AppMenu.vue';
import BanNotice from '@/components/BanNotice.vue';
import { routeLoading } from '@/router/loading';
import { menuPinned, PINNED_FROM } from '@/utils/menu';
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

/* A few short entries: no need for Ionic's 270 px minimum. */
ion-split-pane {
  --side-min-width: 220px;
  --side-max-width: 260px;
}
</style>
