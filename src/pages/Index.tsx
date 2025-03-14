
import { useState } from 'react';
import { useToast } from "@/components/ui/use-toast";
import Header from '@/components/Header';
import UploadSection from '@/components/UploadSection';
import AudioPlayer from '@/components/AudioPlayer';
import TablaturePreview from '@/components/TablaturePreview';
import PaymentCard from '@/components/PaymentCard';
import Footer from '@/components/Footer';
import { generateTablature } from '@/lib/tablature';
import { saveTablature } from '@/lib/supabase';
import { ArrowDown, FileAudio, FileVideo, Music, BarChart, Zap } from 'lucide-react';

const Index = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [tablature, setTablature] = useState(null);
  const [processingComplete, setProcessingComplete] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  
  const handleFileSelected = async (file: File) => {
    setSelectedFile(file);
    setIsProcessing(true);
    
    // Create a URL for the file for preview
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    
    try {
      // Simulate processing
      setTimeout(async () => {
        const generatedTab = generateTablature(file.name);
        
        // Save to Supabase (mock function for now)
        try {
          await saveTablature(generatedTab);
          toast({
            title: "Tablature generated successfully!",
            description: "Your tablature is ready to view and download.",
          });
        } catch (error) {
          console.error("Error saving tablature:", error);
          toast({
            title: "Error saving tablature",
            description: "There was an error saving your tablature. Please try again.",
            variant: "destructive",
          });
        }
        
        setTablature(generatedTab);
        setProcessingComplete(true);
        setIsProcessing(false);
      }, 2500);
    } catch (error) {
      console.error("Error processing file:", error);
      toast({
        title: "Error processing file",
        description: "There was an error processing your file. Please try again.",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-grow">
        {/* Hero Section */}
        <section className="pt-32 pb-16 md:pb-24 px-6 md:px-10">
          <div className="max-w-5xl mx-auto text-center">
            <span className="inline-block px-3 py-1 text-xs font-semibold bg-tabello-100 text-tabello-800 rounded-full mb-6 animate-fade-in">
              AI-Powered Music Transcription
            </span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6 animate-slide-up-fade">
              Turn Your Music Into 
              <span className="text-tabello-700"> Tablature</span> Instantly
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-10 max-w-3xl mx-auto animate-slide-up-fade delay-100">
              Upload your guitar or bass recordings and our AI will transcribe them into accurate, detailed, and easy-to-read tablature.
            </p>
            
            <ArrowDown className="h-10 w-10 text-tabello-500 mx-auto animate-bounce" />
          </div>
        </section>
        
        {/* Upload Section */}
        <section id="upload" className="py-12 px-6 md:px-10 bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-950">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-4">Upload Your Music</h2>
              <p className="text-gray-600 dark:text-gray-400">
                We support MP3, WAV, MP4, and MOV files
              </p>
            </div>
            
            <UploadSection onFileSelected={handleFileSelected} />
            
            {isProcessing && (
              <div className="text-center mt-6">
                <div className="inline-flex items-center px-4 py-2 bg-tabello-100 text-tabello-800 rounded-full">
                  <div className="flex space-x-1 mr-2">
                    <div className="w-2 h-6 bg-tabello-500 rounded-full animate-wave1"></div>
                    <div className="w-2 h-6 bg-tabello-500 rounded-full animate-wave2"></div>
                    <div className="w-2 h-6 bg-tabello-500 rounded-full animate-wave3"></div>
                    <div className="w-2 h-6 bg-tabello-500 rounded-full animate-wave4"></div>
                    <div className="w-2 h-6 bg-tabello-500 rounded-full animate-wave5"></div>
                  </div>
                  <span>Processing your music...</span>
                </div>
              </div>
            )}
          </div>
        </section>
        
        {/* Results Section - only shown after file is processed */}
        {processingComplete && (
          <section className="py-16 px-6 md:px-10">
            <div className="max-w-6xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-2xl md:text-3xl font-bold mb-4">Your Generated Tablature</h2>
                <p className="text-gray-600 dark:text-gray-400">
                  Preview the transcribed tablature for your uploaded file
                </p>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                  {fileUrl && selectedFile && (
                    <>
                      <h3 className="text-lg font-medium mb-4">File Preview</h3>
                      <AudioPlayer 
                        fileUrl={fileUrl} 
                        fileName={selectedFile.name} 
                        fileType={selectedFile.type} 
                      />
                      
                      <div className="my-8">
                        <h3 className="text-lg font-medium mb-4">Generated Tablature</h3>
                        {tablature && <TablaturePreview tablature={tablature} />}
                      </div>
                    </>
                  )}
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-4">Get Full Access</h3>
                  {tablature && <PaymentCard tablatureName={tablature.title} />}
                </div>
              </div>
            </div>
          </section>
        )}
        
        {/* Features Section */}
        <section id="how-it-works" className="py-16 px-6 md:px-10 bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-bold mb-4">How It Works</h2>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                Our advanced AI technology analyzes your music and converts it into accurate tablature
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md transition-all duration-300 hover:shadow-lg">
                <div className="w-12 h-12 bg-tabello-100 dark:bg-tabello-900/50 rounded-full flex items-center justify-center mb-4">
                  <FileAudio className="h-6 w-6 text-tabello-700" />
                </div>
                <h3 className="text-lg font-medium mb-2">Upload Your Music</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Upload audio or video recordings of your playing in supported formats.
                </p>
              </div>
              
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md transition-all duration-300 hover:shadow-lg">
                <div className="w-12 h-12 bg-tabello-100 dark:bg-tabello-900/50 rounded-full flex items-center justify-center mb-4">
                  <BarChart className="h-6 w-6 text-tabello-700" />
                </div>
                <h3 className="text-lg font-medium mb-2">AI Analysis</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Our AI analyzes the audio to detect notes, chords, rhythm, and playing techniques.
                </p>
              </div>
              
              <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md transition-all duration-300 hover:shadow-lg">
                <div className="w-12 h-12 bg-tabello-100 dark:bg-tabello-900/50 rounded-full flex items-center justify-center mb-4">
                  <Music className="h-6 w-6 text-tabello-700" />
                </div>
                <h3 className="text-lg font-medium mb-2">Get Your Tabs</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Receive accurate, detailed tablature that you can view, download, and play along with.
                </p>
              </div>
            </div>
          </div>
        </section>
        
        {/* CTA Section */}
        <section id="pricing" className="py-20 px-6 md:px-10 bg-tabello-700 text-white">
          <div className="max-w-5xl mx-auto text-center">
            <Zap className="h-10 w-10 mx-auto mb-6" />
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              Ready to Transform Your Music?
            </h2>
            <p className="text-xl opacity-90 mb-8 max-w-2xl mx-auto">
              Upload your audio or video and get accurate tabs in seconds.
            </p>
            
            <a
              href="#upload"
              className="inline-block bg-white text-tabello-700 hover:bg-gray-100 font-medium py-3 px-8 rounded-full transition-all duration-200 ease-in-out transform hover:scale-105"
            >
              Start Transcribing Now
            </a>
          </div>
        </section>
      </main>
      
      <Footer />
    </div>
  );
};

export default Index;
