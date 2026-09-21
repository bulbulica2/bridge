<template>
  <ion-page>
    <AppHeader title="Account" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="account">
        <div class="identity">
          <ion-icon :icon="personCircleOutline" class="avatar" color="medium" />
          <h1>{{ auth.user?.name }}</h1>
          <ion-text color="medium">
            <p class="username">@{{ auth.user?.username }}</p>
          </ion-text>
        </div>

        <ion-list inset>
          <ion-item>
            <ion-label>
              <p>Email</p>
              <h2>{{ auth.user?.email }}</h2>
            </ion-label>
          </ion-item>
          <ion-item v-if="auth.user?.description">
            <ion-label>
              <p>Description</p>
              <h2 class="wrap">{{ auth.user.description }}</h2>
            </ion-label>
          </ion-item>
        </ion-list>

        <ion-button expand="block" color="danger" :disabled="loggingOut" @click="logOut">
          <ion-spinner v-if="loggingOut" name="crescent" />
          <span v-else>Log out</span>
        </ion-button>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  IonPage,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonButton,
  IonText,
  IonSpinner,
  useIonRouter,
} from '@ionic/vue';
import { personCircleOutline } from 'ionicons/icons';
import AppHeader from '@/components/AppHeader.vue';
import { navigateAndSettle } from '@/router/loading';
import { useAuthStore } from '@/stores/auth';
import { showToast } from '@/utils/toast';

const auth = useAuthStore();
const ionRouter = useIonRouter();

const loggingOut = ref(false);

// The store clears the user even if the request fails, so we always end up
// logged out locally; the warning only tells the user the server wasn't told.
// This page is gone once /login is up, so the outcome goes in a toast there.
async function logOut() {
  if (loggingOut.value) {
    return;
  }
  loggingOut.value = true;
  let reachedServer = true;
  try {
    await auth.logout();
  } catch {
    reachedServer = false;
  }
  await navigateAndSettle(ionRouter, '/login');
  loggingOut.value = false;
  if (reachedServer) {
    await showToast('You have been logged out.', 'success');
  } else {
    await showToast('Could not reach the server, so you were logged out locally.', 'warning');
  }
}
</script>

<style scoped>
.account {
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: 420px;
  min-height: 100%;
  margin: 0 auto;
}

.identity {
  text-align: center;
}

.avatar {
  font-size: 72px;
}

.identity h1 {
  margin: 8px 0 0;
}

.username {
  margin: 4px 0 0;
}

.wrap {
  white-space: normal;
}
</style>
