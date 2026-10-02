<template>
  <!-- Under every page's toolbar while the logged-in user is banned
       (GET /api/user's `ban`): why, and until when. -->
  <ion-toolbar v-if="auth.ban" color="danger" class="ban-banner">
    <p class="ban-text" role="status">{{ banText(auth.ban) }}</p>
  </ion-toolbar>
</template>

<script setup lang="ts">
import { IonToolbar } from '@ionic/vue';
import { useAuthStore } from '@/stores/auth';
import { banText } from '@/utils/ban';

const auth = useAuthStore();
</script>

<style scoped>
.ban-text {
  margin: 0;
  padding: 8px 16px;
  font-size: 0.9rem;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
</style>
