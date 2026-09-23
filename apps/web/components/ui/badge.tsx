import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border-[1.5px] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
  {
    variants: {
      variant: {
        default: "border-primary/50 bg-primary/15 text-blue-300",
        outline: "border-border bg-transparent text-muted-foreground",
        secondary: "border-secondary bg-secondary text-secondary-foreground",
        destructive: "border-destructive/60 bg-destructive/15 text-pitwall-rose",
        ghost: "border-transparent bg-transparent text-muted-foreground",
        green: "border-pitwall-green/60 bg-pitwall-green/15 text-pitwall-mint",
        yellow: "border-pitwall-yellow/60 bg-pitwall-yellow/15 text-pitwall-amberlight",
        red: "border-pitwall-danger/60 bg-pitwall-danger/15 text-pitwall-rose",
        purple: "border-violet-400/60 bg-violet-400/15 text-violet-200",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
