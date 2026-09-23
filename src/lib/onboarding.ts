// First-run onboarding state: a single "completed" flag in localStorage.
// The wizard itself lives in components/Onboarding.tsx and is opened by app.tsx.

import { loadPapers } from './store'

const DONE_KEY = 'tc-papers:onboarding-done'
const AI_KEY = 'tc-papers:ai-v1'

export function isOnboardingDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1' } catch {
    // Storage unavailable: treat as done so the wizard can't loop forever.
    return true
  }
}

export function markOnboardingDone(): void {
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* worst case the wizard shows again next launch */ }
}

/**
 * Whether the wizard should open on launch: only on a genuinely fresh install.
 * An install from before onboarding shipped (papers or AI preferences already present, no flag)
 * is marked done silently so it is never interrupted.
 */
export function shouldShowOnboarding(): boolean {
  if (isOnboardingDone()) return false
  let hasAiPrefs = false
  try { hasAiPrefs = localStorage.getItem(AI_KEY) !== null } catch { /* ignore */ }
  if (loadPapers().length > 0 || hasAiPrefs) { markOnboardingDone(); return false }
  return true
}
