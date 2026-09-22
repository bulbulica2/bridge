<template>
  <ion-page>
    <AppHeader title="Account" />
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="account">
        <form v-if="editing" class="edit" @submit.prevent="save">
          <ion-list inset>
            <ion-item>
              <ion-input
                v-model="name"
                type="text"
                label="Name"
                label-placement="stacked"
                autocomplete="name"
                :maxlength="NAME_MAX"
                required
                :disabled="saving"
              />
            </ion-item>
            <ion-text v-if="errors.name" color="danger">
              <p class="field-error">{{ errors.name }}</p>
            </ion-text>
            <ion-item>
              <ion-textarea
                v-model="description"
                label="Description"
                label-placement="stacked"
                :auto-grow="true"
                :rows="3"
                :maxlength="DESCRIPTION_MAX"
                :disabled="saving"
              />
            </ion-item>
            <ion-note class="counter" :color="description.length >= DESCRIPTION_MAX ? 'warning' : 'medium'">
              {{ description.length }} / {{ DESCRIPTION_MAX }}
            </ion-note>
            <ion-text v-if="errors.description" color="danger">
              <p class="field-error">{{ errors.description }}</p>
            </ion-text>
          </ion-list>

          <ion-list inset>
            <ion-item>
              <ion-label>
                <p>Username</p>
                <h2>@{{ auth.user?.username }}</h2>
              </ion-label>
            </ion-item>
            <ion-item>
              <ion-label>
                <p>Email</p>
                <h2>{{ auth.user?.email }}</h2>
              </ion-label>
            </ion-item>
          </ion-list>
          <ion-note class="read-only-note">Username and email can't be changed yet.</ion-note>

          <ion-text v-if="error" color="danger">
            <p class="error">{{ error }}</p>
          </ion-text>

          <div class="actions">
            <ion-button fill="outline" :disabled="saving" @click="cancelEdit">Cancel</ion-button>
            <ion-button type="submit" :disabled="saving">
              <ion-spinner v-if="saving" name="crescent" />
              <span v-else>Save</span>
            </ion-button>
          </div>
        </form>

        <template v-else>
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

          <ion-button expand="block" fill="outline" :disabled="loggingOut" @click="startEdit">
            <ion-icon slot="start" :icon="createOutline" />
            Edit profile
          </ion-button>
          <ion-button expand="block" color="danger" :disabled="loggingOut" @click="logOut">
            <ion-spinner v-if="loggingOut" name="crescent" />
            <span v-else>Log out</span>
          </ion-button>
        </template>
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
  IonInput,
  IonTextarea,
  IonNote,
  useIonRouter,
} from '@ionic/vue';
import { createOutline, personCircleOutline } from 'ionicons/icons';
import AppHeader from '@/components/AppHeader.vue';
import { navigateAndSettle } from '@/router/loading';
import { useAuthStore } from '@/stores/auth';
import type { ProfileUpdate } from '@/services/auth';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { showToast } from '@/utils/toast';

// The backend's limits (UpdateProfileRequest in bridge_backend).
const NAME_MAX = 255;
const DESCRIPTION_MAX = 1000;

const auth = useAuthStore();
const ionRouter = useIonRouter();

const loggingOut = ref(false);

const editing = ref(false);
const saving = ref(false);
const name = ref('');
const description = ref('');
const errors = ref<Record<string, string>>({});
const error = ref('');

function startEdit() {
  name.value = auth.user?.name ?? '';
  description.value = auth.user?.description ?? '';
  errors.value = {};
  error.value = '';
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

// Sends only what changed. An emptied description goes out as null, which
// clears it; the backend would store "" otherwise.
async function save() {
  if (saving.value || !auth.user) {
    return;
  }
  const changes: ProfileUpdate = {};
  const newName = name.value.trim();
  const newDescription = description.value.trim() || null;
  if (newName !== auth.user.name) {
    changes.name = newName;
  }
  if (newDescription !== (auth.user.description ?? null)) {
    changes.description = newDescription;
  }
  if (Object.keys(changes).length === 0) {
    editing.value = false;
    return;
  }

  saving.value = true;
  errors.value = {};
  error.value = '';
  try {
    await auth.updateProfile(changes);
    editing.value = false;
    await showToast('Profile updated.', 'success');
  } catch (e) {
    errors.value = fieldErrors(e);
    // Field errors show under their inputs; anything else goes below the form.
    if (Object.keys(errors.value).length === 0) {
      error.value = errorMessage(e, 'Could not save your profile. Please try again.');
    }
  } finally {
    saving.value = false;
  }
}

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

.counter {
  display: block;
  padding: 4px 16px 0;
  text-align: right;
  font-size: 0.8rem;
}

.field-error {
  margin: 4px 16px 8px;
  font-size: 0.85rem;
}

.read-only-note {
  display: block;
  margin: -8px 16px 16px;
  font-size: 0.85rem;
}

.error {
  margin: 0 16px 16px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: 0 16px;
}
</style>
