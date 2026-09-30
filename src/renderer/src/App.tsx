import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { tabello } from "@/lib/api";
import TranscribePage from "./pages/TranscribePage";
import LibraryPage from "./pages/LibraryPage";
import ProjectPage from "./pages/ProjectPage";
import NotFound from "./pages/NotFound";

import './App.css';

// Everything is local, so there is nothing to refetch on window focus.
const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } } });

// HashRouter: the app is served from a local origin, so routes must not depend on server-side rewrites.
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <div className="flex flex-col min-h-screen">
          <Header />
          {!tabello && (
            <p role="alert" className="bg-destructive/10 text-destructive text-sm text-center py-2">
              TaBello must be run as a desktop app (npm run dev), not in a browser.
            </p>
          )}
          <main className="flex-grow">
            <Routes>
              <Route path="/" element={<TranscribePage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/project/:id" element={<ProjectPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
