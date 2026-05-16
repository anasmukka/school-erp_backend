import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "whitespace-nowrap inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate ",
  {
    variants: {
      variant: {
        default:
          "border-white/30 bg-[linear-gradient(135deg,#2563eb,#0ea5e9)] text-primary-foreground shadow-[0_10px_20px_-14px_rgba(37,99,235,0.8)]",
        secondary:
          "border-cyan-100/70 bg-cyan-50/90 text-cyan-800",
        destructive:
          "border-rose-100 bg-rose-100 text-rose-700 shadow-[0_10px_20px_-16px_rgba(244,63,94,0.8)]",
        outline: "bg-white/75 text-foreground border [border-color:var(--badge-outline)] backdrop-blur-sm",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
