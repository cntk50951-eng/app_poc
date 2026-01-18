"""
Text Voice Web - A dictation practice web application
Uses OCR.space for image text recognition, DeepSeek for content extraction,
and Murf AI for text-to-speech.
"""

import os
import json
import base64
import requests
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dev-secret-key')

# API Keys (server-side only)
OCR_SPACE_API_KEY = os.getenv('OCR_SPACE_API_KEY')
DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
MURF_AI_API_KEY = os.getenv('MURF_AI_API_KEY')


def perform_ocr(image_data):
    """Perform OCR on the uploaded image using OCR.space"""
    try:
        # If image_data is a base64 string, decode it
        if image_data.startswith('data:image'):
            # Remove data URL prefix
            image_data = image_data.split(',')[1]

        # Decode base64 to bytes
        image_bytes = base64.b64decode(image_data)

        # OCR.space API - Support multilingual (English + Chinese Simplified)
        url = "https://api.ocr.space/parse/image"
        headers = {'apikey': OCR_SPACE_API_KEY}
        files = {'file': ('image.jpg', image_bytes, 'image/jpeg')}
        # Use 'eng' for English, 'chi_sim' for Chinese, 'auto' for auto-detection
        data = {'language': 'eng', 'detectorientation': 'true', 'scale': 'true', 'OCREngine': '2'}

        response = requests.post(url, headers=headers, files=files, data=data, timeout=30)
        result = response.json()

        # Check for errors
        if result.get('IsErroredOnProcessing'):
            error_msg = result.get('ErrorMessage', 'Unknown OCR error')
            raise Exception(f"OCR Error: {error_msg}")

        if result.get('ParsedResults') and len(result.get('ParsedResults', [])) > 0:
            parsed_text = result['ParsedResults'][0].get('ParsedText', '')
            return parsed_text
        else:
            # Try alternative: check if there's an error in a different field
            if result.get('ErrorMessage'):
                raise Exception(f"OCR Error: {result['ErrorMessage']}")
            raise Exception("No OCR results found - the image may be too small or unclear")

    except Exception as e:
        print(f"OCR Error: {e}")
        raise


def extract_content_with_deepseek(text, mode='both'):
    """
    Extract important words and sentences using DeepSeek API.
    mode: 'words' | 'sentences' | 'both'
    """
    try:
        client = requests.post(
            "https://api.deepseek.com/chat/completions",
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": create_extraction_prompt(text, mode)}],
                "temperature": 0.3,
                "max_tokens": 2000
            }
        )

        result = client.json()
        content = result['choices'][0]['message']['content']

        # Clean up and parse JSON
        content = content.replace('```json', '').replace('```', '').strip()
        return json.loads(content)

    except Exception as e:
        print(f"DeepSeek API Error: {e}")
        return fallback_extraction(text, mode)


def create_extraction_prompt(text, mode):
    """Create the extraction prompt based on mode"""
    if mode == 'words':
        return f"""
從以下英文文字中提取最重要的2個單詞（按重要性排序），返回 JSON 格式：

[
    {{"word": "單詞1", "phonetic": "/IPA音標/", "meaning": "中文意思"}},
    {{"word": "單詞2", "phonetic": "/IPA音標/", "meaning": "中文意思"}}
]

只返回 JSON，不要其他文字。

文字內容：
{text}
        """.strip()
    elif mode == 'sentences':
        return f"""
從以下英文文字中提取最重要的2個完整句子（按重要性排序），返回 JSON 格式：

[
    {{"sentence": "完整句子1"}},
    {{"sentence": "完整句子2"}}
]

只返回 JSON，不要其他文字。

文字內容：
{text}
        """.strip()
    else:
        return f"""
從以下英文文字中提取最重要的2個單詞和2個完整句子，返回 JSON 格式：

{{
    "words": [
        {{"word": "單詞1", "phonetic": "/IPA音標/", "meaning": "中文意思"}},
        {{"word": "單詞2", "phonetic": "/IPA音標/", "meaning": "中文意思"}}
    ],
    "sentences": [
        {{"sentence": "完整句子1"}},
        {{"sentence": "完整句子2"}}
    ]
}}

只返回 JSON，不要其他文字。

文字內容：
{text}
        """.strip()


