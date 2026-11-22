import './Logo.css';

// Inline copies of public/logo.svg and public/logo-wordmark.svg. Inline so the lettering follows
// the app theme (data-theme), not the OS color scheme an <img> SVG would see.
// Keep the drawings in sync with the files in public/.

function MarkShapes() {
  return (
    <>
      <path
        className="wz-logo__bubble"
        d="M144 32H368A112 112 0 0 1 480 144V376Q480 446 506 486Q440 480 400 464H144A112 112 0 0 1 32 352V144A112 112 0 0 1 144 32Z"
      />
      <circle className="wz-logo__sun" cx="314" cy="300" r="46" />
      <path
        className="wz-logo__z"
        fill="none"
        strokeWidth="40"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M160 168H352L160 330H352"
      />
    </>
  );
}

interface LogoProps {
  variant?: 'mark' | 'wordmark';
  height?: number;
  className?: string;
}

export function Logo({ variant = 'wordmark', height = 24, className }: LogoProps) {
  const cls = ['wz-logo', `wz-logo--${variant}`, className].filter(Boolean).join(' ');

  if (variant === 'mark') {
    return (
      <svg
        className={cls}
        viewBox="0 0 512 512"
        width={height}
        height={height}
        role="img"
        aria-label="WhatsZori"
      >
        <MarkShapes />
      </svg>
    );
  }

  return (
    <svg
      className={cls}
      viewBox="0 0 790 160"
      width={(height * 790) / 160}
      height={height}
      role="img"
      aria-label="WhatsZori"
    >
      <g transform="translate(0 12) scale(0.265)">
        <MarkShapes />
      </g>
      <g
        transform="translate(170 30)"
        fill="none"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g className="wz-logo__ink">
          <path d="M0 0L18 100L36 34L54 100L72 0" />
          <path d="M96 0V100M96 64Q96 30 122 30Q148 30 148 64V100" />
          <circle cx="207" cy="65" r="31" />
          <path d="M238 30V100" />
          <path d="M266 6V82Q266 100 284 100M258 34H284" />
          <path d="M338 40Q330 30 316 30Q300 30 300 47Q300 60 318 64Q338 68 338 84Q338 100 318 100Q303 100 296 90" />
        </g>
        <circle className="wz-logo__sun" stroke="none" cx="410" cy="90" r="16" />
        <g className="wz-logo__accent">
          <path d="M366 0H426L366 100H426" />
          <circle cx="491" cy="65" r="33" />
          <path d="M550 30V100M550 66Q550 30 584 32" />
          <path d="M604 30V100" />
        </g>
        <circle className="wz-logo__dot" stroke="none" cx="604" cy="5" r="9" />
      </g>
    </svg>
  );
}
