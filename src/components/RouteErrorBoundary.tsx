import React, { Component, type ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface RouteErrorBoundaryProps {
  children: ReactNode;
  onRetry?: () => void;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Route dynamic load error caught by RouteErrorBoundary:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onRetry) {
      this.props.onRetry();
    } else {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center bg-white rounded-xl border border-[#E3E5DE] shadow-xs m-4"
        >
          <div className="w-12 h-12 rounded-full bg-[#FDF2F2] flex items-center justify-center text-[#B93838] mb-4">
            <AlertTriangle className="w-6 h-6" aria-hidden="true" />
          </div>
          <h2 className="text-base font-bold text-[#202923] mb-1">
            Unable to load page
          </h2>
          <p className="text-xs text-[#69736C] max-w-sm mb-4">
            A network disruption or dynamic import error occurred while loading this section.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#234B3A] text-white font-medium text-xs hover:bg-[#1b3b2d] transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reload and Retry</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
