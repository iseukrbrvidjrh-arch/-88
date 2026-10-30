"""Local IPA and macOS speech API."""

from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.services.pronunciation import pronunciation
from app.services.speech import speak, stop

router = APIRouter(prefix="/api/v1")

class SpeechRequest(BaseModel):
    text: str
    target: str

@router.get("/pronunciation")
async def get_pronunciation(request:Request,word:str):
    return await run_in_threadpool(pronunciation,request.app.state.ipa_dictionary,word)

@router.get("/speech/capabilities")
async def capabilities(request:Request):
    return {"local_tts_available":request.app.state.tts.available(),"engine":"macOS say/afconvert/afplay"}

@router.post("/speech/play")
async def play(request:Request,body:SpeechRequest):
    return await run_in_threadpool(speak,request.app.state.tts,body.text,body.target)

@router.post("/speech/stop")
async def stop_playback(request:Request):
    return await run_in_threadpool(stop,request.app.state.tts)
