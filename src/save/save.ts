// Progress and settings in localStorage. Every access is guarded: private windows and
// blocked storage must not break the game.
export interface Settings { volume: number; music: number; gore: 'full' | 'reduced' | 'off'; sensitivity: number; quality: 'low' | 'high' | 'auto'; autoLock: boolean; hints: boolean }
export interface SaveData { gold: number; bestWave: number; wave: number; kit: string; settings: Settings }

const KEY = 'bleedsalot.save.v1';
export const DEFAULTS: SaveData = {
  gold: 0, bestWave: 0, wave: 0, kit: 'mail',
  settings: { volume: 0.8, music: 0.5, gore: 'full', sensitivity: 1, quality: 'auto', autoLock: true, hints: true },
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const d = JSON.parse(raw);
    return { ...DEFAULTS, ...d, settings: { ...DEFAULTS.settings, ...(d.settings ?? {}) } };
  } catch { return structuredClone(DEFAULTS); }
}
export function writeSave(d: SaveData): void {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage unavailable: play on without it */ }
}
