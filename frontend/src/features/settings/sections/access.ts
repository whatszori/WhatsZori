// How much a plugin can learn or do, from its permissions and sites. The approval dialog and the
// marketplace cards use the same rules, so a plugin looks as risky in both places.

// 2 = sensitive (reads private things or reaches out), 1 = changes things, 0 = harmless
export const RISK: Record<string, 2 | 1 | 0> = {
  messages: 2,
  contacts: 2,
  presence: 2,
  network: 2,
  media: 1,
  composer: 1,
  'chats.manage': 1,
  files: 1,
  notifications: 0,
  clipboard: 0,
};

// what the Allow button names, so pressing it means saying it
export const VERB: Record<string, string> = {
  messages: 'your messages',
  contacts: 'contacts',
  presence: 'online status',
  network: 'internet',
};

// the permissions that read something private, and how to say what they read
export const READS: Record<string, string> = {
  messages: 'your messages',
  contacts: 'your contacts',
  presence: 'who’s online',
};

export type Level = 'high' | 'some' | 'little';

export const LEVEL: Record<Level, { title: string; short: string; text: string }> = {
  high: {
    title: 'High access',
    short: 'High access',
    text: 'It can read private things and send them out of WhatsZori. Allow it only if you know who made it and why it needs this.',
  },
  some: {
    title: 'Some access',
    short: 'Some access',
    text: 'It can see or change some of your data, as listed below.',
  },
  little: {
    title: 'Little access',
    short: 'Little access',
    text: 'It only adds things to the app.',
  },
};

// reading plus a way out, or most of the sensitive list: that's high
export function accessLevel(permissions: string[], network: string[]): Level {
  const risky = permissions.filter((x) => RISK[x] === 2);
  const leaks = permissions.some((x) => READS[x]) && network.length > 0;
  if (leaks || risky.length >= 3) return 'high';
  return permissions.length > 0 ? 'some' : 'little';
}

export const andList = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
