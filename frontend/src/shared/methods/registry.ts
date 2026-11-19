import type { MethodValue, NewConfiguration, PublicAssignment } from '../../api';
import {
  configurationErrors as hedonicErrors,
  type Configuration as HedonicConfiguration,
} from './hedonic_acceptance_9/validation';
export type Configuration = HedonicConfiguration | NewConfiguration;
export const setMethods = new Set([
  'triangle-v1',
  'duo-trio-v1',
  'two-afc-v1',
  'flash-profile-v1',
  'napping-v1',
]);
export const registeredMethods = new Set([
  'hedonic-9-v1',
  'cata-v1',
  'rata-v1',
  'jar-v1',
  'tcata-v1',
  ...setMethods,
]);
export function configurationErrors(config: Configuration): Record<string, string> {
  if (!('kind' in config)) return hedonicErrors(config);
  const errors: Record<string, string> = {};
  if (!config.instructions.trim()) errors.instructions = 'Review nonblank instructions.';
  if (new Set(config.sample_ids).size !== config.sample_ids.length)
    errors.sample_ids = 'Samples must be distinct.';
  if (config.kind === 'tcata') {
    if (!config.start_instruction.trim()) errors.start_instruction = 'Review the start cue.';
    if (
      !Number.isInteger(config.duration_ms) ||
      config.duration_ms < 1000 ||
      config.duration_ms > 600000
    )
      errors.duration_ms = 'Use 1000–600000 ms.';
    if (
      !Number.isInteger(config.required_tolerance_ms) ||
      config.required_tolerance_ms < 1 ||
      config.required_tolerance_ms > 1000
    )
      errors.required_tolerance_ms = 'Use an explicit timing tolerance.';
    if (
      !config.attributes.length ||
      config.attributes.length > 30 ||
      new Set(config.attributes.map((a) => a.id)).size !== config.attributes.length
    )
      errors.attributes = 'Use 1–30 distinct attributes.';
    config.attributes.forEach((a, i) => {
      if (!a.prompt.trim() || !/^[A-Za-z0-9_-]+$/.test(a.id))
        errors['attributes.' + i + '.prompt'] = 'Review attribute ID and wording.';
    });
  }
  if ('questions' in config) {
    if (!config.questions.length || config.questions.length > 100)
      errors.questions = 'Use 1–100 attributes.';
    if (new Set(config.questions.map((q) => q.id)).size !== config.questions.length)
      errors.questions = 'Attribute IDs must be unique.';
    config.questions.forEach((q, i) => {
      if (!q.prompt.trim())
        errors['questions.' + i + '.prompt'] = 'Review nonblank attribute text.';
      if (!/^[A-Za-z0-9_-]+$/.test(q.id))
        errors['questions.' + i + '.id'] = 'Use a stable attribute ID.';
    });
  }
  if (
    'scale_labels' in config &&
    (!scaleNamesValid(config.scale_labels ?? [], config.kind === 'jar') ||
      (config.kind === 'jar'
        ? ![3, 5, 7].includes(config.scale_labels!.length)
        : config.scale_labels!.length < 2 || config.scale_labels!.length > 11))
  )
    errors.scale_labels = 'Review the registered scale categories.';
  if (setMethods.has(config.kind.replaceAll('_', '-') + '-v1') && config.sample_ids.length < 2)
    errors.sample_ids = 'Choose at least two samples.';
  if (
    (config.kind === 'triangle' || config.kind === 'duo_trio' || config.kind === 'two_afc') &&
    config.sample_ids.length !== 2
  )
    errors.sample_ids = 'Choose exactly two products.';
  if (
    config.kind === 'duo_trio' &&
    config.reference_mode === 'constant' &&
    !config.sample_ids.includes(config.reference_sample_id ?? '')
  )
    errors.reference_sample_id = 'Choose the constant reference product.';
  if (config.kind === 'two_afc') {
    if (!config.question.trim()) errors.question = 'Write the question the assessor answers.';
    if (
      config.task === 'directional' &&
      !config.sample_ids.includes(config.expected_sample_id ?? '')
    )
      errors.expected_sample_id = 'Choose the product expected to have more of the attribute.';
    if (config.task === 'preference' && config.expected_sample_id)
      errors.expected_sample_id = 'A preference test has no expected product.';
  }
  if (
    config.kind === 'flash_profile' &&
    (!(config.min_attributes! >= 1) ||
      config.max_attributes! < config.min_attributes! ||
      config.max_attributes! > 50 ||
      config.sample_ids.length > 30)
  )
    errors.min_attributes = 'Review descriptor limits and sample count.';
  return errors;
}
export function methodAssignment(
  config: NewConfiguration,
  variables: Record<string, unknown>,
  frozen?: PublicAssignment,
): PublicAssignment {
  if ('questions' in config || config.kind === 'tcata')
    return {
      kind: config.kind,
      samples:
        typeof variables['sample.code'] === 'string'
          ? [{ slot_id: 'current', code: variables['sample.code'] as string }]
          : [],
      reference: null,
    };
  if (!frozen) throw new Error('Frozen set assignment is missing.');
  return frozen;
}

