from fastapi import FastAPI, Depends, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import models, database
from datetime import datetime
import random
import time
import os

# Add current directory to PATH so pydub finds ffmpeg
os.environ["PATH"] += os.pathsep + os.getcwd()

from shazamio import Shazam

shazam = Shazam()

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="Ambient Music API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/recognize")
async def recognize_audio(audio: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Receives an audio file, saves it to disk, analyzes it using Shazamio via file path.
    """
    content = await audio.read()
    print(f"Received audio: {len(content)} bytes, filename: {audio.filename}")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file")

    # Save audio to a temp file — shazamio works best with a real file path
    tmp_path = "temp_audio_chunk.wav"
    with open(tmp_path, "wb") as f:
        f.write(content)

    try:
        print("Sending to Shazam for recognition...")
        out = await shazam.recognize(tmp_path)
        print(f"Shazam raw output keys: {list(out.keys())}")

        # Parse Shazamio output
        if 'track' not in out:
            print("No track found in Shazam response")
            return {"status": "success", "saved_new": False, "song": None}

        track = out['track']
        song_name = track.get('title', 'Unknown Title')
        artist_name = track.get('subtitle', 'Unknown Artist')
        print(f"Recognized: {song_name} by {artist_name}")

        # Optional album info
        album_name = None
        for section in track.get('sections', []):
            if section.get('type') == 'SONG':
                for metadata in section.get('metadata', []):
                    if metadata.get('title') == 'Album':
                        album_name = metadata.get('text')
                        break

        # Check for duplicates in the DB
        latest_db_song = db.query(models.DetectedSong).order_by(models.DetectedSong.id.desc()).first()

        saved = False
        if not latest_db_song or latest_db_song.song_name != song_name:
            new_song = models.DetectedSong(
                song_name=song_name,
                artist_name=artist_name,
                album_name=album_name,
                confidence_score=99.9,
                duration=None
            )
            db.add(new_song)
            db.commit()
            db.refresh(new_song)
            saved = True
            return_data = new_song
        else:
            return_data = latest_db_song

        return {
            "status": "success",
            "saved_new": saved,
            "song": {
                "id": return_data.id,
                "song_name": return_data.song_name,
                "artist_name": return_data.artist_name,
                "album_name": return_data.album_name,
                "detected_time": return_data.detected_time,
                "confidence_score": return_data.confidence_score
            }
        }
    except Exception as e:
        import traceback
        print(f"Error recognizing: {e}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.get("/history")
def get_history(db: Session = Depends(get_db), limit: int = 50):
    songs = db.query(models.DetectedSong).order_by(models.DetectedSong.id.desc()).limit(limit).all()
    return {"status": "success", "history": songs}
