import type { BleWaterEvent } from '../../types';

const MAX_LIVE_EVENTS = 50;

export function prependUniqueLiveEvent(
  currentEvents: BleWaterEvent[],
  incomingEvent: BleWaterEvent,
): BleWaterEvent[] {
  if (currentEvents.some((event) => event.eventId === incomingEvent.eventId)) {
    return currentEvents;
  }

  return [incomingEvent, ...currentEvents].slice(0, MAX_LIVE_EVENTS);
}
