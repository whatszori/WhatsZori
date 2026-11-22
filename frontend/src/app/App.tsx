import { AuthScreen } from '../features/auth/AuthScreen';
import { useConnection } from '../stores/connection';
import { Spinner } from '../ui';
import { MainLayout } from './MainLayout';
import { AppProviders } from './providers';
import './App.css';

function Screens() {
  const ready = useConnection((s) => s.ready);
  const auth = useConnection((s) => s.auth.state);
  if (!ready)
    return (
      <div className="wz-splash">
        <Spinner size={20} />
      </div>
    );
  return auth === 'logged-in' ? <MainLayout /> : <AuthScreen />;
}

export function App() {
  return (
    <AppProviders>
      <Screens />
    </AppProviders>
  );
}
