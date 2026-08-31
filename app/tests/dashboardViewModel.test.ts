import { describe, expect, it } from 'vitest';
import { DrinkRecord } from '../src/types';
import {
  buildDrinkPayload,
  getDayLabel,
  getBleDisplay,
  getGreeting,
  getProgress,
  getRecentRecords,
  getSceneProgress,
  getWeekPercent,
} from '../src/views/dashboard/dashboardViewModel';

describe('dashboardViewModel', () => {
  it('calculates display progress and caps the ring at 100%', () => {
    expect(getProgress(1200, 2000)).toEqual({ percent: 60, ringPercent: 60 });
    expect(getProgress(2400, 2000)).toEqual({ percent: 120, ringPercent: 100 });
    expect(getProgress(100, 0)).toEqual({ percent: 0, ringPercent: 0 });
  });

  it('returns a time-aware Traditional Chinese greeting', () => {
    expect(getGreeting(new Date('2026-08-27T08:00:00'))).toBe('早安');
    expect(getGreeting(new Date('2026-08-27T14:00:00'))).toBe('午安');
    expect(getGreeting(new Date('2026-08-27T20:00:00'))).toBe('晚安');
  });

  it('formats BLE states without inventing a weight', () => {
    expect(getBleDisplay('connected', 328.25)).toEqual({
      label: '智慧水杯已連線',
      value: '328 g',
      tone: 'connected',
    });
    expect(getBleDisplay('connecting')).toMatchObject({
      label: '智慧水杯連線中',
      value: '',
    });
    expect(getBleDisplay('disconnected')).toMatchObject({
      label: '智慧水杯未連線',
      value: '前往連線',
    });
  });

  it('sorts records newest first and limits the result', () => {
    const records = [
      { id: 'old', occurredAt: '2026-08-27T09:30:00Z' },
      { id: 'new', occurredAt: '2026-08-27T13:45:00Z' },
      { id: 'mid', occurredAt: '2026-08-27T11:00:00Z' },
      { id: 'latest', occurredAt: '2026-08-27T15:30:00Z' },
      { id: 'yesterday', occurredAt: '2026-08-26T08:00:00Z' },
    ] as DrinkRecord[];

    expect(
      getRecentRecords(records, new Date('2026-08-27T12:00:00Z')).map(
        (record) => record.id,
      ),
    ).toEqual([
      'latest',
      'new',
      'mid',
    ]);
  });

  it('builds a drink payload with the selected amount', () => {
    expect(buildDrinkPayload(250, new Date('2026-08-27T09:30:00Z'))).toEqual({
      eventType: 'drink',
      amountMl: 250,
      occurredAt: '2026-08-27T09:30:00.000Z',
    });
  });

  it('normalizes the scene progress into the 0..1 range', () => {
    expect(getSceneProgress(-20)).toBe(0);
    expect(getSceneProgress(60)).toBe(0.6);
    expect(getSceneProgress(120)).toBe(1);
    expect(getSceneProgress(Number.NaN)).toBe(0);
  });

  it('formats a dashboard date without timezone drift', () => {
    expect(getDayLabel('2026-08-31')).toBe('8 月 31 日');
    expect(getDayLabel('bad-date')).toBe('日期未定');
  });

  it('clamps weekly summary percentages', () => {
    expect(getWeekPercent(0, 2000)).toBe(0);
    expect(getWeekPercent(1000, 2000)).toBe(50);
    expect(getWeekPercent(2400, 2000)).toBe(100);
    expect(getWeekPercent(1000, 0)).toBe(0);
  });
});
