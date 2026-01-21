"""
Text Voice Web - A dictation practice web application
Uses OCR.space for image text recognition, DeepSeek for content extraction,
and Murf AI for text-to-speech.
"""

import os
import json
import base64
import requests
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dev-secret-key')

# Database configuration
database_url = os.getenv('DATABASE_URL')
if database_url:
    # Use PostgreSQL on Render with pg8000 driver (pure Python, works with Python 3.13)
    # Replace postgresql:// with postgresql+pg8000:// for pg8000 driver
    if database_url.startswith('postgresql://'):
        pg8000_url = database_url.replace('postgresql://', 'postgresql+pg8000://', 1)
        app.config['SQLALCHEMY_DATABASE_URI'] = pg8000_url
    else:
        app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    # Use SQLite locally
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///app.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# API Keys (server-side only)
OCR_SPACE_API_KEY = os.getenv('OCR_SPACE_API_KEY')
DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
MURF_AI_API_KEY = os.getenv('MURF_AI_API_KEY')

# Google OAuth credentials
GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET')
GOOGLE_REDIRECT_URI = os.getenv('GOOGLE_REDIRECT_URI', 'http://localhost:5000/auth/google/callback')


# ==================== DATABASE MODELS ====================
class User(UserMixin, db.Model):
    """User model for authentication"""
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    password_hash = db.Column(db.String(255), nullable=True)  # Nullable for OAuth users
    google_id = db.Column(db.String(255), unique=True, nullable=True)
    avatar_url = db.Column(db.String(512), nullable=True)
    created_at = db.Column(db.DateTime, default=db.func.current_timestamp())
    updated_at = db.Column(db.DateTime, default=db.func.current_timestamp(), onupdate=db.func.current_timestamp())

    # Relationship to practice sessions
    practice_sessions = db.relationship('PracticeSession', backref='user', lazy='dynamic')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password) if self.password_hash else False


class PracticeSession(db.Model):
    """Record of each dictation practice session"""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True, index=True)  # Nullable for guest users
    title = db.Column(db.String(255), nullable=False)  # e.g., "P3 English Ch.4"
    total_items = db.Column(db.Integer, nullable=False)
    correct_count = db.Column(db.Integer, nullable=False)
    wrong_count = db.Column(db.Integer, nullable=False)
    accuracy = db.Column(db.Float, nullable=False)  # Percentage 0-100
    words_data = db.Column(db.Text, nullable=True)  # JSON string of words in session
    created_at = db.Column(db.DateTime, default=db.func.current_timestamp())


class AudioFile(db.Model):
    """Store audio files from Murf AI (since their URLs are temporary)"""
    id = db.Column(db.Integer, primary_key=True)
    text_hash = db.Column(db.String(64), unique=True, nullable=False, index=True)  # MD5 hash of the text
    text_content = db.Column(db.Text, nullable=False)  # The original text
    audio_data = db.Column(db.LargeBinary, nullable=False)  # Actual audio file content
    audio_format = db.Column(db.String(10), nullable=False, default='mp3')  # Audio format
    created_at = db.Column(db.DateTime, default=db.func.current_timestamp())


class WrongWord(db.Model):
    """User's wrong words book - words/sentences they want to review"""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    text = db.Column(db.String(500), nullable=False)  # The word or sentence
    type = db.Column(db.String(20), nullable=False)  # 'word' or 'sentence'
    phonetic = db.Column(db.String(100), nullable=True)  # Phonetic symbols for words
    meaning = db.Column(db.Text, nullable=True)  # Chinese translation
    example = db.Column(db.Text, nullable=True)  # Example sentence for words
    audio_id = db.Column(db.Integer, db.ForeignKey('audio_file.id'), nullable=True)  # Reference to cached audio
    source_session_id = db.Column(db.Integer, nullable=True)  # Original practice session ID
    notes = db.Column(db.Text, nullable=True)  # User's personal notes
    created_at = db.Column(db.DateTime, default=db.func.current_timestamp())
    updated_at = db.Column(db.DateTime, default=db.func.current_timestamp(), onupdate=db.func.current_timestamp())

    # Relationship to audio file
    audio_file = db.relationship('AudioFile', backref='wrong_words')

    # Composite unique constraint to prevent duplicates
    __table_args__ = (
        db.UniqueConstraint('user_id', 'text', 'type', name='unique_user_word'),
    )


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


# ==================== HELPER FUNCTIONS ====================
def create_database():
    """Create database tables"""
    with app.app_context():
        db.create_all()
        print("Database tables created successfully!")


