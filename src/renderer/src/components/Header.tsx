import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import Equalizer from './Equalizer';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'relative px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
    isActive ? 'bg-secondary text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]' : 'text-muted-foreground hover:text-foreground',
  );

const Header = () => (
  <header className="sticky top-0 z-50 border-b bg-background/70 backdrop-blur-md">
    <div className="max-w-6xl mx-auto flex items-center gap-8 px-6 py-3">
      <NavLink to="/" className="flex items-center gap-2.5" aria-label="TaBello home">
        <Equalizer className="h-5" />
        <span className="font-display text-xl tracking-wide">
          Ta<span className="text-fire">Bello</span>
        </span>
      </NavLink>
      <nav className="flex gap-1">
        <NavLink to="/" end className={navClass}>Transcribe</NavLink>
        <NavLink to="/library" className={navClass}>Library</NavLink>
      </nav>
    </div>
    <div className="h-[2px] gh-rainbow opacity-70" />
  </header>
);

export default Header;
