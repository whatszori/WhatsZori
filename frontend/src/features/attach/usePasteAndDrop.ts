import { useEffect, useState } from 'react';
import type { JID } from '../../api';
import { useAttach } from '../../stores/attach';
import { hasOpenLayer } from '../../ui';

// files on the clipboard: screenshots, pictures copied in a browser, files copied in Explorer
export function clipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  // Word, Excel and the like put a picture of the copied text next to the text itself; that's
  // a text paste. A copied picture or a screenshot has no plain text with it.
  if ([...data.types].includes('text/plain') && data.getData('text/plain').trim()) {
    const all = [...data.files];
    if (all.every((f) => f.type.startsWith('image/'))) return [];
  }
  const files = [...data.files];
  if (files.length) return files;
  // some sources only fill items
  return [...data.items]
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f);
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

// Ctrl+V / Cmd+V / "Paste" anywhere in an open chat, and dropping files on it, open the
// attachment preview. Text pastes are left alone. Returns whether files are being dragged over.
export function usePasteAndDrop(jid: JID): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // over something else (a dialog, a menu) the paste belongs to that, unless it's the preview
    const blocked = () => {
      const a = useAttach.getState();
      if (a.editing) return true;
      return hasOpenLayer() && !(a.open && a.jid === jid);
    };

    const onPaste = (e: ClipboardEvent) => {
      if (blocked()) return;
      const files = clipboardFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void useAttach.getState().addFiles(jid, files);
    };

    // dragenter/leave fire for every child; count them to know when the files left the window
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || blocked()) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // without this the webview opens the file instead
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = blocked() ? 'none' : 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (blocked()) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void useAttach.getState().addFiles(jid, files);
    };

    window.addEventListener('paste', onPaste);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [jid]);

  return dragging;
}