def get_google_auth_url():
    """Generate Google OAuth URL"""
    import urllib.parse
    params = {
        'client_id': GOOGLE_CLIENT_ID,
        'redirect_uri': GOOGLE_REDIRECT_URI,
        'response_type': 'code',
        'scope': 'openid email profile',
        'access_type': 'offline',
        'prompt': 'consent'
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"


def exchange_code_for_tokens(code):
    """Exchange authorization code for access token"""
    url = "https://oauth2.googleapis.com/token"
    data = {
        'code': code,
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'redirect_uri': GOOGLE_REDIRECT_URI,
        'grant_type': 'authorization_code'
    }
    response = requests.post(url, json=data)
    return response.json()


def get_google_user_info(access_token):
    """Get user info from Google"""
    response = requests.get(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        headers={'Authorization': f'Bearer {access_token}'}
    )
    return response.json()


def perform_ocr(image_data):
    """Perform OCR on the uploaded image using OCR.space"""
    import uuid

    try:
        # If image_data is a base64 string, decode it
        if image_data.startswith('data:image'):
            # Remove data URL prefix
            image_data = image_data.split(',')[1]

        # Decode base64 to bytes
        image_bytes = base64.b64decode(image_data)

        # OCR.space API - Support multilingual
        url = "https://api.ocr.space/parse/image"

        # Create a unique filename with proper extension
        # First try to detect image type from bytes
        if image_bytes[:2] == b'\xff\xd8':
            ext = 'jpg'
        elif image_bytes[:4] == b'\x89PNG':
            ext = 'png'
        elif image_bytes[:4] == b'GIF':
            ext = 'gif'
        else:
            ext = 'jpg'  # default

        filename = f"image.{ext}"
        files = {'file': (filename, image_bytes, f'image/{ext}')}
        data = {
            'language': 'eng',
            'detectOrientation': 'true',
            'scale': 'true',
            'OCREngine': '2'
        }

        response = requests.post(url, files=files, data=data, timeout=30)

        # Check for HTTP errors
        if response.status_code != 200:
            raise Exception(f"OCR API returned status {response.status_code}")

        try:
            result = response.json()
        except Exception as e:
            raise Exception(f"OCR API returned non-JSON response: {response.text[:200]}")

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
        # For exceptions, extract candidates first then use enhanced extraction
        import re
        words = re.findall(r'\b([A-Za-z]{2,15})\b', text)
        words = list(dict.fromkeys(words))[:20]
        sentences = re.split(r'[.!?\n]+', text)
        sentences = [s.strip() for s in sentences if len(s.strip()) >= 10][:20]
        return enhanced_extraction_for_technical(text, mode)


def create_extraction_prompt(text, mode):
    """Create the extraction prompt based on mode"""
    if mode == 'words':
        return f"""
從以下英文文字中提取最重要的20個有意義的單詞（按重要性排序），返回 JSON 格式：

要求：
- 只提取真正的英文單詞（2-15個字母），排除數字、符號、代碼片段等
- 排除 like "history[1].action", "data[0].name" 等程式碼或數據結構
- 排除單獨的數字、日期、網址
- 只返回常見的英文詞彙

[
    {{"word": "單詞1", "phonetic": "/IPA音標/", "meaning": "中文翻譯", "example": "例句"}},
    {{"word": "單詞2", "phonetic": "/IPA音標/", "meaning": "中文翻譯", "example": "例句"}}
    ... 最多20個
]

只返回 JSON，不要其他文字。

文字內容：
{text}
        """.strip()
    elif mode == 'sentences':
        return f"""
從以下英文文字中提取最重要的20個完整句子（按重要性排序），返回 JSON 格式：

要求：
- 只提取有意義的完整句子（至少5個單詞）
- 排除 like "history[1].action", "data[0].name" 等程式碼或數據結構
- 排除片段、不完整的句子、標題、標籤等
- 只返回可獨立成句的完整句子

[
    {{"sentence": "完整句子1", "meaning": "中文翻譯"}},
    {{"sentence": "完整句子2", "meaning": "中文翻譯"}}
    ... 最多20個
]

只返回 JSON，不要其他文字。

文字內容：
{text}
        """.strip()
    else:
        return f"""
從以下英文文字中提取最重要的20個有意義的單詞和20個完整句子，返回 JSON 格式：

要求：
- 單詞：只提取真正的英文單詞（2-15個字母），排除數字、符號、代碼片段等
- 句子：只提取有意義的完整句子（至少5個單詞），排除片段和不完整內容
- 排除 like "history[1].action", "data[0].name" 等程式碼或數據結構
- 排除標題、標籤、數據結構等非自然語言內容

{{
    "words": [
        {{"word": "單詞1", "phonetic": "/IPA音標/", "meaning": "中文翻譯", "example": "例句"}},
        {{"word": "單詞2", "phonetic": "/IPA音標/", "meaning": "中文翻譯", "example": "例句"}}
        ... 最多20個
    ],
    "sentences": [
        {{"sentence": "完整句子1", "meaning": "中文翻譯"}},
        {{"sentence": "完整句子2", "meaning": "中文翻譯"}}
        ... 最多20個
    ]
}}

只返回 JSON，不要其他文字。

文字內容：
{text}
        """.strip()


def enhanced_extraction_for_technical(text, mode):
    """
    Enhanced extraction for technical content:
    1. Use regex to extract candidate words/sentences
    2. Call DeepSeek to filter and add meanings/phonetics
    """
    import re

    # Filter patterns to exclude code-like content
    exclude_patterns = [
        r'^[a-zA-Z]+\[\d+\]',  # like "history[1]"
        r'^[a-zA-Z]+\.[a-zA-Z]+',  # like "data.action"
        r'^[a-zA-Z]+\.\w+\(\)',  # like "console.log()"
        r'^[\d\.\-\/]+$',  # just numbers/dates
        r'^https?://',  # URLs
        r'^[a-zA-Z]+:\/\/',  # URLs
        r'^[0-9]+[a-zA-Z]+',  # starts with number like "2history"
        r'^[a-zA-Z]+[0-9]+$',  # ends with number
    ]

    def is_valid_word(w):
        if len(w) < 2 or len(w) > 15:
            return False
        if not re.search(r'[aeiouAEIOU]', w):
            return False
        for pattern in exclude_patterns:
            if re.match(pattern, w):
                return False
        return True

    # Step 1: Extract candidate words
    words = re.findall(r'\b([A-Za-z]{2,15})\b', text)
    words = [w for w in words if is_valid_word(w)]
    unique_words = list(dict.fromkeys(words))[:20]

    # Step 2: Extract candidate sentences
    sentences = re.split(r'[.!?\n]+', text)
    sentences = [s.strip() for s in sentences if len(s.strip()) >= 10][:20]
    sentences = [s for s in sentences if not re.match(r'^[\d\.\[\]\/\-\s]+$', s)]

    # Step 3: Call DeepSeek to filter and add meanings
    try:
        client = requests.post(
            "https://api.deepseek.com/chat/completions",
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "deepseek-chat",
                "messages": [{
                    "role": "user",
                    "content": create_enhanced_prompt(unique_words, sentences, mode)
                }],
                "temperature": 0.3,
                "max_tokens": 2000
            }
        )

        result = client.json()
        content = result['choices'][0]['message']['content']
        content = content.replace('```json', '').replace('```', '').strip()
        return json.loads(content)

    except Exception as e:
        print(f"Enhanced extraction DeepSeek error: {e}")
        # Fallback to basic extraction if API fails
        return basic_extraction(unique_words, sentences, mode)


