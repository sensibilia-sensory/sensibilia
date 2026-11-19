import type { FormStep, Route, StepValue, StudyForm, StudyTest } from './api';

export const defaultRoute = (): Route => ({ condition: null, then: 'next', otherwise: 'next' });
export const code = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;

export function defaultForm(tests: StudyTest[]): StudyForm {
  return {
    schema_version: 1,
    completion_message: 'Thank you for participating.',
    screen_out_message: 'Your session has ended. Please contact the researcher.',
    steps: tests.map((test) => ({
      kind: 'test',
      id: code('test'),
      title: `Test ${test.position + 1}`,
      study_test_id: test.id,
      layout: 'cards',
      route: defaultRoute(),
    })),
  };
}

export function nextStep(
  form: StudyForm,
  step: FormStep,
  values: Record<string, StepValue>,
): string {
  const route = step.route ?? defaultRoute();
  let target = route.otherwise;
  if (route.condition) {
    const answer = values[route.condition.source_step_id];
    if (!answer || answer.state !== 'answered')
      throw new Error('This route depends on an unanswered choice. Check the flow.');
    const matches =
      route.condition.match === 'all'
        ? route.condition.option_ids.every((id) => answer.selected.includes(id))
        : route.condition.option_ids.some((id) => answer.selected.includes(id));
    if (matches) target = route.then;
  }
  if (target === 'next')
    return form.steps[form.steps.findIndex((item) => item.id === step.id) + 1]?.id ?? 'complete';
  return target;
}

/** Mirrors contract checks for useful immediate feedback; the server remains authoritative. */
export function flowErrors(form: StudyForm, tests: StudyTest[], requireAllTests = true): string[] {
  const errors: string[] = [];
  const ids = form.steps.map((step) => step.id);
  if (!ids.length) return ['Add at least one block.'];
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => ['next', 'complete', 'screen_out'].includes(id))
  )
    errors.push('Block codes must be unique and cannot use reserved destinations.');
  const refs = form.steps.filter((step) => step.kind === 'test').map((step) => step.study_test_id);
  if (new Set(refs).size !== refs.length)
    errors.push('Use each configured sensory test only once.');
  if (refs.some((id) => !tests.some((test) => test.id === id)))
    errors.push('A sensory test block refers to a test outside this version.');
  if (requireAllTests && tests.some((test) => !refs.includes(test.id)))
    errors.push('Include every configured sensory test before publishing.');
  const incoming = new Map<string, Set<string>[]>([[ids[0], [new Set()]]]);
  for (const [index, step] of form.steps.entries()) {
    const title = step.title || `Block ${index + 1}`;
    if (!step.title.trim()) errors.push(`${title}: enter a title.`);
    if (
      step.kind === 'instruction' &&
      (!step.text.trim() || !step.continue_label.trim() || step.acknowledgement_label === '')
    )
      errors.push(`${title}: complete the instruction text and button/acknowledgment labels.`);
    if (step.kind === 'choice') {
      if (
        !step.prompt.trim() ||
        step.options.some((option) => !option.label.trim()) ||
        step.options.length < 2
      )
        errors.push(`${title}: complete the question and at least two options.`);
      if (new Set(step.options.map((option) => option.id)).size !== step.options.length)
        errors.push(`${title}: option codes must be unique.`);
    }
    if (step.kind === 'matrix') {
      if (
        !step.instructions.trim() ||
        !step.rows.length ||
        step.rows.some((row) => !row.prompt.trim()) ||
        step.scale.length < 2 ||
        step.scale.some((option) => !option.label.trim())
      )
        errors.push(`${title}: complete the instructions, rows, and scale labels.`);
      if (
        new Set(step.rows.map((row) => row.id)).size !== step.rows.length ||
        new Set(step.scale.map((option) => option.id)).size !== step.scale.length
      )
        errors.push(`${title}: row and scale codes must be unique.`);
    }
    const paths = incoming.get(step.id);
    const before = new Set(paths?.[0] ?? []);
    for (const set of paths ?? []) for (const id of before) if (!set.has(id)) before.delete(id);
    const route = step.route ?? defaultRoute();
    const condition = route.condition;
    if (condition) {
      const source = form.steps.find((item) => item.id === condition.source_step_id);
      if (
        !source ||
        source.kind !== 'choice' ||
        ids.indexOf(source.id) > index ||
        (source.id !== step.id && !before.has(source.id))
      )
        errors.push(`${title}: route needs a choice guaranteed to be answered before this block.`);
      else if (
        !condition.option_ids.length ||
        condition.option_ids.some((id) => !source.options.some((option) => option.id === id))
      )
        errors.push(`${title}: select existing options for the route condition.`);
      else if (!source.multiple && condition.match === 'all' && condition.option_ids.length > 1)
        errors.push(`${title}: a single choice cannot match all of several options.`);
    }
    const after = new Set(before);
    if (step.kind === 'choice') after.add(step.id);
    for (const destination of [route.otherwise, ...(condition ? [route.then] : [])]) {
      const target = destination === 'next' ? (ids[index + 1] ?? 'complete') : destination;
      if (['complete', 'screen_out'].includes(target)) continue;
      if (!ids.includes(target) || ids.indexOf(target) <= index)
        errors.push(`${title}: choose a later block or a session ending.`);
      else if (paths) incoming.set(target, [...(incoming.get(target) ?? []), after]);
    }
    if (!paths) errors.push(`${title}: no route reaches this block.`);
  }
  if (!form.completion_message.trim() || !form.screen_out_message.trim())
    errors.push('Complete both ending messages.');
  return errors;
}
