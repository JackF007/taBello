
import { useState, useEffect } from 'react';
import { Menu, X, Music } from 'lucide-react';
import { scrollToSection } from '@/lib/utils';

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-in-out py-4 px-6 md:px-10 ${
        isScrolled ? 'glassmorphism shadow-sm' : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Music className="h-8 w-8 text-tabgenius-700" />
          <span className="font-semibold text-xl tracking-tight">TaBello</span>
        </div>
        
        <nav className="hidden md:flex space-x-8">
          <button 
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="text-sm font-medium transition-colors hover:text-tabgenius-700"
          >
            Home
          </button>
          <button 
            type="button"
            onClick={() => scrollToSection('how-it-works')}
            className="text-sm font-medium transition-colors hover:text-tabgenius-700"
          >
            How It Works
          </button>
        </nav>
        
        
        <button 
          className="md:hidden focus:outline-none" 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? (
            <X className="h-6 w-6" />
          ) : (
            <Menu className="h-6 w-6" />
          )}
        </button>
      </div>
      
      {/* Mobile navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 glassmorphism shadow-lg p-6 animate-slide-down-fade">
          <nav className="flex flex-col space-y-4">
            <button 
              type="button"
              className="text-left text-sm font-medium transition-colors hover:text-tabgenius-700"
              onClick={() => { setMobileMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            >
              Home
            </button>
            <button 
              type="button"
              className="text-left text-sm font-medium transition-colors hover:text-tabgenius-700"
              onClick={() => { setMobileMenuOpen(false); scrollToSection('how-it-works'); }}
            >
              How It Works
            </button>
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
