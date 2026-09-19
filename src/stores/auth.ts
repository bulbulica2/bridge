import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as authService from '@/services/auth';
import type {
  LoginCredentials,
  PasswordResetData,
  PasswordResetRequest,
  RegistrationData,
  User,
} from '@/services/auth';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const isAuthenticated = computed(() => user.value !== null);

  async function login(credentials: LoginCredentials) {
    await authService.login(credentials);
    user.value = await authService.fetchUser();
  }

  async function register(data: RegistrationData) {
    await authService.register(data);
    user.value = await authService.fetchUser();
  }

  // Password reset is a guest flow: neither call authenticates anyone, so the
  // user stays untouched. Both return the backend's human-readable status.
  async function requestPasswordReset(data: PasswordResetRequest) {
    return authService.requestPasswordReset(data);
  }

  async function resetPassword(data: PasswordResetData) {
    return authService.resetPassword(data);
  }

  return {
    user,
    isAuthenticated,
    login,
    register,
    requestPasswordReset,
    resetPassword,
  };
});
