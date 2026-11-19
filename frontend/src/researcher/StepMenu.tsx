import { Popover } from '../ui';
import { Button } from '../ui';
import type { components } from '../api-schema';
import { setMethods } from '../shared/methods/registry';
import { stepKindHelp, stepKindLabel } from '../shared/lexicon';
import type { nodeKinds } from '../shared/nodes/authoring';

type Method = components['schemas']['TestTypeRead'];
type Kind = (typeof nodeKinds)[number];

const groups: { title: string; kinds: Kind[] }[] = [
  {
    title: 'Questions and text',
    kinds: ['info', 'consent', 'question', 'matrix_question', 'confirm', 'code_entry'],
  },
  { title: 'Structure', kinds: ['group', 'loop_samples', 'serve_gate', 'end'] },
];

type MenuProps = {
  methods: Method[];
  onMethod: (id: string) => void;
  onKind: (kind: Kind) => void;
  onBlock: () => void;
};

/** The menu contents: sensory methods first, then other steps. */
export function StepMenuContent({ methods, onMethod, onKind, onBlock }: MenuProps) {
  return (
    <div className="ui-step-menu">
      <section aria-label="Sensory methods">
        <h3>Sensory methods</h3>
        {methods.map((m) => (
          <Button
            key={m.id}
            variant="quiet"
            className="ui-popover-item"
            data-method-id={m.id}
            onClick={() => onMethod(m.id)}
          >
            {m.name}
            {setMethods.has(m.id) && <span className="ui-hint"> · needs chosen products</span>}
          </Button>
        ))}
      </section>
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h3>{g.title}</h3>
          {g.kinds.map((kind) => (
            <Button
              key={kind}
              variant="quiet"
              className="ui-popover-item"
              title={stepKindHelp[kind]}
              onClick={() => onKind(kind)}
            >
              {stepKindLabel[kind]}
            </Button>
          ))}
        </section>
      ))}
      <section aria-label="Reuse">
        <h3>Reuse</h3>
        <Button variant="quiet" className="ui-popover-item" onClick={onBlock}>
          Questionnaire block…
        </Button>
      </section>
    </div>
  );
}

/** One menu for everything that can be added. */
export function StepMenu({ disabled, ...menu }: MenuProps & { disabled: boolean }) {
  return (
    <Popover label="Add step" disabled={disabled} closeOnSelect>
      <StepMenuContent {...menu} />
    </Popover>
  );
}
