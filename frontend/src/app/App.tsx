import { AuthScreen } from '../features/auth/AuthScreen';
import { useConnection } from '../stores/connection';
import { Logo, Spinner } from '../ui';
import { MainLayout } from './MainLayout';
import { Toasts } from './Toasts';
import { MediaViewer } from '../features/media-viewer/MediaViewer';
import { AvatarViewer } from '../features/media-viewer/AvatarViewer';
import { AppProviders } from './providers';
import { PluginHost } from '../plugin-core/host';
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
      <MediaViewer />
      <AvatarViewer />
      <PluginHost />
      <Toasts />
    </AppProviders>
  );
}
