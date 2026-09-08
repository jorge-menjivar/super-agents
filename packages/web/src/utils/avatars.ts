import { botttsNeutral, identicon, rings, shapes } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';

const BACKGROUNDS = [
  '00acc1',
  '039be5',
  '1e88e5',
  '43a047',
  '546e7a',
  '5e35b1',
  '6d4c41',
  '757575',
  '7cb342',
  '8e24aa',
  'c0ca33',
  'd81b60',
  'e53935',
  'f4511e',
  'fb8c00',
  'fdd835',
  'ffb300',
  '00897b',
  '3949ab',
];

type AvatarStyle = Parameters<typeof createAvatar>[0];

const createEntityAvatar = (style: AvatarStyle, seed: string): string => {
  const svg = createAvatar(style, {
    seed,
    size: 24,
    backgroundColor: BACKGROUNDS,
  }).toString();
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

/** An agent's avatar, drawn from its name, as an image URL. */
export const createAgentAvatar = (agentName: string): string =>
  createEntityAvatar(botttsNeutral, agentName);

/** A skill's avatar, drawn from its name, as an image URL. */
export const createSkillAvatar = (skillName: string): string =>
  createEntityAvatar(shapes, skillName);

/**
 * A partition's avatar, as an image URL. Partitions are named `1`, `2`, `3`
 * within their skill, so the skill's name is part of the seed: without it
 * every skill's first partition would wear the same face.
 */
export const createClusterAvatar = (
  skillName: string,
  clusterName: string,
): string => createEntityAvatar(rings, `${skillName}/${clusterName}`);

/** A configuration's avatar, seeded down the same path as its partition. */
export const createArmAvatar = (
  skillName: string,
  clusterName: string,
  armName: string,
): string =>
  createEntityAvatar(identicon, `${skillName}/${clusterName}/${armName}`);
