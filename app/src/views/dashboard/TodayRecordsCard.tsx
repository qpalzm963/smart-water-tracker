import React from 'react';
import { ChevronRight, Droplet, GlassWater, LoaderCircle, Trash2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { DrinkRecord } from '../../types';

interface TodayRecordsCardProps {
  records: DrinkRecord[];
  onViewAll: () => void;
  onDelete: (record: DrinkRecord) => Promise<void>;
  deletingRecordId: string | null;
}

const formatTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

export const TodayRecordsCard: React.FC<TodayRecordsCardProps> = ({
  records,
  onViewAll,
  onDelete,
  deletingRecordId,
}) => {
  const reduceMotion = useReducedMotion();

  return (
  <motion.section
    className="dashboard-card today-records desktop-records-card"
    initial={reduceMotion ? false : { opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay: 0.19 }}
  >
    <div className="dashboard-card__header desktop-card-heading">
      <div>
        <span className="desktop-card-overline">今日紀錄</span>
        <h2>今日紀錄</h2>
      </div>
      <button type="button" className="desktop-card-link" onClick={onViewAll}>
        查看全部
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>

    {records.length === 0 ? (
      <div className="today-records__empty">
        <GlassWater size={28} aria-hidden="true" />
        <p>今天還沒有紀錄，先喝一杯水吧。</p>
      </div>
    ) : (
      <motion.div
        className="today-records__list desktop-records-list"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: reduceMotion ? 0 : 0.06 } } }}
      >
        <div className="desktop-records-table-head" aria-hidden="true">
          <span />
          <span>容量</span>
          <span>來源</span>
          <span>時間</span>
          <span />
        </div>
        {records.map((record) => (
          <motion.div
            key={record.id}
            className={`record-row desktop-record-row ${record.eventType === 'refill' ? 'desktop-record-row--refill' : ''}`}
            variants={{
              hidden: { opacity: 0, y: reduceMotion ? 0 : 8 },
              visible: { opacity: 1, y: 0 },
            }}
          >
            <span className="record-row__icon desktop-record-row__icon" aria-hidden="true">
              {record.eventType === 'refill' ? <Droplet size={19} /> : <GlassWater size={19} />}
            </span>
            <strong>{record.amountMl} ml</strong>
            <span className="desktop-record-row__source">{record.eventType === 'refill' ? '補水事件' : '飲水紀錄'}</span>
            <time dateTime={record.occurredAt}>{formatTime(record.occurredAt)}</time>
            <button
              type="button"
              className="today-records__delete desktop-records__delete"
              onClick={() => void onDelete(record)}
              disabled={deletingRecordId !== null}
              aria-label={`刪除 ${new Date(record.occurredAt).toLocaleString()} 的紀錄`}
              title="永久刪除紀錄"
            >
              {deletingRecordId === record.id ? (
                <LoaderCircle className="icon-spin" size={16} aria-hidden="true" />
              ) : (
                <Trash2 size={16} aria-hidden="true" />
              )}
            </button>
          </motion.div>
        ))}
      </motion.div>
    )}
  </motion.section>
  );
};
