import { afterEach, describe, expect, it } from 'vitest';
import { getEntries, register, resetSlots } from './slots';

describe('slot registry', () => {
  afterEach(resetSlots);

  it('registers and unregisters entries in order', () => {
    const A = () => null;
    const B = () => null;
    const offA = register('sidebar.footer', 'a', A);
    register('sidebar.footer', 'b', B);
    expect(getEntries('sidebar.footer').map((e) => e.pluginId)).toEqual(['a', 'b']);
    offA();
    expect(getEntries('sidebar.footer').map((e) => e.pluginId)).toEqual(['b']);
    expect(getEntries('composer.actions')).toEqual([]);
  });

  it('returns a new array after a change so subscribers re-render', () => {
    const before = getEntries('sidebar.header');
    register('sidebar.header', 'x', () => null);
    expect(getEntries('sidebar.header')).not.toBe(before);
  });
});
