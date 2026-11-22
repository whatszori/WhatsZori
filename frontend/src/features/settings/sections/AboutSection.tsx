import { LogOut } from 'lucide-react';
import { backend } from '../../../api';
import { useConnection } from '../../../stores/connection';
import { useUI } from '../../../stores/ui';
import { Button } from '../../../ui';
import { Group, Page } from './common';

export function AboutSection() {
  const me = useConnection((s) => s.auth.me);
  return (
    <Page title="About">
      <div className="wz-settings-group">
        <div className="wz-wordmark">WhatsZori</div>
        <p className="wz-about__version">
          Version {__APP_VERSION__} · frontend preview with mock backend
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
          <Button
            variant="danger"
            icon={<LogOut size={16} />}
            onClick={() => {
              useUI.getState().closeSettings();
              void backend.auth.logout();
            }}
          >
            Log out
          </Button>
        </div>
      </Group>
    </Page>
  );
}
