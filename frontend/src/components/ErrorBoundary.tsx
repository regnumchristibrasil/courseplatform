import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert } from './ui/Alert'
import { Button } from './ui/Button'

export interface ErrorBoundaryProps {
  readonly children: ReactNode
  // Decoupled from analytics on purpose — the app composition root can pass
  // `onError` to also report to PostHog without this component depending
  // on the analytics provider directly.
  readonly onError?: (error: Error, errorInfo: ErrorInfo) => void
  readonly onReset?: () => void
}

interface ErrorBoundaryState {
  readonly hasError: boolean
}

function defaultReset(): void {
  window.location.reload()
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Never swallow: always surface to the console, and to the optional
    // caller-provided handler.
    console.error('Unhandled error caught by ErrorBoundary:', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  handleReload = (): void => {
    ;(this.props.onReset ?? defaultReset)()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Alert variant="error">
          <p>Ocorreu um erro inesperado. Tente recarregar a página.</p>
          <Button onClick={this.handleReload}>Recarregar</Button>
        </Alert>
      )
    }

    return this.props.children
  }
}
