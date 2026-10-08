<template>
  <ion-page>
    <AppHeader title="Create account" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="bridge-form-page">
        <div class="bridge-form-card">
          <form class="bridge-form" @submit.prevent="submit">
            <ion-input
              v-model="name"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.name }"
              type="text"
              label="Name"
              label-placement="stacked"
              autocomplete="name"
              aria-describedby="create-name-error"
              :maxlength="NAME_MAX"
              required
              :disabled="submitting"
            />
            <p v-if="errors.name" id="create-name-error" class="bridge-field-message">{{ errors.name }}</p>
            <ion-input
              v-model="username"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.username }"
              type="text"
              label="Username"
              label-placement="stacked"
              autocomplete="username"
              aria-describedby="create-username-error"
              :maxlength="USERNAME_MAX"
              required
              :disabled="submitting"
            />
            <p v-if="errors.username" id="create-username-error" class="bridge-field-message">{{ errors.username }}</p>
            <ion-input
              v-model="email"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.email }"
              type="email"
              label="Email"
              label-placement="stacked"
              autocomplete="email"
              aria-describedby="create-email-error"
              required
              :disabled="submitting"
            />
            <p v-if="errors.email" id="create-email-error" class="bridge-field-message">{{ errors.email }}</p>
            <ion-input
              v-model="password"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.password }"
              type="password"
              label="Password"
              label-placement="stacked"
              autocomplete="new-password"
              aria-describedby="create-password-error"
              required
              :disabled="submitting"
            >
              <ion-input-password-toggle slot="end" />
            </ion-input>
            <p v-if="errors.password" id="create-password-error" class="bridge-field-message">{{ errors.password }}</p>
            <ion-input
              v-model="passwordConfirmation"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.password_confirmation }"
              type="password"
              label="Confirm password"
              label-placement="stacked"
              autocomplete="new-password"
              aria-describedby="create-password-confirmation-error"
              required
              :disabled="submitting"
            >
              <ion-input-password-toggle slot="end" />
            </ion-input>
            <p
              v-if="errors.password_confirmation"
              id="create-password-confirmation-error"
              class="bridge-field-message"
            >
              {{ errors.password_confirmation }}
            </p>

            <ion-text v-if="error" color="danger">
              <p class="error">{{ error }}</p>
            </ion-text>

            <ion-button type="submit" expand="block" color="action" :disabled="submitting">
              <ion-spinner v-if="submitting" name="crescent" />
              <span v-else>Create account</span>
            </ion-button>
          </form>

          <div class="bridge-form-links">
            <ion-button fill="clear" router-link="/login" :disabled="submitting">Already have an account? Log in</ion-button>
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
  IonButton,
  IonText,
  IonSpinner,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import { navigateAndSettle } from '@/router/loading';
import { formErrors } from '@/utils/errors';
import { NAME_MAX, USERNAME_MAX } from '@/utils/limits';
import { showWelcomeToast } from '@/utils/toast';
import { useAuthStore } from '@/stores/auth';

// The fields a 422 can name under their input (POST /register).
const FIELDS = ['name', 'username', 'email', 'password', 'password_confirmation'];

const auth = useAuthStore();
const ionRouter = useIonRouter();

const name = ref('');
const username = ref('');
const email = ref('');
const password = ref('');
const passwordConfirmation = ref('');
const error = ref('');
// A 422's messages under their fields; the rest in `error`.
const errors = ref<Record<string, string>>({});
const submitting = ref(false);

async function submit() {
  if (submitting.value) {
    return;
  }
  error.value = '';
  errors.value = {};
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
    showWelcomeToast(`Welcome, ${auth.user?.name}! Your account is ready.`);
  } catch (e) {
    const failure = formErrors(e, FIELDS, 'Could not create the account. Please try again.');
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
