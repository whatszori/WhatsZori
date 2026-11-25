import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../api';
import { clipboardFiles } from '../features/attach/usePasteAndDrop';
import { useAttach } from './attach';
import { useMessages } from './messages';

const png = () =>
  new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'image.png', { type: 'image/png' });
const doc = () => new File(['hello'], 'notes.txt', { type: 'text/plain' });

beforeAll(() => {
  // jsdom has no blob URLs
  let n = 0;
  URL.createObjectURL ??= () => `blob:test/${n++}`;
  URL.revokeObjectURL ??= () => {};
});

beforeEach(() => useAttach.getState().close());

describe('attachment drafts', () => {
  it('collects pasted files for one chat', async () => {
    await useAttach.getState().addFiles('a@s.whatsapp.net', [png()]);
    await useAttach.getState().addFiles('a@s.whatsapp.net', [doc()]);
    const s = useAttach.getState();
    expect(s.open).toBe(true);
    expect(s.items.map((i) => i.kind)).toEqual(['image', 'file']);
    // the new one is shown
    expect(s.current).toBe(1);
    // a screenshot gets a readable name
    expect(s.items[0].name).toMatch(/^Pasted \d{4}-\d\d-\d\d .*\.png$/);
  });

  it('starts over for another chat', async () => {
    await useAttach.getState().addFiles('a@s.whatsapp.net', [png(), doc()]);
    await useAttach.getState().addFiles('b@s.whatsapp.net', [doc()]);
    const s = useAttach.getState();
    expect(s.jid).toBe('b@s.whatsapp.net');
    expect(s.items).toHaveLength(1);
  });

  it('closes when the last one is removed', async () => {
    await useAttach.getState().addFiles('a@s.whatsapp.net', [doc()]);
    useAttach.getState().remove(useAttach.getState().items[0].token);
    expect(useAttach.getState().open).toBe(false);
  });

  it('keeps the caption when an edit replaces the photo', async () => {
    await useAttach.getState().addFiles('a@s.whatsapp.net', [png()]);
    const [it] = useAttach.getState().items;
    useAttach.getState().setCaption(it.token, 'look');
    await useAttach
      .getState()
      .replace(it.token, new Blob(['x'], { type: 'image/jpeg' }), 'edited.jpg');
    const [after] = useAttach.getState().items;
    expect(after.token).not.toBe(it.token);
    expect(after).toMatchObject({ name: 'edited.jpg', caption: 'look' });
  });

  it('sends everything and adds the messages to the chat', async () => {
    const jid = (await backend.chats.listChats())[0].jid;
    await useAttach.getState().addFiles(jid, [doc(), doc()]);
    useAttach.getState().setCaption(useAttach.getState().items[0].token, 'first');
    await useAttach.getState().send();
    expect(useAttach.getState()).toMatchObject({ open: false, items: [], progress: null });
    const sent =
      useMessages.getState().byChat[jid]?.items.filter((m) => m.kind === 'document') ?? [];
    expect(sent.map((m) => m.text).slice(-2)).toEqual(['first', '']);
  });
});

describe('clipboardFiles', () => {
  const dt = (files: File[], items: unknown[] = [], text = '') =>
    ({
      files,
      items,
      types: text ? ['text/plain', 'Files'] : ['Files'],
      getData: () => text,
    }) as unknown as DataTransfer;

  it('reads files, or file items when files is empty', () => {
    const f = doc();
    expect(clipboardFiles(dt([f]))).toEqual([f]);
    expect(
      clipboardFiles(dt([], [{ kind: 'file', getAsFile: () => f }, { kind: 'string' }])),
    ).toEqual([f]);
    expect(clipboardFiles(null)).toEqual([]);
  });

  it('leaves text copied from Office (text plus a picture of it) to the composer', () => {
    expect(clipboardFiles(dt([png()], [], 'Q3 numbers'))).toEqual([]);
    // a real file next to some text is still a file paste
    const f = doc();
    expect(clipboardFiles(dt([f], [], 'notes.txt'))).toEqual([f]);
  });
});
