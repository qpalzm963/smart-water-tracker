import React from 'react';
import { CircleCheck, CircleX, Info } from 'lucide-react';

interface ToastProps {
  message: string | null;
  type?: 'success' | 'error' | 'info';
  onClose?: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'info', onClose }) => {
  if (!message) return null;

  const icons = {
    success: CircleCheck,
    error: CircleX,
    info: Info,
  };
  const Icon = icons[type];

  return (
    <div className={`toast-notification toast-${type}`} onClick={onClose} role="status">
      <Icon className="toast-icon" size={20} aria-hidden="true" />
      <span className="toast-text">{message}</span>
    </div>
  );
};
