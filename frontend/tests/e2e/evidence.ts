import { join, resolve } from 'node:path';

// Routine runs write captures and reconciliation JSON to an ignored folder. Signed
// acceptance evidence is regenerated only on request: EVIDENCE_DIR=../docs/ui-reference.
// Relative values resolve from frontend/, where Playwright runs.
export const evidenceDir = resolve(process.env.EVIDENCE_DIR || 'test-evidence');

export const evidencePath = (name: string) => join(evidenceDir, name);
