"use client";

import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "@/providers/auth-provider";

/**
 * Hook consumer del AuthContext. Throw si se usa fuera de un
 * `<AuthProvider>` (signal de bug, no estado normal).
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      "useAuth must be used within an <AuthProvider>. Wrap your tree in providers/auth-provider.tsx.",
    );
  }
  return ctx;
}
