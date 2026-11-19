import { Button, DataTable, PropertyGrid } from '../ui';
import type { Version, Report } from './client';

export function StudyChecklist({
  version,
  dirty,
  report,
  onNext,
  expanded = false,
  details = true,
}: {
  version: Version;
  dirty: boolean;
  report?: Report;
  onNext: (tab: string) => void;
  expanded?: boolean;
  details?: boolean;
}) {
  const released = !!version.published_at;
  const checked = !dirty && report?.revision_hash === version.revision_hash && report.valid;
  const rows = [
    {
      id: 'details',
      phase: 'Define',
      status: version.title.trim() ? 'Title saved' : 'Needs review',
      blocker: 'Review purpose and languages',
    },
    {
      id: 'flow',
      phase: 'Build',
      status: version.form ? 'Saved sequence' : 'Not saved',
      blocker: dirty ? 'Unsaved draft edits' : 'Review tests, codes and restrictions',
    },
    {
      id: 'flow?panel=check',
      phase: 'Check',
      status: checked ? 'Validated' : 'Needs check',
      blocker: checked ? 'None' : 'Check the current saved revision',
    },
    {
      id: 'publish',
      phase: 'Release',
      status: released ? 'Released' : 'Draft',
      blocker: released ? 'Immutable version' : 'Review and acknowledge the freeze',
    },
    {
      id: 'sessions',
      phase: 'Run',
      status: released ? 'Available' : 'Blocked',
      blocker: released
        ? 'Review actual assessment status and pending sync on tablets'
        : 'Release before provisioning',
    },
    {
      id: 'data',
      phase: 'Results',
      status: released ? 'Available' : 'Blocked',
      blocker: released
        ? 'Reconcile records before export; availability does not imply collected data'
        : 'Release and collect assessments',
    },
  ];
  const next = released
    ? 'sessions'
    : !version.form
      ? 'flow'
      : !checked
        ? 'flow?panel=check'
        : 'publish';
  const current = next.startsWith('flow?panel=check')
    ? 'Check'
    : next === 'publish'
      ? 'Release'
      : next === 'sessions'
        ? 'Run'
        : version.form
          ? 'Build'
          : 'Define';
  return (
    <>
      <div className="ui-progress" role="group" aria-label="Study progress">
        <ol>
          {rows.map((r) => (
            <li
              key={r.phase}
              title={r.blocker}
              aria-current={r.phase === current ? 'step' : undefined}
            >
              <strong>{r.phase}</strong> {r.status}
            </li>
          ))}
        </ol>
        <Button onClick={() => onNext(next)}>
          What next:{' '}
          {next.includes('check')
            ? 'Check saved study'
            : next === 'publish'
              ? 'Release for collection'
              : next === 'sessions'
                ? 'Assessments'
                : 'Build study sequence'}
        </Button>
      </div>
      {details && (
        <PropertyGrid
          sections={[
            {
              title: 'Study checklist details',
              defaultOpen: expanded,
              children: (
                <DataTable
                  id="study-checklist"
                  label="Study checklist"
                  compact
                  data={rows}
                  getRowId={(r) => r.phase}
                  columns={[
                    { accessorKey: 'phase', header: 'Phase' },
                    { accessorKey: 'status', header: 'Status' },
                    { accessorKey: 'blocker', header: 'Review / blocker' },
                  ]}
                />
              ),
            },
          ]}
        />
      )}
    </>
  );
}

export function StudyHelp({ open = false }: { open?: boolean }) {
  const rows = [
    {
      term: 'Study sequence',
      meaning: 'Ordered study steps. A sensory test uses its registered method and version.',
    },
    {
      term: 'Show only if',
      meaning: 'Show a step only when an earlier answer or assigned setting meets the comparison.',
    },
    {
      term: 'Repeat for samples',
      meaning:
        'Repeat these steps in the saved sample order. Review each code and ingredient restriction.',
    },
    {
      term: 'Saved revision',
      meaning:
        'Verification ID changes when the draft changes. Recheck the revision before release.',
    },
    {
      term: 'Release for collection',
      meaning:
        'Freezes wording, methods, translations and sequence. Later changes need a new version.',
    },
    {
      term: 'Undo / redo',
      meaning:
        'Restores draft edits and deleted steps in this open workspace. Save failures keep edits. Reload clears local undo history.',
    },
    {
      term: 'Template',
      meaning:
        'Copies a published version into a new study; review wording, codes, restrictions and translations. No assessor or response data is copied.',
    },
  ];
  return (
    <>
      <PropertyGrid
        sections={[
          {
            title: 'Help and glossary',
            defaultOpen: open,
            children: (
              <>
                <DataTable
                  id="study-glossary"
                  label="Study glossary"
                  data={rows}
                  getRowId={(r) => r.term}
                  columns={[
                    { accessorKey: 'term', header: 'Term' },
                    { accessorKey: 'meaning', header: 'Meaning / consequence' },
                  ]}
                />
                <p>
                  Use Method library → Source for the registered methodological reference. A
                  reference does not imply ISO compliance or licensed access. Hedonic acceptance
                  uses the nine verbal labels and scores 1–9; zero is invalid.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
}
