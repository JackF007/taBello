
import { useState, useRef } from 'react';
import { Upload, File, FileAudio, FileVideo, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface UploadSectionProps {
  onFileSelected: (file: File) => void;
}

const UploadSection = ({ onFileSelected }: UploadSectionProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const processFile = (file: File) => {
    // Check file type
    const validTypes = ['audio/mpeg', 'audio/wav', 'video/mp4', 'video/quicktime'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Unsupported file format",
        description: "Please upload an MP3, WAV, MP4, or MOV file.",
        variant: "destructive"
      });
      return;
    }

    // Check file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload a file smaller than 50MB.",
        variant: "destructive"
      });
      return;
    }

    setSelectedFile(file);
    simulateUpload(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      processFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      processFile(file);
    }
  };

  const simulateUpload = (file: File) => {
    setUploading(true);
    
    // Simulate upload progress
    setTimeout(() => {
      setUploading(false);
      onFileSelected(file);
      
      toast({
        title: "Upload complete",
        description: `Successfully uploaded ${file.name}`,
      });
    }, 2000);
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const getFileIcon = () => {
    if (!selectedFile) return <Upload className="h-10 w-10 mb-2 text-tabgenius-700" />;
    
    if (selectedFile.type.includes('audio')) {
      return <FileAudio className="h-10 w-10 mb-2 text-tabgenius-700" />;
    } else if (selectedFile.type.includes('video')) {
      return <FileVideo className="h-10 w-10 mb-2 text-tabgenius-700" />;
    } else {
      return <File className="h-10 w-10 mb-2 text-tabgenius-700" />;
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mb-12">
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`animated-border-wrap relative border-2 border-dashed rounded-xl p-8 transition-all duration-300 ease-in-out flex flex-col items-center justify-center text-center 
          ${isDragging ? 'border-tabgenius-600 bg-tabgenius-50/70' : 'border-gray-300 hover:border-tabgenius-400'}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/wav,video/mp4,video/quicktime"
          onChange={handleFileSelect}
          className="hidden"
          id="file-upload"
        />

        {selectedFile ? (
          <div className="w-full animate-fade-in">
            <div className="flex items-center mb-4 justify-center">
              {getFileIcon()}
              {uploading && (
                <div className="ml-2 h-3 flex items-end space-x-1">
                  <div className="waveform-bar animate-wave1 bg-tabgenius-500"></div>
                  <div className="waveform-bar animate-wave2 bg-tabgenius-500"></div>
                  <div className="waveform-bar animate-wave3 bg-tabgenius-500"></div>
                  <div className="waveform-bar animate-wave4 bg-tabgenius-500"></div>
                  <div className="waveform-bar animate-wave5 bg-tabgenius-500"></div>
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm">
              <div className="flex items-center overflow-hidden">
                <div className="truncate ml-3">
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>
              
              <button 
                onClick={handleClearFile} 
                className="ml-2 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            
            {uploading ? (
              <p className="mt-4 text-sm text-tabgenius-600 animate-pulse">Uploading... Please wait</p>
            ) : (
              <p className="mt-4 text-sm text-green-600">Ready for processing</p>
            )}
          </div>
        ) : (
          <>
            {getFileIcon()}
            <h3 className="mt-2 text-sm font-medium">Upload your audio or video file</h3>
            <p className="mt-1 text-xs text-gray-500">
              MP3, WAV, MP4, or MOV up to 50MB
            </p>
            
            <div className="mt-4">
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="bg-tabgenius-700 hover:bg-tabgenius-800"
              >
                Select File
              </Button>
            </div>
            
            <p className="mt-4 text-xs text-gray-400">
              Or drag and drop your file here
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default UploadSection;
