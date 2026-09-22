"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

export function OperationalHoverCard<T>({
  items,
  renderItem,
  className,
}: {
  items: T[];
  renderItem: (item: T, isHovered: boolean) => React.ReactNode;
  className?: string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3", className)}>
      {items.map((item, idx) => {
        const isHovered = hoveredIdx === idx;

        return (
          <div
            key={idx}
            className="relative group block p-1 h-full w-full"
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            onFocus={() => setHoveredIdx(idx)}
            onBlur={() => setHoveredIdx(null)}
            tabIndex={0}
          >
            <AnimatePresence>
              {isHovered && (
                <motion.span
                  className="absolute inset-0 h-full w-full bg-pitwall-border/40 rounded-md block -z-10"
                  layoutId="hoverBackground"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: 1,
                    transition: { duration: 0.15 },
                  }}
                  exit={{
                    opacity: 0,
                    transition: { duration: 0.15, delay: 0.1 },
                  }}
                />
              )}
            </AnimatePresence>
            <div className="rounded-md border border-pitwall-border bg-pitwall-card p-3 h-full transition-colors group-hover:border-pitwall-steel">
              {renderItem(item, isHovered)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
