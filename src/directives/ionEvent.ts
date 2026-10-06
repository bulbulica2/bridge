import type { Directive } from 'vue';

// `v-ion-event:ion-refresh="refresh"`: listens for an Ionic event on the
// element itself (#158). Ionic Vue 8 dispatches every event in kebab-case
// (`ion-refresh`), while its wrappers declare the camelCase name
// (`ionRefresh`) as a component event and only re-emit it from a listener
// for that camelCase name, which never fires, and only on components with
// a v-model. So `@ionRefresh` / `@ionInfinite` never run. Components with a
// value use `v-model` / `@update:model-value` instead (that path works); this
// is for the events without one (`ion-refresh`, `ion-infinite`). The argument
// is the kebab-case name; the handler gets the CustomEvent, its target the
// Ionic element.
type Handler = (event: CustomEvent) => void;

interface Bound {
  handler: Handler;
  listener: (event: Event) => void;
}

const bound = new WeakMap<Element, Map<string, Bound>>();

export const vIonEvent: Directive<HTMLElement, Handler> = {
  mounted(el, { arg, value }) {
    const entry: Bound = { handler: value, listener: (event) => entry.handler(event as CustomEvent) };
    const events = bound.get(el) ?? new Map<string, Bound>();
    events.set(arg!, entry);
    bound.set(el, events);
    el.addEventListener(arg!, entry.listener);
  },
  // A new handler (an inline arrow re-created on render) replaces the old.
  updated(el, { arg, value }) {
    bound.get(el)!.get(arg!)!.handler = value;
  },
  unmounted(el, { arg }) {
    const events = bound.get(el)!;
    el.removeEventListener(arg!, events.get(arg!)!.listener);
    events.delete(arg!);
  },
};
