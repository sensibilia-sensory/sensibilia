import { ChoiceScale, Button, type ScaleLayout } from '../../../ui';
export { configurationErrors, answersValid, type Configuration } from './validation';
import type { Configuration } from './validation';
export function HedonicRenderer({
  configuration,
  answers,
  onChange,
  disabled = false,
  layout,
}: {
  layout?: ScaleLayout;
  disabled?: boolean;
  configuration: Configuration;
  answers: Record<string, number | 'skipped'>;
  onChange: (id: string, value: number | 'skipped') => void;
}) {
  return (
    <div className="ui-stack">
      <p>{configuration.instructions}</p>
      {configuration.questions.map((q) => (
        <div key={q.id} className="ui-stack">
          <ChoiceScale
            disabled={disabled}
            layout={layout}
            label={q.prompt + (q.required ? ' *' : '')}
            value={answers[q.id]}
            options={configuration.scale_labels.map((label, i) => ({ value: i + 1, label }))}
            onChange={(v) => onChange(q.id, Number(v))}
          />
          {configuration.allow_skips && (
            <Button disabled={disabled} onClick={() => onChange(q.id, 'skipped')}>
              Skip {q.prompt}
            </Button>
          )}
          {answers[q.id] === 'skipped' && <p role="status">Explicitly skipped</p>}
        </div>
      ))}
    </div>
  );
}
export const editorLabels = {
  instructions: 'Instructions',
  questions: 'Questions',
  scale_labels: 'Scale labels',
  allow_skips: 'Allow skips',
};
