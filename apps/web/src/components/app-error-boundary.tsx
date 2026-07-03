"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/monitoring";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    captureException(error, { tags: { surface: "error-boundary" } });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <h2 className="text-lg font-semibold">Something went wrong loading this page</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            The app UI failed to start. This is usually fixed by refreshing. If it keeps happening,
            restart the dev server: stop every running dev server, then run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">PORT=3003 npm run dev:fresh</code>{" "}
            in <code className="rounded bg-muted px-1.5 py-0.5 text-xs">apps/web</code>. Never run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">dev:clean</code> while dev is
            still running.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