def create_enhanced_prompt(words, sentences, mode):
    """Create prompt for enhanced extraction with DeepSeek"""
    words_str = ', '.join(words) if words else ""
    sentences_str = '\n'.join([f"- {s}" for s in sentences[:10]]) if sentences else ""

    return f"""
從以下候選單詞和句子中，過濾出有意義的內容，並為每個單詞添加音標和中文翻譯，為每個句子添加中文翻譯。

候選單詞（去除數字、代碼、數據結構等）：
{words_str}

候選句子（去除不完整、片段化的內容）：
{sentences_str}

要求：
- 單詞：只保留真正的英文詞彙（常見單詞），排除技術術語、變量名、數據庫字段名等
- 句子：只保留完整、有意義的自然語言句子
- 為每個單詞提供：word, phonetic (/IPA/), meaning（中文翻譯）, example（例句）
- 為每個句子提供：sentence, meaning（中文翻譯）

返回 JSON 格式：
{{
    "words": [
        {{"word": "example", "phonetic": "/ɪɡˈzæmpl/", "meaning": "例子，示例", "example": "This is an example sentence."}},
        ...
    ],
    "sentences": [
        {{"sentence": "This is a complete sentence.", "meaning": "這是一個完整的句子。"}},
        ...
    ]
}}

只返回 JSON，不要其他文字。"""


def basic_extraction(words, sentences, mode):
    """Basic extraction without DeepSeek (last resort fallback)"""
    if mode == 'words':
        return [{"word": w, "phonetic": "", "meaning": "[待翻譯]"} for w in words[:20]]
    elif mode == 'sentences':
        return [{"sentence": s, "meaning": "[待翻譯]"} for s in sentences[:20]]
    else:
        return {
            "words": [{"word": w, "phonetic": "", "meaning": "[待翻譯]"} for w in words[:20]],
            "sentences": [{"sentence": s, "meaning": "[待翻譯]"} for s in sentences[:20]]
        }


