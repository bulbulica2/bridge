<template>
  <ion-menu content-id="main-content" type="overlay">
    <ion-header>
      <ion-toolbar>
        <ion-title>Menu</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list>
        <ion-menu-toggle auto-hide="false">
          <ion-item button router-link="/home" router-direction="root">
            <ion-label>Home</ion-label>
          </ion-item>
          <ion-item v-if="auth.isAuthenticated" button router-link="/tables" router-direction="root">
            <ion-label>Tables</ion-label>
          </ion-item>
          <ion-item button router-link="/login" router-direction="root">
            <ion-label>Login</ion-label>
          </ion-item>
        </ion-menu-toggle>
      </ion-list>
    </ion-content>
  </ion-menu>
</template>

<script setup lang="ts">
import {
  IonMenu,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonMenuToggle,
} from '@ionic/vue';
import { useAuthStore } from '@/stores/auth';

// Tables needs a session; issue #7 owns the rest of the logged-in menu/header state.
const auth = useAuthStore();
</script>
