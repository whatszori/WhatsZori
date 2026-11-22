import type { BackendEventName, BackendEvents } from '../types';

type Handler<E extends BackendEventName> = (payload: BackendEvents[E]) => void;

export class Emitter {
  private handlers = new Map<BackendEventName, Set<Handler<BackendEventName>>>();

  on<E extends BackendEventName>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<BackendEventName>);
    return () => set.delete(handler as Handler<BackendEventName>);
  }

  emit<E extends BackendEventName>(event: E, payload: BackendEvents[E]): void {
    this.handlers.get(event)?.forEach((h) => {
      try {
        h(payload);
      } catch (err) {
        console.error(`[backend] handler for ${event} threw`, err);
      }
    });
  }
}
