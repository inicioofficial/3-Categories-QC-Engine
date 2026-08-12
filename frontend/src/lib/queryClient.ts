import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60_000,
      gcTime: 15 * 60_000,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * (attemptIndex + 1), 3000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: false,
      networkMode: "always",
    },
  },
});
