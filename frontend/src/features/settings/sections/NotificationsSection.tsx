import { useEffect, useState } from 'react';
import { BellRing, Info } from 'lucide-react';
import { backend, type AppSettings } from '../../../api';
import { useSettings } from '../../../stores/settings';
import { toastError } from '../../../stores/toasts';
import { Button, Segmented, Toggle } from '../../../ui';
import { Group, Page } from './common';

type Notifications = AppSettings['notifications'];

export function NotificationsSection() {
  const n = useSettings((s) => s.settings.notifications);
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<Notifications>) =>
    update((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));
  const [available, setAvailable] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState('');
  useEffect(() => {
    void backend.system
      .platform()
      .then(setPlatform)
      .catch(() => {});
  }, []);
  // WhatsZori's own popups exist on Windows only (Wayland doesn't let a window pick its place)
  const canStyle = platform === 'windows';
  const style = n.style === 'auto' ? (canStyle ? 'whatszori' : 'system') : n.style;

  useEffect(() => {
    let alive = true;
    backend.notifications
      .available()
      .then((v) => alive && setAvailable(v))
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Page title="Notifications" lead="Desktop notifications for new messages.">
      <Group>
        <Toggle
          label="Show notifications"
          description="For new messages while WhatsZori is in the background, or in a chat you don’t have open. Muted chats stay quiet."
          checked={n.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        <Toggle
          label="Show sender and text"
          description="Off: the notification only says there’s a new message, so nobody looking at your screen can read it."
          checked={n.preview}
          disabled={!n.enabled}
          onChange={(preview) => set({ preview })}
        />
        <Toggle
          label="Sound"
          checked={n.sound}
          disabled={!n.enabled}
          onChange={(sound) => set({ sound })}
        />
        {canStyle && (
          <div className="wz-setting-row">
            <div>
              <div className="wz-setting-row__label">Look</div>
              <p className="wz-setting-row__desc">
                WhatsZori’s own notifications follow your theme and plugins. Windows’ notifications
                go to the Action Center.
              </p>
            </div>
            <Segmented
              label="Notification look"
              size="sm"
              value={style}
              options={[
                { value: 'whatszori', label: 'WhatsZori' },
                { value: 'system', label: 'Windows' },
              ]}
              onChange={(v) => set({ style: v })}
            />
          </div>
        )}
      </Group>
      <Group>
        <div className="wz-setting-row">
          <div>
            <div className="wz-setting-row__label">Test</div>
            <p className="wz-setting-row__desc">
              {available === false
                ? backend.kind === 'wails'
                  ? 'This desktop has no notification service running.'
                  : 'Desktop notifications work in the desktop app.'
                : 'Shows a sample notification.'}
            </p>
          </div>
          <Button
            icon={<BellRing size={16} />}
            disabled={!available}
            onClick={() => void backend.notifications.test().catch(toastError)}
          >
            Send test
          </Button>
        </div>
      </Group>
      {backend.kind === 'wails' && (
        <Group title="Window">
          <Toggle
            label="Keep running in the tray"
            description="Closing the window hides it; WhatsZori keeps receiving messages and notifying. Quit from the tray icon."
            checked={settings.tray.closeToTray}
            onChange={(closeToTray) => update((s) => ({ ...s, tray: { ...s.tray, closeToTray } }))}
          />
        </Group>
      )}
      <p className="wz-note">
        <Info size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>
          Reply right from the notification on Windows and KDE Plasma. On GNOME, Reply opens the
          chat ready to type. Messages that arrived while WhatsZori was offline are summed up in one
          notification instead of one each.
        </span>
      </p>
    </Page>
  );
}
