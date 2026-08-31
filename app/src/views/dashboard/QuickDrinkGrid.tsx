import React from 'react';
import { Check, Plus } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

interface QuickDrinkGridProps {
  amounts: readonly number[];
  busyAmount: number | null;
  successAmount: number | null;
  onDrink: (amount: number) => void;
}

export const QuickDrinkGrid: React.FC<QuickDrinkGridProps> = ({
  amounts,
  busyAmount,
  successAmount,
  onDrink,
}) => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      id="quick-drink"
      className="dashboard-card desktop-quick-card"
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.13 }}
    >
      <div className="desktop-card-heading">
        <div>
          <span className="desktop-card-overline">快速記錄</span>
          <h2>喝了多少？</h2>
        </div>
        <span className="desktop-card-meta">現在</span>
      </div>
      <p className="desktop-quick-card__hint">選擇這次喝的容量</p>
      <div className="desktop-quick-grid">
        {amounts.map((amount) => {
          const isBusy = busyAmount === amount;
          const isSuccess = successAmount === amount;
          return (
            <motion.button
              key={amount}
              type="button"
              className={`desktop-quick-button ${isSuccess ? 'desktop-quick-button--success' : ''}`}
              onClick={() => onDrink(amount)}
              disabled={busyAmount !== null}
              aria-label={`記錄喝水 ${amount} 毫升`}
              whileTap={reduceMotion ? undefined : { scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 430, damping: 28 }}
            >
              <span className="desktop-quick-button__label">
                {isBusy ? '記錄中' : `${amount} ml`}
              </span>
              <span className="desktop-quick-button__icon" aria-hidden="true">
                <AnimatePresence mode="wait" initial={false}>
                  {isSuccess ? (
                    <motion.span
                      key="success"
                      initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                    >
                      <Check size={20} strokeWidth={2.6} />
                    </motion.span>
                  ) : (
                    <motion.span key="plus" initial={false} animate={{ opacity: 1 }}>
                      <Plus size={18} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </motion.button>
          );
        })}
      </div>
    </motion.section>
  );
};
