from abc import ABC, abstractmethod
from typing import Optional
from dataclasses import dataclass
import json
import urllib.request
import urllib.error

from core.config import settings

@dataclass
class SpeechToTextResult:
    transcript: str
    detected_language: Optional[str]
    confidence: float
    provider: str
    is_mock: bool

class SpeechToTextService(ABC):
    """
    Abstract Base Class for Speech-to-Text Providers.
    Designed so providers like Sarvam AI can be plugged in seamlessly.
    """
    @abstractmethod
    async def transcribe(
        self,
        audio_data: Optional[bytes] = None,
        language_code: Optional[str] = "en-IN",
        simulation_text: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> SpeechToTextResult:
        pass

class MockSpeechService(SpeechToTextService):
    """
    Mock Speech-to-Text Service for local development and testing.
    Does not require any external API keys.
    """
    async def transcribe(
        self,
        audio_data: Optional[bytes] = None,
        language_code: Optional[str] = "en-IN",
        simulation_text: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> SpeechToTextResult:
        # If simulated transcript is provided by the developer/UI, use it
        if simulation_text and simulation_text.strip():
            transcript = simulation_text.strip()
        elif audio_data and len(audio_data) > 0:
            # When audio is recorded in mock mode without simulation text, provide a sensible default voice order
            transcript = "2 Tata Salt, 3 Parle-G and 1 Aashirvaad Atta"
        else:
            transcript = "2 Tata Salt, 3 Parle-G and 1 Aashirvaad Atta"

        return SpeechToTextResult(
            transcript=transcript,
            detected_language=language_code or "en-IN",
            confidence=0.98,
            provider="mock",
            is_mock=True,
        )

class SarvamSpeechService(SpeechToTextService):
    """
    Production Multilingual Speech-to-Text provider powered by Sarvam AI.
    Requires SARVAM_API_KEY to be set in backend/.env.
    Supports Indian languages: Hindi, Telugu, Tamil, Kannada, Malayalam,
    Marathi, Bengali, Gujarati, Punjabi, Odia, and English.
    """
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.SARVAM_API_KEY
        self.endpoint = "https://api.sarvam.ai/speech-to-text"

    async def transcribe(
        self,
        audio_data: Optional[bytes] = None,
        language_code: Optional[str] = "en-IN",
        simulation_text: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> SpeechToTextResult:
        if not self.api_key:
            raise ValueError(
                "Sarvam AI API key is not configured. "
                "Please configure SARVAM_API_KEY in backend/.env or set VOICE_MODE=mock."
            )

        # Allow simulation text override even in Sarvam mode if explicitly passed
        if simulation_text and simulation_text.strip():
            return SpeechToTextResult(
                transcript=simulation_text.strip(),
                detected_language=language_code or "en-IN",
                confidence=0.99,
                provider="sarvam",
                is_mock=False,
            )

        if not audio_data or len(audio_data) == 0:
            raise ValueError("No audio data provided for speech recognition.")

        # Build multipart/form-data request to Sarvam AI API
        boundary = "----ShopPulseBoundaryXYZ"
        body_parts = []

        # Model parameter
        body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
        body_parts.append(b'Content-Disposition: form-data; name="model"\r\n\r\n')
        body_parts.append(b"saarika:v2\r\n")

        # Language code parameter
        if language_code:
            body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
            body_parts.append(b'Content-Disposition: form-data; name="language_code"\r\n\r\n')
            body_parts.append(f"{language_code}\r\n".encode("utf-8"))

        # Audio file part
        filename = "recording.wav" if content_type == "audio/wav" else "recording.webm"
        file_mime = content_type or "audio/webm"
        body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
        body_parts.append(
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode("utf-8")
        )
        body_parts.append(f"Content-Type: {file_mime}\r\n\r\n".encode("utf-8"))
        body_parts.append(audio_data)
        body_parts.append(b"\r\n")

        body_parts.append(f"--{boundary}--\r\n".encode("utf-8"))
        body_data = b"".join(body_parts)

        req = urllib.request.Request(
            self.endpoint,
            data=body_data,
            headers={
                "api-subscription-key": self.api_key,
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_data = resp.read()
                result = json.loads(resp_data.decode("utf-8"))
                transcript = result.get("transcript", "")
                detected_lang = result.get("language_code", language_code)
                return SpeechToTextResult(
                    transcript=transcript,
                    detected_language=detected_lang,
                    confidence=0.95,
                    provider="sarvam",
                    is_mock=False,
                )
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Sarvam Speech-to-Text API error ({e.code}): {err_body}")
        except Exception as e:
            raise RuntimeError(f"Failed to communicate with Sarvam Speech-to-Text API: {str(e)}")

def get_speech_service() -> SpeechToTextService:
    """
    Factory to obtain the configured SpeechToTextService based on settings.VOICE_MODE.
    Defaults to MockSpeechService when VOICE_MODE is 'mock' or not set.
    """
    mode = (settings.VOICE_MODE or "mock").strip().lower()
    if mode == "sarvam":
        return SarvamSpeechService()
    return MockSpeechService()
