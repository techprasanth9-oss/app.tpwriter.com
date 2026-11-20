import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError, setShareToken } from "./lib/api/client";
import * as authApi from "./lib/api/auth";
import { DocumentEditor } from "./components/DocumentEditor";
import { PrintView } from "./components/PrintView";
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

/** Only same-app paths are followed after login (no open redirects). */
export function safeRedirect(value: unknown): string | undefined {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : undefined;
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async ({ context, search }) => {
    const user = await fetchMeSafely(context);
    if (user) throw redirect({ href: search.redirect ?? "/" });
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
  validateSearch: (search: Record<string, unknown>): { share?: string; thread?: string } => ({
    share: typeof search.share === "string" ? search.share : undefined,
    thread: typeof search.thread === "string" ? search.thread : undefined,
  }),
  beforeLoad: async ({ context, params, search, location }) => {
    // A share link's token is kept for this tab, before anything loads.
    if (search.share) setShareToken(params.documentId, search.share);
    const user = await fetchMeSafely(context);
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } });
  },
  component: DocumentDetailPage,
});

/** Read-only print layout; the server's PDF renderer loads this. */
const documentPrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$documentId/print",
  validateSearch: (search: Record<string, unknown>): { share?: string } => ({
    share: typeof search.share === "string" ? search.share : undefined,
  }),
  beforeLoad: async ({ context, params, search }) => {
    // The server's PDF renderer passes a link-holder's token this way.
    if (search.share) setShareToken(params.documentId, search.share);
    const user = await fetchMeSafely(context);
    if (!user) throw redirect({ to: "/login" });
  },
  component: DocumentPrintPage,
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

function DocumentPrintPage() {
  const { documentId } = documentPrintRoute.useParams();
  return <PrintView documentId={documentId} />;
}

export const routeTree = rootRoute.addChildren([
  loginRoute,
  documentListRoute,
  documentDetailRoute,
  documentPrintRoute,
  profileRoute,
]);