def generate_speech_with_murf(text, voice_id="en-US-natalie", rate=-15, pitch=-5):
    """
    Generate speech using Murf AI API via direct HTTP call.
    First checks database for existing audio, otherwise generates new and stores.
    Returns the audio file URL or None if failed.

    rate: -50 to 50 (negative = slower, positive = faster, default 0)
    pitch: -50 to 50 (negative = deeper, positive = higher, default 0)
    """
    import hashlib

    try:
        # Create hash for the text + voice settings (for caching)
        cache_key = f"{voice_id}|{rate}|{pitch}|{text}"
        text_hash = hashlib.md5(cache_key.encode()).hexdigest()

        # Check if audio already exists in database
        existing_audio = AudioFile.query.filter_by(text_hash=text_hash).first()
        if existing_audio:
            return existing_audio.id  # Return the database ID

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
            audio_url = result.get('audioFile')

            # Download and store the audio file
            audio_response = requests.get(audio_url, timeout=60)
            if audio_response.status_code == 200:
                audio_data = audio_response.content

                # Store in database
                audio_file = AudioFile(
                    text_hash=text_hash,
                    text_content=text,
                    audio_data=audio_data,
                    audio_format='mp3'
                )
                db.session.add(audio_file)
                db.session.commit()

                return audio_file.id

            return audio_url
        else:
            error_msg = response.text
            raise Exception(f"TTS API error ({response.status_code}): {error_msg}")

    except Exception as e:
        print(f"Murf AI API Error: {e}")
        raise


@app.route('/api/audio/<int:audio_id>')
def get_audio(audio_id):
    """Serve audio file from database"""
    try:
        audio = AudioFile.query.get_or_404(audio_id)
        from flask import Response
        return Response(
            audio.audio_data,
            mimetype=f'audio/{audio.audio_format}',
            headers={'Content-Disposition': f'inline; filename=audio.{audio.audio_format}'}
        )
    except Exception as e:
        print(f"Get audio error: {e}")
        return jsonify({'error': 'Audio not found'}), 404


@app.route('/')
def index():
    """Main page"""
    return render_template('index.html')


def is_valid_extraction_result(extracted):
    """Check if the extraction result is valid (not database queries or technical content)"""
    if not extracted:
        return False

    # Check if it's a list of dicts with expected keys
    if isinstance(extracted, list):
        for item in extracted:
            if not isinstance(item, dict):
                return False
            if 'word' in item and not item.get('meaning'):
                return False  # Missing meaning for word
            if 'sentence' in item and not item.get('meaning'):
                return False  # Missing translation for sentence

    # Check if it's a dict with words/sentences
    if isinstance(extracted, dict):
        if 'words' in extracted:
            for word in extracted['words']:
                if not word.get('meaning'):
                    return False
        if 'sentences' in extracted:
            for sent in extracted['sentences']:
                if not sent.get('meaning'):
                    return False

    return True


