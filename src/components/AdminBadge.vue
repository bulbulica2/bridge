<template>
  <!-- Marks an admin (PublicUser.is_admin) next to their name, wherever a seat
       is drawn: players see an admin is at the table, and only another admin
       can remove them from it (bridge_backend docs/API.md, Tables). -->
  <span class="admin-badge" title="Admin">
    <ion-icon :icon="shieldCheckmarkOutline" aria-hidden="true" />
    <span>admin</span>
  </span>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { shieldCheckmarkOutline } from 'ionicons/icons';
</script>

<style scoped>
.admin-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 5px;
  border-radius: 8px;
  background: rgba(var(--ion-color-secondary-rgb, 1, 99, 170), 0.12);
  color: var(--ion-color-secondary, #0163aa);
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1.5;
  text-transform: uppercase;
  white-space: nowrap;
}

.admin-badge ion-icon {
  font-size: 0.85rem;
}
</style>
