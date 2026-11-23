// A WhatsZori plugin, plain JavaScript with no build step. Copy the quick-replies folder into
// <config>/plugins and turn it on in Settings → Plugins. See docs/PLUGINS.md.

const DEFAULTS = ['On my way!', 'Can I call you later?', 'Thanks, got it 👍'];

export default {
  async start(ctx) {
    // use the app's React, never a bundled copy, or hooks break
    const { React, ui } = ctx;
    const h = React.createElement;

    let replies = DEFAULTS;
    const saved = (await ctx.settings.all()).replies;
    if (saved) {
      try {
        replies = JSON.parse(saved);
      } catch {
        ctx.log.warn('ignoring broken saved replies');
      }
    }
    const listeners = new Set();
    const setReplies = (next) => {
      replies = next;
      listeners.forEach((fn) => fn(next));
      void ctx.settings.set('replies', JSON.stringify(next));
    };
    const useReplies = () => {
      const [list, setList] = React.useState(replies);
      React.useEffect(() => {
        listeners.add(setList);
        return () => listeners.delete(setList);
      }, []);
      return list;
    };

    // next to the emoji button: each click inserts the next reply into the message box
    function ComposerButton() {
      const list = useReplies();
      const [i, setI] = React.useState(0);
      if (list.length === 0) return null;
      const text = list[i % list.length];
      return h(ui.IconButton, {
        label: `Insert “${text}”`,
        icon: h('span', { 'aria-hidden': true, style: { fontSize: 16 } }, '⚡'),
        onClick: () => {
          ctx.actions.insertIntoComposer(text);
          setI(i + 1);
        },
      });
    }

    // in Settings → Plugins → Plugin settings
    function Settings() {
      const list = useReplies();
      const [draft, setDraft] = React.useState(list.join('\n'));
      return h(
        'label',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 16px' } },
        h('span', null, 'Quick replies, one per line'),
        h('textarea', {
          rows: 4,
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          onBlur: () =>
            setReplies(
              draft
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          style: { font: 'inherit', padding: 8, borderRadius: 6 },
        }),
      );
    }

    // message menu: quote the message into the box
    function QuoteItem({ message, close }) {
      return h(ui.MenuItem, {
        label: 'Quote in reply',
        icon: h('span', { 'aria-hidden': true }, '❝'),
        onSelect: () => {
          ctx.actions.insertIntoComposer(`> ${message.text}\n`);
          close();
        },
      });
    }

    ctx.registerSlot('composer.actions', ComposerButton);
    ctx.registerSlot('settings.sections', Settings);
    ctx.registerSlot('message.contextMenu', QuoteItem);

    // the storage API: count how many times WhatsZori started us
    const runs = Number((await ctx.storage.get('runs')) ?? 0) + 1;
    await ctx.storage.set('runs', String(runs));
    ctx.log.info(`started (run ${runs})`);

    // slots and event handlers are removed for us; return anything else to clean up
    return () => ctx.log.info('stopped');
  },
};
