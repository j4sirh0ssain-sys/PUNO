import {Component, type ErrorInfo, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {hasError: false, message: ''};

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {hasError: true, message: error.message || 'Unexpected error'};
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('PUNO render error:', error, info);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            backgroundColor: '#101329',
            color: '#f4f4ed',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <div style={{maxWidth: '420px'}}>
            <h1 style={{fontSize: '28px', fontWeight: 800, color: '#f5c84b', marginBottom: '8px'}}>
              PUNO
            </h1>
            <p style={{fontSize: '14px', color: '#c7d4d2', marginBottom: '16px'}}>
              Something went wrong while loading the table: {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 20px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: '#f5c84b',
                color: '#151c27',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Reload Game
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
