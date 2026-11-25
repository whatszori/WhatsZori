// Chat Insights: an example of plugin API 2. Plain JavaScript, no build step.
//  - 📊 panel next to the chat: who writes, when, top words and emoji (Ctrl+Alt+I)
//  - 🔖 bookmarks: message menu, a mark under the message, a badge in the chat list, a banner in
//    the chat and a whole screen with all of them (Ctrl+Alt+B)
//  - words from the settings are highlighted in messages (a text formatter)
//  - a Grayscale tool in the photo editor
//  - a notification when someone deletes a message (if turned on in the settings)
// Permissions: messages, notifications, clipboard. Nothing is sent anywhere.

const CSS = `
.ci-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
.ci-tile { padding: 10px; border-radius: 10px; background: var(--wz-bg-secondary); }
.ci-tile b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.ci-tile span { color: var(--wz-text-secondary); font-size: 11px; }
.ci-h { margin: 16px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--wz-text-secondary); }
.ci-bar { display: grid; grid-template-columns: 96px 1fr 32px; align-items: center; gap: 8px; margin: 4px 0; font-size: 13px; }
.ci-bar__name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ci-bar__track { height: 8px; border-radius: 4px; background: var(--wz-bg-secondary); overflow: hidden; }
.ci-bar__fill { display: block; height: 100%; border-radius: 4px; background: var(--wz-accent); }
.ci-bar__n { text-align: right; color: var(--wz-text-secondary); font-variant-numeric: tabular-nums; }
.ci-hours { display: flex; align-items: flex-end; gap: 2px; height: 56px; }
.ci-hours i { flex: 1; min-height: 2px; border-radius: 2px 2px 0 0; background: var(--wz-accent); opacity: .85; }
.ci-axis { display: flex; justify-content: space-between; color: var(--wz-text-muted); font-size: 10px; margin-top: 3px; }
.ci-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ci-chip { padding: 3px 9px; border-radius: 999px; background: var(--wz-accent-soft); color: var(--wz-accent-text); font-size: 13px; }
.ci-chip small { opacity: .7; margin-left: 4px; }
.ci-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.ci-empty { color: var(--wz-text-secondary); padding: 24px 0; text-align: center; }
.ci-tag { margin: 2px 0 0; font-size: 11px; color: var(--wz-accent-text); }
.ci-badge { font-size: 11px; line-height: 1; }
.ci-banner { display: flex; align-items: center; gap: 10px; padding: 6px 16px; border-bottom: 1px solid var(--wz-border); background: var(--wz-accent-soft); color: var(--wz-accent-text); font-size: 13px; }
.ci-banner button { all: unset; cursor: pointer; font-weight: 600; text-decoration: underline; }
.ci-banner span { flex: 1; }
.ci-mark { background: color-mix(in srgb, #ffd166 70%, transparent); color: inherit; border-radius: 3px; padding: 0 2px; }
.ci-view { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
.ci-group h3 { margin: 0 0 8px; font-size: 13px; color: var(--wz-text-secondary); font-weight: 600; }
.ci-item { display: flex; gap: 12px; align-items: flex-start; width: 100%; padding: 10px 12px; margin-bottom: 4px; border: 0; border-radius: 10px; background: var(--wz-bg-secondary); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.ci-item:hover { background: var(--wz-bg-hover); }
.ci-item div { flex: 1; min-width: 0; }
.ci-item small { display: block; color: var(--wz-text-secondary); margin-bottom: 2px; }
.ci-item p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.ci-info { display: flex; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--wz-text-secondary); padding: 4px 16px 12px; }
.ci-info b { color: var(--wz-text-primary); }
`;

const STOP = new Set(
  ('the a an and or but to of in on at for is it i you me my we he she they this that be are was ' +
    'with not no yes do so just have has will can im its your what ok okay oh ' +
    'и в не на я что с а то как это он она но у по так все мне ты же да нет вы мы за из ' +
    'бы для его если уже там тут ну вот ещё еще или о к от до её их меня тебя')
    .split(' '),
);
const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

