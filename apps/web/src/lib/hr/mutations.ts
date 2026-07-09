import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

type ToastInput = {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
};

type HrMutationOptions = {
  successTitle?: string;
  successDescription?: string;
  onSuccess?: () => void;
};

/** Shared toast + refresh pattern for HR module mutations. */
export async function runHrMutation(
  router: AppRouterInstance,
  toast: (input: ToastInput) => void,
  action: () => Promise<{ error: { message: string } | null }>,
  options?: HrMutationOptions
) {
  const { error } = await action();
  if (error) {
    toast({
      title: "Action failed",
      description: error.message,
      variant: "destructive",
    });
    return false;
  }
  if (options?.successTitle) {
    toast({
      title: options.successTitle,
      description: options.successDescription,
    });
  }
  options?.onSuccess?.();
  router.refresh();
  return true;
}

export function parsePaginatedRpc<T>(data: unknown): { items: T[]; total_count: number } {
  const row = data as { items?: T[]; total_count?: number } | null;
  return {
    items: row?.items ?? [],
    total_count: row?.total_count ?? 0,
  };
}
