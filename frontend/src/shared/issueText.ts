/** Laboratory wording for release-check findings. The raw message and code stay in the technical columns. */
export interface IssueText {
  problem: string;
  fix: string;
}

const text: Record<string, IssueText> = {
  empty_methods: {
    problem: 'The study has no sensory test.',
    fix: 'Add at least one sensory test with “Add step”.',
  },
  test_coverage: {
    problem: 'A sensory test is missing from the sequence, or appears more than once.',
    fix: 'Make sure each sensory test you configured appears exactly once in the study sequence.',
  },
  planned_method: {
    problem: 'This sensory method is not available yet.',
    fix: 'Remove the step or choose a method marked as available in the method library.',
  },
  temporal_sample_scope: {
    problem: 'This time-based test (TCATA) has samples chosen, but is not inside a sample loop.',
    fix: 'Put the test inside “Repeat for each sample”, or clear its sample list.',
  },
  empty_flow: {
    problem: 'The study sequence is empty.',
    fix: 'Add a sensory test and an End step.',
  },
  empty_container: {
    problem: 'A group or loop has no steps in it.',
    fix: 'Add steps to it or remove it.',
  },
  empty_samples: {
    problem: 'A “Repeat for each sample” step has no samples.',
    fix: 'Choose the samples it should repeat for.',
  },
  empty_serving_set: {
    problem: 'A “Wait for sample” step does not say which samples to serve.',
    fix: 'Choose the samples that this step hands out.',
  },
  missing_ingredient_tags: {
    problem: 'Samples in this loop have not been checked for ingredients assessors may avoid.',
    fix: 'Open each sample and record its ingredients, or confirm that it has none to flag.',
  },
  invalid_flow: {
    problem: 'A step is incomplete or has an invalid setting.',
    fix: 'Open the step and fill in the highlighted field.',
  },
  foreign_reference: {
    problem: 'A step points at something that belongs to another study or version.',
    fix: 'Open the step and choose the test or sample again from this study.',
  },
  missing_end: {
    problem: 'Some route through the study never reaches an End step.',
    fix: 'Add an End step, or change the skip rules so every route finishes.',
  },
  unreachable_node: {
    problem: 'No route reaches this step, so no assessor will ever see it.',
    fix: 'Check the rules on the steps before it, or remove this step.',
  },
  contradictory_guard: {
    problem: 'This step’s “show only if” rule can never be true, so it is always skipped.',
    fix: 'Change the rule if the step should appear, or remove the step.',
  },
  illegal_target: {
    problem: 'A skip points to a step it cannot jump to.',
    fix: 'Skip forward to a later step at the same level, or choose “Continue”.',
  },
  illegal_end: {
    problem: 'An “End study” action is not allowed here.',
    fix: 'It must lead to a later “Screened out” End step that has no rule of its own.',
  },
  loop_end: {
    problem: 'An End step is inside a “Repeat for each sample” loop.',
    fix: 'Move the End step after the loop.',
  },
  sample_scope: {
    problem: 'This step uses the current sample but is not inside a sample loop.',
    fix: 'Move it inside “Repeat for each sample”, or change the setting.',
  },
  method_binding: {
    problem: 'This sensory test is set up for the wrong way of presenting samples.',
    fix: 'Tests that compare several samples need a fixed set; tests per sample go inside a sample loop.',
  },
  method_samples: {
    problem: 'This test’s samples do not match the loop it is in.',
    fix: 'Make the test cover every sample in the loop.',
  },
  unknown_variable: {
    problem: 'A rule refers to an answer or value that does not exist.',
    fix: 'Open the rule and choose an answer from the list.',
  },
  undefined_variable: {
    problem: 'A rule reads an answer that an assessor may not have given.',
    fix: 'Add “and the question was answered” to the rule, or make that question required.',
  },
  prior_definition: {
    problem: 'A rule reads an answer that comes later, or this step’s own answer.',
    fix: 'Base the rule on a question that appears earlier in the study.',
  },
  predicate_type: {
    problem: 'A rule compares an answer with a value of the wrong kind.',
    fix: 'Check the comparison, for example a number against a number.',
  },
  previous_missing: {
    problem:
      'This step reviews an earlier answer, but there is no earlier question every assessor answers.',
    fix: 'Add a required question before it.',
  },
  restriction_source: {
    problem:
      'Food restrictions are used, but the question that collects them is missing or misplaced.',
    fix: 'Ask a required multiple-choice question about restrictions before the sample loop.',
  },
  restriction_none: {
    problem: 'The restrictions question has no “none of these” option.',
    fix: 'Add one option that excludes all the others.',
  },
  restriction_tags: {
    problem: 'Some restriction options are not linked to sample ingredients.',
    fix: 'Link every option to the ingredient it means.',
  },
  unsafe_serving: {
    problem: 'Samples could be served to an assessor with a matching food restriction.',
    fix: 'Add a rule on the serving step that skips samples the assessor cannot have.',
  },
  unsafe_serving_set: {
    problem: 'Serving a fixed set of samples together cannot respect food restrictions.',
    fix: 'Use one sample loop per sample so restrictions can be applied to each.',
  },
  unsafe_method_set: {
    problem: 'A multi-sample test cannot respect food restrictions.',
    fix: 'Run it in a separate study for eligible assessors only.',
  },
  serving_method: {
    problem: 'The “Wait for sample” step and the sensory test are not set up together.',
    fix: 'Let the serving step follow the test’s own sample plan; do not list samples on it.',
  },
  serving_bypass: {
    problem: 'Some routes reach the tasting without a “Wait for sample” step first.',
    fix: 'Put the serving step before the tasting on every route.',
  },
  repeated_serving: {
    problem: 'Samples are served more than once inside the same loop.',
    fix: 'Use a separate sample loop for each serving round.',
  },
  missing_translation: {
    problem: 'Text is missing in one of the study’s languages.',
    fix: 'Open the step and fill in the text for that language.',
  },
  default_overlay: {
    problem: 'The text shown for the main language differs from the test’s own wording.',
    fix: 'Edit the wording in the test itself, not in the translation.',
  },
  undeclared_language: {
    problem: 'Text exists in a language the study does not offer.',
    fix: 'Add the language to the study, or remove that text.',
  },
  invalid_pointer: {
    problem: 'A translation points at something assessors never see.',
    fix: 'Remove that translation.',
  },
  unknown_token: {
    problem: 'The text contains a placeholder that does not exist (a word in curly brackets).',
    fix: 'Remove it or use one of the listed placeholders.',
  },
  token_scope: {
    problem: 'The text uses a sample placeholder outside a sample loop.',
    fix: 'Move the step inside the loop, or remove the placeholder.',
  },
  asset_text: {
    problem: 'An image is attached to a step that cannot show images.',
    fix: 'Remove the image or use an Information step.',
  },
  stale_design: {
    problem: 'The sample order plan is out of date after samples changed.',
    fix: 'Generate the sample order again under Samples.',
  },
};

export function explainIssue(issue: { code: string; message: string }): IssueText {
  return (
    text[issue.code] ?? {
      problem: issue.message,
      fix: 'Open the step, correct it and check again.',
    }
  );
}
