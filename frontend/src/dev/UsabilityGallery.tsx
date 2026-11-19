import { useState } from 'react';
import { Tabs } from '../ui';
import { TemplateTable, type Template } from '../researcher/Templates';
import { StudyHelp, StudyChecklist } from '../researcher/Usability';
export function UsabilityGallery() {
  const [tab, setTab] = useState('templates'),
    [notice, setNotice] = useState('');
  const data: Template[] = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    name: 'Reviewed hedonic ' + (i + 1),
    source_version_id: 'publication-' + i,
    review_notes: 'Review wording, restrictions, codes and translations',
    principal: 'researcher-key:fixture',
    created_at: '2026-10-12',
  }));
  return (
    <section id="usability" className="ui-gallery-section" aria-label="Study usability fixtures">
      <h2>Study usability</h2>
      <Tabs
        label="Usability fixture states"
        value={tab}
        onChange={setTab}
        tabs={['templates', 'loading', 'empty', 'error', 'readonly', 'checklist'].map((id) => ({
          id,
          label: id,
          content:
            id === 'checklist' ? (
              <StudyChecklist
                expanded
                version={{
                  id: 'fixture',
                  study_id: 'fixture',
                  version_number: 1,
                  title: 'Hedonic',
                  description: '',
                  published_at: null,
                  revision_hash: 'fixture',
                  form: null,
                }}
                dirty={false}
                onNext={setNotice}
              />
            ) : (
              <TemplateTable
                data={id === 'empty' || id === 'loading' ? [] : data}
                loading={id === 'loading'}
                error={id === 'error' ? 'Cannot reach laboratory server. Retry read.' : ''}
                readonly={id === 'readonly'}
                onUse={(t) => setNotice(t.name)}
              />
            ),
        }))}
      />
      {notice && <p role="status">{notice}</p>}
      <StudyHelp />
    </section>
  );
}
