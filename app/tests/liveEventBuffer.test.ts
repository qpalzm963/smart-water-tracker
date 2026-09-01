import { describe, expect, it } from 'vitest';
import { prependUniqueLiveEvent } from '../src/services/ble/liveEventBuffer';
import type { BleWaterEvent } from '../src/types';

const event = (eventId: string): BleWaterEvent => ({
  eventId,
  occurredAt: 1_788_224_304,
  type: 'drink',
  amountMl: 100,
  remainingMl: 400,
  todayTotalMl: 100,
  timeSynced: true,
});

describe('prependUniqueLiveEvent', () => {
  it('does not add a history replay when the live event is already visible', () => {
    const existing = event('water-device-1');
    const current = [existing];

    const next = prependUniqueLiveEvent(current, event('water-device-1'));

    expect(next).toEqual([existing]);
    expect(next).toBe(current);
  });

  it('prepends new events and retains at most 50 rows', () => {
    const existing = Array.from({ length: 50 }, (_, index) => event(`event-${index}`));

    const next = prependUniqueLiveEvent(existing, event('event-new'));

    expect(next).toHaveLength(50);
    expect(next[0].eventId).toBe('event-new');
    expect(next.at(-1)?.eventId).toBe('event-48');
  });
});
