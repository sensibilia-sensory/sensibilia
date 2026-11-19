import { Button, Field, Toolbar } from '../../ui';
import type { Node } from '../flow';

type Info = Extract<Node, { kind: 'info' }>;

/**
 * The text of an Information step: several lines, with Bold and Italic for the selected words.
 * The text is stored as typed (`**bold**`, `*italic*`, blank line = new paragraph), see richText.tsx.
 */
export function InfoTextEditor({
  node,
  language,
  disabled = false,
  inLoop = false,
  error,
  onChange,
}: {
  node: Info;
  language: string;
  disabled?: boolean;
  /** Inside a sample loop, where $SAMPLE shows the code of the sample being served. */
  inLoop?: boolean;
  error?: string;
  onChange: (node: Node) => void;
}) {
  const id = node.id + '-schema-body';
  const value = node.data.body[language] ?? '';
  const set = (next: string) =>
    onChange({ ...node, data: { ...node.data, body: { ...node.data.body, [language]: next } } });
  /** Wrap the selected words (or the place of the cursor) in `mark` and keep the selection. */
  const wrap = (mark: string) => {
    const box = document.getElementById(id) as HTMLTextAreaElement | null;
    if (!box) return;
    const from = box.selectionStart,
      to = box.selectionEnd;
    const chosen = value.slice(from, to);
    // Already wrapped: take the marks off again.
    const wrapped =
      value.slice(from - mark.length, from) === mark && value.slice(to, to + mark.length) === mark;
    const next = wrapped
      ? value.slice(0, from - mark.length) + chosen + value.slice(to + mark.length)
      : value.slice(0, from) + mark + chosen + mark + value.slice(to);
    const start = from + (wrapped ? -mark.length : mark.length);
    set(next);
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(start, start + chosen.length);
    });
  };
  /** Put $SAMPLE where the cursor is (it replaces any selected text). */
  const insertSample = () => {
    const box = document.getElementById(id) as HTMLTextAreaElement | null;
    const from = box?.selectionStart ?? value.length;
    const to = box?.selectionEnd ?? value.length;
    set(value.slice(0, from) + '$SAMPLE' + value.slice(to));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(from + 7, from + 7);
    });
  };
  return (
    <div className="ui-stack">
      <Toolbar label="Text formatting">
        <Button compact disabled={disabled} aria-label="Bold" onClick={() => wrap('**')}>
          <strong>B</strong> Bold
        </Button>
        <Button compact disabled={disabled} aria-label="Italic" onClick={() => wrap('*')}>
          <em>i</em> Italic
        </Button>
        {inLoop && (
          <Button compact disabled={disabled} onClick={insertSample}>
            Insert sample code
          </Button>
        )}
      </Toolbar>
      <Field
        id={id}
        kind="textarea"
        rows={8}
        label="Text"
        value={value}
        disabled={disabled}
        error={error}
        hint={`Press Enter for a new line and leave a blank line between paragraphs. Select words and use Bold or Italic. You can also type **bold** and *italic*; to show a star itself, type \\* instead.${
          inLoop ? ' Type $SAMPLE to show the code of the sample being served.' : ''
        }`}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );
}
