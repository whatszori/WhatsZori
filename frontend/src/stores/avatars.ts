import { create } from 'zustand';
import type { JID } from '../api';

interface AvatarState {
  // bumped on avatar:changed so the <img> URL changes and the webview fetches the new picture
  versions: Record<JID, number>;
  bump(jid: JID): void;
}

export const useAvatars = create<AvatarState>((set) => ({
  versions: {},
  bump: (jid) => set((s) => ({ versions: { ...s.versions, [jid]: (s.versions[jid] ?? 0) + 1 } })),
}));

// URLs that answered 404 (no picture, hidden, offline). The chat list is virtualized and remounts
// avatars all the time; this keeps them from asking again until the picture changes.
export const missingAvatars = new Set<string>();
