import { DrinkRecord } from '../types';

export const formatRecordDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '時間未知';
  return date.toLocaleString('zh-TW');
};

export const formatRecordTime = (record: DrinkRecord): string => {
  if (record.timeSynced === false) return '未校時';
  const date = new Date(record.occurredAt);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

export const formatRecordDateLabel = (record: DrinkRecord): string => {
  if (record.timeSynced === false) {
    return `未校時事件（同步於 ${formatRecordDateTime(record.syncedAt)}）`;
  }
  return formatRecordDateTime(record.occurredAt);
};
