
import { useState } from 'react';
import { TablatureData, TabSection } from '@/lib/tablature';
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Music, Info, BarChart, FileText, Lock } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

interface TablaturePreviewProps {
  tablature: TablatureData;
}

const TablaturePreview = ({ tablature }: TablaturePreviewProps) => {
  const [activeTab, setActiveTab] = useState("overview");
  const { toast } = useToast();

  const handleDownload = () => {
    toast({
      title: "Premium feature",
      description: "You need to upgrade to download tablature.",
      variant: "default"
    });
  };

  const renderSection = (section: TabSection, index: number) => {
    switch (section.type) {
      case 'header':
        return (
          <div key={index} className="mb-4">
            <h3 className="text-lg font-semibold text-tabello-800">{section.content}</h3>
          </div>
        );
      case 'chord':
        return (
          <div key={index} className="mb-4 p-3 bg-tabello-50 dark:bg-tabello-950/30 rounded-md">
            <p className="font-mono tracking-wider">{section.content}</p>
          </div>
        );
      case 'tablature':
        return (
          <div key={index} className="mb-4 overflow-x-auto">
            <pre className="font-mono text-sm whitespace-pre p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm">
              {section.content}
            </pre>
          </div>
        );
      case 'notes':
        return (
          <div key={index} className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border-l-4 border-amber-400 rounded-md">
            <p className="text-sm italic text-amber-800 dark:text-amber-300">{section.content}</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg">
      <div className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <span className="inline-block px-2 py-1 text-xs font-medium bg-tabello-100 text-tabello-800 rounded-full mb-2">
              {tablature.instrument === 'guitar' ? 'Guitar Tab' : 'Bass Tab'}
            </span>
            <h2 className="text-xl font-bold">{tablature.title}</h2>
          </div>
          <Button 
            onClick={handleDownload}
            className="bg-tabello-700 hover:bg-tabello-800 text-white"
          >
            Download Tab
          </Button>
        </div>

        <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-4 mb-6">
            <TabsTrigger value="overview" className="flex items-center space-x-2">
              <Info className="h-4 w-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger value="tablature" className="flex items-center space-x-2">
              <Music className="h-4 w-4" />
              <span>Tablature</span>
            </TabsTrigger>
            <TabsTrigger value="analysis" className="flex items-center space-x-2">
              <BarChart className="h-4 w-4" />
              <span>Analysis</span>
            </TabsTrigger>
            <TabsTrigger value="notation" className="flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>Notation</span>
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-500 mb-1">Tuning</p>
                <p className="font-medium">{tablature.tuning}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-500 mb-1">Key</p>
                <p className="font-medium">{tablature.key}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-500 mb-1">Tempo</p>
                <p className="font-medium">{tablature.tempo} BPM</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-500 mb-1">Difficulty</p>
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                  <div className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                  <span className="ml-2 text-sm">Intermediate</span>
                </div>
              </div>
            </div>
            
            <div className="p-5 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Techniques Used</h3>
              <div className="flex flex-wrap gap-2">
                <span className="inline-block px-3 py-1 text-xs font-medium bg-tabello-100 dark:bg-tabello-900/40 text-tabello-800 dark:text-tabello-300 rounded-full">
                  Hammer-on
                </span>
                <span className="inline-block px-3 py-1 text-xs font-medium bg-tabello-100 dark:bg-tabello-900/40 text-tabello-800 dark:text-tabello-300 rounded-full">
                  Pull-off
                </span>
                <span className="inline-block px-3 py-1 text-xs font-medium bg-tabello-100 dark:bg-tabello-900/40 text-tabello-800 dark:text-tabello-300 rounded-full">
                  Slides
                </span>
                <span className="inline-block px-3 py-1 text-xs font-medium bg-tabello-100 dark:bg-tabello-900/40 text-tabello-800 dark:text-tabello-300 rounded-full">
                  Palm Mute
                </span>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="tablature" className="animate-fade-in">
            <div className="space-y-2">
              {tablature.sections.map((section, index) => 
                renderSection(section, index)
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="analysis" className="animate-fade-in">
            <div className="relative">
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-lg">
                <Lock className="h-10 w-10 text-tabello-400 mb-2" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">Premium Feature</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-md text-center">
                  Upgrade to TaBello Premium to access detailed analysis of techniques, timing, and performance metrics.
                </p>
                <Button 
                  className="bg-tabello-700 hover:bg-tabello-800 text-white"
                  onClick={handleDownload}
                >
                  Upgrade Now
                </Button>
              </div>
              
              <div className="h-64 bg-gray-100 dark:bg-gray-700 rounded-lg"></div>
            </div>
          </TabsContent>
          
          <TabsContent value="notation" className="animate-fade-in">
            <div className="relative">
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-lg">
                <Lock className="h-10 w-10 text-tabello-400 mb-2" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">Premium Feature</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-md text-center">
                  Upgrade to TaBello Premium to access standard music notation for this piece.
                </p>
                <Button 
                  className="bg-tabello-700 hover:bg-tabello-800 text-white"
                  onClick={handleDownload}
                >
                  Upgrade Now
                </Button>
              </div>
              
              <div className="h-64 bg-gray-100 dark:bg-gray-700 rounded-lg"></div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default TablaturePreview;
