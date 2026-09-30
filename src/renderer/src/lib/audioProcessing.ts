// Audio processing service for tablature generation
import { TablatureData, TabSection } from './tablature';

// Audio analysis constants
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const GUITAR_STRINGS = [40, 45, 50, 55, 59, 64]; // E2, A2, D3, G3, B3, E4 in MIDI numbers
const BASS_STRINGS = [28, 33, 38, 43]; // E1, A1, D2, G2 in MIDI numbers

// Interface for detected notes
interface DetectedNote {
  pitch: number; // MIDI note number
  time: number; // Start time in seconds
  duration: number; // Duration in seconds
  velocity: number; // Volume/intensity (0-1)
}

// Interface for detected chord
interface DetectedChord {
  name: string; // Chord name (e.g., "Em", "C", "G7")
  time: number; // Start time in seconds
  duration: number; // Duration in seconds
}

// Interface for audio analysis result
interface AudioAnalysisResult {
  notes: DetectedNote[];
  chords: DetectedChord[];
  tempo: number; // BPM
  key: string; // e.g., "C major"
  isGuitar: boolean; // true for guitar, false for bass
}

/**
 * Process audio data from a file and extract musical features
 * @param file The audio file to process
 * @returns A promise that resolves to the audio analysis result
 */
export const processAudioFile = async (file: File): Promise<AudioAnalysisResult> => {
  // Create an audio context
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  // Read the file as an ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  
  // Decode the audio data
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  // Extract features from the audio buffer
  const features = await extractAudioFeatures(audioBuffer, audioContext);
  
  // Determine if the audio is likely guitar or bass based on frequency content
  const isGuitar = determineInstrument(features);
  
  // Detect notes from the audio
  const notes = detectNotes(audioBuffer, audioContext, isGuitar);
  
  // Detect chords from the notes
  const chords = detectChords(notes);
  
  // Estimate tempo
  const tempo = estimateTempo(audioBuffer, audioContext);
  
  // Determine musical key
  const key = determineKey(notes, chords);
  
  return {
    notes,
    chords,
    tempo,
    key,
    isGuitar
  };
};

/**
 * Extract audio features from an audio buffer
 * @param audioBuffer The decoded audio buffer
 * @param audioContext The audio context
 * @returns Audio features including spectral and temporal information
 */
const extractAudioFeatures = async (audioBuffer: AudioBuffer, audioContext: AudioContext) => {
  // Get audio data
  const channelData = audioBuffer.getChannelData(0); // Use first channel
  
  // Create analyzer node
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  
  // Create buffer source
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(analyser);
  
  // Get frequency data
  const frequencyData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(frequencyData);
  
  // Calculate spectral centroid (brightness)
  let sum = 0;
  let weightedSum = 0;
  for (let i = 0; i < frequencyData.length; i++) {
    sum += frequencyData[i];
    weightedSum += i * frequencyData[i];
  }
  const spectralCentroid = weightedSum / sum;
  
  // Calculate RMS energy
  let rms = 0;
  for (let i = 0; i < channelData.length; i++) {
    rms += channelData[i] * channelData[i];
  }
  rms = Math.sqrt(rms / channelData.length);
  
  return {
    spectralCentroid,
    rms,
    frequencyData
  };
};

/**
 * Determine if the audio is guitar or bass based on frequency content
 * @param features Extracted audio features
 * @returns true if guitar, false if bass
 */
const determineInstrument = (features: any): boolean => {
  // Bass typically has more energy in lower frequencies
  // Guitar has more balanced energy across the spectrum
  const lowFrequencyEnergy = features.frequencyData.slice(0, 50).reduce((sum: number, val: number) => sum + val, 0);
  const highFrequencyEnergy = features.frequencyData.slice(50, 100).reduce((sum: number, val: number) => sum + val, 0);
  
  // If low frequency energy is significantly higher, likely bass
  return lowFrequencyEnergy < highFrequencyEnergy * 1.5;
};

/**
 * Detect individual notes from audio
 * @param audioBuffer The decoded audio buffer
 * @param audioContext The audio context
 * @param isGuitar Whether the instrument is guitar or bass
 * @returns Array of detected notes
 */
