import type { components } from '../../../api-schema';
export type Configuration = Required<components['schemas']['HedonicConfiguration']>;
export function configurationErrors(config: Configuration): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!config.instructions.trim() || config.instructions.length > 10000)
    errors.instructions = 'Instructions need 1–10000 characters.';
  if (config.questions.length < 1 || config.questions.length > 100)
    errors.questions = 'Add 1–100 questions.';
  const ids = new Set<string>();
  config.questions.forEach((q, i) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(q.id) || ids.has(q.id))
      errors['questions.' + i + '.id'] = 'Use a unique stable identifier.';
    ids.add(q.id);
    if (!q.prompt.trim() || q.prompt.length > 2000)
      errors['questions.' + i + '.prompt'] = 'Prompt needs 1–2000 characters.';
  });
  if (config.scale_labels.length !== 9)
    errors.scale_labels =
      'Nine-point hedonic acceptance needs nine labels. Add the missing scale label.';
  // Steps between the ends may be left unnamed; they then show only their number.
  config.scale_labels.forEach((label, i) => {
    const end = i === 0 || i === config.scale_labels.length - 1;
    if (label.length > 200) errors['scale_labels.' + i] = 'Use at most 200 characters.';
    else if (end && !label.trim())
      errors['scale_labels.' + i] = 'Name the first and last step so the direction is clear.';
  });
  return errors;
}
export function answersValid(config: Configuration, answers: Record<string, number | 'skipped'>) {
  return config.questions.every((q) => {
    const v = answers[q.id];
    return v === undefined
      ? !q.required
      : v === 'skipped'
        ? config.allow_skips === true
        : Number.isInteger(v) && v >= 1 && v <= 9;
  });
}
