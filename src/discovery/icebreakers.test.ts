import { describe, it, expect } from 'vitest';
import { icebreakerFor } from './icebreakers';

describe('icebreakerFor', () => {
  it('returns null when nothing is shared', () => {
    expect(icebreakerFor([], 123)).toBeNull();
  });

  it('returns null when the only shared ids are unknown', () => {
    expect(icebreakerFor(['bogus', 'nope'], 1)).toBeNull();
  });

  it('is deterministic for a given seed', () => {
    const a = icebreakerFor(['jazz'], 42);
    const b = icebreakerFor(['jazz'], 42);
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it('uses the first known shared tag, skipping unknowns', () => {
    const opener = icebreakerFor(['unknown-tag', 'coffee'], 0);
    expect(opener).toContain('coffee');
  });

  it('prefers a bespoke template when one exists for the tag', () => {
    // 'climbing' has specific templates that mention climbing/crags.
    const opener = icebreakerFor(['climbing'], 0)!;
    expect(opener.toLowerCase()).toMatch(/climb|crag|boulder/);
  });

  it('falls back to a generic, label-filled opener for tags without bespoke copy', () => {
    // 'guitar' has no specific template → generic template with the label.
    const opener = icebreakerFor(['guitar'], 0)!;
    expect(opener.toLowerCase()).toContain('guitar');
  });

  it('handles a non-finite seed without throwing', () => {
    expect(() => icebreakerFor(['jazz'], Number.NaN)).not.toThrow();
    expect(icebreakerFor(['jazz'], Number.NaN)).not.toBeNull();
  });
});
