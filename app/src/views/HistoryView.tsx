import React, { useEffect, useState } from 'react';
import { Droplets, GlassWater, History, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useWater } from '../contexts/WaterContext';
import { WaterEventType } from '../types';

interface HistoryViewProps {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ showToast }) => {
  const { records, pagination, fetchRecords, deleteWaterRecord, isLoading } = useWater();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [eventType, setEventType] = useState<WaterEventType | ''>('');
  const [page, setPage] = useState(1);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  const loadData = (targetPage: number = page) =>
    fetchRecords({
      page: targetPage,
      limit: 15,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      eventType: eventType || undefined,
    }).catch((err) => {
      showToast(err.message || '載入歷程失敗', 'error');
    });

  useEffect(() => {
    loadData(1);
    setPage(1);
  }, [startDate, endDate, eventType]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.totalPages) return;
    setPage(newPage);
    loadData(newPage);
  };

  const handleResetFilters = () => {
    setStartDate('');
    setEndDate('');
    setEventType('');
    setPage(1);
  };

  const handleDelete = async (recordId: string, occurredAt: string) => {
    const occurredAtLabel = new Date(occurredAt).toLocaleString();
    if (!window.confirm(`確定要永久刪除 ${occurredAtLabel} 的喝水紀錄嗎？刪除後無法復原。`)) {
      return;
    }

    setDeletingRecordId(recordId);
    try {
      await deleteWaterRecord(recordId);
      const targetPage = records.length === 1 && page > 1 ? page - 1 : page;
      setPage(targetPage);
      await loadData(targetPage);
      showToast('喝水紀錄已永久刪除', 'success');
    } catch (err: any) {
      showToast(err.message || '刪除喝水紀錄失敗', 'error');
    } finally {
      setDeletingRecordId(null);
    }
  };

  return (
    <div className="view-container history-view">
      <div className="section-header">
        <div>
          <h2 className="title-with-icon">
            <History aria-hidden="true" />
            喝水歷程紀錄
          </h2>
          <p className="subtitle">查詢您過去的每一次飲水與補水詳細時間紀錄。</p>
        </div>

        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => loadData(page)} disabled={isLoading}>
            {isLoading ? (
              <LoaderCircle className="icon-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            {isLoading ? '載入中...' : '重新整理'}
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="card filter-card">
        <div className="filter-grid">
          <div className="form-group">
            <label>開始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="form-group">
            <label>結束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="form-group">
            <label>事件類型</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as any)}
              className="select-field"
            >
              <option value="">全部類型 (All)</option>
              <option value="drink">僅喝水 (Drink)</option>
              <option value="refill">僅補水 (Refill)</option>
            </select>
          </div>

          <div className="form-group" style={{ justifyContent: 'flex-end', display: 'flex' }}>
            <button className="btn btn-outline btn-sm" onClick={handleResetFilters}>
              重設篩選
            </button>
          </div>
        </div>
      </div>

      {/* Records Table */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        {records.length === 0 ? (
          <div className="empty-state-box">
            <p>查無符合條件的喝水紀錄</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>發生時間 (Occurred At)</th>
                  <th>事件類型</th>
                  <th>水量變化</th>
                  <th>杯內剩餘量</th>
                  <th>來源裝置</th>
                  <th>事件識別碼 (Event ID)</th>
                  <th className="record-actions-column">操作</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.occurredAt).toLocaleString()}</td>
                    <td>
                      <span
                        className={`badge badge-with-icon ${
                          record.eventType === 'drink' ? 'badge-primary' : 'badge-success'
                        }`}
                      >
                        {record.eventType === 'drink' ? (
                          <GlassWater aria-hidden="true" />
                        ) : (
                          <Droplets aria-hidden="true" />
                        )}
                        {record.eventType === 'drink' ? '喝水' : '補水'}
                      </span>
                    </td>
                    <td className="font-bold">+{record.amountMl} ml</td>
                    <td>{record.remainingMl !== null ? `${record.remainingMl} ml` : '-'}</td>
                    <td className="text-muted">{record.deviceId || '手動/App'}</td>
                    <td className="font-mono text-muted" style={{ fontSize: '0.8rem' }}>
                      {record.eventId || record.id}
                    </td>
                    <td className="record-actions-column">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm record-delete-button"
                        onClick={() => handleDelete(record.id, record.occurredAt)}
                        disabled={deletingRecordId !== null}
                        aria-label={`刪除 ${new Date(record.occurredAt).toLocaleString()} 的紀錄`}
                      >
                        {deletingRecordId === record.id ? (
                          <LoaderCircle className="icon-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 aria-hidden="true" />
                        )}
                        {deletingRecordId === record.id ? '刪除中...' : '刪除'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {pagination.totalPages > 1 && (
          <div className="pagination-bar">
            <button
              className="btn btn-secondary btn-sm"
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
            >
              上一頁
            </button>
            <span className="page-indicator">
              第 {page} 頁 / 共 {pagination.totalPages} 頁 (總計 {pagination.total} 筆)
            </span>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page >= pagination.totalPages}
              onClick={() => handlePageChange(page + 1)}
            >
              下一頁
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
