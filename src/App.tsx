import { useState, useEffect } from 'react';
import { auth } from './lib/firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import Dashboard from '@/components/Dashboard';
import { Toaster } from '@/components/ui/sonner';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('Login error', err);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-100 text-center">
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">
            Controle de Faltas
          </h1>
          <p className="mb-8 text-sm text-gray-500">
            Faça login para identificar faltas de estoque e gerar relatórios.
          </p>
          <Button onClick={handleLogin} className="w-full" size="lg">
            Entrar com Google
          </Button>
          <Toaster />
        </div>
      </div>
    );
  }

  // Check email verified - Google users always have emailVerified as true, 
  // but strictly following rules we ensure it's verified.
  if (!user.emailVerified) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        <div className="text-center p-6 bg-white rounded shadow-sm border border-gray-100 max-w-md">
          <h2 className="text-lg font-medium text-red-600 mb-2">Acesso Negado</h2>
          <p className="text-gray-600">Sua conta precisa de um e-mail verificado para acessar o sistema.</p>
        </div>
        <Toaster />
      </div>
    );
  }

  return (
    <>
      <Dashboard />
      <Toaster />
    </>
  );
}
