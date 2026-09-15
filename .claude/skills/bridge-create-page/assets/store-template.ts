// Pinia store template (setup style, like src/stores/auth.ts).
// Save as src/stores/<domain>.ts, or extend an existing store for the same domain.
// Views call the store; the store calls the service.
import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as __domain__Service from '@/services/__domain__';
import type { __Item__, __Create__Payload } from '@/services/__domain__';

export const use__Domain__Store = defineStore('__domain__', () => {
  const items = ref<__Item__[]>([]);

  async function load() {
    items.value = await __domain__Service.list__Items__();
  }

  async function create(payload: __Create__Payload) {
    const item = await __domain__Service.create__Item__(payload);
    items.value.push(item);
    return item;
  }

  return { items, load, create };
});
