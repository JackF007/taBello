import { useEffect, useRef, useState } from 'react';
import { TablatureData } from '@/lib/tablature';
import { Button } from '@/components/ui/button';
import { PlayCircle, PauseCircle } from 'lucide-react';
import { AlphaTabApi, LogLevel, LayoutMode } from '@coderline/alphatab';
import { useToast } from '@/hooks/use-toast';

interface TablaturePlayerProps {
  tablature: TablatureData;
}

const TablaturePlayer = ({ tablature }: TablaturePlayerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [api, setApi] = useState<AlphaTabApi | null>(null);
  const { toast } = useToast();
  
  // Convert tablature sections to AlphaTex format
  const getTablatureContent = () => {
    // Filter only tablature sections
    const tabSections = tablature.sections.filter(section => section.type === 'tablature');
    
    if (tabSections.length === 0) return '';
    
    // Create AlphaTex format
    const tuning = tablature.instrument === 'bass' ? '.4 .3 .2 .1' : '.6 .5 .4 .3 .2 .1';
    const instrument = tablature.instrument === 'bass' ? 'bass' : 'guitar';
    
    let alphaTex = `\\title "${tablature.title}"
\\instrument ${instrument}
\\tuning ${tuning}
\\tempo ${tablature.tempo}
`;
    
    tabSections.forEach((section, index) => {
      const headerSection = tablature.sections.find(
        (s, i) => s.type === 'header' && i < tablature.sections.indexOf(section) && 
        (i === 0 || tablature.sections.slice(i + 1, tablature.sections.indexOf(section)).every(s => s.type !== 'header'))
      );
      
      if (headerSection) {
        alphaTex += `\\section "${headerSection.content}"
`;
      } else if (index === 0) {
        alphaTex += `\\section "Main"
`;
      }
      
      const tabContent = convertTabToAlphaTex(section.content, tablature.instrument === 'bass');
      alphaTex += tabContent + '\n';
    });
    
    return alphaTex;
  };
  
  // Helper function to convert standard tab notation to AlphaTex
  const convertTabToAlphaTex = (tabContent: string, isBass: boolean): string => {
    const lines = tabContent.split('\n');
    const stringCount = lines.length;
    
    // Initialize bars array
    let bars: string[] = [];
    let currentBar = '';
    
    // Process each position in the tab
    const maxLength = Math.max(...lines.map(line => line.length));
    
    // Skip the string names and first | character
    const startPos = 2;
    
    // Process each column in the tab
    for (let col = startPos; col < maxLength; col++) {
      let hasNote = false;
      let notes = [];
      
      // Check each string at this position
      for (let stringIndex = 0; stringIndex < stringCount; stringIndex++) {
        const line = lines[stringIndex];
        if (col < line.length) {
          const char = line[col];
          
          // If it's a number, it's a fret
          if (/[0-9]/.test(char)) {
            // Check if it's a two-digit number
            let fret = char;
            if (col + 1 < line.length && /[0-9]/.test(line[col + 1])) {
              fret += line[col + 1];
              // Skip the next character since we've processed it
              col++;
            }
            
            // In AlphaTex, strings are numbered from 1 (lowest) to 6/4 (highest)
            // Our tab has highest string first, so we need to reverse
            const alphaTabString = stringCount - stringIndex;
            notes.push(`${alphaTabString}.${fret}`);
            hasNote = true;
          }
        }
      }
      
      // If we found notes at this position, add them to the current bar
      if (hasNote) {
        if (currentBar.length > 0) {
          currentBar += ' ';
        }
        currentBar += notes.join(' ');
      }
      
      // If we hit a bar line or end of tab, finish the current bar
      if (lines.some(line => col < line.length && line[col] === '|') || col === maxLength - 1) {
        if (currentBar.length > 0) {
          bars.push(currentBar);
          currentBar = '';
        }
      }
    }
    
    // Join bars with bar separators
    return bars.join(' | ');
  };

  useEffect(() => {
    if (!containerRef.current) return;
    
    const settings = {
      core: {
        logLevel: LogLevel.Info
      },
      display: {
        layoutMode: LayoutMode.Horizontal,
        scale: 0.8
      },
      player: {
        enablePlayer: true,
        soundFont: '/assets/soundfont/sonivox.sf2'
      }
    };
    
    try {
      const newApi = new AlphaTabApi(containerRef.current, settings);
      setApi(newApi);
      
      // Load the tablature content
      const tabContent = getTablatureContent();
      if (tabContent) {
        newApi.tex(tabContent);
      }
      
      // Set up event listeners
      newApi.playerStateChanged.on((state) => {
        setIsPlaying(state === 1); // 1 = Playing state
      });
      
      newApi.renderFinished.on(() => {
        console.log('AlphaTab rendering completed');
      });
      
      newApi.error.on((error) => {
        console.error('AlphaTab Error:', error);
        toast({
          title: "Errore di rendering",
          description: "Si è verificato un errore durante il rendering della tablatura.",
          variant: "destructive"
        });
      });
      
      return () => {
        newApi.destroy();
      };
    } catch (error) {
      console.error('Error initializing AlphaTab:', error);
    }
  }, [tablature]);
  
  const togglePlay = () => {
    if (!api) return;
    
    isPlaying ? api.pause() : api.play();
  };
  
  return (
    <div className="flex items-center justify-center mt-4">
      {/* Hidden AlphaTab container */}
      <div 
        ref={containerRef} 
        className="hidden"
        style={{ height: '0', overflow: 'hidden' }}
      ></div>
      
      {/* Simple play button */}
      <Button
        variant="outline"
        size="icon"
        onClick={togglePlay}
        disabled={!api}
        className="w-12 h-12 rounded-full bg-tabello-700 hover:bg-tabello-800 text-white"
      >
        {isPlaying ? (
          <PauseCircle className="h-8 w-8" />
        ) : (
          <PlayCircle className="h-8 w-8" />
        )}
      </Button>
    </div>
  );
};

export default TablaturePlayer;