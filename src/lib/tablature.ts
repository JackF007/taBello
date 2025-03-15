
// Tablature data structures and processing functions

export interface TabSection {
  type: 'header' | 'chord' | 'tablature' | 'notes';
  content: string;
}

export interface TablatureData {
  id?: string; // For Supabase integration
  title: string;
  instrument: 'guitar' | 'bass';
  tuning: string;
  key: string;
  tempo: number;
  sections: TabSection[];
  created_at?: string; // For Supabase integration
  user_id?: string; // For Supabase integration
}

// Generate tablature data from a file name
// This is a wrapper around the audio processing functions
export const generateTablature = (fileName: string): TablatureData => {
  // For now, we'll still use mock data since we don't have the actual audio file here
  // In a real implementation, this would call processAudioFile and convertAnalysisToTablature
  // from the audioProcessing module
  const isGuitar = Math.random() > 0.3; // 70% chance it's a guitar tab
  
  return {
    id: `tab_${Date.now()}`,
    title: fileName.replace(/\.[^/.]+$/, ""),
    instrument: isGuitar ? 'guitar' : 'bass',
    tuning: isGuitar ? 'Standard (E A D G B E)' : 'Standard (E A D G)',
    key: getRandomKey(),
    tempo: Math.floor(Math.random() * 60) + 80, // Random tempo between 80-140 BPM
    sections: generateMockSections(isGuitar),
    created_at: new Date().toISOString(),
  };
};

// Process audio file and generate tablature
// This is the main function that will be called from the UI
export const processAudioAndGenerateTablature = async (file: File): Promise<TablatureData> => {
  try {
    // Import the audio processing functions dynamically to avoid circular dependencies
    const { processAudioFile, convertAnalysisToTablature } = await import('./audioProcessing');
    
    // Process the audio file to extract musical features
    const analysis = await processAudioFile(file);
    
    // Convert the analysis results to tablature data
    return convertAnalysisToTablature(file.name, analysis);
  } catch (error) {
    console.error('Error processing audio:', error);
    // Fall back to mock data if processing fails
    return generateTablature(file.name);
  }
};

const getRandomKey = (): string => {
  const keys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab'];
  const types = ['major', 'minor'];
  
  const randomKey = keys[Math.floor(Math.random() * keys.length)];
  const randomType = types[Math.floor(Math.random() * types.length)];
  
  return `${randomKey} ${randomType}`;
};

const generateMockSections = (isGuitar: boolean): TabSection[] => {
  const sections: TabSection[] = [];
  
  // Add header section
  sections.push({
    type: 'header',
    content: 'Intro'
  });
  
  // Add chord section
  sections.push({
    type: 'chord',
    content: isGuitar ? 'Em | G | C | D' : 'Em | G | C'
  });
  
  // Add tablature section for guitar
  if (isGuitar) {
    sections.push({
      type: 'tablature',
      content: `e|----0-----3-------0------------|
B|----0-----0-------1------------|
G|----0-----0-------0------------|
D|----2-----0-------2------------|
A|----2-----2-------3------------|
E|----0-----3-------x------------|`
    });
  } else {
    // Add tablature section for bass
    sections.push({
      type: 'tablature',
      content: `G|----------------------------------|
D|----------------------------------|
A|----2-----3-------3-----0--------|
E|----0-----1-------3-----0--------|`
    });
  }
  
  // Add notes section
  sections.push({
    type: 'notes',
    content: 'Use finger picking during intro, then switch to heavy strumming for chorus.'
  });
  
  // Add another section (Verse)
  sections.push({
    type: 'header',
    content: 'Verse'
  });
  
  // Add chord section for verse
  sections.push({
    type: 'chord',
    content: isGuitar ? 'C | G | Am | F' : 'C | G | Am'
  });
  
  // Add tablature section for guitar verse
  if (isGuitar) {
    sections.push({
      type: 'tablature',
      content: `e|----0-----3-------0-------1-----|
B|----1-----0-------1-------1-----|
G|----0-----0-------2-------2-----|
D|----2-----0-------2-------3-----|
A|----3-----2-------0-------3-----|
E|-------------------------------0-|`
    });
  } else {
    // Add tablature section for bass verse
    sections.push({
      type: 'tablature',
      content: `G|----------------------------------|
D|----------------------------------|
A|----3-----3----------0-----------|
E|----0-----3----------0-----------|`
    });
  }
  
  return sections;
};
