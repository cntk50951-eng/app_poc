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
從以下英文文字中提取最重要的20個有意義的單詞（按重要性排序），返回 JSON 格式：

要求：
- 只提取真正的英文單詞（2-15個字母），排除數字、符號、代碼片段等
- 排除 like "history[1].action", "data[0].name" 等程式碼或數據結構
- 排除單獨的數字、日期、網址
- 只返回常見的英文詞彙

[
    {{"word": "單詞1", "phonetic": "/IPA音標/", "meaning": "中文意思"}},
    {{"word": "單詞2", "phonetic": "/IPA音標/", "meaning": "中文意思"}}
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
    {{"sentence": "完整句子1"}},
    {{"sentence": "完整句子2"}}
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
        {{"word": "單詞1", "phonetic": "/IPA音標/", "meaning": "中文意思"}},
        {{"word": "單詞2", "phonetic": "/IPA音標/", "meaning": "中文意思"}}
        ... 最多20個
    ],
    "sentences": [
        {{"sentence": "完整句子1"}},
        {{"sentence": "完整句子2"}}
        ... 最多20個
    ]
}}

只返回 JSON，不要其他文字。

文字內容：
{text}
        """.strip()


def fallback_extraction(text, mode):
    """Simple fallback extraction when API fails"""
    import re

    # Filter patterns to exclude code-like content
    exclude_patterns = [
        r'^[a-zA-Z]+\[\d+\]',  # like "history[1]"
        r'^[a-zA-Z]+\.[a-zA-Z]+',  # like "data.action"
        r'^[a-zA-Z]+\.\w+\(\)',  # like "console.log()"
        r'^[\d\.\-\/]+$',  # just numbers/dates
        r'^https?://',  # URLs
        r'^[a-zA-Z]+:\/\/',  # URLs
    ]

    def is_valid_word(w):
        # Check if it's a common word (not code-like)
        if len(w) < 2 or len(w) > 15:
            return False
        # Must contain at least one vowel
        if not re.search(r'[aeiouAEIOU]', w):
            return False
        # Skip if matches exclusion patterns
        for pattern in exclude_patterns:
            if re.match(pattern, w):
                return False
        return True

    # Extract words (2-15 letters with vowels)
    words = re.findall(r'\b([A-Za-z]{2,15})\b', text)
    words = [w for w in words if is_valid_word(w)]
    unique_words = list(dict.fromkeys(words))[:20]

    # Extract sentences (at least 5 words, 10+ chars)
    sentences = re.split(r'[.!?]+', text)
    sentences = [s.strip() for s in sentences if len(s.strip().split()) >= 5 and len(s.strip()) >= 10][:20]
    # Filter out code-like sentences
    sentences = [s for s in sentences if not re.match(r'^[\w\.\[\]]+$', s)]

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

        # Build history for last 30 days
        history = []
        for s in recent_sessions[:10]:
            history.append({
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


# ==================== MAIN ====================
if __name__ == '__main__':
    # Create database tables
    create_database()

    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'

    app.run(host='0.0.0.0', port=port, debug=debug)