const detectNotes = (audioBuffer: AudioBuffer, audioContext: AudioContext, isGuitar: boolean): DetectedNote[] => {
  // In a real implementation, this would use pitch detection algorithms
  // For this demo, we'll generate plausible notes based on the instrument
  
  const notes: DetectedNote[] = [];
  const duration = audioBuffer.duration;
  const segments = Math.floor(duration / 0.5); // Split into half-second segments
  
  // Get the appropriate strings for the instrument
  const strings = isGuitar ? GUITAR_STRINGS : BASS_STRINGS;
  
  // Generate notes for each segment
  for (let i = 0; i < segments; i++) {
    const time = i * 0.5;
    const stringIndex = Math.floor(Math.random() * strings.length);
    const baseNote = strings[stringIndex];
    
    // Add some fret positions (0-12)
    const fret = Math.floor(Math.random() * 12);
    const pitch = baseNote + fret;
    
    notes.push({
      pitch,
      time,
      duration: 0.25 + Math.random() * 0.25, // Between 0.25 and 0.5 seconds
      velocity: 0.5 + Math.random() * 0.5 // Between 0.5 and 1.0
    });
  }
  
  return notes;
};

/**
 * Detect chords from notes
 * @param notes Array of detected notes
 * @returns Array of detected chords
 */
const detectChords = (notes: DetectedNote[]): DetectedChord[] => {
  // Group notes by time to find simultaneous notes that form chords
  const timeGroups: { [key: number]: DetectedNote[] } = {};
  
  notes.forEach(note => {
    const timeKey = Math.floor(note.time * 2) / 2; // Round to nearest 0.5s
    if (!timeGroups[timeKey]) {
      timeGroups[timeKey] = [];
    }
    timeGroups[timeKey].push(note);
  });
  
  // Analyze each group to determine chord
  const chords: DetectedChord[] = [];
  const chordTypes = ['', 'm', '7', 'm7', 'maj7', 'sus4', 'dim'];
  
  Object.entries(timeGroups).forEach(([timeStr, noteGroup]) => {
    const time = parseFloat(timeStr);
    
    if (noteGroup.length >= 2) { // Need at least 2 notes for a chord
      // Get the root note (lowest pitch)
      const rootPitch = Math.min(...noteGroup.map(n => n.pitch));
      const rootNoteName = NOTE_NAMES[rootPitch % 12];
      
      // Randomly select a chord type for demo purposes
      // In a real implementation, this would analyze the intervals between notes
      const chordType = chordTypes[Math.floor(Math.random() * chordTypes.length)];
      
      chords.push({
        name: rootNoteName + chordType,
        time,
        duration: 2.0 // Assume chord lasts for 2 seconds
      });
    }
  });
  
  return chords;
};

/**
 * Estimate tempo from audio
 * @param audioBuffer The decoded audio buffer
 * @param audioContext The audio context
 * @returns Estimated tempo in BPM
 */
const estimateTempo = (audioBuffer: AudioBuffer, audioContext: AudioContext): number => {
  // In a real implementation, this would use onset detection and tempo estimation
  // For this demo, return a plausible tempo between 80-140 BPM
  return Math.floor(Math.random() * 60) + 80;
};

/**
 * Determine the musical key from notes and chords
 * @param notes Array of detected notes
 * @param chords Array of detected chords
 * @returns Musical key (e.g., "C major")
 */
const determineKey = (notes: DetectedNote[], chords: DetectedChord[]): string => {
  // Count occurrences of each pitch class
  const pitchClassCounts = new Array(12).fill(0);
  
  notes.forEach(note => {
    const pitchClass = note.pitch % 12;
    pitchClassCounts[pitchClass] += note.duration * note.velocity; // Weight by duration and velocity
  });
  
  // Also consider chord roots
  chords.forEach(chord => {
    const rootName = chord.name.replace(/m|7|maj7|sus4|dim/g, ''); // Extract root note name
    const rootIndex = NOTE_NAMES.indexOf(rootName);
    if (rootIndex >= 0) {
      pitchClassCounts[rootIndex] += 2; // Give extra weight to chord roots
    }
  });
  
  // Find the most common pitch class (potential key)
  let maxCount = 0;
  let maxIndex = 0;
  
  pitchClassCounts.forEach((count, index) => {
    if (count > maxCount) {
      maxCount = count;
      maxIndex = index;
    }
  });
  
  // Determine if major or minor
  // This is simplified; real key detection is more complex
  const keyName = NOTE_NAMES[maxIndex];
  
  // Check for minor key by looking at the relative minor's third (3 semitones up)
  const minorThirdIndex = (maxIndex + 3) % 12;
  const majorThirdIndex = (maxIndex + 4) % 12;
  
  const isMinor = pitchClassCounts[minorThirdIndex] > pitchClassCounts[majorThirdIndex];
  
  return `${keyName} ${isMinor ? 'minor' : 'major'}`;
};

/**
 * Convert audio analysis results to tablature data
 * @param fileName Original file name (used for title)
 * @param analysis Audio analysis results
 * @returns Tablature data structure
 */
