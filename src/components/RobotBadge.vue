<template>
  <!-- Marks a seated robot (PublicUser.is_robot) next to its name, wherever a
       seat is drawn. Ionicons has no robot, so a chip stands in for one. -->
  <span class="robot-badge" title="Robot player">
    <ion-icon :icon="hardwareChipOutline" aria-hidden="true" />
    <span>robot</span>
  </span>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { hardwareChipOutline } from 'ionicons/icons';
</script>

<style scoped>
.robot-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 5px;
  border-radius: 8px;
  background: rgba(var(--ion-color-tertiary-rgb, 82, 96, 255), 0.12);
  color: var(--ion-color-tertiary, #5260ff);
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1.5;
  text-transform: uppercase;
  white-space: nowrap;
}

.robot-badge ion-icon {
  font-size: 0.85rem;
}
</style>
