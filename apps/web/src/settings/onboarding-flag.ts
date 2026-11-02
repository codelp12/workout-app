// Device-local, so skipping the wizard on one device doesn't skip it everywhere.
const KEY = "workout-app:onboarding-offered";

/** Whether this install has already shown (or skipped) the first-run wizard. */
export function onboardingOffered(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function markOnboardingOffered(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Private mode or storage disabled: the wizard may show again; harmless.
  }
}
