<template>
  <ion-page>
    <AppHeader :title="hasToken ? 'Choose a new password' : 'Reset password'" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="form-page">
        <!-- Stage 2: a token came from the emailed link, so set the new password. -->
        <form v-if="hasToken" @submit.prevent="submitNewPassword">
          <ion-list>
            <ion-item>
              <ion-input
                v-model="email"
                type="email"
                label="Email"
                label-placement="stacked"
                autocomplete="email"
                required
              />
            </ion-item>
            <ion-item>
              <ion-input
                v-model="password"
                type="password"
                label="New password"
                label-placement="stacked"
                autocomplete="new-password"
                required
              />
            </ion-item>
            <ion-item>
              <ion-input
                v-model="passwordConfirmation"
                type="password"
                label="Confirm new password"
                label-placement="stacked"
                autocomplete="new-password"
                required
              />
            </ion-item>
          </ion-list>

          <ion-text v-if="error" color="danger">
            <p class="message">{{ error }}</p>
          </ion-text>

          <ion-button type="submit" expand="block" :disabled="submitting">
            <ion-spinner v-if="submitting" name="crescent" />
            <span v-else>Save new password</span>
          </ion-button>
        </form>

        <!-- Stage 1: ask for the reset link. -->
        <form v-else @submit.prevent="submitLinkRequest">
          <ion-text>
            <p class="message">
              Enter your email and we'll send you a link to choose a new password.
            </p>
          </ion-text>

          <ion-list>
            <ion-item>
              <ion-input
                v-model="email"
                type="email"
                label="Email"
                label-placement="stacked"
                autocomplete="email"
                required
              />
            </ion-item>
          </ion-list>

          <ion-text v-if="error" color="danger">
            <p class="message">{{ error }}</p>
          </ion-text>
          <ion-text v-if="status" color="success">
            <p class="message">{{ status }}</p>
          </ion-text>

          <ion-button type="submit" expand="block" :disabled="submitting">
            <ion-spinner v-if="submitting" name="crescent" />
            <span v-else>Send reset link</span>
          </ion-button>
        </form>

        <div class="secondary">
          <ion-button fill="clear" router-link="/login">Back to log in</ion-button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { isAxiosError } from 'axios';
import {
  IonPage,
  IonContent,
  IonList,
  IonItem,
  IonInput,
  IonButton,
  IonText,
  IonSpinner,
  onIonViewWillEnter,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const ionRouter = useIonRouter();
const route = useRoute();

// bridge_backend emails a link to /password-reset/:token?email=… (see
// AppServiceProvider::boot). Without a token this page is the "send me a link"
// form instead.
const token = computed(() => (route.params.token as string | undefined) ?? '');
const hasToken = computed(() => token.value !== '');

const email = ref('');
const password = ref('');
const passwordConfirmation = ref('');
const error = ref('');
const status = ref('');
const submitting = ref(false);

// Guest-only page. The app-wide router guard comes with issue #7.
onIonViewWillEnter(() => {
  if (auth.isAuthenticated) {
    ionRouter.navigate('/home', 'root', 'replace');
    return;
  }
  // The emailed link carries the address the token was issued for.
  const fromLink = route.query.email;
  if (typeof fromLink === 'string' && fromLink !== '') {
    email.value = fromLink;
  }
});

async function submitLinkRequest() {
  error.value = '';
  status.value = '';
  submitting.value = true;
  try {
    status.value = await auth.requestPasswordReset({ email: email.value });
  } catch (e) {
    error.value = errorMessage(e, 'Could not send the reset link. Please try again.');
  } finally {
    submitting.value = false;
  }
}

async function submitNewPassword() {
  error.value = '';
  status.value = '';
  if (password.value !== passwordConfirmation.value) {
    error.value = 'Passwords do not match.';
    return;
  }
  submitting.value = true;
  try {
    await auth.resetPassword({
      token: token.value,
      email: email.value,
      password: password.value,
      password_confirmation: passwordConfirmation.value,
    });
    password.value = '';
    passwordConfirmation.value = '';
    // The reset does not start a session, so the user logs in with the new password.
    ionRouter.navigate('/login', 'root', 'replace');
  } catch (e) {
    error.value = errorMessage(e, 'Could not reset the password. Please try again.');
  } finally {
    submitting.value = false;
  }
}

// Laravel validation errors come back as 422 {message, errors: {field: [msg]}}.
function errorMessage(e: unknown, fallback: string): string {
  if (isAxiosError(e)) {
    if (!e.response) {
      return 'Cannot reach the server. Please try again later.';
    }
    const data = e.response.data as { message?: string; errors?: Record<string, string[]> };
    const firstError = data.errors && Object.values(data.errors)[0]?.[0];
    if (firstError || data.message) {
      return firstError || data.message!;
    }
  }
  return fallback;
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

.message {
  margin: 8px 16px;
}

.secondary {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 16px;
}
</style>
