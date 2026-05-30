import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from '../src/pages/LoginPage';
import { AuthProvider } from '../src/context/AuthContext';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/axios', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

vi.mock('axios', () => ({
  default: {
    isAxiosError: (err: unknown): err is { response?: { status: number } } =>
      typeof err === 'object' && err !== null && (err as Record<string, unknown>).isAxiosError === true,
  },
}));

const queryClient = new QueryClient();

const renderLoginPage = () => {
  mockGet.mockRejectedValue({ response: { status: 401 } });
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

  it('renders login form', async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByText('Enter Password')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
  });

  it('shows error on invalid credentials', async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    });

    mockPost.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401 },
      message: 'Request failed with status code 401',
    });

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('shows error on network failure', async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    });

    mockPost.mockRejectedValueOnce(new Error('Network Error'));

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(screen.getByText('Connection error. Please try again.')).toBeInTheDocument();
    });
  });

  it('calls login API and navigates on success', async () => {
    renderLoginPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    });

    mockPost.mockResolvedValueOnce({ data: { ok: true } });

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'correct' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/auth/login', { password: 'correct' });
    });
  });
});
