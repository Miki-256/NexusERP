type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyOfflineChange() {
  listeners.forEach((fn) => fn());
}

export function subscribeOfflineChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
