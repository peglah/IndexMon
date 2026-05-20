"use client";

import { useState } from "react";

type Toast = {
  id: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
};

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = (toast: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
    return id;
  };

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  return { toasts, toast, dismiss };
}