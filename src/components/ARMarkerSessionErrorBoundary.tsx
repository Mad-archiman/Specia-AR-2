'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onClose: () => void;
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ARMarkerSessionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.props.onError?.(error);
    console.error('ARMarkerSession error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-4 bg-[#1a1a2e] p-4"
          style={{ width: '100vw', height: '100dvh' }}
        >
          <p className="text-center text-white/90">
            마커 모드 로딩 중 오류가 발생했습니다.
          </p>
          <p className="max-w-sm text-center text-sm text-white/60">
            {this.state.error?.message}
          </p>
          <button
            type="button"
            onClick={this.props.onClose}
            className="rounded border border-white/80 bg-black/50 px-6 py-3 text-white"
          >
            닫기
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