def fallback_extraction(text, mode):
    """Simple fallback extraction when API fails"""
    import re

    # Extract words (2-15 letters)
    words = re.findall(r'\b([A-Za-z]{2,15})\b', text)
    unique_words = list(dict.fromkeys(words))[:2]

    # Extract sentences
    sentences = re.split(r'[.!?]+', text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 10][:2]

    if mode == 'words':
        return [{"word": w, "phonetic": "", "meaning": ""} for w in unique_words]
    elif mode == 'sentences':
        return [{"sentence": s} for s in sentences]
    else:
        return {
            "words": [{"word": w, "phonetic": "", "meaning": ""} for w in unique_words],
            "sentences": [{"sentence": s} for s in sentences]
        }


def generate_speech_with_murf(text, voice_id="en-US-natalie", rate=-15, pitch=-5):
    """
    Generate speech using Murf AI API via direct HTTP call.
    Returns the audio file URL.

    rate: -50 to 50 (negative = slower, positive = faster, default 0)
    pitch: -50 to 50 (negative = deeper, positive = higher, default 0)
    """
    try:
        # Murf AI API endpoint
        url = "https://api.murf.ai/v1/speech/generate"

        headers = {
            "api-key": MURF_AI_API_KEY,
            "Content-Type": "application/json"
        }

        payload = {
            "voice_id": voice_id,
            "text": text,
            "rate": rate,
            "pitch": pitch,
            "format": "MP3"
        }

        response = requests.post(url, headers=headers, json=payload, timeout=60)

        if response.status_code == 200:
            result = response.json()
            return result.get('audioFile')
        else:
            error_msg = response.text
            raise Exception(f"TTS API error ({response.status_code}): {error_msg}")

    except Exception as e:
        print(f"Murf AI API Error: {e}")
        raise


@app.route('/')
def index():
    """Main page"""
    return render_template('index.html')


@app.route('/api/ocr', methods=['POST'])
def ocr_api():
    """OCR endpoint"""
    try:
        data = request.json
        image_data = data.get('image', '')

        if not image_data:
            return jsonify({'error': 'No image provided'}), 400

        text = perform_ocr(image_data)

        # Extract content using DeepSeek
        extracted = extract_content_with_deepseek(text, mode='both')

        return jsonify({
            'success': True,
            'text': text,
            'extracted': extracted
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/extract', methods=['POST'])
def extract_api():
    """Extract words/sentences from text"""
    try:
        data = request.json
        text = data.get('text', '')
        mode = data.get('mode', 'both')

        if not text:
            return jsonify({'error': 'No text provided'}), 400

        extracted = extract_content_with_deepseek(text, mode=mode)

        return jsonify({
            'success': True,
            'extracted': extracted
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tts', methods=['POST'])
def tts_api():
    """Text-to-Speech endpoint using Murf AI"""
    try:
        data = request.json
        text = data.get('text', '')
        voice_id = data.get('voice_id', 'en-US-natalie')
        rate = data.get('rate', -15)  # Default slower speed
        pitch = data.get('pitch', -5)  # Default slightly lower pitch

        if not text:
            return jsonify({'error': 'No text provided'}), 400

        audio_url = generate_speech_with_murf(text, voice_id=voice_id, rate=rate, pitch=pitch)

        return jsonify({
            'success': True,
            'audio_url': audio_url
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tts/batch', methods=['POST'])
def tts_batch_api():
    """Generate TTS for multiple items"""
    try:
        data = request.json
        items = data.get('items', [])
        voice_id = data.get('voice_id', 'en-US-natalie')
        rate = data.get('rate', -15)  # Default slower speed
        pitch = data.get('pitch', -5)  # Default slightly lower pitch

        if not items:
            return jsonify({'error': 'No items provided'}), 400

        results = []
        for item in items:
            text = item.get('text', '')
            item_type = item.get('type', 'word')
            item_id = item.get('id', 0)

            try:
                audio_url = generate_speech_with_murf(text, voice_id=voice_id, rate=rate, pitch=pitch)
                results.append({
                    'id': item_id,
                    'type': item_type,
                    'text': text,
                    'audio_url': audio_url,
                    'success': True
                })
            except Exception as e:
                results.append({
                    'id': item_id,
                    'type': item_type,
                    'text': text,
                    'error': str(e),
                    'success': False
                })

        return jsonify({
            'success': True,
            'results': results
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'

    app.run(host='0.0.0.0', port=port, debug=debug)
