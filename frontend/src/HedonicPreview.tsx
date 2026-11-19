import { useState } from 'react';
import { Eye, RotateCcw } from 'lucide-react';
import type { Configuration } from './api';

/** Shared, configuration-driven hedonic rendering; preview answers never leave this component. */
export function HedonicPreview({ configuration }: { configuration: Configuration }) {
  const [answers, setAnswers] = useState<Record<string, number | 'skipped'>>({});
  const questions = configuration.questions;
  return (
    <aside className="preview-panel" aria-label="Assessor preview">
      <div className="preview-toolbar">
        <span>
          <Eye size={16} /> Assessor preview
        </span>
        <button
          className="icon-button"
          aria-label="Reset preview answers"
          onClick={() => setAnswers({})}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="preview-paper">
        <div className="preview-mark">
          <span className="tiny-dot" /> SENSORY EVALUATION
        </div>
        <h2>Your evaluation</h2>
        <p className="preview-instructions">
          {configuration.instructions || 'Your instructions will appear here.'}
        </p>
        {questions.map((question, index) => (
          <fieldset className="preview-question" key={question.id + index}>
            <legend>
              <span className="eyebrow">
                QUESTION {index + 1}
                {question.required ? ' · REQUIRED' : ' · OPTIONAL'}
              </span>
              <span className="preview-prompt">
                {question.prompt || 'Your question will appear here.'}
              </span>
            </legend>
            <div className="rating-grid">
              {configuration.scale_labels?.map((label, rating) => (
                <label
                  className={`rating-option ${answers[question.id] === rating + 1 ? 'chosen' : ''}`}
                  key={rating}
                >
                  <input
                    type="radio"
                    name={`preview-${question.id}-${index}`}
                    value={rating + 1}
                    checked={answers[question.id] === rating + 1}
                    onChange={() =>
                      setAnswers((previous) => ({ ...previous, [question.id]: rating + 1 }))
                    }
                  />
                  <span className="rating-number">{rating + 1}</span>
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {configuration.allow_skips && (
              <button
                className="text-button preview-skip"
                onClick={() =>
                  setAnswers((previous) => ({ ...previous, [question.id]: 'skipped' }))
                }
              >
                Skip this question
              </button>
            )}
            <div className="preview-answer" aria-live="polite">
              {answers[question.id] === 'skipped'
                ? 'Question skipped'
                : answers[question.id]
                  ? `Rating ${answers[question.id]} selected`
                  : 'Choose one answer'}
            </div>
          </fieldset>
        ))}
        <div className="preview-end">Thank you for taking part.</div>
      </div>
      <p className="preview-caption">Try the scale. Preview answers are not collected.</p>
    </aside>
  );
}
