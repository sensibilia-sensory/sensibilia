import { useState } from 'react';
import { Button, ConfirmButton, DataTable, Field, FileField, SidePanel } from '../ui';
import { outline, type Flow, type Node } from '../shared/flow';
import { questionnaireBlock } from '../shared/nodes/authoring';
import {
  copyFromSource,
  questionnaireFromFile,
  questionnaireToFile,
} from '../shared/nodes/questionnaireFile';
import type { components } from '../api-schema';
import { saveBlob } from './download';

export type BankItem = components['schemas']['QuestionnaireItemRead'];
/** The item bank the panel works with; the page supplies it from the server. */
export interface ItemBank {
  items: BankItem[];
  busy: boolean;
  error: string;
  onSave: (item: components['schemas']['QuestionnaireItemCreate']) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
}
const kindNames: Record<string, string> = {
  info: 'Information',
  consent: 'Consent',
  question: 'Question',
  matrix_question: 'Battery',
  confirm: 'Confirmation',
  group: 'Group',
};

/**
 * Save the study's questions to a file on this computer or load one into this draft, and keep a bank
 * of reusable steps (consent and information statements, standard questions). Copies only: a step
 * added from the bank or a file is an ordinary draft step and is never linked back to its source.
 */
export function QuestionnaireFile({
  flow,
  selectedId,
  bank,
  readOnly = false,
  onInsert,
  onClose,
}: {
  flow: Flow;
  selectedId?: string;
  bank?: ItemBank;
  readOnly?: boolean;
  onInsert: (nodes: Node[]) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [ready, setReady] = useState<{ name: string; nodes: Node[] }>();
  const [name, setName] = useState('');
  const selected = selectedId
    ? outline(flow.nodes).find(({ node }) => node.id === selectedId)?.node
    : undefined;
  const titles = (nodes: Node[]) =>
    nodes.map((n) => n.title[flow.default_language] || n.title[flow.languages[0]]);
  return (
    <SidePanel title="Save or load questions" onClose={onClose}>
      <div className="ui-stack">
        <p>
          A file keeps the questions and information steps of this study, with their wording in
          every language. Sensory methods, sample loops and anything that depends on them stay out.
        </p>
        <Button
          onClick={() => {
            try {
              const file = questionnaireToFile(flow);
              saveBlob(
                new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }),
                'questionnaire-' + file.saved_at.slice(0, 10) + '.json',
              );
              setError('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save questions to a file
        </Button>
        <FileField
          label="Load questions from a file"
          accept=".json,application/json"
          hint="A file saved from Sensibilia. Its steps are added to this draft; nothing is replaced."
          disabled={readOnly}
          onChange={async (file) => {
            setReady(undefined);
            if (!file) return setError('');
            try {
              setReady({ name: file.name, nodes: questionnaireFromFile(await file.text(), flow) });
              setError('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
        {error && <p role="alert">{error}</p>}
        {ready && (
          <div className="ui-stack">
            <p>
              {ready.name} holds {ready.nodes.length} {ready.nodes.length === 1 ? 'step' : 'steps'}:{' '}
              {titles(ready.nodes).join(', ')}.
            </p>
            <Button
              variant="primary"
              disabled={readOnly}
              onClick={() => {
                onInsert(ready.nodes);
                setReady(undefined);
              }}
            >
              Add {ready.nodes.length} {ready.nodes.length === 1 ? 'step' : 'steps'} to this draft
            </Button>
          </div>
        )}
        {bank && (
          <section className="ui-stack" aria-label="Item bank">
            <h3>Item bank</h3>
            <p>
              Reusable steps such as consent and information statements. Adding one copies it into
              this draft; later changes to either do not affect the other.
            </p>
            <Field
              label="Name in the bank"
              hint={
                selected
                  ? 'Saves the selected step: ' + titles([selected])[0]
                  : 'Select a step in the list to save it.'
              }
              value={name}
              disabled={!selected || bank.busy}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              disabled={!selected || bank.busy}
              onClick={async () => {
                if (!selected) return;
                try {
                  questionnaireBlock(flow, selected.id, flow); // refuses steps that need others
                  await bank.onSave({
                    name: name.trim() || titles([selected])[0] || 'Saved step',
                    languages: flow.languages,
                    default_language: flow.default_language,
                    text_version: flow.text_version ?? null,
                    node: selected as unknown as Record<string, unknown>,
                  });
                  setName('');
                  setError('');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Save selected step to the bank
            </Button>
            {bank.error && <p role="alert">{bank.error}</p>}
            <DataTable
              id="questionnaire-item-bank"
              label="Saved steps"
              selectable={false}
              virtualize={false}
              compact
              data={bank.items}
              getRowId={(i) => i.id}
              emptyText={bank.busy ? 'Loading…' : 'Nothing saved yet.'}
              columns={[
                { accessorKey: 'name', header: 'Name' },
                {
                  id: 'kind',
                  header: 'Type',
                  accessorFn: (i) => kindNames[i.kind] ?? i.kind,
                },
                { id: 'languages', header: 'Languages', accessorFn: (i) => i.languages.join(', ') },
                {
                  id: 'saved',
                  header: 'Saved',
                  accessorFn: (i) => i.created_at.slice(0, 10),
                },
              ]}
              rowActions={(item) => (
                <div className="ui-inline">
                  <Button
                    compact
                    aria-label={'Add ' + item.name + ' to this draft'}
                    disabled={readOnly || bank.busy}
                    onClick={() => {
                      try {
                        onInsert(
                          copyFromSource(
                            [item.node as unknown as Node],
                            {
                              languages: item.languages,
                              default_language: item.default_language,
                              text_version: (item.text_version ?? null) as 1 | null,
                            },
                            flow,
                          ),
                        );
                        setError('');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Add to draft
                  </Button>
                  <ConfirmButton
                    compact
                    confirmLabel={'Archive ' + item.name}
                    disabled={bank.busy}
                    onConfirm={() => void bank.onArchive(item.id)}
                  >
                    Archive
                  </ConfirmButton>
                </div>
              )}
            />
            <p>Archiving hides a step from this list; nothing is deleted.</p>
          </section>
        )}
      </div>
    </SidePanel>
  );
}
