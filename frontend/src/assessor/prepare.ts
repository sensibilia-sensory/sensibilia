import type { components } from '../api-schema';
import { Client } from '../researcher/client';
import { flowIssues } from '../shared/flow/validation';
import { outline } from '../shared/flow';
import { cacheImages } from '../shared/assets';
import { cacheShell } from './cache';
import { readSession, savePackage, updateSession, type Package } from './storage';

export async function prepareSession(id: string, token: string) {
  const client = new Client('', token);
  const pkg = await client.request<Package>('/sessions/' + id + '/test', {}, 'session');
  if (
    pkg.session.id !== id ||
    !pkg.flow ||
    pkg.package_schema_version !== 4 ||
    ![
      'linear-v2.1',
      'guards-v2.2',
      'samples-v2.3',
      'text-v2.5',
      'designs-v2.6',
      'serving-v2.7',
      'methods-v2.8',
      'temporal-v2.9',
      'assets-v2.10',
    ].includes(pkg.evaluator_version ?? '')
  )
    throw new Error('This tablet requires a supported frozen Flow v2 package.');
  if (
    (pkg.evaluator_version === 'serving-v2.7' ||
      outline(pkg.flow.nodes).some(({ node }) => node.kind === 'serve_gate')) &&
    !pkg.serving_assignment
  )
    throw new Error('Assign this assessment to a booth before tablet preparation.');
  const issues = flowIssues(pkg.flow, pkg.tests);
  if (issues.length) throw new Error(issues.join(' '));
  await cacheImages(pkg, token);
  const cached = await readSession(id);
  if (cached) {
    if (cached.token !== token || cached.storageVersion !== 1 || cached.shellVersion !== 1)
      throw new Error('Existing tablet record differs; retain its data and contact staff.');
    if (cached.package.serving_assignment?.id !== pkg.serving_assignment?.id) {
      if (!pkg.serving_assignment) throw new Error('Staff must assign this assessment to a booth.');
      if (
        [
          'revision_hash',
          'flow',
          'tests',
          'context',
          'loop_assignments',
          'assignments',
          'assets',
        ].some(
          (key) =>
            JSON.stringify(cached.package[key as keyof Package]) !==
            JSON.stringify(pkg[key as keyof Package]),
        )
      )
        throw new Error('Frozen package changed; retain this tablet and contact staff.');
      const refreshed = await updateSession(id, (latest) => {
        if (!latest || latest.outbox.length || latest.serving?.pending.length)
          throw new Error(
            'Synchronise retained research and serving operations before preparing a booth transfer.',
          );
        const serving = latest.serving ?? {
          pending: [],
          acknowledged: [],
          suppressed: [],
          signals: [],
          waits: {},
        };
        return {
          ...latest,
          package: { ...latest.package, serving_assignment: pkg.serving_assignment },
          serving: {
            ...serving,
            assignment_history: [
              ...(serving.assignment_history ?? []),
              ...(latest.package.serving_assignment ? [latest.package.serving_assignment] : []),
            ],
          },
        };
      });
      return { local: refreshed, durable: await cacheShell(id) };
    }
    return { local: cached, durable: await cacheShell(id) };
  }
  const progress = await client.request<components['schemas']['ProgressRead']>(
    '/sessions/' + id + '/progress',
    {},
    'session',
  );
  if (pkg.session.status !== 'in_progress' || (progress.next_seq ?? 1) !== 1)
    throw new Error(
      'This assessment has server progress. Resume its original tablet; prepare a fresh replacement assessment for a new device.',
    );
  const durable = await cacheShell(id);
  return { local: await savePackage(id, token, pkg), durable };
}
