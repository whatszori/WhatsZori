import { Users } from 'lucide-react';
import { initials, nameHue } from '../lib/format';
import './Avatar.css';

interface AvatarProps {
  name: string;
  size?: number;
  group?: boolean;
  online?: boolean;
}

export function Avatar({ name, size = 40, group, online }: AvatarProps) {
  const text = initials(name);
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
      {text || <Users size={Math.round(size * 0.45)} strokeWidth={1.75} />}
      {online && <span className="wz-avatar__online" />}
    </span>
  );
}
