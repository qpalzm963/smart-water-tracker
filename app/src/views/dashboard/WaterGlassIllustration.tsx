import React, { useId } from 'react';

interface WaterGlassIllustrationProps {
  progress: number;
}

export const WaterGlassIllustration: React.FC<WaterGlassIllustrationProps> = ({
  progress,
}) => {
  const clipId = useId().replace(/:/g, '');
  const clamped = Math.min(100, Math.max(0, progress));
  const waterY = 116 - clamped * 0.74;

  return (
    <svg className="water-glass" viewBox="0 0 160 150" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <path d="M34 22h92l-9 106c-1 12-12 18-37 18s-36-6-37-18L34 22Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect
          className="water-glass__water"
          x="30"
          y={waterY}
          width="100"
          height={150 - waterY}
          rx="10"
        />
        <ellipse
          className="water-glass__surface"
          cx="80"
          cy={waterY}
          rx="49"
          ry="7"
        />
      </g>
      <path
        className="water-glass__body"
        d="M34 22h92l-9 106c-1 12-12 18-37 18s-36-6-37-18L34 22Z"
      />
      <ellipse className="water-glass__rim" cx="80" cy="22" rx="46" ry="9" />
      <path className="water-glass__shine" d="M49 40c1 25 3 53 6 76" />
      <ellipse className="water-glass__base" cx="80" cy="130" rx="35" ry="8" />
    </svg>
  );
};
