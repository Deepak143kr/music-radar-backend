from sqlalchemy import Column, Integer, String, Float, DateTime
from datetime import datetime
from database import Base

class DetectedSong(Base):
    __tablename__ = "detected_songs"

    id = Column(Integer, primary_key=True, index=True)
    song_name = Column(String, index=True)
    artist_name = Column(String, index=True)
    album_name = Column(String, nullable=True)
    detected_time = Column(DateTime, default=datetime.utcnow)
    confidence_score = Column(Float, nullable=True)
    duration = Column(Integer, nullable=True)
