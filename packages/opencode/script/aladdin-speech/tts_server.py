from io import BytesIO
import os
from pathlib import Path
from threading import Lock

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from mlx_audio.tts.utils import load_model
from pydantic import BaseModel, Field

MODEL = os.environ.get(
    "ALADDIN_TTS_MODEL",
    str(Path(__file__).parent / ".models/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit"),
)
VOICES = ("Ryan", "Aiden", "Vivian", "Serena", "Dylan", "Eric", "Uncle_Fu", "Ono_Anna", "Sohee")
ENGLISH_VOICES = ("Ryan", "Aiden")

app = FastAPI(title="Aladdin Qwen3-TTS", version="1.0.0")
model = None
model_lock = Lock()


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=4096)
    model: str = "qwen3-tts-1.7b"
    voice: str = "Ryan"
    language: str = "english"


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL, "loaded": model is not None}


@app.get("/v1/voices")
def voices():
    return {"voices": VOICES, "english": ENGLISH_VOICES}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    if request.voice not in VOICES:
        raise HTTPException(status_code=422, detail=f"Unknown voice: {request.voice}")
    if request.language.lower() != "english":
        raise HTTPException(status_code=422, detail="Aladdin is configured for English speech")

    global model
    with model_lock:
        if model is None:
            model = load_model(MODEL)
        output = next(
            iter(
                model.generate(
                    text=request.input,
                    voice=request.voice,
                    temperature=0.9,
                )
            ),
            None,
        )
    if output is None:
        raise HTTPException(status_code=503, detail="Qwen3-TTS returned no audio")

    audio = BytesIO()
    sf.write(audio, np.asarray(output.audio), 24000, format="WAV")
    return Response(content=audio.getvalue(), media_type="audio/wav")
