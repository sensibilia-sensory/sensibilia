import type { MatrixStep, Selection } from './api';

/** One shared scale, one answer per stable row; compact row cards on small screens. */
export function MatrixRenderer({
  step,
  answers,
  change,
}: {
  step: MatrixStep;
  answers: Record<string, Selection>;
  change: (row: string, answer: Selection) => void;
}) {
  return (
    <div
      className="matrix-scroll"
      role="region"
      aria-label={`${step.title} response matrix`}
      tabIndex={0}
    >
      <table className="response-matrix">
        <caption>{step.instructions}</caption>
        <thead>
          <tr>
            <th scope="col">Question</th>
            {step.scale.map((option) => (
              <th key={option.id} scope="col">
                {option.label || 'Scale label'}
              </th>
            ))}
            {step.allow_skips && <th scope="col">Skip</th>}
          </tr>
        </thead>
        <tbody>
          {step.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                {row.prompt || 'Question'}
                <span className="row-required">{row.required ? 'Required' : 'Optional'}</span>
              </th>
              {step.scale.map((option) => (
                <td key={option.id}>
                  <label className="matrix-option">
                    <input
                      type="radio"
                      name={`matrix-${step.id}-${row.id}`}
                      aria-label={`${row.prompt || 'Question'}: ${option.label || 'Scale label'}`}
                      checked={
                        answers[row.id]?.state === 'selected' &&
                        answers[row.id]?.option_id === option.id
                      }
                      onChange={() => change(row.id, { state: 'selected', option_id: option.id })}
                    />
                    <span className="matrix-mobile-label">{option.label || 'Scale label'}</span>
                  </label>
                </td>
              ))}
              {step.allow_skips && (
                <td>
                  <label className="matrix-option">
                    <input
                      type="radio"
                      name={`matrix-${step.id}-${row.id}`}
                      aria-label={`${row.prompt || 'Question'}: Skip`}
                      checked={answers[row.id]?.state === 'skipped'}
                      onChange={() => change(row.id, { state: 'skipped', option_id: null })}
                    />
                    <span className="matrix-mobile-label">Skip</span>
                  </label>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
