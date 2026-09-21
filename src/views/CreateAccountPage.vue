<template>
  <ion-page>
    <AppHeader title="Create account" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="form-page">
        <form @submit.prevent="submit">
          <ion-list>
            <ion-item>
              <ion-input
                v-model="name"
                type="text"
                label="Name"
                label-placement="stacked"
                autocomplete="name"
                required
                :disabled="submitting"
              />
            </ion-item>
            <ion-item>
              <ion-input
                v-model="username"
                type="text"
                label="Username"
                label-placement="stacked"
                autocomplete="username"
                required
                :disabled="submitting"
              />
            </ion-item>
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
                autocomplete="new-password"
                required
                :disabled="submitting"
              />
            </ion-item>
            <ion-item>
              <ion-input
                v-model="passwordConfirmation"
                type="password"
                label="Confirm password"
                label-placement="stacked"
                autocomplete="new-password"
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
            <span v-else>Create account</span>
          </ion-button>
        </form>

        <div class="secondary">
          <ion-button fill="clear" router-link="/login" :disabled="submitting">Already have an account? Log in</ion-button>
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

const name = ref('');
const username = ref('');
const email = ref('');
const password = ref('');
const passwordConfirmation = ref('');
const error = ref('');
const submitting = ref(false);

async function submit() {
  if (submitting.value) {
    return;
  }
  error.value = '';
  if (password.value !== passwordConfirmation.value) {
    error.value = 'Passwords do not match.';
    return;
  }
  submitting.value = true;
  try {
    await auth.register({
      name: name.value,
      username: username.value,
      email: email.value,
      password: password.value,
      password_confirmation: passwordConfirmation.value,
    });
    password.value = '';
    passwordConfirmation.value = '';
    // Stay busy until /account is up, so the form can't be edited or
    // resubmitted while its chunk loads.
    await navigateAndSettle(ionRouter, '/account');
  } catch (e) {
    error.value = errorMessage(e, 'Could not create the account. Please try again.');
  } finally {
    submitting.value = false;
  }
}

</script>

<style scoped>
.form-page {
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
  justify-content: center;
  margin-top: 16px;
}
</style>
