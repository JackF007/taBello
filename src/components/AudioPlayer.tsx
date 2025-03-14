
import { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { Slider } from "@/components/ui/slider";

interface AudioPlayerProps {
  fileUrl: string;
  fileName: string;
  fileType: string;
}

const AudioPlayer = ({ fileUrl, fileName, fileType }: AudioPlayerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [waveformArray, setWaveformArray] = useState<number[]>([]);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = fileType.includes('video');

  // Generate random waveform for visualization
  useEffect(() => {
    const bars = 60;
    const newWaveform = Array(bars).fill(0).map(() => Math.random() * 0.8 + 0.2);
    setWaveformArray(newWaveform);
  }, [fileUrl]);

  const togglePlay = () => {
    if (isVideo && videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    } else if (!isVideo && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (isVideo && videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    } else if (!isVideo && audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (isVideo && videoRef.current) {
      setDuration(videoRef.current.duration);
    } else if (!isVideo && audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (value: number[]) => {
    const newTime = value[0];
    setCurrentTime(newTime);
    
    if (isVideo && videoRef.current) {
      videoRef.current.currentTime = newTime;
    } else if (!isVideo && audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    
    if (isVideo && videoRef.current) {
      videoRef.current.volume = newVolume;
    } else if (!isVideo && audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  return (
    <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg">
      {isVideo ? (
        <div className="relative aspect-video">
          <video
            ref={videoRef}
            src={fileUrl}
            className="w-full h-full object-cover"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
          />
        </div>
      ) : (
        <div className="p-6 pb-2">
          <div className="flex items-center justify-center h-24 mb-2">
            <div className="flex items-end h-full w-full space-x-[2px]">
              {waveformArray.map((height, i) => (
                <div
                  key={i}
                  className={`waveform-bar rounded-t ${
                    (currentTime / duration) * waveformArray.length > i
                      ? 'bg-tabgenius-600'
                      : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  style={{
                    height: `${height * 100}%`,
                    transform: isPlaying ? `scaleY(${0.7 + Math.sin(Date.now() / 200 + i) * 0.3})` : 'scaleY(1)'
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <audio
        ref={audioRef}
        src={!isVideo ? fileUrl : undefined}
        className="hidden"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="p-4">
        <div className="mb-3">
          <h3 className="text-sm font-medium truncate">{fileName}</h3>
          <p className="text-xs text-gray-500">{isVideo ? 'Video' : 'Audio'} file</p>
        </div>
        
        <div className="mb-4">
          <Slider
            value={[currentTime]}
            min={0}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button 
              className="text-gray-600 hover:text-tabgenius-700 transition-colors" 
              aria-label="Previous"
            >
              <SkipBack className="h-5 w-5" />
            </button>
            
            <button
              onClick={togglePlay}
              className="w-10 h-10 flex items-center justify-center bg-tabgenius-700 hover:bg-tabgenius-800 rounded-full text-white transition-all duration-200 ease-in-out transform hover:scale-105"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </button>
            
            <button 
              className="text-gray-600 hover:text-tabgenius-700 transition-colors" 
              aria-label="Next"
            >
              <SkipForward className="h-5 w-5" />
            </button>
          </div>
          
          <div className="flex items-center space-x-2">
            <Volume2 className="h-4 w-4 text-gray-500" />
            <Slider
              value={[volume]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={handleVolumeChange}
              className="w-24 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioPlayer;
