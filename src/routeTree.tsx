import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./lib/api/client";
import * as authApi from "./lib/api/auth";
import { DocumentEditor } from "./components/DocumentEditor";
import { DocumentListPage } from "./pages/DocumentListPage";
import { LoginPage } from "./pages/LoginPage";

export interface RouterContext {
  queryClient: QueryClient;
}

const ME_KEY = ["auth", "me"] as const;

async function fetchMeSafely(ctx: RouterContext) {
  const existing = ctx.queryClient.getQueryData<authApi.AuthUser | null>(ME_KEY);
  if (existing !== undefined) return existing;
  return ctx.queryClient.fetchQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await authApi.fetchMe();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async ({ context }) => {
    const user = await fetchMeSafely(context);
    if (user) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

const documentListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    const user = await fetchMeSafely(context);
    if (!user) throw redirect({ to: "/login" });
  },
  component: DocumentListPage,
});

const documentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$documentId",
  beforeLoad: async ({ context }) => {
    const user = await fetchMeSafely(context);
    if (!user) throw redirect({ to: "/login" });
  },
  component: DocumentDetailPage,
});

function DocumentDetailPage() {
  const { documentId } = documentDetailRoute.useParams();
  return <DocumentEditor documentId={documentId} />;
}

export const routeTree = rootRoute.addChildren([
  loginRoute,
  documentListRoute,
  documentDetailRoute,
]);
