export interface WaveGroup { type: string; count: number; elite?: boolean; name?: string }
export interface WaveDef {
  title: string;
  announce: string;
  groups: WaveGroup[];
  /** How many attack at once (token pool). */
  tokens: number;
  /** Seconds over which the wave trickles in. */
  spawnOver: number;
  /** Peasants that arrive together at the start. */
  firstRush: number;
}

/** Tale 1, The Turnip Rebellion. Milestone 1 stands in a foreman for Sir Vival on wave 5. */
export const WAVES: WaveDef[] = [
  { title: 'A Disagreement About Turnips', announce: 'Six peasants. They have brought kitchenware.', tokens: 2, spawnOver: 6, firstRush: 3,
    groups: [{ type: 'mob', count: 6 }] },
  { title: 'The Pitchforks Arrive', announce: 'Someone has found the tool shed.', tokens: 2, spawnOver: 10, firstRush: 4,
    groups: [{ type: 'mob', count: 7 }, { type: 'farmhand', count: 3 }] },
  { title: 'Men Who Fell Trees', announce: 'The woodcutters have finished work early.', tokens: 3, spawnOver: 14, firstRush: 5,
    groups: [{ type: 'mob', count: 8 }, { type: 'farmhand', count: 4 }, { type: 'woodcutter', count: 2 }] },
  { title: 'The Whole Village', announce: 'Everyone is here. Even the ones who said they were busy.', tokens: 3, spawnOver: 18, firstRush: 6,
    groups: [{ type: 'mob', count: 11 }, { type: 'farmhand', count: 5 }, { type: 'woodcutter', count: 3 }] },
  { title: 'The Foreman', announce: 'He has felled larger things than you. Oaks, mainly.', tokens: 4, spawnOver: 20, firstRush: 7,
    groups: [{ type: 'mob', count: 12 }, { type: 'farmhand', count: 6 }, { type: 'woodcutter', count: 3 }, { type: 'woodcutter', count: 1, elite: true, name: 'Big Wat, Foreman' }] },
];
