import { create } from 'zustand';
import {
  backend,
  type AuthStatus,
  type ConnState,
  type QRPayload,
  type SyncProgress,
} from '../api';

interface ConnectionState {
  auth: AuthStatus;
  conn: ConnState;
  qr: (QRPayload & { receivedAt: number }) | null;
  // why the last login attempt ended, shown on the auth screen
  authError: string | null;
  // history sync from the phone; null when nothing is syncing
  sync: SyncProgress | null;
  ready: boolean;
  init(): Promise<void>;
  setAuth(auth: AuthStatus): void;
  setConn(conn: ConnState): void;
  setQR(qr: QRPayload): void;
  setAuthError(message: string | null): void;
  setSync(sync: SyncProgress): void;
}

export const useConnection = create<ConnectionState>((set) => ({
  auth: { state: 'logged-out', me: null },
  conn: 'offline',
  qr: null,
  authError: null,
  sync: null,
  ready: false,
  async init() {
    const [auth, conn] = await Promise.all([backend.auth.getState(), backend.auth.getConnState()]);
    set({ auth, conn, ready: true });
  },
  setAuth: (auth) =>
    set((s) => ({
      auth,
      qr: auth.state === 'qr' ? s.qr : null,
      authError: auth.state === 'logged-out' ? s.authError : null,
    })),
  setConn: (conn) => set({ conn }),
  setQR: (qr) => set({ qr: { ...qr, receivedAt: Date.now() }, authError: null }),
  setAuthError: (authError) => set({ authError, qr: null }),
  setSync: (sync) => set({ sync: sync.done ? null : sync }),
}));
