<!--
  Form page template: the Login page pattern (src/views/LoginPage.vue).
  Replace every __PLACEHOLDER__, add/remove fields, point submit() at the right
  store action and adjust the secondary links (delete that block if none).
  Content is centered horizontally and vertically on purpose; the user asked for it.
-->
<template>
  <ion-page>
    <AppHeader title="__TITLE__" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="form-page">
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
              />
            </ion-item>
            <!-- more <ion-item><ion-input .../></ion-item> fields -->
          </ion-list>

          <ion-text v-if="error" color="danger">
            <p class="error">{{ error }}</p>
          </ion-text>

          <ion-button type="submit" expand="block" :disabled="submitting">
            <ion-spinner v-if="submitting" name="crescent" />
            <span v-else>__SUBMIT_LABEL__</span>
          </ion-button>
        </form>

        <div class="secondary">
          <ion-button fill="clear" router-link="__LINK_PATH__">__LINK_LABEL__</ion-button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
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
  useIonRouter,
} from '@ionic/vue';
import AppHeader from '@/components/AppHeader.vue';
import { use__Domain__Store } from '@/stores/__domain__';

const store = use__Domain__Store();
const ionRouter = useIonRouter();

const email = ref('');
const error = ref('');
const submitting = ref(false);

async function submit() {
  error.value = '';
  submitting.value = true;
  try {
    await store.__action__({ email: email.value });
    ionRouter.navigate('__SUCCESS_PATH__', 'root', 'replace');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    submitting.value = false;
  }
}

// Laravel validation errors come back as 422 {message, errors: {field: [msg]}}.
function errorMessage(e: unknown): string {
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
  return 'Something went wrong. Please try again.';
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
  justify-content: space-between;
  margin-top: 16px;
}
</style>
