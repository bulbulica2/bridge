<template>
  <ion-page>
    <AppHeader :title="hasToken ? 'Choose a new password' : 'Reset password'" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="bridge-form-page">
        <div class="bridge-form-card">
          <!-- Stage 2: a token came from the emailed link, so set the new password. -->
          <form v-if="hasToken" class="bridge-form" @submit.prevent="submitNewPassword">
            <ion-input
              v-model="email"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.email }"
              type="email"
              label="Email"
              label-placement="stacked"
              autocomplete="email"
              aria-describedby="reset-email-error"
              required
            />
            <p v-if="errors.email" id="reset-email-error" class="bridge-field-message">
              {{ errors.email }}
            </p>
            <ion-input
              v-model="password"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.password }"
              type="password"
              label="New password"
              label-placement="stacked"
              autocomplete="new-password"
              aria-describedby="reset-password-error"
              required
            >
              <ion-input-password-toggle slot="end" />
            </ion-input>
            <p v-if="errors.password" id="reset-password-error" class="bridge-field-message">
              {{ errors.password }}
            </p>
            <ion-input
              v-model="passwordConfirmation"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.password_confirmation }"
              type="password"
              label="Confirm new password"
              label-placement="stacked"
              autocomplete="new-password"
              aria-describedby="reset-password-confirmation-error"
              required
            >
              <ion-input-password-toggle slot="end" />
            </ion-input>
            <p v-if="errors.password_confirmation" id="reset-password-confirmation-error" class="bridge-field-message">
              {{ errors.password_confirmation }}
            </p>

            <ion-text v-if="error" color="danger">
              <p class="message">{{ error }}</p>
            </ion-text>

            <ion-button type="submit" expand="block" color="action" :disabled="submitting">
              <ion-spinner v-if="submitting" name="crescent" />
              <span v-else>Save new password</span>
            </ion-button>
          </form>

          <!-- Stage 1: ask for the reset link. -->
          <form v-else class="bridge-form" @submit.prevent="submitLinkRequest">
            <ion-text>
              <p class="message">
                Enter your email and we'll send you a link to choose a new password.
              </p>
            </ion-text>

            <ion-input
              v-model="email"
              class="bridge-field"
              :class="{ 'bridge-field-invalid': errors.email }"
              type="email"
              label="Email"
              label-placement="stacked"
              autocomplete="email"
              aria-describedby="link-email-error"
              required
            />
            <p v-if="errors.email" id="link-email-error" class="bridge-field-message">
              {{ errors.email }}
            </p>

            <ion-text v-if="error" color="danger">
              <p class="message">{{ error }}</p>
            </ion-text>
            <ion-text v-if="status" color="success">
              <p class="message">{{ status }}</p>
            </ion-text>

            <ion-button type="submit" expand="block" color="action" :disabled="submitting">
              <ion-spinner v-if="submitting" name="crescent" />
              <span v-else>Send reset link</span>
            </ion-button>
          </form>

          <div class="bridge-form-links">
            <ion-button fill="clear" router-link="/login">Back to log in</ion-button>
          </div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage,
  IonContent,
  IonInput,
  IonInputPasswordToggle,
  IonButton,
  IonText,
  IonSpinner,
  onIonViewWillEnter,
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import { formErrors } from '@/utils/errors';
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
// A 422's messages under their fields; the rest in `error`.
const errors = ref<Record<string, string>>({});
const status = ref('');
const submitting = ref(false);

// Guest-only is enforced by the router guard; this only reads the link.
onIonViewWillEnter(() => {
  // The emailed link carries the address the token was issued for.
  const fromLink = route.query.email;
  if (typeof fromLink === 'string' && fromLink !== '') {
    email.value = fromLink;
  }
});

async function submitLinkRequest() {
  error.value = '';
  errors.value = {};
  status.value = '';
  submitting.value = true;
  try {
    status.value = await auth.requestPasswordReset({ email: email.value });
  } catch (e) {
    const failure = formErrors(e, ['email'], 'Could not send the reset link. Please try again.');
    errors.value = failure.fields;
    error.value = failure.message;
  } finally {
    submitting.value = false;
  }
}

async function submitNewPassword() {
  error.value = '';
  errors.value = {};
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
    const failure = formErrors(
      e,
      ['email', 'password', 'password_confirmation'],
      'Could not reset the password. Please try again.',
    );
    errors.value = failure.fields;
    error.value = failure.message;
  } finally {
    submitting.value = false;
  }
}

</script>

<style scoped>
.message {
  margin: 0;
}

.bridge-form-links {
  margin-top: 12px;
}
</style>
