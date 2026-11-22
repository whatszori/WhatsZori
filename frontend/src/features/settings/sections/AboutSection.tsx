import { useState } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import { backend } from '../../../api';
import { useConnection } from '../../../stores/connection';
import { useUI } from '../../../stores/ui';
import { Button, Dialog, Logo } from '../../../ui';
import { Group, Page } from './common';

export function AboutSection() {
  const me = useConnection((s) => s.auth.me);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const logout = (wipe: boolean) => {
    useUI.getState().closeSettings();
    void backend.auth.logout(wipe);
  };
  return (
    <Page title="About">
      <div className="wz-settings-group">
        <Logo height={34} />
        <p className="wz-about__version">
          Version {__APP_VERSION__} ·{' '}
          {backend.kind === 'wails' ? 'desktop app' : 'browser preview with mock backend'}
        </p>
      </div>
      <Group title="Disclaimer">
        <p className="wz-setting-row wz-setting-row__desc">
          WhatsZori is an unofficial client. It is not made, endorsed or supported by WhatsApp or
          Meta, and it uses a reverse-engineered protocol that can change or break at any time.
          Using third-party clients may be against WhatsApp’s terms of service.
        </p>
      </Group>
      <Group title="Links">
        <ul className="wz-about__links">
          <li>
            <a
              href="https://github.com/whatszori/WhatsZori"
              target="_blank"
              rel="noreferrer noopener"
            >
              Source code
            </a>
          </li>
          <li>
            <a
              href="https://github.com/whatszori/WhatsZori/issues"
              target="_blank"
              rel="noreferrer noopener"
            >
              Report a problem
            </a>
          </li>
          <li>
            <a
              href="https://github.com/whatszori/plugin-sdk"
              target="_blank"
              rel="noreferrer noopener"
            >
              Plugin SDK
            </a>
          </li>
        </ul>
      </Group>
      <Group title="Account">
        <div className="wz-setting-row">
          <div>
            <div className="wz-setting-row__label">{me?.phone ?? 'Not linked'}</div>
            <p className="wz-setting-row__desc">
              Unlinks this computer. Local history stays on disk.
            </p>
          </div>
          <Button variant="danger" icon={<LogOut size={16} />} onClick={() => logout(false)}>
            Log out
          </Button>
        </div>
        <div className="wz-setting-row">
          <div>
            <div className="wz-setting-row__label">Delete local data</div>
            <p className="wz-setting-row__desc">
              Logs out and deletes every chat, kept deleted message, edit history and downloaded
              file from this computer.
            </p>
          </div>
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setConfirmWipe(true)}>
            Delete…
          </Button>
        </div>
      </Group>
      <Dialog
        open={confirmWipe}
        title="Log out and delete local data?"
        onClose={() => setConfirmWipe(false)}
        footer={
          <>
            <Button onClick={() => setConfirmWipe(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => logout(true)}>
              Delete and log out
            </Button>
          </>
        }
      >
        <p className="wz-dialog-text">
          Messages that were deleted for everyone, and old versions of edited messages, exist only
          here. They can't be brought back. Your chats on the phone are not affected.
        </p>
      </Dialog>
    </Page>
  );
}
