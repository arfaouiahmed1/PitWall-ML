import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border-[1.5px] text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border-border bg-transparent text-foreground hover:border-primary/60 hover:bg-accent",
        secondary: "border-secondary bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
        ghost: "border-transparent bg-transparent text-foreground hover:border-border hover:bg-accent",
        green: "border-pitwall-green/60 bg-pitwall-green/15 text-pitwall-mint hover:bg-pitwall-green/25",
        yellow: "border-pitwall-yellow/60 bg-pitwall-yellow/15 text-pitwall-amberlight hover:bg-pitwall-yellow/25",
        red: "border-pitwall-danger/60 bg-pitwall-danger/15 text-pitwall-rose hover:bg-pitwall-danger/25",
        purple: "border-violet-400/60 bg-violet-400/15 text-violet-200 hover:bg-violet-400/25",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
