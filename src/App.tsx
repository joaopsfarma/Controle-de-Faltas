import { useState, useEffect } from 'react';
import { auth } from './lib/firebase';
import { signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, updateProfile, User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import Dashboard from '@/components/Dashboard';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const [anonName, setAnonName] = useState('');

  const handleAnonLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anonName.trim()) {
      toast.error('Por favor, informe seu nome para entrar.');
      return;
    }
    try {
      const userCredential = await signInAnonymously(auth);
      if (userCredential.user) {
        await updateProfile(userCredential.user, { displayName: anonName.trim() });
        // Force state update to reflect new displayName if needed, but onAuthStateChanged will handle the auth part
        setUser({ ...userCredential.user });
      }
    } catch (err) {
      console.error('Login error', err);
      toast.error('Erro ao entrar como anônimo.');
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('Google login error', err);
      toast.error('Erro ao entrar com Google: ' + err.message);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isLoginMode) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error('Auth error', err);
      if (err.code === 'auth/operation-not-allowed') {
        toast.error('O login com e-mail/senha não está ativado no Firebase Console.');
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
         toast.error('Credenciais inválidas.');
      } else {
         toast.error('Erro de autenticação: ' + err.message);
      }
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
      <div className="flex h-screen w-full flex-col items-center justify-center bg-gray-50 px-4 py-8 overflow-auto">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 sm:p-8 shadow-sm ring-1 ring-gray-100 text-center">
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">
            Controle de Faltas
          </h1>
          <p className="mb-6 text-sm text-gray-500">
            Acesse o sistema para gestão de estoque
          </p>
          
          <form onSubmit={handleEmailAuth} className="space-y-4 mb-6 text-left">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="seu@email.com" 
                required 
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input 
                id="password" 
                type="password" 
                required 
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full">
              {isLoginMode ? 'Entrar' : 'Criar Conta'}
            </Button>
            <div className="text-center mt-2">
              <button 
                type="button" 
                onClick={() => setIsLoginMode(!isLoginMode)}
                className="text-xs text-indigo-600 hover:underline"
              >
                {isLoginMode ? 'Não tem conta? Criar uma' : 'Já tem conta? Entrar'}
              </button>
            </div>
          </form>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-500">Ou</span>
            </div>
          </div>

          <div className="space-y-4">
            <Button onClick={handleGoogleLogin} variant="outline" className="w-full">
              Entrar com Google
            </Button>
            
            <form onSubmit={handleAnonLogin} className="space-y-3 pt-4 text-left border-t border-gray-100">
              <Label htmlFor="anonName" className="text-sm font-medium text-gray-700">Acesso Rápido Anônimo</Label>
              <Input 
                id="anonName" 
                placeholder="Como deseja ser chamado?" 
                value={anonName}
                onChange={e => setAnonName(e.target.value)}
              />
              <Button type="submit" variant="secondary" className="w-full">
                Entrar anonimamente
              </Button>
            </form>
          </div>
          <Toaster />
        </div>
      </div>
    );
  }

  return (
    <>
      <Dashboard user={user} />
      <Toaster />
    </>
  );
}
