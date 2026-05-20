import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';

export const LoginPage = () => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(password);
      navigate('/');
    } catch {
      setError('Invalid credentials');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 p-8 bg-card rounded-lg shadow-md">
        <h2 className="text-2xl font-bold text-center text-foreground">Enter Password</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-destructive text-sm text-center">{error}</p>}
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            required
          />
          <Button type="submit" className="w-full">
            Unlock
          </Button>
        </form>
      </div>
    </div>
  );
};