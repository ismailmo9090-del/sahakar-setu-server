# Sahakar Setu API Guide for Android App

## Base URL
```
https://ethanol-cash-peculiar.ngrok-free.dev
```

---

## 1. Chat Endpoint (Text)

### POST /api/v1/chat

**Request:**
```json
{
  "message": "User's message in Hindi or English",
  "channel": "web",
  "language": "hi"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| message | string | YES | User's message |
| channel | string | NO | "web" (default), "voice", "kiosk", "whatsapp", "sms", "ivr" |
| language | string | NO | "hi" (Hindi), "en" (English), "mr" (Marathi), etc. |
| sessionId | string (UUID) | NO | Reuse for continuing conversation |
| caseId | string (UUID) | NO | Reuse for continuing case |

**Response:**
```json
{
  "answer": "Bot's response text",
  "citations": ["Source: doc name, section"],
  "sessionId": "uuid-string",
  "caseId": "uuid-string",
  "language": "hi"
}
```

---

## 2. Voice Endpoint (Audio IN → Text + Audio OUT)

### POST /api/v1/voice

Full voice flow: Audio → STT (Vosk) → LLM (Groq) → TTS (Edge-TTS) → Audio + Text

**Request:**
```json
{
  "audio": "base64 encoded WAV audio (16kHz, mono, 16-bit PCM)",
  "language": "hi",
  "sessionId": "optional-uuid",
  "caseId": "optional-uuid"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| audio | string (base64) | YES | WAV audio file encoded as base64 |
| language | string | NO | "hi" (default), "en", "mr", etc. |
| sessionId | string (UUID) | NO | Reuse for continuing conversation |
| caseId | string (UUID) | NO | Reuse for continuing case |

**Response:**
```json
{
  "transcript": "what the user said in audio",
  "answer": "bot's text response",
  "citations": ["Source: doc name, section"],
  "audio": "base64 encoded MP3 audio of the answer",
  "audioFormat": "mp3",
  "sessionId": "uuid-string",
  "caseId": "uuid-string",
  "language": "hi"
}
```

**Audio Requirements:**
- Format: WAV
- Sample rate: 16000 Hz (16kHz)
- Channels: 1 (mono)
- Bit depth: 16-bit PCM
- Encoding: Base64

---

## 3. TTS Endpoint (Text to Audio Only)

### POST /api/v1/tts

Converts text to speech audio.

**Request:**
```json
{
  "text": "Namaste! Main Sahakar Setu hoon.",
  "language": "hi"
}
```

**Response:** Binary MP3 audio file
- Content-Type: audio/mpeg
- Body: MP3 audio bytes

**Available Voices:**
| Language | Voice |
|----------|-------|
| hi (Hindi) | hi-IN-SwaraNeural |
| en (English) | en-US-JennyNeural |
| mr (Marathi) | mr-IN-SwaraNeural |
| ta (Tamil) | ta-IN-PallaviNeural |
| te (Telugu) | te-IN-ShrutiNeural |
| bn (Bengali) | bn-IN-TanishaaNeural |

---

## 4. STT Endpoint (Audio to Text Only)

### POST /api/v1/stt

Converts audio to text.

**Request:**
```json
{
  "audio": "base64 encoded WAV audio",
  "language": "hi"
}
```

**Response:**
```json
{
  "transcript": "what the user said",
  "language": "hi"
}
```

---

## 5. Health Check

### GET /health

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-09-23T...",
  "db": "connected"
}
```

---

## 6. Grievance Draft

### POST /api/v1/grievance/draft

**Request:**
```json
{
  "caseId": "uuid-from-chat",
  "language": "hi"
}
```

**Response:**
```json
{
  "trackingId": "GRV-2026-...",
  "status": "drafted",
  "document": "Generated grievance text..."
}
```

---

## 7. Scheme Eligibility

### POST /api/v1/scheme/eligibility

**Request:**
```json
{
  "query": "Mujhe PMFBY mein kya milega?",
  "language": "hi"
}
```

---

## 8. EMI Calculator

### POST /api/v1/financial/emi

**Request:**
```json
{
  "principal": 100000,
  "rate": 7,
  "tenure": 12
}
```

---

## Android App Integration Examples

### Text Chat Flow
```kotlin
// 1. User types message
val response = httpClient.post("https://ethanol-cash-peculiar.ngrok-free.dev/api/v1/chat") {
    contentType(ContentType.Application.Json)
    setBody(ChatRequest(
        message = "PMFBY kya hai?",
        channel = "web",
        language = "hi",
        sessionId = savedSessionId,
        caseId = savedCaseId
    ))
}
// Save sessionId, caseId from response
```

### Voice Chat Flow
```kotlin
// 1. Record audio as WAV (16kHz, mono, 16-bit)
val audioBytes = recordAudio()
val audioBase64 = Base64.encodeToString(audioBytes, Base64.NO_WRAP)

// 2. Send to voice endpoint
val response = httpClient.post("https://ethanol-cash-peculiar.ngrok-free.dev/api/v1/voice") {
    contentType(ContentType.Application.Json)
    setBody(VoiceRequest(
        audio = audioBase64,
        language = "hi",
        sessionId = savedSessionId,
        caseId = savedCaseId
    ))
}

// 3. Get response
val transcript = response.transcript  // what user said
val answer = response.answer          // text answer
val audioMp3 = response.audio        // base64 MP3 to play

// 4. Play audio
val mp3Bytes = Base64.decode(audioMp3, Base64.NO_WRAP)
playMp3Audio(mp3Bytes)
```

### TTS Only Flow
```kotlin
// Convert text to audio
val response = httpClient.post("https://ethanol-cash-peculiar.ngrok-free.dev/api/v1/tts") {
    contentType(ContentType.Application.Json)
    setBody(TtsRequest(text = "Namaste!", language = "hi"))
}
// Response is binary MP3 audio
playMp3Audio(response.body())
```

---

## Complete Conversation Flow

```
1. User opens app
   → POST /api/v1/chat { message: "Namaste", channel: "voice", language: "hi" }
   → Save sessionId, caseId

2. User speaks (voice)
   → POST /api/v1/voice { audio: "base64...", language: "hi", sessionId, caseId }
   → Play returned MP3 audio

3. User speaks about problem (voice)
   → POST /api/v1/voice { audio: "base64...", language: "hi", sessionId, caseId }
   → Bot asks follow-up questions

4. User wants grievance
   → POST /api/v1/grievance/draft { caseId, language: "hi" }
   → Get tracking ID
```
