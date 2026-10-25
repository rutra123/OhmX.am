// client/src/pages/admin/AdminLoginPage.tsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';

export const AdminLoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setError('');
    setLoading(true);

    try {
      const res = await api<{ token: string; username: string }>('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      if (res.token) {
        localStorage.setItem('ek-admin-token', res.token);
        setPassword('');
        navigate('/admin/warm-floor', { replace: true });
      } else {
        setError('Login failed');
      }
    } catch (err: any) {
      setError(err?.message || 'Login error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Admin Login</h1>
          <p className="text-sm text-slate-400 mt-1">OhmX.am local administration</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-950 border border-red-900 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 mt-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-xl font-medium transition"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500">
          This page is local only. Do not expose admin credentials publicly.
        </p>
      </div>
    </div>
  );
};
