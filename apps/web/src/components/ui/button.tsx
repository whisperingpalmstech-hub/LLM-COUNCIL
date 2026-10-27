// Adapted from T3 Code's button (MIT, T3 Tools Inc.), trimmed to the variants Synod uses.
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-sm outline-none transition-[background-color,box-shadow,scale,color] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 gap-1.5 px-2.5",
        default: "h-8 px-3",
        lg: "h-10 px-4 text-[0.9375rem]",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5"
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs inset-shadow-[0_1px_rgb(255_255_255/16%)] hover:bg-primary/90",
        outline: "border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent dark:bg-input/30 dark:hover:bg-input/60",
        ghost: "border-transparent text-foreground hover:bg-accent data-[pressed]:bg-accent",
        "ghost-muted": "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        secondary: "border-transparent bg-secondary text-foreground hover:bg-accent",
        destructive: "border-error bg-error text-white hover:bg-error/90"
      }
    }
  }
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
