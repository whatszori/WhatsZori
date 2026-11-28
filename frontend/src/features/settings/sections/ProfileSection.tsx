import { useState, type FormEvent } from 'react';
import { useUI } from '../../../stores/ui';
import { Check, Pencil, Phone, User, Info } from 'lucide-react';
import { useConnection } from '../../../stores/connection';
import { useProfile } from '../../../stores/profile';
import { Avatar, IconButton, Input, useLayer } from '../../../ui';
import { Page } from './common';

function EditableField({
  icon,
  label,
  value,
  hint,
  maxLength,
  onSave,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  maxLength: number;
  onSave: (v: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = draft !== null;
  // while editing, Esc cancels the edit instead of closing settings
  useLayer(editing, () => {
    setDraft(null);
    setError(null);
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft === null) return;
    try {
      await onSave(draft);
      setDraft(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <div className="wz-profile-field">
      <span className="wz-profile-field__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="wz-profile-field__main">
        <div className="wz-profile-field__label">{label}</div>
        {editing ? (
          <form className="wz-profile-field__form" onSubmit={submit}>
            <Input
              aria-label={label}
              value={draft}
              maxLength={maxLength}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              trailing={<span className="wz-profile-field__count">{maxLength - draft.length}</span>}
            />
            <IconButton type="submit" label="Save" icon={<Check size={18} />} />
          </form>
        ) : (
          <div className="wz-profile-field__value-row">
            <span className="wz-profile-field__value wz-selectable">{value || '—'}</span>
            <IconButton
              label={`Edit ${label.toLowerCase()}`}
              size="sm"
              icon={<Pencil size={15} />}
              onClick={() => setDraft(value)}
            />
          </div>
        )}
        {error && (
          <p className="wz-profile-field__error" role="alert">
            {error}
          </p>
        )}
        {hint && !editing && <p className="wz-profile-field__hint">{hint}</p>}
      </div>
    </div>
  );
}

export function ProfileSection() {
  const profile = useProfile((s) => s.profile);
  const myJid = useConnection((s) => s.auth.me?.jid);
  const { setName, setAbout } = useProfile.getState();

  return (
    <Page title="Profile">
      <div className="wz-profile">
        <div className="wz-profile__avatar">
          <button
            type="button"
            className="wz-avatar-open"
            aria-label="Show your profile picture"
            disabled={!myJid}
            onClick={() =>
              myJid && useUI.getState().setAvatarViewer({ jid: myJid, name: profile.name || 'You' })
            }
          >
            <Avatar name={profile.name || profile.phone} jid={myJid} size={128} />
          </button>
        </div>
        <EditableField
          icon={<User size={18} />}
          label="Name"
          value={profile.name}
          maxLength={25}
          hint="Shown to people who haven't saved your number."
          onSave={setName}
        />
        <EditableField
          icon={<Info size={18} />}
          label="About"
          value={profile.about}
          maxLength={139}
          onSave={setAbout}
        />
        <div className="wz-profile-field">
          <span className="wz-profile-field__icon" aria-hidden="true">
            <Phone size={18} />
          </span>
          <div className="wz-profile-field__main">
            <div className="wz-profile-field__label">Phone</div>
            <div className="wz-profile-field__value wz-selectable">{profile.phone}</div>
          </div>
        </div>
      </div>
    </Page>
  );
}
