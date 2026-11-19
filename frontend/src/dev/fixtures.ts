import type { Status } from '../ui/StatusText';

/** Component fixtures only. These are not API records or a method registry. */
export interface TestTypeFixture {
  key: string;
  name: string;
  version: number;
  implementation: string;
  status: Status;
  reference: string;
}

const names = [
  ['hedonic_acceptance_9', 'Nine-point hedonic acceptance'],
  ['cata', 'Check-all-that-apply'],
  ['rata', 'Rate-all-that-apply'],
  ['jar', 'Just-about-right'],
  ['flash_profile', 'Flash profile'],
  ['duo_trio', 'Duo-trio'],
  ['tcata', 'Temporal check-all-that-apply'],
  ['triangle', 'Triangle'],
  ['tetrad', 'Tetrad'],
  ['ranking', 'Ranking'],
  ['paired_comparison', 'Paired comparison'],
  ['descriptive_analysis', 'Descriptive analysis'],
  ['free_choice_profile', 'Free-choice profiling'],
  ['projective_mapping', 'Projective mapping'],
  ['sorting', 'Sorting'],
  ['time_intensity', 'Time-intensity'],
  ['tds', 'Temporal dominance of sensations'],
  ['degree_of_difference', 'Degree of difference'],
  ['difference_from_control', 'Difference from control'],
  ['same_different', 'Same–different'],
  ['two_out_of_five', 'Two-out-of-five'],
  ['a_not_a', 'A–not-A'],
  ['three_afc', 'Three-alternative forced choice'],
  ['two_afc', 'Two-alternative forced choice'],
  ['magnitude_estimation', 'Magnitude estimation'],
  ['spectrum', 'Spectrum descriptive analysis'],
  ['qim', 'Quality index method'],
  ['repertory_grid', 'Repertory grid'],
  ['polarized_sensory_positioning', 'Polarized sensory positioning with reference products'],
  ['temporal_liking', 'Temporal liking'],
];

export const testTypes: TestTypeFixture[] = names.map(([key, name], index) => ({
  key,
  name,
  version: (index % 3) + 1,
  implementation:
    index < 4 ? 'Config, preview, validation' : index < 15 ? 'Config, preview' : 'Schema only',
  status: index < 10 ? 'published' : index === 20 ? 'deprecated' : 'draft',
  reference: 'Laboratory reference · illustrative fixture',
}));

export interface DesignSetFixture {
  id: string;
  set: number;
  set_code: string;
  sequence: number;
  product: number;
  blinding_code: string;
}

export const designSets: DesignSetFixture[] = Array.from({ length: 60 }, (_, index) =>
  Array.from({ length: 3 }, (_, product) => ({
    id: `set-${index + 1}-product-${product + 1}`,
    set: index + 1,
    set_code: `SET-${String(index + 1).padStart(3, '0')}`,
    sequence: product + 1,
    product: ((index + product) % 3) + 1,
    blinding_code: String(100 + ((index * 37 + product * 113) % 900)),
  })),
).flat();

/** Separate stress fixture exercises the >200-row virtualisation branch. */
export const virtualSets: DesignSetFixture[] = Array.from({ length: 600 }, (_, index) => ({
  ...designSets[index % designSets.length],
  id: `virtual-${index + 1}`,
  set: Math.floor(index / 3) + 1,
  set_code: `SET-${String(Math.floor(index / 3) + 1).padStart(3, '0')}`,
}));
