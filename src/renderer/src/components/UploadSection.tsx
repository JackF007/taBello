import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { MEDIA_EXTENSIONS } from '../../../shared/ipc';

interface UploadSectionProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

const ACCEPT = ['audio/*', 'video/*', ...MEDIA_EXTENSIONS.map((ext) => `.${ext}`)].join(',');

function isMediaFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || (MEDIA_EXTENSIONS as readonly string[]).includes(extension);
}

/** Drop zone + file picker. Files stay on disk: only their path is handed to the main process. */
const UploadSection = ({ onFileSelected, disabled = false }: UploadSectionProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const processFile = (file: File | undefined) => {
    if (!file || disabled) return;
    if (!isMediaFile(file)) {
      toast({
        title: 'Unsupported file',
        description: `Choose an audio or video file (${MEDIA_EXTENSIONS.slice(0, 6).join(', ')}, …).`,
        variant: 'destructive',
      });
      return;
    }
    onFileSelected(file);
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>, dragging: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(dragging);
  };

  return (
    <div
      onDragEnter={(e) => handleDrag(e, true)}
      onDragOver={(e) => handleDrag(e, true)}
      onDragLeave={(e) => handleDrag(e, false)}
      onDrop={(e) => {
        handleDrag(e, false);
        processFile(e.dataTransfer.files[0]);
      }}
      className={`rounded-xl border-2 border-dashed p-10 flex flex-col items-center justify-center text-center transition-colors
        ${isDragging ? 'border-tabello-600 bg-tabello-50' : 'border-gray-300 hover:border-tabello-400'}
        ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        onChange={(e) => {
          processFile(e.target.files?.[0]);
          e.target.value = '';
        }}
        className="hidden"
        id="file-upload"
        disabled={disabled}
      />
      <Upload className="h-10 w-10 mb-3 text-tabello-600" />
      <h3 className="text-base font-medium">Drop an audio or video file here</h3>
      <p className="mt-1 text-sm text-muted-foreground">MP3, WAV, FLAC, M4A, MP4, MOV, MKV… up to 15 minutes</p>
      <Button className="mt-5" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
        Choose file
      </Button>
    </div>
  );
};

export default UploadSection;