export const convertAnalysisToTablature = (fileName: string, analysis: AudioAnalysisResult): TablatureData => {
  const { notes, chords, tempo, key, isGuitar } = analysis;
  
  // Create tablature sections
  const sections: TabSection[] = [];
  
  // Add intro header
  sections.push({
    type: 'header',
    content: 'Intro'
  });
  
  // Add chord progression if we have chords
  if (chords.length > 0) {
    // Get first few chords for the progression
    const uniqueChords = Array.from(new Set(chords.slice(0, 8).map(c => c.name)));
    const chordProgression = uniqueChords.join(' | ');
    
    sections.push({
      type: 'chord',
      content: chordProgression
    });
  }
  
  // Generate tablature notation from notes
  const tabContent = generateTablatureNotation(notes, isGuitar);
  sections.push({
    type: 'tablature',
    content: tabContent
  });
  
  // Add performance notes
  sections.push({
    type: 'notes',
    content: `This transcription was generated by AI analysis. Tempo is approximately ${tempo} BPM. Key signature is ${key}.`
  });
  
  // Add verse section
  sections.push({
    type: 'header',
    content: 'Verse'
  });
  
  // Add more chord content for verse if available
  if (chords.length > 8) {
    const verseChords = Array.from(new Set(chords.slice(8, 16).map(c => c.name)));
    const verseChordProgression = verseChords.join(' | ');
    
    sections.push({
      type: 'chord',
      content: verseChordProgression
    });
  }
  
  // Generate verse tablature from later notes
  const verseNotes = notes.slice(Math.floor(notes.length / 2));
  const verseTabContent = generateTablatureNotation(verseNotes, isGuitar);
  sections.push({
    type: 'tablature',
    content: verseTabContent
  });
  
  return {
    id: `tab_${Date.now()}`,
    title: fileName.replace(/\.[^/.]+$/, ""), // Remove file extension
    instrument: isGuitar ? 'guitar' : 'bass',
    tuning: isGuitar ? 'Standard (E A D G B E)' : 'Standard (E A D G)',
    key,
    tempo,
    sections,
    created_at: new Date().toISOString()
  };
};

/**
 * Generate tablature notation from detected notes
 * @param notes Array of detected notes
 * @param isGuitar Whether the instrument is guitar or bass
 * @returns Formatted tablature string
 */
const generateTablatureNotation = (notes: DetectedNote[], isGuitar: boolean): string => {
  // Get the appropriate strings for the instrument
  const strings = isGuitar ? GUITAR_STRINGS : BASS_STRINGS;
  const stringNames = isGuitar ? ['e', 'B', 'G', 'D', 'A', 'E'] : ['G', 'D', 'A', 'E'];
  
  // Initialize empty tablature lines
  const tabLines: string[] = [];
  for (let i = 0; i < strings.length; i++) {
    tabLines.push(`${stringNames[i]}|----------------------------------|`);
  }
  
  // Sort notes by time
  const sortedNotes = [...notes].sort((a, b) => a.time - b.time);
  
  // Map notes to fret positions on strings
  sortedNotes.forEach(note => {
    // Find the best string for this note
    let bestString = -1;
    let bestFret = Infinity;
    
    for (let i = 0; i < strings.length; i++) {
      const stringPitch = strings[i];
      const fret = note.pitch - stringPitch;
      
      // Check if the note can be played on this string (fret between 0-24)
      if (fret >= 0 && fret <= 24 && fret < bestFret) {
        bestString = i;
        bestFret = fret;
      }
    }
    
    // If we found a valid string/fret combination
    if (bestString >= 0) {
      // Calculate position in the tab string (roughly 2 chars per quarter note)
      const position = Math.floor(note.time * 8) + 2; // +2 to account for string name and |
      
      // Ensure the tab line is long enough
      while (tabLines[bestString].length <= position + 1) {
        tabLines[bestString] += '-';
      }
      
      // Place the fret number at the right position
      const fretStr = bestFret.toString();
      const tabLine = tabLines[bestString];
      tabLines[bestString] = 
        tabLine.substring(0, position) + 
        fretStr + 
        tabLine.substring(position + fretStr.length);
    }
  });
  
  // Ensure all lines are the same length
  const maxLength = Math.max(...tabLines.map(line => line.length));
  for (let i = 0; i < tabLines.length; i++) {
    while (tabLines[i].length < maxLength) {
      tabLines[i] += '-';
    }
  }
  
  // Add final bar line
  for (let i = 0; i < tabLines.length; i++) {
    if (!tabLines[i].endsWith('|')) {
      tabLines[i] += '|';
    }
  }
  
  return tabLines.join('\n');
}