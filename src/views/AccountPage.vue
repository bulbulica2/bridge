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

        <ion-text v-if="error" color="danger">
          <p class="error">{{ error }}</p>
        </ion-text>

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
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const ionRouter = useIonRouter();

const error = ref('');
const loggingOut = ref(false);

// The store clears the user even if the request fails, so we always end up
// logged out locally; the message only tells the user the server wasn't told.
async function logOut() {
  error.value = '';
  loggingOut.value = true;
  try {
    await auth.logout();
  } catch {
    error.value = 'Could not reach the server, so you were logged out locally.';
  } finally {
    loggingOut.value = false;
    ionRouter.navigate('/login', 'root', 'replace');
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

.error {
  margin: 8px 16px;
}
</style>
