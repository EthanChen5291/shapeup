import { describe, expect, it } from 'vitest';
import { displayName } from './displayName';

describe('displayName', () => {
  it('prefers the chosen username, then first name, then the email local part', () => {
    expect(displayName('ethan', 'Ethan', 'e@x.com')).toBe('ethan');
    expect(displayName(undefined, 'Ethan', 'e@x.com')).toBe('Ethan');
    expect(displayName('  ', null, 'chen.ethan@gmail.com')).toBe('chen.ethan');
  });
  it('is undefined when nothing is known yet', () => {
    expect(displayName(undefined, undefined, undefined)).toBeUndefined();
  });
});
