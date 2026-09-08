import {
  describeSkillRouting,
  readSkillRouting,
} from '@web/utils/skill-routing';
import { describe, expect, it } from 'vitest';

describe('readSkillRouting', () => {
  it('reads a decision the gateway recorded', () => {
    expect(
      readSkillRouting({
        skill_routing: {
          method: 'embedding',
          similarity: 0.93,
          threshold: 0.8,
          candidates: 2,
        },
      }),
    ).toEqual({
      method: 'embedding',
      similarity: 0.93,
      threshold: 0.8,
      candidates: 2,
    });
  });

  it('is null for a log whose skill the caller named, or older logs', () => {
    expect(readSkillRouting({})).toBeNull();
    expect(readSkillRouting(null)).toBeNull();
    expect(readSkillRouting({ skill_routing: { method: 'guess' } })).toBeNull();
  });
});

describe('describeSkillRouting', () => {
  it('says how close the match was, against the bar it had to clear', () => {
    const description = describeSkillRouting({
      method: 'embedding',
      similarity: 0.93,
      threshold: 0.8,
      candidates: 2,
    });
    expect(description.label).toBe('sent to the closest match');
    expect(description.detail).toBe(
      '93% match, needs 80% \u00b7 from 2 skills',
    );
  });

  it('shows why a skill was created', () => {
    const description = describeSkillRouting({
      method: 'created',
      similarity: 0.41,
      threshold: 0.8,
      candidates: 1,
    });
    expect(description.label).toBe('started a new skill');
    expect(description.detail).toBe('41% match, needs 80% \u00b7 from 1 skill');
  });

  it('has nothing to add for the only skill', () => {
    expect(
      describeSkillRouting({
        method: 'only_skill',
        similarity: null,
        threshold: null,
        candidates: 1,
      }),
    ).toMatchObject({ label: 'the agent had one skill', detail: null });
    expect(
      describeSkillRouting({
        method: 'created',
        similarity: null,
        threshold: 0.8,
        candidates: 0,
      }).detail,
    ).toBeNull();
  });
});
