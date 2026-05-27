import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from '../src/pages/LoginPage';
import { AuthProvider } from '../src/context/AuthContext';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: {
    post: mockPost,
    isAxiosError: (err: unknown): err is { response?: { status: number } } =>
      typeof err === 'object' && err !== null && (err as Record<string, unknown>).isAxiosError === true,
  },
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders login form', () => {
    renderLoginPage();
    expect(screen.getByText('Enter Password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
  });

  it('shows error on invalid credentials', async () => {
    mockPost.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401 },
      message: 'Request failed with status code 401',
    });

    renderLoginPage();

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('shows error on network failure', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network Error'));

    renderLoginPage();

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(screen.getByText('Connection error. Please try again.')).toBeInTheDocument();
    });
  });

  it('stores token and navigates on successful login', async () => {
    mockPost.mockResolvedValueOnce({ data: { token: 'test-token' } });

    renderLoginPage();

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'correct' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(localStorage.getItem('token')).toBe('test-token');
    });
  });
});
