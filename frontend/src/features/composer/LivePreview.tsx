import { forwardRef, useMemo } from 'react';
import { hasFormatting, sourceSpans } from '../../lib/markdown';

// Formatting shown as you type: a layer over the textarea draws the same text with markers
// dimmed and bold, strike and code styled, while the textarea's own text goes transparent (its
// caret and selection stay). Nothing here may change a glyph's width, or the caret would drift:
// bold is a stroke, italic a tint.
export const LivePreview = forwardRef<HTMLDivElement, { text: string }>(function LivePreview(
  { text },
  ref,
) {
  const spans = useMemo(() => (hasFormatting(text) ? sourceSpans(text) : null), [text]);
  if (!spans) return null;
  return (
    <div ref={ref} className="wz-composer__preview" aria-hidden="true">
      {spans.map((s, i) =>
        s.cls ? (
          <span
            key={i}
            className={s.cls
              .split(' ')
              .map((c) => `wz-lp-${c}`)
              .join(' ')}
          >
            {s.v}
          </span>
        ) : (
          s.v
        ),
      )}
      {/* a trailing newline needs something after it to take up its line */}
      {'​'}
    </div>
  );
});
