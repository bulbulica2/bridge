<template>
  <ion-page>
    <AppHeader title="Login" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="login">
        <form @submit.prevent="submit">
          <ion-list>
            <ion-item>
              <ion-input
                v-model="email"
                type="email"
                label="Email"
                label-placement="stacked"
                autocomplete="email"
                required
                :disabled="submitting"
              />
            </ion-item>
            <ion-item>
              <ion-input
                v-model="password"
                type="password"
                label="Password"
                label-placement="stacked"
                autocomplete="current-password"
                required
                :disabled="submitting"
              />
            </ion-item>
          </ion-list>

          <ion-text v-if="error" color="danger">
            <p class="error">{{ error }}</p>
          </ion-text>

          <ion-button type="submit" expand="block" :disabled="submitting">
            <ion-spinner v-if="submitting" name="crescent" />
            <span v-else>Log in</span>
          </ion-button>
        </form>

        <div class="secondary">
          <ion-button fill="clear" router-link="/create-account" :disabled="submitting">Create account</ion-button>
          <ion-button fill="clear" router-link="/reset-password" :disabled="submitting">Reset password</ion-button>
        </div>
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
  IonInput,
  IonButton,
  IonText,
  IonSpinner,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import { navigateAndSettle } from '@/router/loading';
import { errorMessage } from '@/utils/errors';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const ionRouter = useIonRouter();

const email = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);

async function submit() {
  if (submitting.value) {
    return;
  }
  error.value = '';
  submitting.value = true;
  try {
    await auth.login({ email: email.value, password: password.value });
    password.value = '';
    // Stay busy until /account is up, so the form can't be edited or
    // resubmitted while its chunk loads.
    await navigateAndSettle(ionRouter, '/account');
  } catch (e) {
    error.value = errorMessage(e, 'Login failed. Please try again.');
  } finally {
    submitting.value = false;
  }
}

</script>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: 420px;
  min-height: 100%;
  margin: 0 auto;
}

.error {
  margin: 8px 16px;
}

.secondary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: 16px;
}
</style>
