import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { initMusic } from './lib/menuMusic'
import './index.css'

createRoot(document.getElementById("root")!).render(<App />);
void initMusic();
