import { AuthScreen } from '../features/auth/AuthScreen';
import { useConnection } from '../stores/connection';
import { Logo, Spinner } from '../ui';
import { MainLayout } from './MainLayout';
import { Toasts } from './Toasts';
import { AppProviders } from './providers';
import './App.css';

function Screens() {
  const ready = useConnection((s) => s.ready);
  const auth = useConnection((s) => s.auth.state);
  if (!ready)
    return (
      <div className="wz-splash">
        <Logo variant="mark" height={64} />
        <Spinner size={20} />
      </div>
    );
  return auth === 'logged-in' ? <MainLayout /> : <AuthScreen />;
}

export function App() {
  return (
    <AppProviders>
      <Screens />
      <Toasts />
    </AppProviders>
  );
}
