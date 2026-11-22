import { useState } from 'react';
import { Sparkles, Terminal } from 'lucide-react';
import { IconButton, MenuItem } from '../ui';
import { register } from './slots';
import type { SlotProps } from './types';

const ID = 'wz-demo';

function HeaderAction({ chat }: SlotProps['chat.header.actions']) {
  const [on, setOn] = useState(false);
  return (
    <IconButton
      label={on ? `Demo plugin active for ${chat.name}` : 'Demo plugin action'}
      icon={<Sparkles size={18} />}
      active={on}
      onClick={() => setOn((v) => !v)}
    />
  );
}

function ContextItem({ message, close }: SlotProps['message.contextMenu']) {
  return (
    <MenuItem
      label="Demo: log to console"
      icon={<Terminal />}
      onSelect={() => {
        console.info('[wz-demo] message', message);
        close();
      }}
    />
  );
}

function Broken(): never {
  throw new Error('deliberately broken demo plugin');
}

function Footer() {
  return <p className="wz-demo-footer">Demo plugins loaded. One is broken on purpose and hidden.</p>;
}

function SettingsBlock() {
  return (
    <p className="wz-setting-row__desc">
      The demo plugin registered this block through the <code>settings.sections</code> slot.
    </p>
  );
}

export function registerDemoPlugins(): () => void {
  const offs = [
    register('chat.header.actions', ID, HeaderAction),
    register('message.contextMenu', ID, ContextItem),
    register('composer.actions', 'wz-demo-broken', Broken),
    register('sidebar.footer', ID, Footer),
    register('settings.sections', ID, SettingsBlock),
  ];
  return () => offs.forEach((off) => off());
}
