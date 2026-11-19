/** Wording only: validators and methodological configuration remain authoritative. */
export const settingHelp: Record<string, string> = {
  preparation:
    'Public protocol preparation text included in the assigned package. Private product mapping comes from staff-only sample labels.',
  require_staff_delivery:
    'Off: the assessor confirms "Yes, I have them" as soon as the samples are in front of them. On: the assessor can confirm only after serving staff mark the samples delivered on the operator screen.',
  timeout_seconds:
    'Only with staff delivery required. After this wait the assessor may ask staff to verify the delivery by hand and give a reason. It never marks a sample served automatically.',
  instructions:
    'Directions shown before rating. Review wording and language against the Method library reference.',
  questions:
    'Define each measured liking question; order and identifiers are retained in exported data.',
  id: 'Stable identifier used in conditions and exports. Changing it changes the interpretation of answers.',
  prompt:
    'Question shown to the assessor. Review clarity, language and the registered method reference.',
  required: 'Requires an answer before continuing; review the separate skip setting.',
  scale_labels:
    'Labels in ascending score order. Name at least the first and last step; a step left empty shows only its number. Review anchors and language; zero is invalid.',
  allow_skips:
    'Allows an explicit skipped answer, kept distinct from missing data and a numeric rating.',
  allow_skip: 'Allows an explicit skipped answer. Conditions must account for undefined answers.',
  body: 'Text shown to the assessor in this step. Review instructions and translations before release.',
  answer_type:
    'Select the response format; changing it removes configuration that no longer applies.',
  min: 'Smallest allowed numeric answer. Ordinary questions may include zero when explicitly configured.',
  max: 'Largest allowed numeric answer; values outside this bound are rejected.',
  label: 'Visible option wording. Stable option IDs are used by display conditions and exports.',
  exclusive: 'This choice clears other selections, for example a reviewed none option.',
  outcome: 'Completed or screened out. This determines the final assessment state.',
  normalization: 'How entered codes are compared. Review case and whitespace rules before release.',
  source: 'Determines whether this code confirms a sample or a returning participant.',
  allow_unknown:
    'Whether an unknown code can continue. It does not change assigned identity or study.',
  accept_label: 'Consent choice shown to the assessor; review approved ethics wording.',
  decline_label: 'Decline choice shown to the assessor; verify the screen-out sequence.',
  ack_label: 'Label for the acknowledgement required by this step.',
  continue_label: 'Label for advancing this instruction step.',
};
