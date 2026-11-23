import { useState } from 'react';
import { User, Users } from 'lucide-react';
import { backend, type JID } from '../api';
import { initials, nameHue } from '../lib/format';
import { missingAvatars, useAvatars } from '../stores/avatars';
import './Avatar.css';

interface AvatarProps {
  name: string;
  // with a jid the real picture is shown when there is one; initials stay as the fallback
  jid?: JID;
  size?: number;
  group?: boolean;
  online?: boolean;
}

// unsaved contacts are just a number; digits as initials look like a badge, so use a silhouette
const PHONE_LIKE = /^\+?[\d\s().-]+$/;

// the preview from WhatsApp is ~96 px; bigger avatars ask for the full picture
const FULL_FROM = 72;

function useAvatarUrl(jid: JID | undefined, size: number): string {
  const version = useAvatars((s) => (jid ? (s.versions[jid] ?? 0) : 0));
  if (!jid) return '';
  const url = backend.media.avatarUrl(jid, size >= FULL_FROM);
  if (!url || !version) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
}

export function Avatar({ name, jid, size = 40, group, online }: AvatarProps) {
  const text = PHONE_LIKE.test(name.trim()) ? '' : initials(name);
  const Fallback = group ? Users : User;
  const url = useAvatarUrl(jid, size);
  const [loaded, setLoaded] = useState('');
  const [, setMissing] = useState(0);
  const showImg = url !== '' && !missingAvatars.has(url);
  return (
    <span
      className={`wz-avatar${group ? ' wz-avatar--group' : ''}${loaded === url && showImg ? ' wz-avatar--photo' : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        ['--wz-avatar-hue' as string]: nameHue(name),
      }}
      aria-hidden="true"
    >
      {text || <Fallback size={Math.round(size * 0.5)} strokeWidth={1.75} />}
      {showImg && (
        <img
          key={url}
          className="wz-avatar__img"
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(url)}
          onError={() => {
            missingAvatars.add(url);
            setMissing((n) => n + 1);
          }}
        />
      )}
      {online && <span className="wz-avatar__online" />}
    </span>
  );
}