def ocr_api():
    """OCR endpoint - handles both OCR and content extraction"""
    try:
        data = request.json
        image_data = data.get('image', '')

        if not image_data:
            return jsonify({'error': 'No image provided'}), 400

        text = perform_ocr(image_data)

        # Check if text looks like database query or technical content
        technical_patterns = [
            r'^[\w\s]*SELECT.*FROM',
            r'^[\w\s]*INSERT.*INTO',
            r'^[\w\s]*UPDATE.*SET',
            r'^[\w\s]*DELETE.*FROM',
            r'^[\w\s]*history\[\d+\]',
            r'^[\w\s]*data\[\d+\]',
            r'^[\w\s]*[\w]+\.[\w]+\([\w\s,]*\)',  # function calls
        ]

        is_technical = any(re.search(p, text, re.IGNORECASE | re.DOTALL) for p in technical_patterns)

        if is_technical:
            print("Detected technical content, using enhanced extraction")
            # Use enhanced extraction for technical content
            extracted = enhanced_extraction_for_technical(text, 'both')
        else:
            # Extract content using DeepSeek for normal content
            extracted = extract_content_with_deepseek(text, mode='both')

            # Fallback if DeepSeek returned empty or invalid results
            if not is_valid_extraction_result(extracted):
                print("DeepSeek returned invalid results, using enhanced extraction")
                extracted = enhanced_extraction_for_technical(text, 'both')

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
                audio_result = generate_speech_with_murf(text, voice_id=voice_id, rate=rate, pitch=pitch)
                # audio_result can be an integer (database ID) or string (URL)
                audio_url = audio_result if isinstance(audio_result, str) else f"/api/audio/{audio_result}"
                results.append({
                    'id': item_id,
                    'type': item_type,
                    'text': text,
                    'audio_url': audio_url,
                    'audio_id': audio_result if isinstance(audio_result, int) else None,
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


# ==================== AUTH ROUTES ====================
@app.route('/auth/google')
def google_auth():
    """Initiate Google OAuth flow"""
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return jsonify({'success': False, 'message': 'Google OAuth not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env'}), 500
    auth_url = get_google_auth_url()
    return redirect(auth_url)


@app.route('/auth/google/callback')
def google_callback():
    """Handle Google OAuth callback"""
    try:
        code = request.args.get('code')
        if not code:
            return redirect(url_for('index'))

        # Exchange code for tokens
        tokens = exchange_code_for_tokens(code)
        if 'error' in tokens:
            print(f"Google OAuth error: {tokens['error']}")
            return redirect(url_for('index'))

        # Get user info
        user_info = get_google_user_info(tokens['access_token'])
        if 'email' not in user_info:
            print(f"Google user info: {user_info}")
            return redirect(url_for('index'))

        # Find or create user
        user = User.query.filter_by(email=user_info['email']).first()

        if not user:
            user = User(
                email=user_info['email'],
                name=user_info.get('name', user_info['email'].split('@')[0]),
                google_id=user_info['id'],
                avatar_url=user_info.get('picture')
            )
            db.session.add(user)
            db.session.commit()
        elif not user.google_id:
            # Update existing user with Google ID
            user.google_id = user_info['id']
            user.avatar_url = user_info.get('picture')
            db.session.commit()

        login_user(user)
        # Redirect with a query param to trigger page reload
        return redirect(url_for('index', logged_in='true'))
    except Exception as e:
        print(f"Google OAuth callback error: {e}")
        return redirect(url_for('index'))


@app.route('/auth/login', methods=['POST'])
def login():
    """Email/password login"""
    try:
        data = request.json
        email = data.get('email', '').lower().strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'success': False, 'message': '請填寫郵箱和密碼'}), 400

        user = User.query.filter_by(email=email).first()

        if not user:
            return jsonify({'success': False, 'message': '帳戶不存在，請先註冊'}), 401

        if not user.check_password(password):
            return jsonify({'success': False, 'message': '密碼錯誤'}), 401

        login_user(user)

        return jsonify({
            'success': True,
            'user': {
                'id': user.id,
                'email': user.email,
                'name': user.name,
                'avatar_url': user.avatar_url
            }
        })
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({'success': False, 'message': '登錄失敗，請稍後重試'}), 500


