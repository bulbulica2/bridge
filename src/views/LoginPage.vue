<template>
  <ion-page>
    <AppHeader title="Login" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="login bridge-form-page">
        <p class="bridge-form-brand">{{ APP_NAME }}</p>
        <div class="bridge-form-card">
          <form class="bridge-form" @submit.prevent="submit">
            <ion-input
              v-model="email"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.email }"
              type="email"
              label="Email"
              label-placement="stacked"
              autocomplete="email"
              aria-describedby="login-email-error"
              required
              :disabled="submitting"
            />
            <p v-if="errors.email" id="login-email-error" class="bridge-field-message">{{ errors.email }}</p>
            <ion-input
              v-model="password"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.password }"
              type="password"
              label="Password"
              label-placement="stacked"
              autocomplete="current-password"
              aria-describedby="login-password-error"
              required
              :disabled="submitting"
            >
              <ion-input-password-toggle slot="end" />
            </ion-input>
            <p v-if="errors.password" id="login-password-error" class="bridge-field-message">{{ errors.password }}</p>
            <ion-checkbox
              v-model="remember"
              class="bridge-check"
              label-placement="end"
              justify="start"
              :disabled="submitting"
            >
              Remember me
            </ion-checkbox>

            <ion-text v-if="error" color="danger">
              <p class="error">{{ error }}</p>
            </ion-text>

            <ion-button type="submit" expand="block" color="action" :disabled="submitting">
              <ion-spinner v-if="submitting" name="crescent" />
              <span v-else>Log in</span>
            </ion-button>
          </form>

          <div class="bridge-form-links">
            <ion-button fill="clear" router-link="/create-account" :disabled="submitting">Create account</ion-button>
            <ion-button fill="clear" router-link="/reset-password" :disabled="submitting">Reset password</ion-button>
          </div>
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
  IonInput,
  IonInputPasswordToggle,
  IonCheckbox,
  IonButton,
  IonText,
  IonSpinner,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import { navigateAndSettle } from '@/router/loading';
import { APP_NAME } from '@/utils/brand';
import { formErrors } from '@/utils/errors';
import { showWelcomeToast } from '@/utils/toast';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const ionRouter = useIonRouter();

const email = ref('');
const password = ref('');
// Off by default; see LoginCredentials.remember.
const remember = ref(false);
const error = ref('');
// A 422's messages under their fields (email, password); the rest in `error`.
const errors = ref<Record<string, string>>({});
const submitting = ref(false);

async function submit() {
  if (submitting.value) {
    return;
  }
  error.value = '';
  errors.value = {};
  submitting.value = true;
  try {
    await auth.login({ email: email.value, password: password.value, remember: remember.value });
    password.value = '';
    // Stay busy until /account is up, so the form can't be edited or
    // resubmitted while its chunk loads.
    await navigateAndSettle(ionRouter, '/account');
    showWelcomeToast(`Welcome back, ${auth.user?.name}!`);
  } catch (e) {
    const failure = formErrors(e, ['email', 'password'], 'Login failed. Please try again.');
    errors.value = failure.fields;
    error.value = failure.message;
  } finally {
    submitting.value = false;
  }
}

</script>

<style scoped>
.error {
  margin: 0;
}

.bridge-form-links {
  margin-top: 12px;
}
</style>
