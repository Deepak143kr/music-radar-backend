#!/usr/bin/env bash
# exit on error
set -o errexit

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

if [ ! -f ffmpeg ]; then
  echo "Downloading FFmpeg..."
  wget -q https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz
  echo "Extracting FFmpeg..."
  tar -xf ffmpeg-git-amd64-static.tar.xz
  mv ffmpeg-git-*-amd64-static/ffmpeg .
  mv ffmpeg-git-*-amd64-static/ffprobe .
  rm -rf ffmpeg-git-*-amd64-static* ffmpeg-git-amd64-static.tar.xz
  chmod +x ffmpeg ffprobe
  echo "FFmpeg installed successfully!"
fi
