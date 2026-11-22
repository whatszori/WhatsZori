import { create } from 'zustand';
import { backend, type Profile } from '../api';

interface ProfileState {
  profile: Profile;
  loaded: boolean;
  load(): Promise<void>;
  setName(name: string): Promise<void>;
  setAbout(about: string): Promise<void>;
}

export const useProfile = create<ProfileState>((set, get) => ({
  profile: { name: '', about: '', phone: '' },
  loaded: false,
  async load() {
    set({ profile: await backend.profile.get(), loaded: true });
  },
  async setName(name) {
    const before = get().profile;
    set({ profile: { ...before, name: name.trim() } });
    try {
      await backend.profile.setName(name);
    } catch (err) {
      set({ profile: before });
      throw err;
    }
  },
  async setAbout(about) {
    const before = get().profile;
    set({ profile: { ...before, about: about.trim() } });
    try {
      await backend.profile.setAbout(about);
    } catch (err) {
      set({ profile: before });
      throw err;
    }
  },
}));
