
import { Music, Github, Twitter, Instagram } from 'lucide-react';

const Footer = () => {
  return (
    <footer className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto py-12 px-6 md:px-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <Music className="h-6 w-6 text-tabgenius-700" />
              <span className="font-semibold text-lg">TabGenius</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Convert your audio and video recordings into accurate guitar and bass tablature with AI-powered technology.
            </p>
            <div className="flex space-x-4">
              <a href="#" className="text-gray-500 hover:text-tabgenius-700 transition-colors">
                <Github className="h-5 w-5" />
              </a>
              <a href="#" className="text-gray-500 hover:text-tabgenius-700 transition-colors">
                <Twitter className="h-5 w-5" />
              </a>
              <a href="#" className="text-gray-500 hover:text-tabgenius-700 transition-colors">
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>
          
          <div>
            <h3 className="font-medium text-sm mb-4">Product</h3>
            <ul className="space-y-3">
              <li><a href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-tabgenius-700 dark:hover:text-tabgenius-400 transition-colors">Features</a></li>
              <li><a href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-tabgenius-700 dark:hover:text-tabgenius-400 transition-colors">Pricing</a></li>
              <li><a href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-tabgenius-700 dark:hover:text-tabgenius-400 transition-colors">FAQ</a></li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-medium text-sm mb-4">Legal</h3>
            <ul className="space-y-3">
              <li><a href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-tabgenius-700 dark:hover:text-tabgenius-400 transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-tabgenius-700 dark:hover:text-tabgenius-400 transition-colors">Terms of Service</a></li>
              <li><a href="#" className="text-sm text-gray-600 dark:text-gray-400 hover:text-tabgenius-700 dark:hover:text-tabgenius-400 transition-colors">Cookies</a></li>
            </ul>
          </div>
        </div>
        
        <div className="pt-8 mt-8 border-t border-gray-200 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
            © {new Date().getFullYear()} TabGenius. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
