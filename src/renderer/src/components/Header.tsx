import { NavLink } from 'react-router-dom';
import { Music } from 'lucide-react';
import { cn } from '@/lib/utils';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
    isActive ? 'bg-tabello-100 text-tabello-800' : 'text-muted-foreground hover:text-foreground',
  );

const Header = () => (
  <header className="sticky top-0 z-50 glassmorphism border-b px-6 py-3">
    <div className="max-w-6xl mx-auto flex items-center gap-6">
      <NavLink to="/" className="flex items-center space-x-2">
        <Music className="h-7 w-7 text-tabello-700" />
        <span className="font-semibold text-lg tracking-tight">TaBello</span>
      </NavLink>
      <nav className="flex gap-1">
        <NavLink to="/" end className={navClass}>Transcribe</NavLink>
        <NavLink to="/library" className={navClass}>Library</NavLink>
      </nav>
    </div>
  </header>
);

export default Header;
