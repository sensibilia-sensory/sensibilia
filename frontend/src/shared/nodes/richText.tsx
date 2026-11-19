import type { ReactNode } from 'react';

/**
 * The small amount of formatting a researcher may use in an Information text:
 *   - a blank line starts a new paragraph, a single line break stays a line break;
 *   - `**bold**`, `*italic*` and `***both***`; a backslash shows a literal asterisk (`\*`).
 * Nothing else is interpreted: no HTML, links or images. Text is rendered as React text, never as
 * markup, so what a researcher types cannot inject anything into the tablet screen.
 */
export type RichInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em'; children: RichInline[] }
  | { kind: 'break' };
export type RichBlock = RichInline[];

// Order matters: the three-star form first, then two, then one, so `***x***` is bold and italic.
const inline = /\\([*\\])|\*\*\*(\S|\S.*?\S)\*\*\*|\*\*(\S|\S.*?\S)\*\*|\*(\S|\S.*?\S)\*/g;

function parseInline(source: string): RichInline[] {
  const out: RichInline[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const tail = out.at(-1);
    if (tail?.kind === 'text') tail.text += text;
    else out.push({ kind: 'text', text });
  };
  for (const match of source.matchAll(inline)) {
    push(source.slice(last, match.index));
    const [, escaped, both, bold, italic] = match;
    if (escaped !== undefined) push(escaped);
    else if (both !== undefined)
      out.push({ kind: 'strong', children: [{ kind: 'em', children: parseInline(both) }] });
    else if (bold !== undefined) out.push({ kind: 'strong', children: parseInline(bold) });
    else out.push({ kind: 'em', children: parseInline(italic) });
    last = match.index + match[0].length;
  }
  push(source.slice(last));
  return out;
}

/** Paragraphs separated by blank lines; inside a paragraph every line break is kept. */
export function parseRichText(source: string): RichBlock[] {
  return source
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ''))
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph) =>
      paragraph
        .split('\n')
        .flatMap((line, i): RichInline[] => [
          ...(i ? [{ kind: 'break' } as RichInline] : []),
          ...parseInline(line),
        ]),
    );
}

/** The characters a formatted text shows, without markers; for previews and tests. */
export function plainRichText(source: string): string {
  const flat = (parts: RichInline[]): string =>
    parts
      .map((p) => (p.kind === 'text' ? p.text : p.kind === 'break' ? '\n' : flat(p.children)))
      .join('');
  return parseRichText(source).map(flat).join('\n\n');
}

/**
 * Formatted text as paragraphs. `map` is applied to every piece of text after parsing (for the
 * sample-code placeholders), so a substituted value is never read as formatting.
 */
export function RichText({
  value,
  map = (text) => text,
  className,
}: {
  value: string;
  map?: (text: string) => string;
  className?: string;
}) {
  const render = (parts: RichInline[]): ReactNode[] =>
    parts.map((part, i) =>
      part.kind === 'text' ? (
        map(part.text)
      ) : part.kind === 'break' ? (
        <br key={i} />
      ) : part.kind === 'strong' ? (
        <strong key={i}>{render(part.children)}</strong>
      ) : (
        <em key={i}>{render(part.children)}</em>
      ),
    );
  return (
    <>
      {parseRichText(value).map((block, i) => (
        <p key={i} className={className}>
          {render(block)}
        </p>
      ))}
    </>
  );
}
