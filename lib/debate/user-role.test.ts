import { describe, it, expect } from 'vitest';
import { resolveParticipantRole, type SpeakerSeat } from '@/lib/debate/user-role';

const ME = '11111111-1111-1111-1111-111111111111';
const SOMEONE_ELSE = '22222222-2222-2222-2222-222222222222';

function seat(role: SpeakerSeat['role'], user_id: string | null = ME): SpeakerSeat {
  return { user_id, role };
}

describe('resolveParticipantRole', () => {
  it('is an observer when the debate has no seats', () => {
    expect(resolveParticipantRole([], ME)).toBe('observer');
  });

  it('is an observer when none of the seats are theirs', () => {
    expect(
      resolveParticipantRole([seat('moderator', SOMEONE_ELSE), seat('affirmative', SOMEONE_ELSE)], ME),
    ).toBe('observer');
  });

  it('is a moderator when their only seat is the moderator seat', () => {
    expect(resolveParticipantRole([seat('moderator')], ME)).toBe('moderator');
  });

  it('is a speaker when their only seat is affirmative', () => {
    expect(resolveParticipantRole([seat('affirmative')], ME)).toBe('speaker');
  });

  it('is a speaker when their only seat is negative', () => {
    expect(resolveParticipantRole([seat('negative')], ME)).toBe('speaker');
  });

  it('is an observer when their only seat is panelist', () => {
    expect(resolveParticipantRole([seat('panelist')], ME)).toBe('observer');
  });

  // The bug behind issue #100.  `find()` took the first matching row whatever
  // its role, so one person holding two seats resolved to whichever row the
  // query happened to return first — and neither snapshot query sorted, so
  // that was Postgres heap order.  An unrelated UPDATE moves a tuple to the
  // end of the heap and silently changes the answer.
  it('prefers the moderator seat when it comes back after a speaking seat', () => {
    expect(resolveParticipantRole([seat('affirmative'), seat('moderator')], ME)).toBe('moderator');
  });

  it('prefers the moderator seat when it comes back before a speaking seat', () => {
    expect(resolveParticipantRole([seat('moderator'), seat('affirmative')], ME)).toBe('moderator');
  });

  it('prefers a speaking seat over a panelist seat, in either order', () => {
    expect(resolveParticipantRole([seat('panelist'), seat('negative')], ME)).toBe('speaker');
    expect(resolveParticipantRole([seat('negative'), seat('panelist')], ME)).toBe('speaker');
  });

  it('ignores other people holding the higher-precedence seat', () => {
    expect(
      resolveParticipantRole([seat('moderator', SOMEONE_ELSE), seat('affirmative', ME)], ME),
    ).toBe('speaker');
  });

  // An unclaimed seat carries user_id = null.  A viewer with no id must not
  // match one and inherit its role.
  it('does not match an unclaimed seat when there is no user id', () => {
    expect(resolveParticipantRole([seat('moderator', null)], null)).toBe('observer');
  });

  it('does not match an unclaimed seat when there is a user id', () => {
    expect(resolveParticipantRole([seat('moderator', null)], ME)).toBe('observer');
  });
});
