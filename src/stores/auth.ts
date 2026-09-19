import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as authService from '@/services/auth';
import type { LoginCredentials, RegistrationData, User } from '@/services/auth';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const isAuthenticated = computed(() => user.value !== null);

  // The store lives in memory, but the Sanctum session lives in a cookie, so on
  // a page reload we have to ask the backend who we are before the router guard
  // can decide anything. Kept as a single in-flight promise so concurrent
  // navigations only trigger one request.
  let sessionCheck: Promise<void> | null = null;

  async function login(credentials: LoginCredentials) {
    await authService.login(credentials);
    user.value = await authService.fetchUser();
    sessionCheck = Promise.resolve();
  }

  async function register(data: RegistrationData) {
    await authService.register(data);
    user.value = await authService.fetchUser();
    sessionCheck = Promise.resolve();
  }

  async function logout() {
    try {
      await authService.logout();
    } finally {
      // Whatever the server says, this client is done with the session.
      user.value = null;
      sessionCheck = Promise.resolve();
    }
  }

  // Resolves once we know whether there is a live session. Safe to await on
  // every navigation: the lookup happens at most once per page load.
  function loadSession(): Promise<void> {
    if (!sessionCheck) {
      sessionCheck = authService
        .fetchUser()
        .then((u) => {
          user.value = u;
        })
        .catch(() => {
          // 401 (or an unreachable backend) simply means "not logged in".
          user.value = null;
        });
    }
    return sessionCheck;
  }

  return { user, isAuthenticated, login, register, logout, loadSession };
});
