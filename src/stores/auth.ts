import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as authService from '@/services/auth';
import type { LoginCredentials, User } from '@/services/auth';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const isAuthenticated = computed(() => user.value !== null);

  async function login(credentials: LoginCredentials) {
    await authService.login(credentials);
    user.value = await authService.fetchUser();
  }

  return { user, isAuthenticated, login };
});
