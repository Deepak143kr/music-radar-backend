# Ambient Music Radar - Backend

FastAPI backend with Shazam music recognition.

## Deploy to Render

1. Push this folder to GitHub
2. Go to render.com → New Web Service
3. Connect your GitHub repo
4. Set:
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Python version**: 3.11
