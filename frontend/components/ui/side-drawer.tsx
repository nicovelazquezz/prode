"use client";

import * as React from "react";
import { Drawer as VaulDrawer } from "vaul";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Side drawer (right-side por default) basado en vaul. Pensado para
 * mostrar detalle de una entidad sin perder el contexto de la lista
 * (admin pagos, audit log, etc.).
 *
 * En mobile vaul ya maneja el gesto de drag-to-close. En desktop,
 * el drawer ocupa ~480px desde la derecha (ajustable via prop width).
 */
const SideDrawer = ({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  children: React.ReactNode;
}) => (
  <VaulDrawer.Root open={open} onOpenChange={onOpenChange} direction="right">
    {children}
  </VaulDrawer.Root>
);

const SideDrawerOverlay = React.forwardRef<
  React.ElementRef<typeof VaulDrawer.Overlay>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Overlay>
>(({ className, ...props }, ref) => (
  <VaulDrawer.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-[rgba(5,9,14,0.4)]", className)}
    {...props}
  />
));
SideDrawerOverlay.displayName = "SideDrawerOverlay";

const SideDrawerContent = React.forwardRef<
  React.ElementRef<typeof VaulDrawer.Content>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Content> & {
    width?: string;
  }
>(({ className, children, width = "max-w-lg", ...props }, ref) => (
  <VaulDrawer.Portal>
    <SideDrawerOverlay />
    <VaulDrawer.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col",
        "bg-[var(--color-landing-surface)]",
        "border-l border-[var(--color-landing-line-strong)]",
        width,
        className,
      )}
      {...props}
    >
      <VaulDrawer.Close
        aria-label="Cerrar"
        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-sm text-[var(--color-landing-text-muted)] transition-colors hover:bg-[var(--color-landing-surface-2)] hover:text-[var(--color-landing-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-landing-gold)]"
      >
        <X className="h-4 w-4" aria-hidden />
      </VaulDrawer.Close>
      {children}
    </VaulDrawer.Content>
  </VaulDrawer.Portal>
));
SideDrawerContent.displayName = "SideDrawerContent";

const SideDrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "border-b border-[var(--color-landing-line-strong)] p-6 pr-12",
      className,
    )}
    {...props}
  />
);

const SideDrawerTitle = React.forwardRef<
  React.ElementRef<typeof VaulDrawer.Title>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Title>
>(({ className, ...props }, ref) => (
  <VaulDrawer.Title
    ref={ref}
    className={cn(
      "font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight leading-none",
      "text-[var(--color-landing-text)]",
      className,
    )}
    {...props}
  />
));
SideDrawerTitle.displayName = "SideDrawerTitle";

const SideDrawerDescription = React.forwardRef<
  React.ElementRef<typeof VaulDrawer.Description>,
  React.ComponentPropsWithoutRef<typeof VaulDrawer.Description>
>(({ className, ...props }, ref) => (
  <VaulDrawer.Description
    ref={ref}
    className={cn(
      "mt-2 font-sans text-sm text-[var(--color-landing-text-muted)]",
      className,
    )}
    {...props}
  />
));
SideDrawerDescription.displayName = "SideDrawerDescription";

const SideDrawerBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex-1 overflow-y-auto p-6", className)}
    {...props}
  />
);

const SideDrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "border-t border-[var(--color-landing-line-strong)] p-6 flex flex-wrap gap-2 justify-end",
      className,
    )}
    {...props}
  />
);

export {
  SideDrawer,
  SideDrawerContent,
  SideDrawerHeader,
  SideDrawerTitle,
  SideDrawerDescription,
  SideDrawerBody,
  SideDrawerFooter,
};
