export interface Session {
  name: string;
  username: string;
  outlet: string;
  shift: string;
  clockIn: string;
  cash: number;
}

const DEMO: Session = {
  name: 'Gista',
  username: 'gista.kasir',
  outlet: 'ESB Cabang Poris',
  shift: 'Shift Pagi',
  clockIn: '08:57',
  cash: 200000,
};

let current: Session | null = null;
type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function getSession(): Session | null {
  return current;
}

export function isLoggedIn(): boolean {
  return current !== null;
}

/** Simulasi login dev — tombol "Masuk Demo" di LoginScreen memanggil ini. */
export function loginDemo(): Session {
  current = { ...DEMO };
  emit();
  return current;
}

export function logout(): void {
  current = null;
  emit();
}

export function subscribeSession(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
