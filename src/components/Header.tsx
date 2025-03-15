
import { useState, useEffect } from 'react';
import { Menu, X, Music } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

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
          <a 
            href="#" 
            className="text-sm font-medium transition-colors hover:text-tabgenius-700"
          >
            Home
          </a>
          <a 
            href="#how-it-works" 
            className="text-sm font-medium transition-colors hover:text-tabgenius-700"
          >
            How It Works
          </a>
          <a 
            href="#pricing" 
            className="text-sm font-medium transition-colors hover:text-tabgenius-700"
          >
            Pricing
          </a>
        </nav>
        
        <div className="hidden md:flex items-center space-x-4">
          {user ? (
            <Button 
              onClick={() => navigate('/dashboard')}
              className="bg-tabgenius-700 hover:bg-tabgenius-800 text-white rounded-full transition-all duration-200 ease-in-out transform hover:scale-105"
            >
              Dashboard
            </Button>
          ) : (
            <>
              <Button 
                variant="ghost" 
                className="text-sm font-medium transition-colors hover:text-tabgenius-700"
                onClick={() => navigate('/auth')}
              >
                Sign In
              </Button>
              <Button 
                onClick={() => navigate('/auth')}
                className="bg-tabgenius-700 hover:bg-tabgenius-800 text-white rounded-full transition-all duration-200 ease-in-out transform hover:scale-105"
              >
                Get Started
              </Button>
            </>
          )}
        </div>
        
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
            <a 
              href="#" 
              className="text-sm font-medium transition-colors hover:text-tabgenius-700"
              onClick={() => setMobileMenuOpen(false)}
            >
              Home
            </a>
            <a 
              href="#how-it-works" 
              className="text-sm font-medium transition-colors hover:text-tabgenius-700"
              onClick={() => setMobileMenuOpen(false)}
            >
              How It Works
            </a>
            <a 
              href="#pricing" 
              className="text-sm font-medium transition-colors hover:text-tabgenius-700"
              onClick={() => setMobileMenuOpen(false)}
            >
              Pricing
            </a>
            {user ? (
              <Button 
                onClick={() => navigate('/dashboard')}
                className="bg-tabgenius-700 hover:bg-tabgenius-800 text-white rounded-full transition-all duration-200 ease-in-out transform hover:scale-105 w-full"
              >
                Dashboard
              </Button>
            ) : (
              <>
                <Button 
                  variant="ghost" 
                  className="justify-start px-0 text-sm font-medium transition-colors hover:text-tabgenius-700"
                  onClick={() => navigate('/auth')}
                >
                  Sign In
                </Button>
                <Button 
                  onClick={() => navigate('/auth')}
                  className="bg-tabgenius-700 hover:bg-tabgenius-800 text-white rounded-full transition-all duration-200 ease-in-out transform hover:scale-105 w-full"
                >
                  Get Started
                </Button>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
