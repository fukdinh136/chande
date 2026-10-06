import { useSyncExternalStore } from 'react';

/** Store ngoài React tối giản: màn hình đọc bằng useStore, logic gọi API nằm trong lớp con. */
export class Store<T extends object> {
  private readonly listeners = new Set<() => void>();
  constructor(protected state: T) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  protected set(patch: Partial<T>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export interface Subscribable<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

export function useStore<T>(store: Subscribable<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
