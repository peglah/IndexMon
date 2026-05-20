"use client";

import { useToast } from "@/components/ui/use-toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <div className="toast-container">
      {toasts.map(({ id, title, description, action }) => (
        <div key={id} className="toast">
          {title && <div className="toast-title">{title}</div>}
          {description && <div className="toast-description">{description}</div>}
          {action}
        </div>
      ))}
    </div>
  );
}