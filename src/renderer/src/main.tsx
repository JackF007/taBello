import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { playStartupSound } from './lib/startupSound'
import './index.css'

createRoot(document.getElementById("root")!).render(<App />);
void playStartupSound();
