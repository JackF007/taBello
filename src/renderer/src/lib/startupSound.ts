import { tabello } from '@/lib/api';

/** TaBello's short startup tune (scripts/generate-startup-sound.ts), unless the user turned it off. */
export async function playStartupSound(): Promise<void> {
  if (!tabello) return;
  try {
    const { startupSound } = await tabello.getPreferences();
    if (!startupSound) return;
    const audio = new Audio('sounds/startup.ogg');
    audio.volume = 0.6;
    await audio.play();
  } catch {
    // A sound that cannot play (no audio device) is no reason to complain.
  }
}
