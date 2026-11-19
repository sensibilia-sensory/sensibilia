// Shared CI runners are several times slower in full-page axe scans than a workstation.
export const timeoutScale = process.env.CI ? 3 : 1;
