// Translate: a sandboxed plugin. "Translate" in a message's menu sends that one message's text to
// the translator picked in the settings (through WhatsZori, to the hosts in the manifest only)
// and shows the result under the message. Nothing is sent on its own.

const NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
const langName = (code) => {
  try {
    return NAMES.of(code) || code;
  } catch {
    return code;
  }
};

async function google(ctx, text, target) {
  const q = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dt: 't', q: text });
  const res = await ctx.net.fetch(`https://translate.googleapis.com/translate_a/single?${q}`);
  if (!res.ok) throw new Error(`Google answered ${res.status}`);
  const data = await res.json();
  const out = (data[0] || []).map((part) => part[0] || '').join('');
  return { text: out, from: data[2] || '', by: 'Google' };
}

async function deepl(ctx, text, target) {
  const key = String((await ctx.settings.get('deeplKey')) || '').trim();
  if (!key) throw new Error('add your DeepL key in the plugin’s settings');
  const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const body = new URLSearchParams({ text, target_lang: target.toUpperCase() });
  const res = await ctx.net.fetch(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}` },
    body,
  });
  if (res.status === 403) throw new Error('DeepL refused the key');
  if (res.status === 456) throw new Error('the DeepL quota for this month is used up');
  if (!res.ok) throw new Error(`DeepL answered ${res.status}`);
  const t = (await res.json()).translations?.[0];
  return { text: t?.text || '', from: (t?.detected_source_language || '').toLowerCase(), by: 'DeepL' };
}

export default {
  async start(ctx) {
    // pk -> { loading, text, from, by, error }
    const shown = new Map();

    async function target() {
      const t = String((await ctx.settings.get('target')) || 'auto');
      if (t !== 'auto') return t;
      // no navigator in the sandbox; Intl knows the locale
      return new Intl.DateTimeFormat().resolvedOptions().locale.split('-')[0] || 'en';
    }

    async function translate(message) {
      shown.set(message.pk, { loading: true });
      ctx.invalidate();
      try {
        const to = await target();
        const provider = String((await ctx.settings.get('provider')) || 'google');
        const r = provider === 'deepl' ? await deepl(ctx, message.text, to) : await google(ctx, message.text, to);
        if (!r.text) throw new Error('the translator sent nothing back');
        shown.set(message.pk, { ...r, same: r.from && r.from === to });
      } catch (err) {
        shown.set(message.pk, { error: String(err.message || err) });
      }
      ctx.invalidate();
    }

    ctx.registerSlot('message.contextMenu', ({ message, close }) => {
      if (!message.text || !message.text.trim()) return null;
      const on = shown.has(message.pk);
      return {
        t: 'menuItem',
        label: on ? 'Hide translation' : 'Translate',
        icon: '🌐',
        onClick: () => {
          close();
          if (on) {
            shown.delete(message.pk);
            ctx.invalidate();
          } else {
            void translate(message);
          }
        },
      };
    });

    ctx.registerSlot('message.accessories', ({ message }) => {
      const s = shown.get(message.pk);
      if (!s) return null;
      if (s.loading)
        return { t: 'row', gap: 6, children: [{ t: 'spinner' }, { t: 'text', text: 'Translating…', muted: true, size: 'sm' }] };
      const hide = { t: 'button', label: 'Hide', variant: 'ghost', size: 'sm', onClick: () => { shown.delete(message.pk); ctx.invalidate(); } };
      if (s.error)
        return { t: 'row', gap: 6, children: [
          { t: 'text', text: `Couldn’t translate: ${s.error}`, muted: true, size: 'sm' },
          { t: 'button', label: 'Try again', variant: 'ghost', size: 'sm', onClick: () => void translate(message) },
          hide,
        ] };
      return { t: 'stack', gap: 2, children: [
        { t: 'text', text: s.text, size: 'sm' },
        { t: 'row', gap: 6, children: [
          { t: 'text', size: 'sm', muted: true,
            text: s.same ? `Already in ${langName(s.from)} · ${s.by}` : `🌐 From ${s.from ? langName(s.from) : 'another language'} · ${s.by}` },
          { t: 'button', label: 'Copy', variant: 'ghost', size: 'sm', onClick: async () => { await ctx.clipboard.writeText(s.text); ctx.actions.toast('Translation copied'); } },
          hide,
        ] },
      ] };
    });
  },
};
