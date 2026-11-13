// All the jokes live here. The world plays it straight; only the words are allowed to be funny.

export const FIRST_NAMES = ['Gareth', 'Mildred', 'Dave', 'Wat', 'Agnes', 'Hob', 'Godric', 'Maud', 'Cuthbert', 'Edith', 'Osbert', 'Alys', 'Piers', 'Hilda', 'Tom', 'Wilfred', 'Joan', 'Bartholomew', 'Ned', 'Ethel', 'Rolf', 'Gytha', 'Simkin', 'Old Peter'];
export const EPITHETS = ['the Unwashed', 'Two-Teeth', 'the Damp', 'of No Fixed Hovel', 'the Reasonable', 'the Younger (52)', 'Turnip-Fancier', 'the Mostly Sober', 'One-Shoe', 'the Litigious', 'Who Owes Rent', 'the Unlucky', 'the Slightly Taller', 'from Two Fields Over', 'the Almost Brave', 'Mudborn', 'the Disappointed', 'Son of Also Gareth'];
/** Roughly one peasant in six has no epithet at all. */
export const PLAIN_NAMES = ['Dave', 'Just Colin', 'Steve', 'Nigel'];

export const BARKS: Record<string, string[]> = {
  spawn: ['I was only hired for wave three.', 'This is about the turnips.', 'We outnumber him. That is the whole plan.', 'Mind the mud.', 'I left a stew on.'],
  jeer: ['After you, Gareth.', 'I am waiting my turn. It is only fair.', 'Your tax assessment was inaccurate!', 'Somebody else go.', 'I have a rake and a grievance.', 'He looks expensive.', 'My back is not what it was.', 'We did vote on this.', 'Nice surcoat. Shame.'],
  attack: ['For the turnips!', 'Have at you, I suppose.', 'This is for the tithe!', 'Sorry in advance.'],
  armL: ['That was my spare arm.', 'I use that for waving.', 'Left one. Fine. Fine.'],
  armR: ['That was my good arm.', 'I signed things with that.', 'Well, that is the harvest ruined.'],
  leg: ['I walked here on that.', 'I shall be late home.', 'Right. I am sitting this one out.'],
  flee: ['I have remembered a prior engagement.', 'I was never here!', 'Tell my wife I was brave. Briefly.', 'The turnips are not worth it.', 'I am going to find a bigger mob.'],
  allyDied: ['He owed me fourpence.', 'That was Gareth. One of the Gareths.', 'Could have been worse. Could have been me.', 'Somebody will have to tell his goat.'],
  parried: ['That usually works.', 'Unfair.'],
  hitKnight: ['I got him! Did everyone see?', 'Put that in the ballad.'],
  elite: ['I have felled oaks, boy.', 'Timber.'],
};

export const DEATH_LINES = [
  'Sir Bleedsalot has lived up to the name.',
  'Slain by a man holding kitchenware.',
  'The chroniclers will be brief.',
  'A setback. The squire is fetching a mop.',
  'He died as he lived: surrounded by people who disliked him.',
  'The peasants are already arguing over the boots.',
];
export const CLEAR_LINES = [
  'The square is quiet. Damp, but quiet.',
  'A firm conversation, concluded.',
  'The barber-surgeon has put things back, mostly the right way round.',
  'Order is restored. The mud is a slightly different colour.',
];
export const VICTORY_LINE = 'The Turnip Rebellion is over. The turnips were unharmed.';

export const NAMED_SUFFIX: Record<string, string> = { woodcutter: 'the Woodcutter', farmhand: '', mob: '' };