@app.route('/auth/register', methods=['POST'])
def register():
    """Email/password registration"""
    try:
        data = request.json
        name = data.get('name', '').strip()
        email = data.get('email', '').lower().strip()
        password = data.get('password', '')

        # Validation
        if not name or not email or not password:
            return jsonify({'success': False, 'message': '請填寫所有必填欄位'}), 400

        if len(password) < 8:
            return jsonify({'success': False, 'message': '密碼必須至少 8 個字符'}), 400

        if not any(c.isdigit() for c in password):
            return jsonify({'success': False, 'message': '密碼必須包含至少 1 個數字'}), 400

        if not any(c in '!@#$%^&*(),.?":{}|<>' for c in password):
            return jsonify({'success': False, 'message': '密碼必須包含至少 1 個符號'}), 400

        # Check if user exists
        existing_user = User.query.filter_by(email=email).first()
        if existing_user:
            return jsonify({'success': False, 'message': '該郵箱已被註冊'}), 400

        # Create new user
        user = User(
            email=email,
            name=name
        )
        user.set_password(password)

        db.session.add(user)
        db.session.commit()

        login_user(user)

        return jsonify({
            'success': True,
            'user': {
                'id': user.id,
                'email': user.email,
                'name': user.name,
                'avatar_url': user.avatar_url
            }
        })
    except Exception as e:
        print(f"Register error: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': '註冊失敗，請稍後重試'}), 500


@app.route('/auth/logout')
@login_required
def logout():
    """Logout user"""
    logout_user()
    return redirect(url_for('index'))


@app.route('/auth/current-user')
def get_current_user():
    """Get current logged in user"""
    if current_user.is_authenticated:
        return jsonify({
            'success': True,
            'user': {
                'id': current_user.id,
                'email': current_user.email,
                'name': current_user.name,
                'avatar_url': current_user.avatar_url
            }
        })
    return jsonify({'success': False, 'message': 'Not logged in'})


@app.route('/auth/update-profile', methods=['POST'])
@login_required
def update_profile():
    """Update user profile (name)"""
    try:
        data = request.json
        name = data.get('name', '').strip()

        if not name:
            return jsonify({'success': False, 'message': '請輸入暱稱'}), 400

        if len(name) > 50:
            return jsonify({'success': 'False', 'message': '暱稱不能超過 50 個字符'}), 400

        current_user.name = name
        db.session.commit()

        return jsonify({
            'success': True,
            'user': {
                'id': current_user.id,
                'email': current_user.email,
                'name': current_user.name,
                'avatar_url': current_user.avatar_url
            }
        })
    except Exception as e:
        print(f"Update profile error: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': '更新失敗'}), 500


@app.route('/auth/upload-avatar', methods=['POST'])
@login_required
def upload_avatar():
    """Upload user avatar"""
    try:
        if 'avatar' not in request.files:
            return jsonify({'success': False, 'message': '請選擇圖片'}), 400

        file = request.files['avatar']
        if file.filename == '':
            return jsonify({'success': False, 'message': '請選擇圖片'}), 400

        # Validate file type
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        if ext not in allowed_extensions:
            return jsonify({'success': False, 'message': '不支持的圖片格式'}), 400

        # Generate filename
        filename = f"avatar_{current_user.id}_{int(__import__('time').time())}.{ext}"
        upload_path = os.path.join('static', 'uploads', 'avatars')
        os.makedirs(upload_path, exist_ok=True)
        filepath = os.path.join(upload_path, filename)

        # Save file
        file.save(filepath)

        # Update user avatar_url
        avatar_url = f"/static/uploads/avatars/{filename}"
        current_user.avatar_url = avatar_url
        db.session.commit()

        return jsonify({
            'success': True,
            'avatar_url': avatar_url
        })
    except Exception as e:
        print(f"Upload avatar error: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': '上傳失敗'}), 500


@app.route('/api/practice/record', methods=['POST'])
def record_practice():
    """Record a practice session - requires authentication"""
    # Require authentication for practice recording
    if not current_user.is_authenticated:
        return jsonify({'success': False, 'message': '請先登錄以記錄練習成績'}), 401

    try:
        data = request.json
        title = data.get('title', '練習')
        total_items = data.get('total_items', 0)
        correct_count = data.get('correct_count', 0)
        wrong_count = data.get('wrong_count', 0)
        words_data = data.get('words_data', [])

        # Server-side validation
        if total_items < 0 or correct_count < 0 or wrong_count < 0:
            return jsonify({'success': False, 'message': '無效的數據'}), 400

        if correct_count + wrong_count != total_items:
            return jsonify({'success': False, 'message': '數據不一致'}), 400

        # Validate session belongs to current user (session isolation)
        user_id = current_user.id

        accuracy = 0 if total_items == 0 else round((correct_count / total_items) * 100, 1)

        # Create practice session linked to current user
        session = PracticeSession(
            user_id=user_id,
            title=title,
            total_items=total_items,
            correct_count=correct_count,
            wrong_count=wrong_count,
            accuracy=accuracy,
            words_data=json.dumps(words_data) if words_data else None
        )
        db.session.add(session)
        db.session.commit()

        return jsonify({
            'success': True,
            'session_id': session.id
        })
    except Exception as e:
        print(f"Record practice error: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': '記錄失敗'}), 500


@app.route('/api/practice/history')
def get_practice_history():
    """Get practice history for current user"""
    try:
        if not current_user.is_authenticated:
            return jsonify({'success': False, 'message': 'Not logged in'}), 401

        sessions = PracticeSession.query.filter_by(user_id=current_user.id)\
            .order_by(PracticeSession.created_at.desc())\
            .limit(50)\
            .all()

        # Don't load words_data here - only load when needed for session detail
        return jsonify({
            'success': True,
            'sessions': [{
                'id': s.id,
                'title': s.title,
                'total_items': s.total_items,
                'correct_count': s.correct_count,
                'wrong_count': s.wrong_count,
                'accuracy': s.accuracy,
                'created_at': s.created_at.isoformat()
            } for s in sessions]
        })
    except Exception as e:
        print(f"Get practice history error: {e}")
        return jsonify({'success': False, 'message': '獲取歷史失敗'}), 500


@app.route('/api/practice/session/<int:session_id>')
def get_practice_session(session_id):
    """Get a specific practice session for retry"""
    try:
        if not current_user.is_authenticated:
            return jsonify({'success': False, 'message': 'Not logged in'}), 401

        session = PracticeSession.query.filter_by(id=session_id, user_id=current_user.id).first()
        if not session:
            print(f"Session {session_id} not found for user {current_user.id}")
            return jsonify({'success': False, 'message': 'Session not found'}), 404

        # Check if words_data exists and is valid JSON
        words_data = []
        if session.words_data:
            try:
                words_data = json.loads(session.words_data)
                print(f"Session {session_id}: words_data loaded, {len(words_data)} items")
            except json.JSONDecodeError as e:
                print(f"Session {session_id}: Invalid words_data JSON: {e}")
                words_data = []
        else:
            print(f"Session {session_id}: No words_data found")

        return jsonify({
            'success': True,
            'session': {
                'id': session.id,
                'title': session.title,
                'total_items': session.total_items,
                'correct_count': session.correct_count,
                'wrong_count': session.wrong_count,
                'accuracy': session.accuracy,
                'words_data': words_data,
                'created_at': session.created_at.isoformat()
            }
        })
    except Exception as e:
        print(f"Get practice session error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': '獲取失敗'}), 500


@app.route('/api/practice/stats')
def get_practice_stats():
    """Get practice statistics for current user"""
    try:
        if not current_user.is_authenticated:
            return jsonify({'success': False, 'message': 'Not logged in'}), 401

        from datetime import datetime, timedelta

        sessions = PracticeSession.query.filter_by(user_id=current_user.id).all()

        total_sessions = len(sessions)
        total_correct = sum(s.correct_count for s in sessions)
        total_wrong = sum(s.wrong_count for s in sessions)
        total_items = total_correct + total_wrong
        avg_accuracy = round((total_correct / total_items * 100), 1) if total_items > 0 else 0

        # Today's stats
        today = db.func.date(PracticeSession.created_at) == db.func.current_date()
        today_sessions = PracticeSession.query.filter_by(user_id=current_user.id).filter(today).all()
        today_correct = sum(s.correct_count for s in today_sessions)
        today_wrong = sum(s.wrong_count for s in today_sessions)
        today_total = today_correct + today_wrong
        today_accuracy = round((today_correct / today_total * 100), 1) if today_total > 0 else 0

        # Calculate streak
        streak = calculate_streak(sessions)

        # Recent history (last 30 days)
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        recent_sessions = PracticeSession.query\
            .filter_by(user_id=current_user.id)\
            .filter(PracticeSession.created_at >= thirty_days_ago)\
            .order_by(PracticeSession.created_at.desc())\
            .all()

        # Build history for last 30 days (without words_data to improve performance)
        history = []
        for s in recent_sessions[:10]:
            history.append({
                'id': s.id,
                'title': s.title,
                'total_items': s.total_items,
                'correct_count': s.correct_count,
                'wrong_count': s.wrong_count,
                'accuracy': s.accuracy,
                'created_at': s.created_at.isoformat()
            })

        return jsonify({
            'success': True,
            'stats': {
                'total_sessions': total_sessions,
                'total_correct': total_correct,
                'total_wrong': total_wrong,
                'avg_accuracy': avg_accuracy,
                'today_correct': today_correct,
                'today_wrong': today_wrong,
                'today_accuracy': today_accuracy,
                'streak': streak,
                'history': history
            }
        })
    except Exception as e:
        print(f"Get practice stats error: {e}")
        return jsonify({'success': False, 'message': '獲取統計失敗'}), 500


def calculate_streak(sessions):
    """Calculate consecutive practice days streak"""
    if not sessions:
        return 0

    from datetime import datetime, timedelta

    # Group sessions by date (using date only, not time)
    practice_dates = set()
    for session in sessions:
        # Get the date in local timezone
        date_val = session.created_at.date() if hasattr(session.created_at, 'date') else session.created_at
        practice_dates.add(date_val)

    if not practice_dates:
        return 0

    # Sort dates in descending order (most recent first)
    sorted_dates = sorted(practice_dates, reverse=True)
    today = datetime.now().date()

    # Check if practiced today or yesterday (streak is still valid)
    most_recent = sorted_dates[0]
    if most_recent < today - timedelta(days=1):
        return 0  # Streak broken

    # Count consecutive days
    streak = 0
    current_date = most_recent

    # If practiced today, count it
    if current_date == today:
        streak += 1
        current_date = today - timedelta(days=1)
    elif current_date == today - timedelta(days=1):
        # Practiced yesterday but not today, streak is still valid
        streak += 1
        current_date = today - timedelta(days=2)
    else:
        return 0

    # Count backwards
    while current_date in sorted_dates:
        streak += 1
        current_date -= timedelta(days=1)

    return streak


# ==================== WRONG WORDS BOOK ====================
@app.route('/api/wrong-words', methods=['GET'])
def get_wrong_words():
    """Get all wrong words for current user, grouped by date"""
    try:
        if not current_user.is_authenticated:
            return jsonify({'success': False, 'message': '請先登錄'}), 401

        # Get search query
        search_query = request.args.get('q', '').strip().lower()

        # Base query
        query = WrongWord.query.filter_by(user_id=current_user.id)

        # Apply search if provided
        if search_query:
            # Search in text, meaning, or by date
            if '/' in search_query or '-' in search_query:
                # Try to search by date
                try:
                    from datetime import datetime
                    search_date = datetime.strptime(search_query, '%Y/%m/%d').date() if '/' in search_query else datetime.strptime(search_query, '%Y-%m-%d').date()
                    query = query.filter(db.func.date(WrongWord.created_at) == search_date)
                except ValueError:
                    # Not a valid date format, search by text instead
                    query = query.filter(
                        db.or_(
                            WrongWord.text.ilike(f'%{search_query}%'),
                            WrongWord.meaning.ilike(f'%{search_query}%')
                        )
                    )
            else:
                # Search by text or meaning
                query = query.filter(
                    db.or_(
                        WrongWord.text.ilike(f'%{search_query}%'),
                        WrongWord.meaning.ilike(f'%{search_query}%')
                    )
                )

        # Order by created_at descending
        wrong_words = query.order_by(WrongWord.created_at.desc()).all()

        # Group by date
        from datetime import date
        grouped = {}
        for ww in wrong_words:
            created_date = ww.created_at.date() if hasattr(ww.created_at, 'date') else ww.created_at
            date_key = created_date.strftime('%Y/%m/%d')
            if date_key not in grouped:
                grouped[date_key] = []
            grouped[date_key].append({
                'id': ww.id,
                'text': ww.text,
                'type': ww.type,
                'phonetic': ww.phonetic,
                'meaning': ww.meaning,
                'example': ww.example,
                'audio_url': f'/api/audio/{ww.audio_id}' if ww.audio_id else None,
                'notes': ww.notes,
                'created_at': ww.created_at.isoformat()
            })

        return jsonify({
            'success': True,
            'wrong_words': grouped,
            'total_count': len(wrong_words)
        })
    except Exception as e:
        print(f"Get wrong words error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': '獲取生詞本失敗'}), 500


@app.route('/api/wrong-words', methods=['POST'])
def add_wrong_word():
    """Add a new word to wrong words book"""
    try:
        if not current_user.is_authenticated:
            return jsonify({'success': False, 'message': '請先登錄'}), 401

        data = request.json
        text = data.get('text', '').strip()
        word_type = data.get('type', 'word')
        phonetic = data.get('phonetic', '')
        meaning = data.get('meaning', '')
        example = data.get('example', '')
        audio_id = data.get('audio_id')
        source_session_id = data.get('source_session_id')
        notes = data.get('notes', '')

        if not text:
            return jsonify({'success': False, 'message': '詞語不能為空'}), 400

        # Check for duplicate
        existing = WrongWord.query.filter_by(
            user_id=current_user.id,
            text=text,
            type=word_type
        ).first()

        if existing:
            return jsonify({'success': False, 'message': '此詞語已在生詞本中'}), 400

        # Create new wrong word
        wrong_word = WrongWord(
            user_id=current_user.id,
            text=text,
            type=word_type,
            phonetic=phonetic,
            meaning=meaning,
            example=example,
            audio_id=audio_id,
            source_session_id=source_session_id,
            notes=notes
        )

        db.session.add(wrong_word)
        db.session.commit()

        return jsonify({
            'success': True,
            'id': wrong_word.id,
            'message': '已添加到生詞本'
        })
    except Exception as e:
        print(f"Add wrong word error: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': '添加失敗'}), 500


@app.route('/api/wrong-words/<int:word_id>', methods=['DELETE'])
def delete_wrong_word(word_id):
    """Delete a word from wrong words book"""
    try:
        if not current_user.is_authenticated:
            return jsonify({'success': False, 'message': '請先登錄'}), 401

        wrong_word = WrongWord.query.filter_by(id=word_id, user_id=current_user.id).first()
        if not wrong_word:
            return jsonify({'success': False, 'message': '找不到此詞語'}), 404

        db.session.delete(wrong_word)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': '已從生詞本移除'
        })
    except Exception as e:
        print(f"Delete wrong word error: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': '刪除失敗'}), 500


@app.route('/api/wrong-words/<int:word_id>', methods=['PUT'])
def update_wrong_word(word_id):
    """Update a word's notes in wrong words book"""
    try:
        if not current_user.is_authenticated:
            return jsonify({'success': False, 'message': '請先登錄'}), 401

        data = request.json
        wrong_word = WrongWord.query.filter_by(id=word_id, user_id=current_user.id).first()
        if not wrong_word:
            return jsonify({'success': False, 'message': '找不到此詞語'}), 404

        if 'notes' in data:
            wrong_word.notes = data['notes']

        db.session.commit()

        return jsonify({
            'success': True,
            'message': '更新成功'
        })
    except Exception as e:
        print(f"Update wrong word error: {e}")
        db.session.rollback()
        return jsonify({'success': False, 'message': '更新失敗'}), 500


# ==================== MAIN ====================
if __name__ == '__main__':
    # Create database tables
    create_database()

    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'

    app.run(host='0.0.0.0', port=port, debug=debug)
