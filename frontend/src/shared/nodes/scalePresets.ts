/** Standard response scales, offered by name so researchers do not retype common labels. */
export const scalePresets: { id: string; name: string; labels: string[] }[] = [
  {
    id: 'agree5',
    name: 'Agreement, 5 points',
    labels: [
      'Strongly disagree',
      'Disagree',
      'Neither agree nor disagree',
      'Agree',
      'Strongly agree',
    ],
  },
  {
    id: 'agree7',
    name: 'Agreement, 7 points',
    labels: [
      'Strongly disagree',
      'Disagree',
      'Somewhat disagree',
      'Neither agree nor disagree',
      'Somewhat agree',
      'Agree',
      'Strongly agree',
    ],
  },
  {
    id: 'frequency5',
    name: 'Frequency, 5 points',
    labels: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'],
  },
  {
    id: 'purchase5',
    name: 'Purchase intent, 5 points',
    labels: [
      'Definitely would not purchase',
      'Probably would not purchase',
      'Might or might not purchase',
      'Probably would purchase',
      'Definitely would purchase',
    ],
  },
  {
    id: 'hedonic9',
    name: 'Liking, 9 points',
    labels: [
      'Dislike extremely',
      'Dislike very much',
      'Dislike moderately',
      'Dislike slightly',
      'Neither like nor dislike',
      'Like slightly',
      'Like moderately',
      'Like very much',
      'Like extremely',
    ],
  },
];
