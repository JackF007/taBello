import { AlphaTabApi, LogLevel, LayoutMode } from '@coderline/alphatab';
import React, { useRef, useEffect, useState } from 'react';

// Aggiunta interfaccia props
interface TablaturePlayerProps {
  content: string;
}

export const TablaturePlayer = ({ content }: TablaturePlayerProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const apiRef = useRef<AlphaTabApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !content) return;

    try {
      // Verifica se il contenuto è valido
      if (content && content.includes('.')) {
        console.log('Possibile errore di sintassi AlphaTex con i punti (.) nel contenuto');
      }

      const api = new AlphaTabApi(containerRef.current, {
        core: {
          logLevel: LogLevel.Debug,
          useWorkers: false,
          engine: 'html5',
          fontDirectory: '/font/' // Percorso modificato per i font
        },
        display: {
          layoutMode: LayoutMode.Horizontal,
        },
        player: {
          enablePlayer: true,
          soundFont: '/soundfont/sonivox.sf2', // Percorso modificato per soundfont
          scrollElement: containerRef.current
        }
      });

      // Carica il contenuto dopo l'inizializzazione
      try {
        api.tex(content);
      } catch (texError) {
        console.error('Errore nel parsing AlphaTex:', texError);
        setErrorMessage(`Errore formato tablatura: ${texError.message}`);
      }

      // Gestione eventi
      api.renderFinished.on(() => setIsLoading(false));
      api.error.on(error => {
        console.error('AlphaTab Error:', error);
        setErrorMessage(`Errore: ${error.message}`);
      });

      // Playback controls
      api.playerStateChanged.on(state => {
        console.log('Player State:', state);
      });

      apiRef.current = api;

      return () => {
        api.destroy();
        apiRef.current = null;
      };
    } catch (error) {
      console.error('Init Error:', error);
      setErrorMessage('Errore inizializzazione player');
      setIsLoading(false);
    }
  }, [content]);

  const handlePlay = () => apiRef.current?.play();
  const handlePause = () => apiRef.current?.pause();

  return (
    <div className="tab-player">
      <div ref={containerRef} style={{ height: '600px', width: '100%' }} />
      
      {isLoading && <div>Caricamento partitura...</div>}
      
      {errorMessage && (
        <div className="error-message">{errorMessage}</div>
      )}

      <div className="playback-controls">
        <button onClick={handlePlay}>Play</button>
        <button onClick={handlePause}>Pause</button>
      </div>
    </div>
  );
}; 