import { create } from 'zustand';
import { backend, type AuthStatus, type ConnState, type QRPayload } from '../api';

interface ConnectionState {
  auth: AuthStatus;
  conn: ConnState;
  qr: (QRPayload & { receivedAt: number }) | null;
  ready: boolean;
  init(): Promise<void>;
  setAuth(auth: AuthStatus): void;
  setConn(conn: ConnState): void;
  setQR(qr: QRPayload): void;
}

export const useConnection = create<ConnectionState>((set) => ({
  auth: { state: 'logged-out', me: null },
  conn: 'offline',
  qr: null,
  ready: false,
  async init() {
    const auth = await backend.auth.getState();
    set({ auth, ready: true, conn: auth.state === 'logged-in' ? 'connecting' : 'offline' });
  },
  setAuth: (auth) => set((s) => ({ auth, qr: auth.state === 'qr' ? s.qr : null })),
  setConn: (conn) => set({ conn }),
  setQR: (qr) => set({ qr: { ...qr, receivedAt: Date.now() } }),
}));
