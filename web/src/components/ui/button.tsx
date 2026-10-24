/**
 * Button (ported from the legacy `Components/ui/button.jsx`, shadcn new-york),
 * with the MASTER §3 variants: the green pill (primary actions), the dark
 * button ("New sale"), the outline button, ghost, link and destructive.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-sm font-medium disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** Dark neutral (`primary`), 8 px radius: "New sale", the active tab. */
        default: 'rounded-lg bg-primary text-primary-foreground shadow-card hover:bg-primary/90 disabled:opacity-60',
        /** Green pill: "+ Add", Checkout, Save. */
        green:
          'rounded-full bg-green font-semibold text-white hover:bg-green-hover disabled:bg-disabled disabled:text-disabled-foreground',
        outline:
          'rounded-lg border border-border bg-card text-foreground shadow-card hover:bg-accent disabled:opacity-60',
        secondary: 'rounded-lg bg-secondary text-secondary-foreground hover:bg-accent disabled:opacity-60',
        ghost: 'rounded-lg text-foreground hover:bg-accent disabled:opacity-60',
        link: 'text-green underline-offset-4 hover:underline disabled:opacity-60',
        /** Outline in the destructive colour (row actions, "Remove"). */
        destructive:
          'rounded-lg border border-destructive bg-card text-destructive hover:bg-danger-bg disabled:opacity-60',
        /** Filled destructive (the confirm button of a destructive dialog). */
        destructiveSolid: 'rounded-lg bg-destructive-strong text-white hover:bg-danger disabled:opacity-60',
      },
      /*
       * MASTER §6 Targets: the visual heights stay (36 px default); the small
       * and icon-only sizes get a 44 px hit area (`hit-area`, theme.css).
       */
      size: {
        default: 'h-9 px-4',
        sm: 'relative h-8 px-3 text-[13px] hit-area',
        lg: 'h-11 px-6 text-[15px]',
        xl: 'h-12 px-6 text-base',
        icon: 'relative size-9 hit-area',
        'icon-sm': 'relative size-8 hit-area',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
