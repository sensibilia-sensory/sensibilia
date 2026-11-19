import { Field, PropertyGrid, Tabs } from '../../ui';
import { methodTextFields } from '../flow/text';
import type { Flow } from '../flow';
import type { Configuration } from '../methods/registry';
export function MethodTextEditor({
  flow,
  testId,
  configuration,
  language,
  onLanguage,
  onChange,
  disabled = false,
  errors = {},
}: {
  flow: Flow;
  testId: string;
  configuration: Configuration;
  language: string;
  onLanguage: (language: string) => void;
  onChange: (flow: Flow) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
}) {
  return (
    <Tabs
      label="Method text language"
      value={language}
      onChange={onLanguage}
      tabs={flow.languages.map((lang) => ({
        id: lang,
        label: lang,
        content: (
          <PropertyGrid
            sections={[
              {
                title: 'Reviewed method text',
                defaultOpen: true,
                children: Object.entries(methodTextFields(configuration)).map(
                  ([pointer, defaultText]) => (
                    <Field
                      key={pointer}
                      id={'method-text-' + pointer + '-' + lang}
                      label={pointer}
                      value={
                        flow.method_text?.[testId]?.[pointer]?.[lang] ??
                        (lang === flow.default_language ? defaultText : '')
                      }
                      disabled={disabled || lang === flow.default_language}
                      error={errors[pointer]}
                      hint={
                        lang === flow.default_language
                          ? 'Edit the default-language configuration below.'
                          : undefined
                      }
                      onChange={(e) =>
                        onChange({
                          ...flow,
                          method_text: {
                            ...flow.method_text,
                            [testId]: {
                              ...flow.method_text?.[testId],
                              [pointer]: {
                                ...flow.method_text?.[testId]?.[pointer],
                                [flow.default_language]: defaultText,
                                [lang]: e.target.value,
                              },
                            },
                          },
                        })
                      }
                    />
                  ),
                ),
              },
            ]}
          />
        ),
      }))}
    />
  );
}
