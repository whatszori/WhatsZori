import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  label: string;
  fallback?: ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[wz] ${this.props.label} crashed and was hidden`, error, info.componentStack);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
