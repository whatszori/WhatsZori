import { User, Users } from 'lucide-react';
import { initials, nameHue } from '../lib/format';
import './Avatar.css';

interface AvatarProps {
  name: string;
  size?: number;
  group?: boolean;
  online?: boolean;
}

// unsaved contacts are just a number; digits as initials look like a badge, so use a silhouette
const PHONE_LIKE = /^\+?[\d\s().-]+$/;

export function Avatar({ name, size = 40, group, online }: AvatarProps) {
  const text = PHONE_LIKE.test(name.trim()) ? '' : initials(name);
  const Fallback = group ? Users : User;
  return (
    <span
      className={`wz-avatar${group ? ' wz-avatar--group' : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        ['--wz-avatar-hue' as string]: nameHue(name),
      }}
      aria-hidden="true"
    >
      {text || <Fallback size={Math.round(size * 0.5)} strokeWidth={1.75} />}
      {online && <span className="wz-avatar__online" />}
    </span>
  );
}