export type Descriptor = { id: string; term: string; ranks: Record<string, number> };
export function descriptorTermsValid(
  config: Extract<NewConfiguration, { kind: 'flash_profile' }>,
  attributes: Descriptor[],
) {
  return (
    attributes.length >= config.min_attributes! &&
    attributes.length <= config.max_attributes! &&
    attributes.every(
      (a) => a.term.trim() && a.term.trim().length <= 500 && /^[A-Za-z0-9_-]+$/.test(a.id),
    ) &&
    new Set(attributes.map((a) => a.id)).size === attributes.length &&
    new Set(attributes.map((a) => a.term.trim().toLowerCase())).size === attributes.length
  );
}
export function descriptorRanksValid(
  config: Extract<NewConfiguration, { kind: 'flash_profile' }>,
  assignment: PublicAssignment,
  attributes: Descriptor[],
) {
  return attributes.every((attr) => {
    const ranks = assignment.samples.map((s) => attr.ranks[s.sample_id!]);
    const unique = new Set(ranks);
    return (
      Object.keys(attr.ranks).length === assignment.samples.length &&
      ranks.every((r) => Number.isInteger(r) && r >= 1 && r <= assignment.samples.length) &&
      [...unique].sort((a, b) => a - b).every((r, i) => r === i + 1) &&
      (config.allow_ties || unique.size === ranks.length)
    );
  });
}
/** Shared frontend validity; server frozen-method validation remains authoritative. */
export function methodValuesValid(
  config: NewConfiguration,
  answers: Record<string, MethodValue>,
  assignment?: PublicAssignment,
) {
  if (config.kind === 'tcata') return false;
  if ('questions' in config)
    return (
      Object.keys(answers).every((id) => config.questions.some((q) => q.id === id)) &&
      config.questions.every((q) => {
        const value = answers[q.id];
        if (!value) return !q.required;
        if (!('kind' in value) || value.kind !== config.kind) return false;
        if (value.state === 'skipped') return !!config.allow_skips;
        if (config.kind === 'cata')
          return value.state === 'selected' || value.state === 'unselected';
        if (config.kind === 'rata' && value.kind === 'rata')
          return value.state === 'unselected'
            ? value.rating == null
            : value.state === 'selected' &&
                (value.rating == null
                  ? !config.require_ratings
                  : Number.isInteger(value.rating) &&
                    value.rating >= config.rating_min! &&
                    value.rating < config.rating_min! + config.scale_labels!.length);
        return (
          config.kind === 'jar' &&
          value.kind === 'jar' &&
          value.state === 'rated' &&
          Number.isInteger(value.rating) &&
          value.rating! >= 1 &&
          value.rating! <= config.scale_labels!.length
        );
      })
    );
  const key =
    config.kind === 'flash_profile' ? 'profile' : config.kind === 'napping' ? 'map' : 'choice';
  const value = answers[key];
  if (
    Object.keys(answers).length !== 1 ||
    !value ||
    !('kind' in value) ||
    value.kind !== config.kind
  )
    return false;
  if (config.kind === 'triangle' || config.kind === 'duo_trio' || config.kind === 'two_afc')
    return (
      value.state === 'chosen' &&
      'selected_slot_id' in value &&
      (assignment
        ? assignment.samples.map((s) => s.slot_id)
        : config.kind === 'triangle'
          ? ['s1', 's2', 's3']
          : ['s1', 's2']
      ).includes(value.selected_slot_id)
    );
  if (
    config.kind === 'flash_profile' &&
    value.kind === 'flash_profile' &&
    value.state === 'profile'
  )
    return (
      descriptorTermsValid(config, value.attributes) &&
      descriptorRanksValid(
        config,
        assignment ?? {
          kind: config.kind,
          samples: config.sample_ids.map((id) => ({ slot_id: id, sample_id: id, code: id })),
          reference: null,
        },
        value.attributes,
      )
    );
  if (config.kind === 'napping' && value.kind === 'napping' && value.state === 'mapped')
    return (
      Object.keys(value.points).length === config.sample_ids.length &&
      config.sample_ids.every((id) => {
        const p = value.points[id];
        return (
          p &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          p.x >= 0 &&
          p.x <= 60 &&
          p.y >= 0 &&
          p.y <= 40 &&
          (config.collect_descriptions || !p.description) &&
          (p.description?.length ?? 0) <= 2000
        );
      })
    );
  return false;
}

/** Unnamed steps are allowed between the ends (and the centre of a JAR scale), as on the server. */
export function scaleNamesValid(labels: string[], centre: boolean) {
  if (!labels.length || labels.some((l) => l.length > 200)) return false;
  const required = new Set([
    0,
    labels.length - 1,
    ...(centre ? [Math.floor(labels.length / 2)] : []),
  ]);
  return [...required].every((i) => labels[i].trim());
}
