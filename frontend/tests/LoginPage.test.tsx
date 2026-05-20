import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from '../src/pages/LoginPage';
import { AuthProvider } from '../src/context/AuthContext';
import { describe, it, expect } from 'vitest';

const queryClient = new QueryClient();

const renderLoginPage = () => {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <LoginPage />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

describe('LoginPage', () => {
  it('renders login form', () => {
    renderLoginPage();
    expect(screen.getByText('Enter Password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
  });
});