function analyse(msgs) {
  const bySender = new Map();
  const hours = new Array(24).fill(0);
  const words = new Map();
  const emoji = new Map();
  let mine = 0, edited = 0, deleted = 0, media = 0;
  for (const m of msgs) {
    const who = m.fromMe ? 'You' : m.senderName || 'Someone';
    bySender.set(who, (bySender.get(who) ?? 0) + 1);
    hours[new Date(m.timestamp).getHours()]++;
    if (m.fromMe) mine++;
    if (m.editedAt) edited++;
    if (m.deleted) deleted++;
    if (m.kind !== 'text') media++;
    const text = m.text || '';
    for (const e of text.match(EMOJI) ?? []) emoji.set(e, (emoji.get(e) ?? 0) + 1);
    for (const w of text.toLowerCase().match(/[\p{L}][\p{L}'-]{2,}/gu) ?? []) {
      if (!STOP.has(w)) words.set(w, (words.get(w) ?? 0) + 1);
    }
  }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const first = msgs[0]?.timestamp;
  const last = msgs[msgs.length - 1]?.timestamp;
  const days = first ? Math.max(1, (last - first) / 86_400_000) : 1;
  return { total: msgs.length, mine, edited, deleted, media, perDay: msgs.length / days,
    senders: top(bySender, 6), hours, words: top(words, 10), emoji: top(emoji, 8), since: first };
}

// pages back through history with messagePage (API 2) instead of the first 200 only
async function loadMessages(ctx, jid, want) {
  let out = [];
  let before;
  while (out.length < want) {
    const page = await ctx.data.messagePage(jid, { before, limit: Math.min(200, want - out.length) });
    out = [...page.messages, ...out];
    if (!page.hasMore || page.messages.length === 0) break;
    before = page.messages[0].pk;
  }
  return out;
}

export default {
  async start(ctx) {
    const { React, ui } = ctx;
    const h = React.createElement;
    ui.addStyles(CSS);

    // ---- shared state ----
    const state = { bookmarks: [], highlight: [], sample: 200, notifyOnDelete: false };
    const subs = new Set();
    const update = (patch) => {
      Object.assign(state, patch);
      subs.forEach((fn) => fn());
    };
    const useStore = () => {
      const [, force] = React.useReducer((x) => x + 1, 0);
      React.useEffect(() => {
        subs.add(force);
        return () => subs.delete(force);
      }, []);
      return state;
    };
    try {
      state.bookmarks = JSON.parse((await ctx.storage.get('bookmarks')) ?? '[]');
    } catch {
      ctx.log.warn('bookmarks were broken, starting over');
    }
    const words = (v) => String(v ?? '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    state.highlight = words(await ctx.settings.get('highlight'));
    state.sample = Number(await ctx.settings.get('sample')) || 200;
    state.notifyOnDelete = (await ctx.settings.get('notifyOnDelete')) === true;
    ctx.settings.onChange((key, value) => {
      if (key === 'highlight') update({ highlight: words(value) });
      if (key === 'sample') update({ sample: Number(value) || 200 });
      if (key === 'notifyOnDelete') update({ notifyOnDelete: value === true });
    });
    const saveBookmarks = (list) => {
      update({ bookmarks: list });
      void ctx.storage.set('bookmarks', JSON.stringify(list));
    };
    const toggleBookmark = (message) => {
      if (state.bookmarks.some((b) => b.pk === message.pk)) {
        saveBookmarks(state.bookmarks.filter((b) => b.pk !== message.pk));
        return;
      }
      const chat = ctx.data.chats().find((c) => c.jid === message.chatJid);
      saveBookmarks([{ pk: message.pk, chatJid: message.chatJid, chatName: chat?.name ?? '',
        from: message.fromMe ? 'You' : message.senderName, text: message.text || `[${message.kind}]`,
        at: message.timestamp }, ...state.bookmarks].slice(0, 500));
      ctx.actions.toast('Bookmarked');
    };

    // ---- events ----
    ctx.events.onDeleted(async (e) => {
      if (!state.notifyOnDelete) return;
      const chat = ctx.data.chats().find((c) => c.jid === e.chatJid);
      await ctx.notify('Message deleted', `${e.byName || 'Someone'} deleted a message in ${chat?.name ?? 'a chat'}. WhatsZori kept it.`).catch(() => {});
    });

    // ---- the stats panel ----
    function Bar({ name, n, max }) {
      return h('div', { className: 'ci-bar' },
        h('span', { className: 'ci-bar__name', title: name }, name),
        h('span', { className: 'ci-bar__track' }, h('span', { className: 'ci-bar__fill', style: { width: `${(n / max) * 100}%` } })),
        h('span', { className: 'ci-bar__n' }, n));
    }

    function summaryOf(stats) {
      return `📊 Last ${stats.total} messages: ${Math.round((stats.mine / stats.total) * 100)}% mine, ~${stats.perDay.toFixed(1)}/day` +
        (stats.emoji[0] ? `, favourite emoji ${stats.emoji[0][0]}` : '') +
        (stats.words[0] ? `, top word “${stats.words[0][0]}”` : '');
    }

    function StatsPanel({ chat }) {
      const s = useStore();
      const [stats, setStats] = React.useState(null);
      React.useEffect(() => {
        let gone = false;
        setStats(null);
        loadMessages(ctx, chat.jid, s.sample).then((msgs) => !gone && setStats(analyse(msgs)));
        return () => { gone = true; };
      }, [chat.jid, s.sample]);
      if (!stats) return h('div', { className: 'ci-empty' }, h(ui.Spinner, { size: 18 }));
      if (stats.total === 0) return h('div', { className: 'ci-empty' }, 'No messages here yet.');
      const tile = (n, label) => h('div', { className: 'ci-tile' }, h('b', null, n), h('span', null, label));
      const maxH = Math.max(...stats.hours, 1);
      return h(React.Fragment, null,
        h('div', { className: 'ci-tiles' },
          tile(stats.total, 'messages'),
          tile(stats.perDay < 10 ? stats.perDay.toFixed(1) : Math.round(stats.perDay), 'per day'),
          tile(stats.media, 'media'),
          tile(`${Math.round((stats.mine / stats.total) * 100)}%`, 'yours'),
          tile(stats.edited, 'edited'),
          tile(stats.deleted, 'deleted')),
        h('div', { className: 'ci-h' }, 'Who writes'),
        stats.senders.map(([name, n]) => h(Bar, { key: name, name, n, max: stats.senders[0][1] })),
        h('div', { className: 'ci-h' }, 'When (hour of day)'),
        h('div', { className: 'ci-hours' }, stats.hours.map((n, i) => h('i', { key: i, title: `${i}:00: ${n}`, style: { height: `${(n / maxH) * 100}%` } }))),
        h('div', { className: 'ci-axis' }, ...['0', '6', '12', '18', '23'].map((t) => h('span', { key: t }, t))),
        stats.words.length > 0 && h('div', { className: 'ci-h' }, 'Top words'),
        h('div', { className: 'ci-chips' }, stats.words.map(([w, n]) => h('span', { key: w, className: 'ci-chip' }, w, h('small', null, n)))),
        stats.emoji.length > 0 && h('div', { className: 'ci-h' }, 'Top emoji'),
        h('div', { className: 'ci-chips' }, stats.emoji.map(([e, n]) => h('span', { key: e, className: 'ci-chip' }, e, h('small', null, n)))),
        h('div', { className: 'ci-actions' },
          h(ui.Button, { size: 'sm', onClick: async () => {
            await ctx.clipboard.writeText(summaryOf(stats));
            ctx.actions.toast('Summary copied');
          } }, 'Copy summary')));
    }

    ctx.panels.register({ id: 'stats', title: 'Chat insights', icon: '📊', render: StatsPanel });

    // ---- bookmarks everywhere ----
    ctx.registerSlot('message.contextMenu', ({ message, close }) => {
      const s = useStore();
      const marked = s.bookmarks.some((b) => b.pk === message.pk);
      return h(ui.MenuItem, { label: marked ? 'Remove bookmark' : 'Bookmark', icon: h('span', { 'aria-hidden': true }, marked ? '✖' : '🔖'),
        onSelect: () => { toggleBookmark(message); close(); } });
    });
    ctx.registerSlot('message.accessories', ({ message }) => {
      const s = useStore();
      return s.bookmarks.some((b) => b.pk === message.pk) ? h('div', { className: 'ci-tag' }, '🔖 bookmarked') : null;
    });
    ctx.registerSlot('chatList.item.badge', ({ chat }) => {
      const s = useStore();
      const n = s.bookmarks.filter((b) => b.chatJid === chat.jid).length;
      return n ? h('span', { className: 'ci-badge', title: `${n} bookmarked` }, '🔖') : null;
    });
    ctx.registerSlot('conversation.banner', ({ chat }) => {
      const s = useStore();
      const n = s.bookmarks.filter((b) => b.chatJid === chat.jid).length;
      if (!n) return null;
      return h('div', { className: 'ci-banner' },
        h('span', null, `🔖 ${n} bookmarked message${n > 1 ? 's' : ''} in this chat`),
        h('button', { type: 'button', onClick: () => ctx.views.open('bookmarks') }, 'Show'));
    });
    ctx.registerSlot('mediaViewer.actions', ({ message }) => {
      const s = useStore();
      const marked = s.bookmarks.some((b) => b.pk === message.pk);
      return h(ui.IconButton, { label: marked ? 'Remove bookmark' : 'Bookmark', active: marked,
        icon: h('span', { 'aria-hidden': true }, '🔖'), onClick: () => toggleBookmark(message) });
    });

    function BookmarksView() {
      const s = useStore();
      if (s.bookmarks.length === 0)
        return h('div', { className: 'ci-empty' }, 'Nothing bookmarked yet. Right-click a message → Bookmark.');
      const groups = new Map();
      for (const b of s.bookmarks) groups.set(b.chatName, [...(groups.get(b.chatName) ?? []), b]);
      return h('div', { className: 'ci-view' },
        ...[...groups.entries()].map(([name, list]) => h('section', { key: name, className: 'ci-group' },
          h('h3', null, `${name} · ${list.length}`),
          list.map((b) => h('button', { key: b.pk, type: 'button', className: 'ci-item', onClick: () => ctx.actions.jumpTo(b.chatJid, b.pk) },
            h('div', null, h('small', null, `${b.from} · ${new Date(b.at).toLocaleString()}`), h('p', null, b.text)),
            h(ui.IconButton, { label: 'Remove bookmark', size: 'sm', icon: h('span', null, '✖'),
              onClick: (e) => { e.stopPropagation(); saveBookmarks(s.bookmarks.filter((x) => x.pk !== b.pk)); } }))))));
    }
    ctx.views.register({ id: 'bookmarks', title: 'Bookmarks', icon: '🔖', render: BookmarksView });

    // ---- the info panel ----
    ctx.registerSlot('chatInfo.sections', ({ chat }) => {
      const s = useStore();
      const n = s.bookmarks.filter((b) => b.chatJid === chat.jid).length;
      return h('div', { className: 'ci-info' },
        h('span', null, '🔖 ', h('b', null, n), ' bookmarked'),
        h(ui.Button, { size: 'sm', variant: 'ghost', onClick: () => ctx.panels.open('stats') }, 'Open insights'));
    });

    // ---- highlighted words ----
    ctx.messages.registerFormatter((text) => {
      if (!state.highlight.length || !text) return null;
      const re = new RegExp(`(${state.highlight.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
      if (!re.test(text)) return null;
      return text.split(re).map((part, i) => (i % 2 ? h('mark', { key: i, className: 'ci-mark' }, part) : part));
    });

    // ---- the photo editor ----
    ctx.editor.registerTool({
      id: 'grayscale',
      label: 'Grayscale',
      icon: '◐',
      apply(c, { width, height }) {
        const copy = new OffscreenCanvas(width, height);
        copy.getContext('2d').drawImage(c.canvas, 0, 0);
        c.clearRect(0, 0, width, height);
        c.filter = 'grayscale(1)';
        c.drawImage(copy, 0, 0);
        c.filter = 'none';
      },
    });

    // ---- commands ----
    ctx.commands.register({ id: 'stats', title: 'Chat insights: open the panel', shortcut: 'Ctrl+Alt+I', keywords: ['stats'],
      when: () => !!ctx.data.activeChat(), run: () => ctx.panels.open('stats') });
    ctx.commands.register({ id: 'bookmarks', title: 'Bookmarks', shortcut: 'Ctrl+Alt+B', run: () => ctx.views.open('bookmarks') });
    ctx.commands.register({ id: 'clear', title: 'Chat insights: clear all bookmarks', run: async () => {
      if (await ui.confirm({ title: 'Clear bookmarks?', message: `All ${state.bookmarks.length} bookmarks will be removed.`, confirmLabel: 'Clear', danger: true }))
        saveBookmarks([]);
    } });

    ctx.log.info('started', state.bookmarks.length, 'bookmarks, API', ctx.apiVersion, 'app', ctx.app.version);
  },
};
