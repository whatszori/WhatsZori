import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, RefreshCw, Smartphone } from 'lucide-react';
import { backend, devControls } from '../../api';
import { formatPairingCode, isValidPhone } from '../../lib/format';
import { useConnection } from '../../stores/connection';
import { Button, Input, Logo, Spinner } from '../../ui';
import { QRCode } from './QRCode';
import './AuthScreen.css';

type Mode = 'qr' | 'phone';

function useCountdown(receivedAt: number | undefined, ttl: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  if (!receivedAt || !ttl) return 0;
  return Math.max(0, Math.ceil((receivedAt + ttl - now) / 1000));
}

function errorText(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : 'Something went wrong';
}

function QRPanel({ onPhone }: { onPhone: () => void }) {
  const qr = useConnection((s) => s.qr);
  const authError = useConnection((s) => s.authError);
  const secs = useCountdown(qr?.receivedAt, qr?.expiresIn);

  const start = () =>
    void backend.auth
      .startQRLogin()
      .catch((err) => useConnection.getState().setAuthError(errorText(err)));

  useEffect(start, []);

  return (
    <>
      <h1 className="wz-auth__title">Link this device</h1>
      <ol className="wz-auth__steps">
        <li>Open WhatsApp on your phone</li>
        <li>Go to Settings, then Linked devices</li>
        <li>Tap Link a device and point the camera here</li>
      </ol>
      <div className="wz-auth__qr-wrap">
        {authError ? (
          <div className="wz-auth__qr wz-auth__qr--loading">
            <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={start}>
              Get a new code
            </Button>
          </div>
        ) : qr && devControls ? (
          <button
            type="button"
            className="wz-auth__qr"
            onClick={() => devControls?.simulateScan()}
            aria-label="QR code. In the mock build, click to simulate a scan."
            title="Mock: click to simulate a scan"
          >
            <QRCode code={qr.code} />
          </button>
        ) : qr ? (
          <div className="wz-auth__qr" role="img" aria-label="QR code to scan with your phone">
            <QRCode code={qr.code} />
          </div>
        ) : (
          <div className="wz-auth__qr wz-auth__qr--loading">
            <Spinner size={20} />
          </div>
        )}
        <p
          className={authError ? 'wz-auth__error' : 'wz-auth__refresh'}
          role={authError ? 'alert' : undefined}
          aria-live="polite"
        >
          {authError ?? (qr ? `Code refreshes in ${secs}s` : 'Generating code…')}
        </p>
      </div>
      <Button variant="ghost" icon={<Smartphone size={16} />} onClick={onPhone}>
        Link with phone number instead
      </Button>
    </>
  );
}

function PhonePanel({ onBack }: { onBack: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the login socket timed out while we waited for the phone
  const expired = useConnection((s) => s.authError);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidPhone(phone)) {
      setError('Enter the full number including the country code.');
      return;
    }
    setBusy(true);
    setError(null);
    useConnection.getState().setAuthError(null);
    try {
      setCode(await backend.auth.pairWithPhone(phone));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const grouped = code ? formatPairingCode(code).split('-') : [];

  return (
    <>
      <h1 className="wz-auth__title">
        {code ? 'Enter this code on your phone' : 'Link with phone number'}
      </h1>
      {code ? (
        <>
          <p className="wz-auth__hint">
            On your phone open Linked devices, tap Link with phone number instead, and type:
          </p>
          <div
            className="wz-auth__code wz-mono wz-selectable"
            aria-label={`Pairing code ${code.split('').join(' ')}`}
          >
            {grouped.map((g, i) => (
              <span key={i} className="wz-auth__code-group">
                {g}
              </span>
            ))}
          </div>
          {expired ? (
            <>
              <p className="wz-auth__error" role="alert">
                {expired}
              </p>
              <Button
                variant="secondary"
                icon={<RefreshCw size={16} />}
                onClick={() => {
                  useConnection.getState().setAuthError(null);
                  setCode(null);
                }}
              >
                Try again
              </Button>
            </>
          ) : (
            <p className="wz-auth__waiting">
              <Spinner size={14} /> Waiting for your phone…
            </p>
          )}
        </>
      ) : (
        <form className="wz-auth__form" onSubmit={submit} noValidate>
          <label htmlFor="wz-phone" className="wz-auth__label">
            Phone number
          </label>
          <Input
            id="wz-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+49 170 1234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus
            aria-invalid={!!error}
            aria-describedby={error ? 'wz-phone-error' : undefined}
          />
          {error && (
            <p id="wz-phone-error" className="wz-auth__error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy || !phone.trim()}>
            {busy ? <Spinner size={14} /> : 'Get code'}
          </Button>
        </form>
      )}
      <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={onBack}>
        Use QR code instead
      </Button>
    </>
  );
}

function Disclaimer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="wz-auth__disclaimer">
      <p>
        WhatsZori is an unofficial client that uses an unofficial protocol.{' '}
        <button
          type="button"
          className="wz-link-button"
          aria-expanded={open}
          aria-controls="wz-disclaimer-full"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Show less' : 'Learn more'}
        </button>
      </p>
      {open && (
        <p id="wz-disclaimer-full" className="wz-auth__disclaimer-full">
          WhatsZori is not made, endorsed or supported by WhatsApp or Meta. It talks to WhatsApp
          servers the same way a linked device does, through a reverse-engineered protocol. WhatsApp
          may change that protocol at any time, which can break features, and using third-party
          clients may be against their terms of service and can, in rare cases, lead to your account
          being restricted. Your messages stay end-to-end encrypted and are stored only on this
          computer.
        </p>
      )}
    </div>
  );
}

export function AuthScreen() {
  const state = useConnection((s) => s.auth.state);
  const [mode, setMode] = useState<Mode>('qr');

  const busy = state === 'logging-in';

  return (
    <main className="wz-auth">
      <div className="wz-auth__card">
        <Logo className="wz-auth__logo" height={30} />
        {busy ? (
          <div className="wz-auth__busy" role="status">
            <Spinner size={20} />
            <p>Linking and syncing your chats…</p>
          </div>
        ) : mode === 'qr' ? (
          <QRPanel onPhone={() => setMode('phone')} />
        ) : (
          <PhonePanel onBack={() => setMode('qr')} />
        )}
      </div>
      <Disclaimer />
    </main>
  );
}
