import { Pipette } from 'lucide-react';
import type { AppSettings, Message } from '../../../api';
import { useSettings } from '../../../stores/settings';
import { ACCENT_PRESETS, resolveTheme } from '../../../theme/theme-manager';
import { Segmented, Toggle } from '../../../ui';
import { Bubble } from '../../conversation/Bubble';
import '../../conversation/Bubble.css';
import { Group, Page, Row } from './common';

type Appearance = AppSettings['appearance'];

const noop = () => undefined;
const now = Date.now();
const PREVIEW: Message[] = [
  {
    pk: 'p1',
    id: 'p1',
    chatJid: 'x',
    senderJid: 'a',
    senderName: 'Anna',
    fromMe: false,
    timestamp: now - 120_000,
    kind: 'text',
    text: 'Does the new accent work for you?',
    reactions: [],
  },
  {
    pk: 'p2',
    id: 'p2',
    chatJid: 'x',
    senderJid: 'me',
    senderName: 'You',
    fromMe: true,
    timestamp: now - 60_000,
    kind: 'text',
    text: 'Calm enough. Keeping it.',
    status: 'read',
    reactions: [],
  },
];

export function AppearanceSection() {
  const a = useSettings((s) => s.settings.appearance);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<Appearance>) =>
    update((s) => ({ ...s, appearance: { ...s.appearance, ...patch } }));
  const theme = resolveTheme(a.theme);
  const isCustom = !!a.accent && a.accent.startsWith('#');
  // with a theme on and no accent picked, the theme's own accent is in use, not a preset
  const themed = useSettings((s) => Object.values(s.settings.themes).some(Boolean));

  return (
    <Page title="Appearance" lead="Changes apply right away.">
      <Group>
        <Row label="Theme" description="System follows your OS light or dark setting.">
          <Segmented
            label="Theme"
            value={a.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
        </Row>
        <Row
          label="Accent color"
          description={
            themed && !a.accent && !a.useSystemAccent
              ? 'Using the active theme’s accent. Pick one to override it.'
              : 'Used for selection, your messages and badges.'
          }
          id="wz-accent-label"
          stack
        >
          <div className="wz-swatches" role="radiogroup" aria-labelledby="wz-accent-label">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={
                  !a.useSystemAccent &&
                  (a.accent === p.id || (!a.accent && !themed && p.id === 'slate'))
                }
                aria-label={p.name}
                title={p.name}
                disabled={a.useSystemAccent}
                className="wz-swatch"
                style={{ ['--wz-swatch' as string]: p[theme] }}
                onClick={() => set({ accent: p.id })}
              />
            ))}
            <label
              className="wz-swatch wz-swatch--custom"
              title="Custom color"
              style={
                isCustom
                  ? { ['--wz-swatch' as string]: a.accent!, background: a.accent! }
                  : undefined
              }
            >
              {!isCustom && <Pipette size={14} strokeWidth={1.75} />}
              <input
                type="color"
                aria-label="Custom accent color"
                disabled={a.useSystemAccent}
                value={isCustom ? a.accent! : '#3d6fb4'}
                onChange={(e) => set({ accent: e.target.value })}
              />
            </label>
          </div>
          <Toggle
            label="Use system accent color"
            description="Takes the accent from your OS. Mocked in this build."
            checked={a.useSystemAccent}
            onChange={(useSystemAccent) => set({ useSystemAccent })}
          />
        </Row>
      </Group>

      <Group title="Layout">
        <Row
          label="Window layout"
          description={
            (a.layout ?? 'panels') === 'rail'
              ? 'Icon rail on the left, settings open inside the sidebar.'
              : 'Sidebar and content, settings open in the content area.'
          }
        >
          <Segmented
            label="Window layout"
            value={a.layout ?? 'panels'}
            onChange={(layout) => set({ layout })}
            options={[
              { value: 'panels', label: 'Panels' },
              { value: 'rail', label: 'Rail' },
            ]}
          />
        </Row>
      </Group>

      <Group title="Messages">
        <Row label="Density" description="Compact fits more chats and messages on screen.">
          <Segmented
            label="Density"
            value={a.density}
            onChange={(density) => set({ density })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Row>
        <Row label="Text size">
          <div className="wz-range">
            <input
              type="range"
              min={0.85}
              max={1.25}
              step={0.05}
              value={a.fontScale}
              aria-label="Text size"
              aria-valuetext={`${Math.round(a.fontScale * 100)}%`}
              onChange={(e) => set({ fontScale: Number(e.target.value) })}
            />
            <output>{Math.round(a.fontScale * 100)}%</output>
          </div>
        </Row>
        <div className="wz-preview" aria-hidden="true">
          {PREVIEW.map((m) => (
            <Bubble
              key={m.pk}
              message={m}
              showSender={false}
              groupStart
              groupEnd
              highlighted={false}
              onMenu={noop}
              onReact={noop}
              onJump={noop}
              onHistory={noop}
            />
          ))}
        </div>
      </Group>
    </Page>
  );
}
