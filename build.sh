#!/usr/bin/env bash
# exit on error
set -o errexit

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
