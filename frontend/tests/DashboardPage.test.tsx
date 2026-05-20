import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from '../src/pages/DashboardPage';
import { AuthProvider } from '../src/context/AuthContext';
import { describe, it, expect } from 'vitest';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

describe('DashboardPage', () => {
  it('renders loading state', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <DashboardPage />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
