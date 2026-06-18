import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  Animated, Linking, StatusBar, SafeAreaView, ActivityIndicator,
  Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BACKEND_URL = 'https://music-radar-backend.onrender.com';
// ───────────────────────────────────────────────────────────────────────────

const RECORDING_OPTIONS = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
    audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_MEDIUM,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

const COLORS = {
  bg: '#0f172a',
  bgCard: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.10)',
  accent: '#3b82f6',
  purple: '#8b5cf6',
  muted: '#94a3b8',
  white: '#f8fafc',
  green: '#10b981',
  red: '#ef4444',
  youtube: '#ff4444',
  spotify: '#1ed760',
};

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [currentSong, setCurrentSong] = useState(null);
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState('Tap to start detecting music');
  const [loading, setLoading] = useState(false);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isFirstRender = useRef(true);

  // We keep a ref to the active recording so we can stop it on demand
  const activeRecordingRef = useRef(null);
  // Controls the recording loop
  const shouldLoopRef = useRef(false);
  // Prevents overlapping loops
  const loopRunningRef = useRef(false);

  // ── Spinning vinyl animation ──────────────────────────────────────────────
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (isListening) {
      Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 4000, useNativeDriver: true })
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      spinAnim.stopAnimation();
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isListening]);

  // ── Fetch history ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetchHistory();
    const t = setInterval(fetchHistory, 10000);
    return () => clearInterval(t);
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/history`);
      const data = await res.json();
      if (data.status === 'success') setHistory(data.history);
    } catch (_) {}
  };

  // ── Core recording function: creates a FRESH recorder each time ───────────
  const recordOnce = useCallback(async () => {
    let recording = null;
    let uri = null;

    try {
      // Set audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      // Create a brand-new Recording instance
      recording = new Audio.Recording();
      activeRecordingRef.current = recording;

      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      await recording.startAsync();

      // Record for 9 seconds (checking every 200ms for stop signal)
      for (let i = 0; i < 45; i++) {
        if (!shouldLoopRef.current) break;
        await new Promise(r => setTimeout(r, 200));
      }

      // Stop and get URI
      await recording.stopAndUnloadAsync();
      uri = recording.getURI();
    } catch (err) {
      console.error('[recordOnce] Recording error:', err.message || err);
      // Attempt cleanup
      if (recording) {
        try { await recording.stopAndUnloadAsync(); } catch (_) {}
      }
      return null;
    } finally {
      activeRecordingRef.current = null;
      recording = null;
    }

    return uri;
  }, []);

  // ── The recording loop ────────────────────────────────────────────────────
  const runRecordingLoop = useCallback(async () => {
    if (loopRunningRef.current) return;
    loopRunningRef.current = true;

    console.log('[Loop] Starting recording loop');

    while (shouldLoopRef.current) {
      const uri = await recordOnce();

      if (!shouldLoopRef.current) break;

      if (uri) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(uri);
          if (fileInfo.exists && fileInfo.size > 0) {
            console.log(`[Loop] Got recording: ${uri} (${fileInfo.size} bytes)`);
            await sendToBackend(uri);
            // Cleanup file
            try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch (_) {}
          } else {
            console.warn('[Loop] Empty or missing recording file');
          }
        } catch (e) {
          console.error('[Loop] File processing error:', e.message || e);
        }
      } else {
        console.warn('[Loop] recordOnce returned null, waiting before retry...');
        // Wait 2s before retrying on error
        for (let i = 0; i < 10; i++) {
          if (!shouldLoopRef.current) break;
          await new Promise(r => setTimeout(r, 200));
        }
      }

      // Short pause between recordings
      if (shouldLoopRef.current) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    loopRunningRef.current = false;
    console.log('[Loop] Recording loop ended');
  }, [recordOnce]);

  // ── Start listening ───────────────────────────────────────────────────────
  const startListening = async () => {
    // Request permissions
    const { status: permStatus } = await Audio.requestPermissionsAsync();
    if (permStatus !== 'granted') {
      setStatus('Microphone permission denied.');
      return;
    }

    shouldLoopRef.current = true;
    setIsListening(true);
    setStatus('Listening for music...');
    runRecordingLoop();
  };

  // ── Stop listening ────────────────────────────────────────────────────────
  const stopListening = async () => {
    shouldLoopRef.current = false;
    setIsListening(false);
    setStatus('Stopped. Tap to detect again.');

    // Stop any active recording immediately
    const rec = activeRecordingRef.current;
    if (rec) {
      try { await rec.stopAndUnloadAsync(); } catch (_) {}
      activeRecordingRef.current = null;
    }
  };

  // ── Send audio to backend ─────────────────────────────────────────────────
  const sendToBackend = async (uri) => {
    setLoading(true);
    try {
      const info = await FileSystem.getInfoAsync(uri);
      const sizeKB = info.exists ? (info.size / 1024).toFixed(1) : '0';
      setStatus(`Identifying... (${sizeKB} KB)`);
      console.log(`[Upload] Sending ${sizeKB} KB to backend: ${uri}`);

      const uploadResult = await FileSystem.uploadAsync(
        `${BACKEND_URL}/recognize`,
        uri,
        {
          fieldName: 'audio',
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        }
      );

      console.log('[Upload] Response status:', uploadResult.status);
      const data = JSON.parse(uploadResult.body);
      console.log('[Upload] Response:', JSON.stringify(data).substring(0, 200));

      if (data.status === 'success') {
        if (data.song) {
          setCurrentSong(data.song);
          setStatus(`Found: ${data.song.song_name} (${sizeKB} KB)`);
          if (data.saved_new) fetchHistory();
        } else {
          setStatus(`No song detected (${sizeKB} KB), listening...`);
        }
      } else {
        setStatus(`Backend Error: ${data.message || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('[Upload] Error:', e.message || e);
      setStatus(`Upload Error: ${e.message || 'Network request failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const openYouTube = (title, artist) =>
    Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${artist}`)}`);

  const openSpotify = (title, artist) =>
    Linking.openURL(`https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`);

  const formatTime = (iso) => {
    if (!iso) return '';
    try {
      const date = new Date(iso + 'Z');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    } catch (_) { return ''; }
  };

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🎵 Music Radar</Text>
        <View style={[styles.badge, isListening && styles.badgeActive]}>
          <View style={[styles.dot, isListening && styles.dotActive]} />
          <Text style={styles.badgeText}>{isListening ? 'Listening' : 'Inactive'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Now Playing Card */}
        <View style={styles.card}>
          <Animated.View style={[styles.vinyl, { transform: [{ rotate: spin }, { scale: pulseAnim }] }]}>
            <View style={styles.vinylCenter}>
              <Text style={styles.vinylEmoji}>{currentSong ? '🎵' : '🎙'}</Text>
            </View>
          </Animated.View>

          {currentSong ? (
            <>
              <Text style={styles.songTitle}>{currentSong.song_name}</Text>
              <Text style={styles.songArtist}>{currentSong.artist_name}</Text>
              {currentSong.album_name ? (
                <Text style={styles.songAlbum}>{currentSong.album_name}</Text>
              ) : null}
              <View style={styles.matchBadge}>
                <Text style={styles.matchText}>✓ {currentSong.confidence_score}% Match</Text>
              </View>

              {/* Links */}
              <View style={styles.linkRow}>
                <TouchableOpacity style={styles.linkBtnYT} onPress={() => openYouTube(currentSong.song_name, currentSong.artist_name)}>
                  <Text style={styles.linkBtnText}>▶ YouTube</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkBtnSP} onPress={() => openSpotify(currentSong.song_name, currentSong.artist_name)}>
                  <Text style={styles.linkBtnTextSP}>♪ Spotify</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.songTitle}>No Music Detected</Text>
              <Text style={styles.songArtist}>{status}</Text>
            </>
          )}

          {loading && <ActivityIndicator color={COLORS.accent} style={{ marginTop: 12 }} />}

          {/* Control Button */}
          <TouchableOpacity
            style={[styles.ctrlBtn, isListening ? styles.ctrlBtnStop : styles.ctrlBtnStart]}
            onPress={isListening ? stopListening : startListening}
          >
            <Text style={styles.ctrlBtnText}>{isListening ? '⏹ Stop Listening' : '🎙 Start Auto-Detect'}</Text>
          </TouchableOpacity>
        </View>

        {/* Status Text when Listening */}
        {isListening && (
          <View style={styles.statusCard}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        )}

        {/* History */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🕐 Detection History</Text>

          {history.length === 0 ? (
            <Text style={styles.emptyText}>No songs detected yet.</Text>
          ) : (
            history.map((song) => (
              <View key={song.id} style={styles.historyItem}>
                <View style={styles.historyIcon}>
                  <Text style={{ fontSize: 18 }}>🎵</Text>
                </View>
                <View style={styles.historyDetails}>
                  <Text style={styles.historyTitle}>{song.song_name}</Text>
                  <Text style={styles.historyArtist}>{song.artist_name}</Text>
                  <View style={styles.linkRow}>
                    <TouchableOpacity style={styles.linkBtnYTSm} onPress={() => openYouTube(song.song_name, song.artist_name)}>
                      <Text style={styles.linkBtnText}>▶ YouTube</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.linkBtnSPSm} onPress={() => openSpotify(song.song_name, song.artist_name)}>
                      <Text style={styles.linkBtnTextSP}>♪ Spotify</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.historyTime}>{formatTime(song.detected_time)}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.white },
  badge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.border },
  badgeActive: { borderColor: COLORS.green },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.red, marginRight: 6 },
  dotActive: { backgroundColor: COLORS.green },
  badgeText: { color: COLORS.white, fontSize: 13, fontWeight: '600' },

  scroll: { padding: 16, paddingBottom: 40 },

  card: { backgroundColor: COLORS.bgCard, borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, padding: 20, marginBottom: 16, alignItems: 'center' },

  statusCard: { backgroundColor: 'rgba(59,130,246,0.1)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)', padding: 12, marginBottom: 16, alignItems: 'center' },
  statusText: { color: COLORS.accent, fontSize: 14, fontWeight: '600', textAlign: 'center' },

  vinyl: { width: 160, height: 160, borderRadius: 80, backgroundColor: '#1e293b', borderWidth: 3, borderColor: '#334155', alignItems: 'center', justifyContent: 'center', marginBottom: 20, shadowColor: COLORS.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10 },
  vinylCenter: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.accent },
  vinylEmoji: { fontSize: 24 },

  songTitle: { fontSize: 24, fontWeight: '800', color: COLORS.white, textAlign: 'center', marginBottom: 4 },
  songArtist: { fontSize: 16, color: COLORS.muted, textAlign: 'center', marginBottom: 4 },
  songAlbum: { fontSize: 13, color: COLORS.muted, textAlign: 'center', fontStyle: 'italic', marginBottom: 8 },

  matchBadge: { backgroundColor: 'rgba(16,185,129,0.15)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 14, marginBottom: 16 },
  matchText: { color: COLORS.green, fontSize: 13, fontWeight: '700' },

  linkRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  linkBtnYT: { backgroundColor: 'rgba(255,68,68,0.15)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(255,68,68,0.3)' },
  linkBtnSP: { backgroundColor: 'rgba(30,215,96,0.15)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(30,215,96,0.3)' },
  linkBtnYTSm: { backgroundColor: 'rgba(255,68,68,0.15)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,68,68,0.3)', marginTop: 4 },
  linkBtnSPSm: { backgroundColor: 'rgba(30,215,96,0.15)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(30,215,96,0.3)', marginTop: 4 },
  linkBtnText: { color: COLORS.youtube, fontSize: 12, fontWeight: '700' },
  linkBtnTextSP: { color: COLORS.spotify, fontSize: 12, fontWeight: '700' },

  ctrlBtn: { marginTop: 20, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 32, width: '100%', alignItems: 'center' },
  ctrlBtnStart: { backgroundColor: COLORS.accent, shadowColor: COLORS.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8 },
  ctrlBtnStop: { backgroundColor: COLORS.red, shadowColor: COLORS.red, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8 },
  ctrlBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '800' },

  sectionTitle: { fontSize: 18, fontWeight: '800', color: COLORS.white, alignSelf: 'flex-start', marginBottom: 14 },
  emptyText: { color: COLORS.muted, fontSize: 14, marginTop: 8 },

  historyItem: { flexDirection: 'row', alignItems: 'flex-start', width: '100%', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  historyIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(59,130,246,0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 },
  historyDetails: { flex: 1 },
  historyTitle: { color: COLORS.white, fontWeight: '700', fontSize: 14 },
  historyArtist: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  historyTime: { color: COLORS.muted, fontSize: 11, marginLeft: 8, flexShrink: 0, marginTop: 2 },
});
