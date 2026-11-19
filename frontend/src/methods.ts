import type {
  Configuration,
  MethodConfiguration,
  NewConfiguration,
  PublicAssignment,
  Sample,
  StudyTest,
} from './api';

export function isHedonic(config: MethodConfiguration): config is Configuration {
  return !('kind' in config);
}
export function testQuestions(test: StudyTest) {
  return 'questions' in test.configuration ? test.configuration.questions : [];
}
export function testSummary(test: StudyTest) {
  const config = test.configuration;
  if ('questions' in config) return config.questions[0]?.prompt || 'Untitled test';
  return `${config.sample_ids.length} samples · ${config.kind?.replaceAll('_', ' ')}`;
}
export function defaultConfiguration(methodId: string, samples: Sample[]): NewConfiguration {
  const ids = samples.map((sample) => sample.id);
  const base = {
    instructions: 'Evaluate the samples according to the instructions below.',
    sample_ids: ids,
  };
  switch (methodId) {
    case 'tcata-v1':
      return {
        ...base,
        kind: 'tcata',
        sample_ids: [],
        instructions:
          'Select every attribute that applies and deselect it when it stops applying. Several attributes may apply at once.',
        attributes: [{ id: 'attribute_1', prompt: '', required: true }],
        start_instruction: 'Follow the reviewed sampling instruction when you press Start.',
        duration_ms: 30000,
        required_tolerance_ms: 50,
        multi_active: true,
        capture: 'transitions',
        allow_skips: false,
      };
    case 'cata-v1':
      return {
        ...base,
        kind: 'cata',
        instructions:
          'Check all attributes that apply to this sample. Leave attributes that do not apply unchecked.',
        questions: [{ id: 'attribute_1', prompt: '', required: true }],
        allow_skips: false,
      };
    case 'rata-v1':
      return {
        ...base,
        kind: 'rata',
        instructions:
          'Check the attributes that apply to this sample, then rate each selected attribute.',
        questions: [{ id: 'attribute_1', prompt: '', required: true }],
        allow_skips: false,
        rating_target: 'intensity',
        rating_min: 1,
        scale_labels: ['Low', 'Medium', 'High'],
        require_ratings: true,
      };
    case 'jar-v1':
      return {
        ...base,
        kind: 'jar',
        instructions:
          'For each attribute, indicate whether the sample has too little, just about the right amount, or too much.',
        questions: [{ id: 'attribute_1', prompt: '', required: true }],
        allow_skips: false,
        scale_labels: [
          'Much too little',
          'Too little',
          'Just about right',
          'Too much',
          'Much too much',
        ],
      };
    case 'triangle-v1':
      return {
        ...base,
        kind: 'triangle',
        sample_ids: ids.slice(0, 2),
        instructions:
          'Evaluate the three coded samples from left to right. Two are the same product. Choose the sample that is different. If uncertain, make your best choice.',
        purpose: 'difference',
      };
    case 'duo-trio-v1':
      return {
        ...base,
        kind: 'duo_trio',
        sample_ids: ids.slice(0, 2),
        instructions:
          'Evaluate the reference first, then the two coded samples from left to right. Choose the sample that matches the reference. If uncertain, make your best choice.',
        purpose: 'difference',
        reference_mode: 'balanced',
        reference_sample_id: null,
      };
    case 'two-afc-v1':
      return {
        ...base,
        kind: 'two_afc',
        sample_ids: ids.slice(0, 2),
        instructions:
          'Evaluate the two coded samples from left to right, then answer the question below. You must choose one sample, even if the difference is small.',
        task: 'directional',
        question: '',
        expected_sample_id: ids[0] ?? null,
      };
    case 'flash-profile-v1':
      return {
        ...base,
        kind: 'flash_profile',
        instructions: 'Evaluate all samples comparatively.',
        descriptor_instructions:
          'Generate your own sensory descriptors that distinguish these samples. Use non-hedonic terms.',
        ranking_instructions:
          'Rank all samples for each descriptor from lowest to highest perceived intensity. Rank 1 is lowest. Use consecutive ranks; equal intensities may share a rank when ties are enabled.',
        min_attributes: 1,
        max_attributes: 20,
        allow_ties: true,
        rank_direction: 'increasing_intensity',
        rank_encoding: 'dense',
      };
    case 'napping-v1':
      return {
        ...base,
        kind: 'napping',
        instructions:
          'Place the coded samples on the blank map according to their overall sensory similarity. Similar samples should be closer together and different samples farther apart. Use your own criteria and the whole available space.',
        canvas_width: 60,
        canvas_height: 40,
        coordinate_units: 'cm_equivalent',
        collect_descriptions: false,
      };
    default:
      throw new Error('This method does not have a renderer.');
  }
}

/** A representative rehearsal only. Actual serving orders are frozen by the server. */
export function previewAssignment(config: NewConfiguration, samples: Sample[]): PublicAssignment {
  const ids = config.sample_ids.map((id) => ({
    slot_id: id,
    sample_id: id,
    code: samples.find((sample) => sample.id === id)?.code || id.slice(0, 8),
  }));
  if (config.kind === 'triangle')
    return {
      kind: config.kind,
      samples: ['317', '582', '946'].map((code, i) => ({ slot_id: `s${i + 1}`, code })),
      reference: null,
    };
  if (config.kind === 'two_afc')
    return {
      kind: config.kind,
      samples: ['317', '582'].map((code, i) => ({ slot_id: `s${i + 1}`, code })),
      reference: null,
    };
  if (config.kind === 'duo_trio')
    return {
      kind: config.kind,
      samples: ['317', '582'].map((code, i) => ({ slot_id: `s${i + 1}`, code })),
      reference: { slot_id: 'reference', code: '946' },
    };
  return { kind: config.kind || '', samples: ids, reference: null };
}
