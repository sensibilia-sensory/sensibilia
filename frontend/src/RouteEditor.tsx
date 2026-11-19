import type { ChoiceStep, FormStep, Route, StudyForm } from './api';
import { defaultRoute } from './flow';

export function RouteEditor({
  form,
  step,
  change,
}: {
  form: StudyForm;
  step: FormStep;
  change: (route: Route) => void;
}) {
  const index = form.steps.findIndex((item) => item.id === step.id);
  const route = step.route ?? defaultRoute();
  const choices = form.steps
    .slice(0, index + 1)
    .filter((item): item is ChoiceStep => item.kind === 'choice');
  const source = choices.find((item) => item.id === route.condition?.source_step_id);
  const destinations = [
    { id: 'next', title: 'Next block' },
    ...form.steps.slice(index + 1),
    { id: 'complete', title: 'Finish session' },
    { id: 'screen_out', title: 'End without tasting / screen out' },
  ];
  function destination(label: string, value: string, update: (value: string) => void) {
    return (
      <label className="field-label route-destination">
        {label}
        <select aria-label={label} value={value} onChange={(event) => update(event.target.value)}>
          {!destinations.some((item) => item.id === value) && (
            <option value={value}>Missing destination — choose another</option>
          )}
          {destinations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title || 'Untitled block'}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <section className="route-editor">
      <div className="section-row">
        <h3>After this block</h3>
        <span className="pill neutral">Forward routes</span>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={!!route.condition}
          disabled={!choices.length}
          onChange={(event) =>
            change(
              event.target.checked
                ? {
                    ...route,
                    condition: {
                      source_step_id: choices.at(-1)!.id,
                      option_ids: [choices.at(-1)!.options[0].id],
                      match: 'any',
                    },
                  }
                : { condition: null, then: 'next', otherwise: route.otherwise },
            )
          }
        />{' '}
        Use an if / else rule
      </label>
      {!choices.length && (
        <p className="field-help">Add a choice block before this one to use a condition.</p>
      )}
      {route.condition ? (
        <>
          <label className="field-label">
            If the answer to
            <select
              value={route.condition.source_step_id}
              onChange={(event) => {
                const choice = choices.find((item) => item.id === event.target.value)!;
                change({
                  ...route,
                  condition: {
                    source_step_id: choice.id,
                    option_ids: [choice.options[0].id],
                    match: 'any',
                  },
                });
              }}
            >
              {!source && (
                <option value={route.condition.source_step_id}>
                  Missing choice — choose another
                </option>
              )}
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.title}
                  {choice.id === step.id ? ' (this block)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Matches
            <select
              value={route.condition.match}
              onChange={(event) =>
                change({
                  ...route,
                  condition: { ...route.condition!, match: event.target.value as 'any' | 'all' },
                })
              }
            >
              <option value="any">Any selected option below</option>
              <option value="all">All selected options below</option>
            </select>
          </label>
          <fieldset className="route-options">
            <legend>Options to match</legend>
            {source?.options.map((option) => (
              <label className="checkbox-label" key={option.id}>
                <input
                  type="checkbox"
                  checked={route.condition!.option_ids.includes(option.id)}
                  onChange={(event) =>
                    change({
                      ...route,
                      condition: {
                        ...route.condition!,
                        option_ids: event.target.checked
                          ? [...route.condition!.option_ids, option.id]
                          : route.condition!.option_ids.filter((id) => id !== option.id),
                      },
                    })
                  }
                />
                {option.label || 'Untitled option'}
              </label>
            ))}
          </fieldset>
          <div className="route-targets">
            {destination('Then go to', route.then, (then) => change({ ...route, then }))}
            {destination('Else go to', route.otherwise, (otherwise) =>
              change({ ...route, otherwise }),
            )}
          </div>
        </>
      ) : (
        destination('Continue to', route.otherwise, (otherwise) => change({ ...route, otherwise }))
      )}
    </section>
  );
}
