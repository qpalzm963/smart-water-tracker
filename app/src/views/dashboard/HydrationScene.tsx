import React from 'react';
import { WaterGlassIllustration } from './WaterGlassIllustration';

export interface HydrationSceneProps {
  progress: number;
}

export const HydrationScene: React.FC<HydrationSceneProps> = ({ progress }) => (
  <div className="tech-scene__fallback" aria-hidden="true">
    <span className="tech-scene__static-halo" />
    <WaterGlassIllustration progress={progress * 100} />
  </div>
);
