import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
          "border border-white/35 bg-[linear-gradient(135deg,#1d4ed8_0%,#0ea5e9_54%,#14b8a6_100%)] text-primary-foreground shadow-[0_12px_26px_-16px_rgba(29,78,216,0.8)] hover:saturate-110",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_10px_20px_-14px_rgba(239,68,68,0.85)] border-destructive-border",
        outline:
          "border border-white/70 bg-white/65 text-slate-700 shadow-[0_8px_16px_-14px_rgba(15,23,42,0.7)] backdrop-blur-md hover:bg-white/80",
        secondary:
          "border border-cyan-100/90 bg-[linear-gradient(135deg,rgba(236,253,255,0.9),rgba(239,246,255,0.82))] text-secondary-foreground",
        ghost: "border border-transparent hover:bg-white/55 hover:backdrop-blur-sm",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-10 px-4 py-2.5",
        sm: "min-h-8 rounded-lg px-3 text-xs",
        lg: "min-h-11 rounded-xl px-8 text-sm",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
