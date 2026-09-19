<template>
  <ion-header>
    <ion-toolbar>
      <ion-buttons slot="start">
        <ion-menu-button />
      </ion-buttons>
      <ion-title>{{ title }}</ion-title>
      <ion-buttons slot="end">
        <slot name="end" />
        <!-- Header account action, only once there is somebody logged in. -->
        <ion-button v-if="auth.isAuthenticated" router-link="/account">
          <ion-icon slot="start" :icon="personCircleOutline" />
          Account
        </ion-button>
      </ion-buttons>
    </ion-toolbar>
  </ion-header>
</template>

<script setup lang="ts">
import {
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonMenuButton,
  IonTitle,
} from '@ionic/vue';
import { personCircleOutline } from 'ionicons/icons';
import { useAuthStore } from '@/stores/auth';

defineProps<{
  title: string;
}>();

const auth = useAuthStore();
</script>
