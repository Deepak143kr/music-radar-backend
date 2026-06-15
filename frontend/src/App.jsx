import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Activity, Clock, Music, Play, ExternalLink } from 'lucide-react';
import RecordRTC from 'recordrtc';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'https://music-radar-backend.onrender.com';

// Helper: build search URLs without any API keys
const getYouTubeUrl = (title, artist) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${artist}`)}`;

const getSpotifyUrl = (title, artist) =>
  `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`;

function SongLinks({ song_name, artist_name }) {
  return (
    <div className="song-links">
      <a
        href={getYouTubeUrl(song_name, artist_name)}
        target="_blank"
        rel="noopener noreferrer"
        className="link-btn youtube"
        title="Search on YouTube"
      >
        <Play size={14} />
        YouTube
      </a>
      <a
        href={getSpotifyUrl(song_name, artist_name)}
        target="_blank"
        rel="noopener noreferrer"
        className="link-btn spotify"
        title="Search on Spotify"
      >
        <ExternalLink size={14} />
        Spotify
      </a>
    </div>
  );
}

function App() {
  const [isListening, setIsListening] = useState(false);
  const [currentSong, setCurrentSong] = useState(null);
  const [history, setHistory] = useState([]);
  const [audioLevels, setAudioLevels] = useState(Array(10).fill(0));

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Fetch history on load
  useEffect(() => {
    fetchHistory();
    const historyInterval = setInterval(fetchHistory, 10000);
    return () => clearInterval(historyInterval);
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/history`);
      const data = await res.json();
      if (data.status === 'success') {
        setHistory(data.history);
      }
    } catch (err) {
      console.error('Error fetching history', err);
    }
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setIsListening(true);

      // Web Audio API for visualizer
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 64;

      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVisualizer = () => {
        analyserRef.current.getByteFrequencyData(dataArray);
        const step = Math.floor(bufferLength / 10);
        const newLevels = [];
        for (let i = 0; i < 10; i++) {
          newLevels.push(dataArray[i * step] / 255);
        }
        setAudioLevels(newLevels);
        animationFrameRef.current = requestAnimationFrame(updateVisualizer);
      };

      updateVisualizer();

      mediaRecorderRef.current = new RecordRTC(stream, {
        type: 'audio',
        mimeType: 'audio/wav',
        recorderType: RecordRTC.StereoAudioRecorder,
        timeSlice: 10000,
        numberOfAudioChannels: 1,
        desiredSampRate: 44100,
        ondataavailable: function (blob) {
          if (blob.size > 1000) {
            sendAudioToServer(blob);
          }
        },
      });

      mediaRecorderRef.current.startRecording();
    } catch (err) {
      console.error('Error accessing microphone', err);
      alert('Microphone access is required to detect music.');
    }
  };

  const stopListening = () => {
    setIsListening(false);
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stopRecording(() => {
        mediaRecorderRef.current.destroy();
        mediaRecorderRef.current = null;
      });
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setAudioLevels(Array(10).fill(0));
  };

  const sendAudioToServer = async (audioBlob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'sample.wav');

    try {
      const res = await fetch(`${BACKEND_URL}/recognize`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.status === 'success') {
        setCurrentSong(data.song);
        if (data.saved_new) {
          fetchHistory();
        }
      }
    } catch (err) {
      console.error('Error recognizing audio', err);
    }
  };

  const formatTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1 className="header-title">Ambient Music Radar</h1>
        <div className="status-badge">
          <div className={`status-dot ${isListening ? 'active' : ''}`}></div>
          {isListening ? 'Listening' : 'Inactive'}
        </div>
      </header>

      <main className="main-content">
        {/* NOW PLAYING */}
        <section className="glass-card now-playing-section">
          <div className={`record-album ${isListening ? 'spinning' : ''}`}>
            <div className="record-center">
              {currentSong ? <Music color="#fff" size={24} /> : <Activity color="#fff" size={24} />}
            </div>
            <div className="record-hole"></div>
          </div>

          {currentSong ? (
            <>
              <h2 className="song-title">{currentSong.song_name}</h2>
              <p className="song-artist">{currentSong.artist_name}</p>
              <div className="confidence-score">{currentSong.confidence_score}% Match</div>
              {/* YouTube + Spotify buttons for now-playing */}
              <SongLinks song_name={currentSong.song_name} artist_name={currentSong.artist_name} />
            </>
          ) : (
            <>
              <h2 className="song-title">No Music Detected</h2>
              <p className="song-artist">Start listening to detect nearby music</p>
            </>
          )}

          <div className="visualizer-container">
            {audioLevels.map((level, i) => (
              <div
                key={i}
                className="visualizer-bar"
                style={{ height: `${Math.max(4, level * 40)}px` }}
              ></div>
            ))}
          </div>

          <div className="controls">
            {!isListening ? (
              <button className="btn-primary" onClick={startListening}>
                <Mic size={20} />
                Start Auto-Detect
              </button>
            ) : (
              <button className="btn-primary btn-danger" onClick={stopListening}>
                <MicOff size={20} />
                Stop Listening
              </button>
            )}
          </div>
        </section>

        {/* HISTORY */}
        <section className="glass-card history-section">
          <h2>
            <Clock size={24} /> Detection History
          </h2>

          <div className="history-list">
            {history.length === 0 ? (
              <div className="empty-state">No songs detected yet.</div>
            ) : (
              history.map((song) => (
                <div key={song.id} className="history-item">
                  <div className="history-item-icon">
                    <Music size={20} />
                  </div>
                  <div className="history-item-details">
                    <div className="history-item-title">{song.song_name}</div>
                    <div className="history-item-artist">{song.artist_name}</div>
                    {/* YouTube + Spotify buttons inline for each history item */}
                    <SongLinks song_name={song.song_name} artist_name={song.artist_name} />
                  </div>
                  <div className="history-item-time">{formatTime(song.detected_time + 'Z')}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
