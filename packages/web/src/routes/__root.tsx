import {
  createRootRoute,
  type ErrorComponentProps,
  isRedirect,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import {
  getAuthStatus,
  ServerUnavailableError,
} from '@web/api/v1/super-agents/auth';
import { Suspense } from 'react';

async function checkAuth({
  location,
}: {
  location: { pathname: string };
}): Promise<void> {
  if (location.pathname === '/login') {
    return;
  }

  try {
    const data = await getAuthStatus();

    if (!data) {
      throw redirect({ to: '/login' });
    }

    if (data.authRequired && !data.authenticated) {
      throw redirect({ to: '/login' });
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    // The server said why it cannot serve; the error view shows that.
    if (e instanceof ServerUnavailableError) throw e;
    // Network error — default to login for security
    throw redirect({ to: '/login' });
  }
}

// The router types a boundary's error as unknown, since anything can be
// thrown; what reaches this one is usually, but not necessarily, an Error.
function UnavailableComponent({ error }: ErrorComponentProps) {
  return (
    <main className="flex h-screen items-center justify-center p-8">
      <div className="max-w-2xl space-y-3">
        <h1 className="text-xl font-semibold">
          {error instanceof ServerUnavailableError
            ? 'The server is not ready to serve the dashboard'
            : 'Something went wrong'}
        </h1>
        <p className="text-muted-foreground">
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    </main>
  );
}

export const Route = createRootRoute({
  beforeLoad: checkAuth,
  component: RootComponent,
  errorComponent: UnavailableComponent,
});

function RootComponent() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <p className="text-lg">Loading...</p>
          </div>
        </div>
      }
    >
      <Outlet />
    </Suspense>
  );
}
