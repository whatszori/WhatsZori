import { create } from 'zustand';
import { backend, type Attachment, type JID } from '../api';
import { useMessages } from './messages';
import { toastError } from './toasts';

// The attachment preview: files picked, pasted or dropped wait here until they're sent. One chat
// at a time; adding files for another chat starts over.

export interface DraftItem extends Attachment {
  caption: string;
  // the preview URL (the backend's, or a blob: in the browser preview)
  url: string;
}

const MAX_ITEMS = 30;
// WhatsApp shows these as photos; other pictures get re-encoded to JPEG first
const PHOTO_MIMES = ['image/jpeg', 'image/png'];

interface AttachState {
  jid: JID | null;
  open: boolean;
  items: DraftItem[];
  current: number;
  // send pictures as documents, uncompressed
  asFiles: boolean;
  // sending: how many of how many
  progress: { done: number; total: number } | null;
  // the photo editor, by token
  editing: string | null;

  pick(jid: JID): Promise<void>;
  addFiles(jid: JID, files: File[]): Promise<void>;
  select(i: number): void;
  remove(token: string): void;
  setCaption(token: string, caption: string): void;
  setAsFiles(v: boolean): void;
  edit(token: string | null): void;
  // the editor's result takes the original's place
  replace(token: string, blob: Blob, name: string): Promise<void>;
  send(): Promise<void>;
  close(): void;
}

const toItem = (a: Attachment): DraftItem => ({
  ...a,
  caption: '',
  url: backend.messages.attachmentUrl(a.token),
});

// pasted screenshots come as "image.png"; give them something nicer to show and save
function nameFor(f: File): string {
  if (f.name && f.name !== 'image.png' && f.name !== 'image.jpg') return f.name;
  const ext = f.type === 'image/jpeg' ? 'jpg' : (f.type.split('/')[1] ?? 'png');
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `Pasted ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.${ext}`;
}

// webp, bmp and the like aren't photos to WhatsApp; draw them and send a JPEG
async function toJPEG(url: string): Promise<Blob> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("couldn't convert the picture"))),
      'image/jpeg',
      0.92,
    ),
  );
}

const dropAll = (items: DraftItem[]) => {
  for (const it of items) void backend.messages.dropAttachment(it.token).catch(() => {});
};

export const useAttach = create<AttachState>((set, get) => {
  // new files for jid: join the open draft, or replace one for another chat
  const add = (jid: JID, added: Attachment[]) => {
    if (added.length === 0) return;
    const s = get();
    if (s.progress && s.jid !== jid) {
      dropAll(added.map(toItem));
      toastError('Wait until the files for the other chat are sent');
      return;
    }
    const keep = s.jid === jid && (s.open || !!s.progress);
    if (!keep) dropAll(s.items);
    const before = keep ? s.items : [];
    const room = MAX_ITEMS - before.length;
    if (added.length > room) {
      dropAll(added.slice(room).map(toItem));
      toastError(`At most ${MAX_ITEMS} files at once`);
    }
    const fresh = added.slice(0, Math.max(0, room)).map(toItem);
    set({
      jid,
      open: true,
      items: [...before, ...fresh],
      current: fresh.length ? before.length : s.current,
      asFiles: keep ? s.asFiles : false,
      editing: keep ? s.editing : null,
    });
  };

  return {
    jid: null,
    open: false,
    items: [],
    current: 0,
    asFiles: false,
    progress: null,
    editing: null,

    async pick(jid) {
      try {
        add(jid, await backend.messages.pickAttachments());
      } catch (err) {
        toastError(err, "Couldn't add the file");
      }
    },

    async addFiles(jid, files) {
      const done: Attachment[] = [];
      for (const f of files) {
        try {
          done.push(await backend.messages.uploadAttachment(f, nameFor(f)));
        } catch (err) {
          toastError(err, `Couldn't add ${f.name || 'the file'}`);
        }
      }
      add(jid, done);
    },

    select: (i) => set((s) => ({ current: Math.max(0, Math.min(i, s.items.length - 1)) })),

    remove(token) {
      void backend.messages.dropAttachment(token).catch(() => {});
      const s = get();
      const items = s.items.filter((it) => it.token !== token);
      if (items.length === 0) {
        set({ items, open: false, current: 0, editing: null });
        return;
      }
      set({ items, current: Math.min(s.current, items.length - 1) });
    },

    setCaption: (token, caption) =>
      set((s) => ({ items: s.items.map((it) => (it.token === token ? { ...it, caption } : it)) })),

    setAsFiles: (asFiles) => set({ asFiles }),

    edit: (editing) => set({ editing }),

    async replace(token, blob, name) {
      const a = await backend.messages.uploadAttachment(blob, name);
      const s = get();
      if (!s.items.some((it) => it.token === token)) {
        void backend.messages.dropAttachment(a.token);
        return;
      }
      void backend.messages.dropAttachment(token).catch(() => {});
      set({
        items: s.items.map((it) =>
          it.token === token ? { ...toItem(a), caption: it.caption } : it,
        ),
        editing: null,
      });
    },

    async send() {
      const s = get();
      const jid = s.jid;
      if (!jid || s.progress || s.items.length === 0) return;
      const queue = [...s.items];
      const asFiles = s.asFiles;
      set({ progress: { done: 0, total: queue.length } });
      for (const [i, it] of queue.entries()) {
        try {
          let token = it.token;
          if (
            it.kind === 'image' &&
            !asFiles &&
            !PHOTO_MIMES.includes(it.mime) &&
            it.mime !== 'image/gif'
          ) {
            const jpeg = await toJPEG(it.url);
            const base = it.name.replace(/\.[^.]+$/, '') || 'photo';
            token = (await backend.messages.uploadAttachment(jpeg, `${base}.jpg`)).token;
            void backend.messages.dropAttachment(it.token).catch(() => {});
          }
          const m = await backend.messages.sendAttachment(jid, token, it.caption, asFiles);
          useMessages.getState().addSent(jid, m);
          set((st) => ({
            items: st.items.filter((x) => x.token !== it.token),
            current: 0,
            progress: { done: i + 1, total: queue.length },
          }));
        } catch (err) {
          // stop here: the rest stay in the preview to try again
          toastError(err, `${it.name} not sent`);
          set({ progress: null, open: true });
          return;
        }
      }
      set({ progress: null, open: false, items: [], current: 0 });
    },

    close() {
      const s = get();
      if (s.progress) {
        // keeps sending in the background; nothing to come back to afterwards
        set({ open: false });
        return;
      }
      dropAll(s.items);
      set({ open: false, items: [], current: 0, editing: null, asFiles: false });
    },
  };
});
