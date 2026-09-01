import React from 'react';

interface WaterDropMarkProps {
  className?: string;
  title?: string;
}

export const WaterDropMark: React.FC<WaterDropMarkProps> = ({ className, title }) => (
  <svg
    className={className}
    viewBox="0 0 48 48"
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : true}
  >
    {title && <title>{title}</title>}
    <path
      d="M24 4C18 13 10 21 10 30a14 14 0 0 0 28 0C38 21 30 13 24 4Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinejoin="round"
    />
    <path
      d="M18 31c1.2 3.2 3.5 4.8 7 5"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);
