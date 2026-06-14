import urllib.request
import zipfile
import os
import shutil

url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
zip_path = "ffmpeg.zip"

print("Downloading FFmpeg...")
urllib.request.urlretrieve(url, zip_path)

print("Extracting...")
with zipfile.ZipFile(zip_path, 'r') as zip_ref:
    zip_ref.extractall("ffmpeg_extracted")

extracted_dir = os.path.join("ffmpeg_extracted", os.listdir("ffmpeg_extracted")[0], "bin")

print("Moving binaries...")
shutil.copy(os.path.join(extracted_dir, "ffmpeg.exe"), "ffmpeg.exe")
shutil.copy(os.path.join(extracted_dir, "ffprobe.exe"), "ffprobe.exe")

print("Cleaning up...")
os.remove(zip_path)
shutil.rmtree("ffmpeg_extracted")
print("Done!")
