import { ImagePlus, X } from 'lucide-react';
import { backend } from '../../../api';
import { toastError } from '../../../stores/toasts';
import { useSettings } from '../../../stores/settings';
import { Button } from '../../../ui';
import { Row } from './common';

// Chat wallpaper: an image of the user's own, copied into the themes folder, dimmed to taste.
export function WallpaperRows() {
  const a = useSettings((s) => s.settings.appearance);
  const update = useSettings((s) => s.update);
  const desktop = backend.kind === 'wails';
  const set = (p: Partial<typeof a>) =>
    update((s) => ({ ...s, appearance: { ...s.appearance, ...p } }));
  const dim = a.wallpaperDim ?? 0.2;

  const choose = async () => {
    try {
      const rel = await backend.userThemes.pickWallpaper();
      if (rel) set({ wallpaper: rel });
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <Row
        label="Chat wallpaper"
        description={
          desktop
            ? 'An image behind your messages. It replaces a theme’s own background.'
            : 'Your own wallpaper works in the desktop app.'
        }
      >
        <div className="wz-wallpaper-pick">
          {a.wallpaper && (
            <span
              className="wz-wallpaper-pick__thumb"
              style={{ backgroundImage: `url("${backend.userThemes.wallpaperUrl(a.wallpaper)}")` }}
              aria-hidden="true"
            />
          )}
          <Button
            size="sm"
            icon={<ImagePlus size={16} />}
            disabled={!desktop}
            onClick={() => void choose()}
          >
            {a.wallpaper ? 'Change…' : 'Choose…'}
          </Button>
          {a.wallpaper && (
            <Button size="sm" icon={<X size={16} />} onClick={() => set({ wallpaper: '' })}>
              Remove
            </Button>
          )}
        </div>
      </Row>
      {a.wallpaper && (
        <Row label="Dim the wallpaper" description="Keeps messages readable on busy pictures.">
          <div className="wz-range">
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.05}
              value={dim}
              aria-label="Dim the wallpaper"
              aria-valuetext={`${Math.round(dim * 100)}%`}
              onChange={(e) => set({ wallpaperDim: Number(e.target.value) })}
            />
            <output>{Math.round(dim * 100)}%</output>
          </div>
        </Row>
      )}
    </>
  );
}
