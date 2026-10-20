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
import { ProfilePage } from "./pages/ProfilePage";

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
        // 401 = unauthed, expected. Any other error (500, network down,
        // bad JSON) → treat as unauthed too so the user lands on /login
        // instead of white-screening on a broken backend. The LoginPage
        // itself will surface its own 500s during the actual login call.
        if (err instanceof ApiError) return null;
        console.error("[fetchMeSafely] unexpected error:", err);
        return null;
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

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profile",
  beforeLoad: async ({ context }) => {
    const user = await fetchMeSafely(context);
    if (!user) throw redirect({ to: "/login" });
  },
  component: ProfilePage,
});

function DocumentDetailPage() {
  const { documentId } = documentDetailRoute.useParams();
  return <DocumentEditor documentId={documentId} />;
}

export const routeTree = rootRoute.addChildren([
  loginRoute,
  documentListRoute,
  documentDetailRoute,
  profileRoute,
]);
