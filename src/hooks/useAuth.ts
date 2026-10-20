import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as authApi from "~/lib/api/auth";
import { ApiError } from "~/lib/api/client";

const ME_KEY = ["auth", "me"] as const;

export function useAuth() {
  const qc = useQueryClient();

  const meQuery = useQuery({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) => {
      try {
        return await authApi.fetchMe(signal);
      } catch (err) {
        // Any ApiError (401, 500, etc.) → treat as unauthed so the UI
        // can land on the login screen. The actual login attempt will
        // surface a real error if the backend is still broken.
        if (err instanceof ApiError) return null;
        console.error("[useAuth] unexpected error:", err);
        return null;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const loginMut = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: (user) => qc.setQueryData(ME_KEY, user),
  });

  const signupMut = useMutation({
    mutationFn: ({
      email,
      password,
      displayName,
    }: {
      email: string;
      password: string;
      displayName?: string;
    }) => authApi.signup(email, password, displayName),
    onSuccess: (user) => qc.setQueryData(ME_KEY, user),
  });

  const logoutMut = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ queryKey: ["documents"] });
    },
  });

  return {
    user: meQuery.data,
    loading: meQuery.isLoading,
    error: meQuery.error,
    login: loginMut.mutateAsync,
    loginState: loginMut,
    signup: signupMut.mutateAsync,
    signupState: signupMut,
    logout: logoutMut.mutateAsync,
    logoutState: logoutMut,
  };
}
