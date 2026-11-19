/** Laboratory wording for internal names. API and export names are unchanged. */
export const stepKindLabel: Record<string, string> = {
  info: 'Information',
  consent: 'Consent',
  question: 'Question',
  matrix_question: 'Question grid',
  group: 'Group',
  loop_samples: 'Repeat for each sample',
  confirm: 'Confirmation',
  code_entry: 'Code entry',
  serve_gate: 'Wait for sample',
  end: 'End',
  embedded_method: 'Sensory test',
};
export const stepKindHelp: Record<string, string> = {
  info: 'Text or images the assessor reads',
  consent: 'Agree or decline to take part',
  question: 'Single choice, multiple choice, text or number',
  matrix_question: 'Several statements with one shared scale',
  group: 'Keeps steps together so they can be shown or skipped as one',
  loop_samples: 'Runs the steps inside it once for each sample',
  confirm: 'Assessor confirms something before continuing',
  code_entry: 'Assessor types a code, such as a sample code',
  serve_gate: 'Pause until the sample has been delivered',
  end: 'Finishes the assessment',
};
export const kindLabel = (kind: string) => stepKindLabel[kind] ?? kind;

const statusWords: Record<string, string> = {
  in_progress: 'In progress',
  completed: 'Finished',
  screened_out: 'Screened out',
  ended: 'Ended by staff',
  draft: 'Draft',
  active: 'Open',
  closed: 'Closed',
  // Analysis jobs
  queued: 'Waiting',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
/** Analysis settings in the laboratory's words. */
export const analysisWords: Record<string, string> = {
  tukey: 'Tukey HSD (recommended)',
  lsd: 'Fisher LSD',
  friedman: 'Friedman (ranks; for skewed ratings)',
  difference: 'Are they different?',
  similarity: 'Are they similar enough?',
  triangle: 'Triangle',
  duo_trio: 'Duo-trio',
  two_afc: '2-AFC',
};
export const statusLabel = (status: string | null | undefined) =>
  status ? (statusWords[status] ?? status) : '';

const servingStates: Record<string, string> = {
  ready: 'Waiting for sample',
  acknowledged: 'Being prepared',
  help: 'Assessor asked for help',
  served: 'Served',
  received: 'Received by assessor',
  'no session': 'Free',
  disabled: 'Not in use',
  completed: 'Finished',
  screened_out: 'Screened out',
};
export const servingStateLabel = (state: string) => servingStates[state] ?? state;
const presenceWords: Record<string, string> = {
  online: 'Online',
  offline: 'Offline',
  unknown: 'Not reported',
};
export const presenceLabel = (presence: string) => presenceWords[presence] ?? presence;

/** Plain wording for schema field names shown in settings forms. */
export const fieldLabels: Record<string, string> = {
  body: 'Text',
  prompt: 'Question text',
  label: 'Option text',
  answer_type: 'Answer type',
  min: 'Lowest value',
  max: 'Highest value',
  exclusive: 'Exclusive',
  allow_skip: 'Allow skipping',
  outcome: 'Result',
  normalization: 'Compare codes by',
  source: 'Code used for',
  id: 'ID',
  required: 'Must be answered',
  decline_label: 'Decline button text',
  accept_label: 'Agree button text',
  ack_label: 'Confirm button text',
  continue_label: 'Continue button text',
  require_staff_delivery: 'Staff must mark samples as delivered',
  timeout_seconds: 'Wait before asking staff (seconds)',
  allow_unknown: 'Allow unknown codes',
  preparation: 'Preparation notes',
};
export const fieldLabel = (key: string) =>
  fieldLabels[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
