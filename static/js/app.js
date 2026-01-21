/**
 * Dictation App - Main JavaScript
 * UI improvements: loading animation, item selection, phonetic symbols, TTS optimization
 */

class DictationApp {
    constructor() {
        this.currentPage = 'page-home';
        this.recognizedText = '';
        this.words = [];
        this.sentences = [];
        this.allWords = []; // All words with phonetics from DeepSeek
        this.allSentences = []; // All sentences from DeepSeek
        this.contentType = 'words'; // 'words' or 'sentences'
        this.dictationMode = 'words';
        this.currentIndex = 0;
        this.items = [];
        this.results = [];
        this.isPlaying = false;
        this.autoPlay = false;
        this.dictationAutoPlay = false; // Auto-play on dictation page
        this.slowMode = false;
        this.slowModeSpeed = 0.5;
        this.audioPlayer = document.getElementById('audio-player');

        // Selection state - limits based on login status
        this.selectedWordIndices = new Set();
        this.selectedSentenceIndices = new Set();
        this.maxWordSelection = 2;  // Guest: 2, Logged in: 20
        this.maxSentenceSelection = 2;  // Guest: 2, Logged in: 20

        // TTS cache - track which items have already been generated
        this.ttsCache = new Map(); // key: text, value: audio_url

        // Settings
        this.darkMode = false;
        this.speechRate = 0;
        this.voiceId = 'en-US-natalie';

        // Wrong words and statistics
        this.wrongWords = [];
        this.statistics = this.loadStatistics();

        // Recording
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordedAudio = null;
        this.isRecording = false;

        // Auth state
        this.isLoggedIn = false;

        this.init();
    }

    init() {
        this.loadSettings();
        this.checkAuthStatus();
        this.bindEvents();
        this.applyDarkMode();
        this.updateStatsDisplay();
        this.updateWrongWordsDisplay();
        this.loadStreak();

        // Check if redirected from Google OAuth
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('logged_in') === 'true') {
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
            // Fetch user data from server
            this.fetchCurrentUser();
        }
    }

    // ==================== AUTH STATUS ====================
    async fetchCurrentUser() {
        try {
            const response = await fetch('/auth/current-user');
            const data = await response.json();
            if (data.success && data.user) {
                this.isLoggedIn = true;
                this.maxWordSelection = 20;
                this.maxSentenceSelection = 20;
                this.updateUserDisplay(data.user);
                this.loadRecentActivity();
            }
        } catch (error) {
            console.error('Error fetching current user:', error);
        }
    }

    checkAuthStatus() {
        const currentUser = localStorage.getItem('currentUser');
        if (currentUser) {
            try {
                const user = JSON.parse(currentUser);
                this.isLoggedIn = true;
                this.maxWordSelection = 20;
                this.maxSentenceSelection = 20;
                this.updateUserDisplay(user);
            } catch (e) {
                console.error('Error parsing user data:', e);
            }
        }
    }

    async loadStreak() {
        if (!this.isLoggedIn) {
            // Show disabled state for guests
            const streakCountEl = document.getElementById('streak-count');
            if (streakCountEl) {
                streakCountEl.textContent = '0 天';
            }
            return;
        }

        try {
            const response = await fetch('/api/practice/stats');
            const data = await response.json();
            if (data.success && data.stats) {
                const streakCountEl = document.getElementById('streak-count');
                if (streakCountEl) {
                    const streak = data.stats.streak || 0;
                    streakCountEl.textContent = `${streak} 天`;
                }
            }
        } catch (error) {
            console.error('Error loading streak:', error);
        }
    }

    // ==================== SETTINGS ====================
    loadSettings() {
        const settings = JSON.parse(localStorage.getItem('dictationSettings') || '{}');
        this.darkMode = settings.darkMode || false;
        this.speechRate = settings.speechRate || 0;
        this.voiceId = settings.voiceId || 'en-US-natalie';
        this.autoPlay = settings.autoPlay || false;

        const speedSlider = document.getElementById('speed-slider');
        const voiceSelect = document.getElementById('voice-select');
        if (speedSlider) speedSlider.value = this.speechRate;
        if (voiceSelect) voiceSelect.value = this.voiceId;
        this.updateSpeedDisplay();
        this.updateAutoPlayToggle();
    }

    saveSettings() {
        const settings = {
            darkMode: this.darkMode,
            speechRate: this.speechRate,
            voiceId: this.voiceId,
            autoPlay: this.autoPlay
        };
        localStorage.setItem('dictationSettings', JSON.stringify(settings));
    }

    // ==================== PAGE NAVIGATION ====================
    showPage(pageId) {
        document.querySelectorAll('[id^="page-"]').forEach(page => {
            page.classList.add('hidden');
        });

        const targetPage = document.getElementById(pageId);
        if (targetPage) {
            targetPage.classList.remove('hidden');
            this.currentPage = pageId;
        }

        if (pageId === 'page-stats') {
            this.updateStatsDisplay();
        } else if (pageId === 'page-wrong-words') {
            this.updateWrongWordsDisplay();
        }
    }

    toggleSettings() {
        const settingsPage = document.getElementById('page-settings');
        if (settingsPage.classList.contains('hidden')) {
            settingsPage.classList.remove('hidden');
        } else {
            settingsPage.classList.add('hidden');
        }
    }

    // ==================== DARK MODE ====================
    toggleDarkMode() {
        this.darkMode = !this.darkMode;
        this.applyDarkMode();
        this.saveSettings();
    }

    applyDarkMode() {
        document.documentElement.classList.toggle('dark', this.darkMode);
        const toggle = document.getElementById('dark-mode-toggle');
        if (toggle) {
            const knob = toggle.querySelector('div');
            if (this.darkMode) {
                toggle.classList.add('bg-primary');
                toggle.classList.remove('bg-gray-300');
                knob.classList.add('translate-x-6');
            } else {
                toggle.classList.remove('bg-primary');
                toggle.classList.add('bg-gray-300');
                knob.classList.remove('translate-x-6');
            }
        }
    }

    // ==================== SPEED CONTROL ====================
    setSpeechRate(rate) {
        this.speechRate = parseInt(rate);
        document.getElementById('speed-slider').value = this.speechRate;
        this.updateSpeedDisplay();
        this.saveSettings();
    }

    updateSpeedDisplay() {
        const value = this.speechRate;
        const display = document.getElementById('speed-display');
        if (display) {
            if (value < -10) display.textContent = '很慢';
            else if (value < 0) display.textContent = '較慢';
            else if (value === 0) display.textContent = '正常';
            else if (value < 10) display.textContent = '較快';
            else display.textContent = '很快';
        }
    }

    // ==================== VOICE SELECTION ====================
    setVoiceId(voiceId) {
        this.voiceId = voiceId;
        this.saveSettings();
    }

    // ==================== AUTO PLAY ====================
    toggleAutoPlay() {
        this.autoPlay = !this.autoPlay;
        this.updateAutoPlayToggle();
        this.saveSettings();
    }

    updateAutoPlayToggle() {
        const toggle = document.getElementById('auto-play-toggle');
        if (toggle) {
            const knob = toggle.querySelector('div');
            if (this.autoPlay) {
                toggle.classList.add('bg-primary');
                toggle.classList.remove('bg-gray-300');
                knob.classList.add('translate-x-6');
            } else {
                toggle.classList.remove('bg-primary');
                toggle.classList.add('bg-gray-300');
                knob.classList.remove('translate-x-6');
            }
        }
    }

    // ==================== SLOW MODE ====================
    toggleSlowMode() {
        this.slowMode = !this.slowMode;
        const slowBtn = document.getElementById('slow-btn-card');
        const speedLabel = document.getElementById('speed-label');

        if (this.slowMode) {
            if (slowBtn) {
                slowBtn.classList.remove('text-gray-500', 'dark:text-gray-300');
                slowBtn.classList.add('text-primary', 'bg-primary/10');
            }
            if (speedLabel) speedLabel.textContent = '0.5x';
        } else {
            if (slowBtn) {
                slowBtn.classList.add('text-gray-500', 'dark:text-gray-300');
                slowBtn.classList.remove('text-primary', 'bg-primary/10');
            }
            if (speedLabel) speedLabel.textContent = '1x';
        }
    }

    // ==================== CAMERA & IMAGE ====================
    startCamera() {
        document.getElementById('image-input').click();
    }

    async handleImageFile(file) {
        if (!file) return;

        // Check file size and compress if needed (OCR.space limit is 1024KB)
        const MAX_SIZE = 1024 * 1024; // 1MB
        let imageData = null;

        if (file.size > MAX_SIZE) {
            this.showLoading('正在壓縮圖片...');
            try {
                imageData = await this.compressImage(file, 800);
            } catch (error) {
                console.error('Compression error:', error);
                // Fall back to original file reading
                imageData = await this.fileToDataURL(file);
            }
        } else {
            imageData = await this.fileToDataURL(file);
        }

        this.imageData = imageData;

        const preview = document.getElementById('ocr-preview');
        if (preview) {
            preview.style.backgroundImage = `url('${this.imageData}')`;
        }

        this.showPage('page-verify');
        this.performOCR();
    }

    fileToDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
        });
    }

    // ==================== HISTORY / RECENT ACTIVITY ====================
    showHistoryPage() {
        if (!this.isLoggedIn) {
            this.toggleAuthModal();
            return;
        }
        this.showPage('page-history');
        this.loadHistory();
    }

    async loadHistory() {
        const container = document.getElementById('history-list');
        if (!container) return;

        // Show loading state
        container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center py-8">載入中...</p>';

        try {
            const response = await fetch('/api/practice/history');
            const data = await response.json();

            if (data.success && data.sessions && data.sessions.length > 0) {
                container.innerHTML = data.sessions.map(session => this.createHistoryCard(session)).join('');
            } else {
                container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center py-8">暫無練習記錄</p>';
            }
        } catch (error) {
            console.error('Load history error:', error);
            container.innerHTML = '<p class="text-red-500 dark:text-red-400 text-center py-8">載入失敗，請重試</p>';
        }
    }

    createHistoryCard(session) {
        const accuracy = session.accuracy || 0;
        const colorClass = accuracy >= 90 ? 'text-green-500' : accuracy >= 70 ? 'text-yellow-500' : 'text-red-500';
        const bgClass = accuracy >= 90 ? 'bg-green-100 dark:bg-green-900/30' : accuracy >= 70 ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-red-100 dark:bg-red-900/30';
        const label = accuracy >= 90 ? '優秀' : accuracy >= 70 ? '良好' : '需要加油';
        const date = new Date(session.created_at).toLocaleDateString('zh-HK');

        return `
            <div class="bg-white dark:bg-surface-dark p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 cursor-pointer hover:border-primary/50 transition-colors" onclick="dictationApp.showSessionDetail(${session.id})">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-3">
                        <div class="relative w-12 h-12 rounded-full flex items-center justify-center ${bgClass}">
                            <span class="text-sm font-bold ${colorClass}">${Math.round(accuracy)}%</span>
                        </div>
                        <div>
                            <h4 class="font-bold text-text-main dark:text-white text-base">${session.title}</h4>
                            <p class="text-xs text-text-sub dark:text-gray-400">${date}</p>
                        </div>
                    </div>
                    <span class="material-symbols-outlined text-gray-400">chevron_right</span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <div class="flex gap-4">
                        <span class="text-gray-500 dark:text-gray-400">${session.total_items} 題</span>
                        <span class="text-green-600 dark:text-green-400">${session.correct_count} 正確</span>
                        <span class="text-red-500 dark:text-red-400">${session.wrong_count} 錯誤</span>
                    </div>
                    <span class="px-2 py-0.5 rounded-full ${bgClass} ${colorClass} text-xs font-bold">${label}</span>
                </div>
            </div>
        `;
    }

    async showSessionDetail(sessionId) {
        console.log('showSessionDetail called with sessionId:', sessionId);
        this.currentSessionId = sessionId;
        this.showPage('page-session-detail');

        const container = document.getElementById('session-items-list');
        console.log('Container element:', container);
        if (!container) {
            console.error('session-items-list container not found!');
            return;
        }
        container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center py-8">載入中...</p>';

        try {
            console.log('Fetching session data from API...');
            const response = await fetch(`/api/practice/session/${sessionId}`);
            console.log('API response status:', response.status);
            const data = await response.json();
            console.log('API response data:', JSON.stringify(data, null, 2));

            if (data.success && data.session) {
                console.log('Session data loaded successfully');
                console.log('words_data length:', data.session.words_data?.length || 0);
                const session = data.session;
                const accuracy = session.accuracy || 0;

                // Update summary
                document.getElementById('session-title').textContent = session.title;
                document.getElementById('session-date').textContent = new Date(session.created_at).toLocaleString('zh-HK');
                document.getElementById('session-total').textContent = session.total_items;
                document.getElementById('session-correct').textContent = session.correct_count;
                document.getElementById('session-wrong').textContent = session.wrong_count;

                const badge = document.getElementById('session-accuracy-badge');
                if (accuracy >= 90) {
                    badge.className = 'px-3 py-1 rounded-full text-sm font-bold bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400';
                    badge.textContent = '優秀';
                } else if (accuracy >= 70) {
                    badge.className = 'px-3 py-1 rounded-full text-sm font-bold bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400';
                    badge.textContent = '良好';
                } else {
                    badge.className = 'px-3 py-1 rounded-full text-sm font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
                    badge.textContent = '需要加油';
                }

                // Store session data for retry
                this.currentSessionData = session;

                // Render items
                const wordsData = session.words_data || [];
                if (wordsData.length > 0) {
                    container.innerHTML = wordsData.map((item, index) => {
                        const isCorrect = item.isCorrect === true || item.isCorrect === 'true';
                        const text = item.text;
                        const userAnswer = item.userAnswer || '';

                        const itemClass = isCorrect
                            ? 'border-green-200 dark:border-green-800'
                            : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10';
                        const statusBadge = isCorrect
                            ? '<span class="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs font-bold">正確</span>'
                            : '<span class="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold">錯誤</span>';

                        // Get audio URL (from audio_id or audio_url)
                        let audioUrl = item.audio_url || null;
                        if (item.audio_id) {
                            audioUrl = `/api/audio/${item.audio_id}`;
                        }

                        return `
                            <div class="p-4 rounded-xl border-2 ${itemClass}">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="font-semibold text-text-main dark:text-white">${text}</span>
                                    ${statusBadge}
                                </div>
                                ${!isCorrect ? `
                                    <div class="text-sm text-text-sub dark:text-gray-400">
                                        你的答案: <span class="text-red-500 dark:text-red-400 line-through">${userAnswer}</span>
                                    </div>
                                ` : ''}
                                ${audioUrl ? `
                                    <button onclick="dictationApp.playSessionAudio('${audioUrl.replace(/'/g, "\\'")}')" class="mt-2 flex items-center gap-1 text-sm text-primary hover:text-primary-dark">
                                        <span class="material-symbols-outlined" style="font-size: 18px;">volume_up</span>
                                        播放音頻
                                    </button>
                                ` : ''}
                            </div>
                        `;
                    }).join('');
                } else {
                    container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center py-8">暫無練習內容</p>';
                }
            } else {
                container.innerHTML = '<p class="text-red-500 dark:text-red-400 text-center py-8">載入失敗</p>';
            }
        } catch (error) {
            console.error('Load session detail error:', error);
            container.innerHTML = '<p class="text-red-500 dark:text-red-400 text-center py-8">載入失敗，請重試</p>';
        }
    }

    playSessionAudio(audioUrl) {
        this.audioPlayer.src = audioUrl;
        this.audioPlayer.play();
    }

    async retrySessionAll() {
        console.log('retrySessionAll called');
        console.log('currentSessionData:', this.currentSessionData);
        if (!this.currentSessionData) {
            console.warn('No currentSessionData, cannot retry');
            this.showToast('無法載入練習數據', 'error');
            return;
        }
        const wordsData = this.currentSessionData.words_data || [];
        console.log('wordsData:', wordsData);

        // Check if any items need audio regeneration
        const needsAudio = wordsData.filter(item => {
            if (item.audio_id) return false; // Has cached audio
            if (item.audio_url && item.audio_url.startsWith('/api/audio/')) return false; // Has cached audio URL
            return true; // Needs audio
        });

        // Build items, using cached audio URLs
        this.items = wordsData.map((item, index) => ({
            word: item.type === 'word' ? item.text : null,
            sentence: item.type === 'sentence' ? item.text : null,
            type: item.type || 'word',
            id: index,
            audio_url: item.audio_url || (item.audio_id ? `/api/audio/${item.audio_id}` : null),
            text: item.text  // Store text for regeneration
        }));

        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));

        // Regenerate audio for items that don't have valid cached audio
        if (needsAudio.length > 0) {
            this.showLoading('正在準備音頻...');
            await this.regenerateMissingAudio();
            this.hideLoading();
        }

        this.updateDictationUI();
        this.showPage('page-dictation');

        if (this.autoPlay) {
            setTimeout(() => this.playCurrentAudio(), 500);
        }
    }

    async retrySessionWrong() {
        console.log('retrySessionWrong called');
        if (!this.currentSessionData) {
            console.warn('No currentSessionData, cannot retry wrong items');
            this.showToast('無法載入練習數據', 'error');
            return;
        }
        const wordsData = this.currentSessionData.words_data || [];
        const wrongItems = wordsData.filter(item => item.isCorrect === false || item.isCorrect === 'false');
        console.log('wrongItems:', wrongItems);

        if (wrongItems.length === 0) {
            this.showToast('沒有錯題需要練習！', 'info');
            return;
        }

        // Check if any items need audio regeneration
        const needsAudio = wrongItems.filter(item => {
            if (item.audio_id) return false;
            if (item.audio_url && item.audio_url.startsWith('/api/audio/')) return false;
            return true;
        });

        this.items = wrongItems.map((item, index) => ({
            word: item.type === 'word' ? item.text : null,
            sentence: item.type === 'sentence' ? item.text : null,
            type: item.type || 'word',
            id: index,
            audio_url: item.audio_url || (item.audio_id ? `/api/audio/${item.audio_id}` : null),
            text: item.text
        }));

        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));

        // Regenerate audio for items that don't have valid cached audio
        if (needsAudio.length > 0) {
            this.showLoading('正在準備音頻...');
            await this.regenerateMissingAudio();
            this.hideLoading();
        }

        this.updateDictationUI();
        this.showPage('page-dictation');

        if (this.autoPlay) {
            setTimeout(() => this.playCurrentAudio(), 500);
        }
    }

    async regenerateMissingAudio() {
        const itemsNeedingAudio = this.items.filter(item => !item.audio_url);
        if (itemsNeedingAudio.length === 0) return;

        const voiceId = this.voiceId || 'en-US-natalie';
        const rate = this.speechRate !== undefined ? this.speechRate : 0;
        const pitch = -5; // Default pitch

        for (const item of itemsNeedingAudio) {
            try {
                const response = await fetch('/api/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: item.text,
                        voice_id: voiceId,
                        rate: rate,
                        pitch: pitch
                    })
                });

                const data = await response.json();
                if (data.success && data.audio_url) {
                    item.audio_url = data.audio_url;
                }
            } catch (error) {
                console.error('Failed to regenerate audio for:', item.text, error);
            }
        }
    }

    async loadRecentActivity() {
        if (!this.isLoggedIn) return;

        try {
            const response = await fetch('/api/practice/stats');
            const data = await response.json();

            if (data.success && data.stats && data.stats.history && data.stats.history.length > 0) {
                const container = document.getElementById('recent-activity-list');
                if (container) {
                    // Show only the most recent 3 activities
                    const recentSessions = data.stats.history.slice(0, 3);
                    container.innerHTML = recentSessions.map(session => this.createRecentActivityCard(session)).join('');
                }
            }
        } catch (error) {
            console.error('Load recent activity error:', error);
        }
    }

    createRecentActivityCard(session) {
        const accuracy = session.accuracy || 0;
        const date = new Date(session.created_at).toLocaleDateString('zh-HK');
        const timeLabel = this.getRelativeTimeLabel(session.created_at);

        return `
            <div class="bg-white dark:bg-surface-dark p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between cursor-pointer" onclick="dictationApp.showHistoryPage()">
                <div class="flex items-center gap-4">
                    <div class="relative w-14 h-14 rounded-full flex items-center justify-center bg-white dark:bg-surface-dark shadow-inner" style="background: conic-gradient(#22c3c3 ${accuracy}%, #edf2f7 0);">
                        <div class="absolute inset-1 bg-white dark:bg-surface-dark rounded-full flex items-center justify-center">
                            <span class="text-xs font-bold text-gray-800 dark:text-white">${Math.round(accuracy)}%</span>
                        </div>
                    </div>
                    <div>
                        <h4 class="font-bold text-text-main dark:text-white text-base">${session.title}</h4>
                        <p class="text-xs text-text-sub dark:text-gray-400 mt-0.5">${timeLabel} • ${session.total_items} 個詞語</p>
                    </div>
                </div>
                <span class="material-symbols-outlined text-gray-400">chevron_right</span>
            </div>
        `;
    }

    getRelativeTimeLabel(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return '今天';
        if (diffDays === 1) return '昨天';
        if (diffDays < 7) return `${diffDays} 天前`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} 週前`;
        return date.toLocaleDateString('zh-HK');
    }

    // ==================== LOADING OVERLAY ====================
    showLoading(message = '正在分析圖片...') {
        const overlay = document.getElementById('loading-overlay');
        const text = document.getElementById('loading-text');
        if (overlay) {
            if (text) text.textContent = message;
            overlay.classList.remove('hidden');
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    // ==================== ERROR BANNER ====================
    showErrorBanner(message) {
        const banner = document.getElementById('ocr-error-banner');
        const msgEl = document.getElementById('ocr-error-message');
        if (banner && msgEl) {
            msgEl.textContent = message;
            banner.classList.remove('hidden');
        }
    }

    hideErrorBanner() {
        const banner = document.getElementById('ocr-error-banner');
        if (banner) {
            banner.classList.add('hidden');
        }
    }

    // ==================== IMAGE PREVIEW ====================
    showImagePreview() {
        if (!this.imageData) return;
        const modal = document.getElementById('image-preview-modal');
        const img = document.getElementById('preview-image');
        if (modal && img) {
            img.src = this.imageData;
            modal.classList.remove('hidden');
        }
    }

    hideImagePreview() {
        const modal = document.getElementById('image-preview-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    // ==================== OCR ====================
    async performOCR() {
        if (!this.imageData) return;

        this.hideErrorBanner();
        this.showLoading('正在識別文字內容...');

        try {
            const response = await fetch('/api/ocr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: this.imageData })
            });

            const data = await response.json();

            if (data.success) {
                this.recognizedText = data.text;
                this.allWords = data.extracted.words || [];
                this.allSentences = data.extracted.sentences || [];

                // Update counts
                document.getElementById('words-count-badge').textContent = this.allWords.length;
                document.getElementById('sentences-count-badge').textContent = this.allSentences.length;

                this.renderContentList();
            } else {
                this.hideLoading();
                this.showErrorBanner(data.error || 'OCR 識別失敗，請重試');
            }
        } catch (error) {
            this.hideLoading();
            console.error('OCR Error:', error);
            this.showErrorBanner('OCR 識別失敗：' + error.message);
        }
    }

    // ==================== TOAST NOTIFICATION ====================
    showToast(message, type = 'success') {
        // Remove existing toast if any
        const existingToast = document.getElementById('toast-notification');
        if (existingToast) {
            existingToast.remove();
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = `fixed bottom-24 left-1/2 transform -translate-x-1/2 z-[200] px-6 py-3 rounded-full shadow-lg flex items-center gap-2 animate-fade-in ${
            type === 'success' ? 'bg-green-500 text-white' :
            type === 'error' ? 'bg-red-500 text-white' :
            'bg-primary text-white'
        }`;

        const icon = type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info';
        toast.innerHTML = `
            <span class="material-symbols-outlined">${icon}</span>
            <span class="font-semibold text-sm">${message}</span>
        `;

        document.body.appendChild(toast);

        // Auto remove after 2.5 seconds
        setTimeout(() => {
            toast.classList.add('opacity-0', 'transition-opacity');
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // ==================== IMAGE COMPRESSION ====================
    compressImage(file, maxSizeKB = 500, quality = 0.8) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Calculate max dimension based on max size
                    const maxDimension = Math.sqrt(maxSizeKB * 1024 * 2); // Approximation
                    if (width > maxDimension || height > maxDimension) {
                        if (width > height) {
                            height = Math.round(height * maxDimension / width);
                            width = maxDimension;
                        } else {
                            width = Math.round(width * maxDimension / height);
                            height = maxDimension;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (blob.size > file.size * quality) {
                            // If compressed is not smaller, try more aggressive compression
                            canvas.toBlob((blob2) => {
                                resolve(blob2 ? this.blobToDataURL(blob2) : event.target.result);
                            }, 'image/jpeg', 0.5);
                        } else {
                            resolve(blob ? this.blobToDataURL(blob) : event.target.result);
                        }
                    }, 'image/jpeg', quality);
                };
                img.onerror = () => reject(new Error('Failed to load image'));
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
        });
    }

    blobToDataURL(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onload = () => resolve(reader.result);
        });
    }
    switchContentType(type) {
        this.contentType = type;
        this.renderContentList();
    }

    renderContentList() {
        const container = document.getElementById('content-list');
        const items = this.contentType === 'words' ? this.allWords : this.allSentences;

        if (!container) return;

        if (items.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">暫無內容，請上傳圖片</p>';
            this.hideLoading();
            return;
        }

        // Display up to 20 items regardless of login status
        const displayItems = items.slice(0, 20);
        const playButtonDisabled = !this.isLoggedIn ? 'opacity-50 cursor-not-allowed' : 'hover:text-primary';
        const playButtonOnClick = !this.isLoggedIn ? '' : `onclick="dictationApp.handlePlayClick(this, '${this.contentType}', ${'$&'})"`;

        container.innerHTML = displayItems.map((item, index) => {
            const text = item.word || item.sentence;
            const phonetic = item.phonetic || '';
            const num = index + 1;

            // For guest users, disable the play button
            const playBtnClass = !this.isLoggedIn
                ? 'play-audio-btn p-2 text-gray-300 cursor-not-allowed'
                : 'play-audio-btn p-2 text-gray-400 hover:text-primary transition-colors rounded-full hover:bg-gray-50 dark:hover:bg-gray-700';
            const playBtnOnClick = !this.isLoggedIn ? '' : `onclick="dictationApp.handlePlayClick(this, '${this.contentType}', ${index})"`;

            return `
                <div class="group flex items-center gap-3 bg-white dark:bg-surface-dark p-3 pr-2 rounded-xl shadow-soft border border-transparent hover:border-primary/30 transition-all">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-base">
                        ${num}
                    </div>
                    <div class="flex-1 min-w-0">
                        <input class="w-full bg-transparent border-none p-0 text-base font-semibold text-text-main dark:text-white placeholder-gray-400 focus:ring-0" type="text" value="${text}" onchange="dictationApp.updateItem('${this.contentType}', ${index}, this.value)">
                        ${phonetic ? `<div class="text-xs text-gray-400 font-mono">${phonetic}</div>` : ''}
                    </div>
                    <div class="flex items-center gap-1">
                        <button class="${playBtnClass}" ${playBtnOnClick}>
                            <span class="material-symbols-outlined text-[20px]">volume_up</span>
                        </button>
                        <button class="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-full hover:bg-gray-50 dark:hover:bg-gray-700" onclick="dictationApp.deleteItem('${this.contentType}', ${index})">
                            <span class="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Add info text if there are more than 20 items
        if (items.length > 20) {
            container.innerHTML += `
                <div class="mt-2 text-xs text-gray-400 text-center">還有 ${items.length - 20} 項未顯示，請選擇最多 20 項</div>
            `;
        }

        // Add "Go to Selection" button
        container.innerHTML += `
            <button onclick="dictationApp.goToSelection()" class="mt-4 w-full flex items-center justify-center gap-2 py-3 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl transition-colors font-semibold">
                <span class="material-symbols-outlined">checklist</span>
                選擇聽寫內容
            </button>
        `;

        this.hideLoading();
    }

    handlePlayClick(buttonElement, type, index) {
        this.playItemAudio(type, index, buttonElement);
    }

    goToSelection() {
        // Update limit displays based on login status
        const wordLimitEl = document.getElementById('word-limit-display');
        const sentenceLimitEl = document.getElementById('sentence-limit-display');
        if (wordLimitEl) wordLimitEl.textContent = this.maxWordSelection;
        if (sentenceLimitEl) sentenceLimitEl.textContent = this.maxSentenceSelection;

        this.showPage('page-selection');
        this.renderSelectionList();
    }

    renderSelectionList() {
        const wordsList = document.getElementById('words-selection-list');
        const sentencesList = document.getElementById('sentences-selection-list');

        // Play button disabled for guest users
        const playBtnClass = !this.isLoggedIn
            ? 'play-audio-btn p-2 text-gray-300 cursor-not-allowed'
            : 'play-audio-btn p-2 text-gray-400 hover:text-primary transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700';
        const playBtnOnClick = !this.isLoggedIn ? '' : 'onclick="dictationApp.handlePlayClick(this, \'%type%\', %index%)"';

        // Display up to 20 items regardless of login status
        const displayWords = this.allWords.slice(0, 20);
        const displaySentences = this.allSentences.slice(0, 20);

        // Render words with play buttons
        if (wordsList) {
            wordsList.innerHTML = displayWords.map((item, index) => {
                const isSelected = this.selectedWordIndices.has(index);
                return `
                    <div class="flex items-center gap-2 p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-surface-dark'}">
                        <button onclick="event.stopPropagation(); dictationApp.toggleWordSelection(${index})" class="flex-1 flex items-center gap-3 cursor-pointer">
                            <span class="material-symbols-outlined ${isSelected ? 'text-primary' : 'text-gray-300'}">${isSelected ? 'check_circle' : 'radio_button_unchecked'}</span>
                            <div class="flex-1 text-left">
                                <div class="font-semibold text-text-main dark:text-white">${item.word}</div>
                                ${item.phonetic ? `<div class="text-xs text-gray-400 font-mono">${item.phonetic}</div>` : ''}
                            </div>
                        </button>
                        <button class="${playBtnClass}" ${!this.isLoggedIn ? '' : `onclick="dictationApp.handlePlayClick(this, 'words', ${index})"`}>
                            <span class="material-symbols-outlined text-[20px]">volume_up</span>
                        </button>
                    </div>
                `;
            }).join('');
        }

        // Render sentences with play buttons
        if (sentencesList) {
            sentencesList.innerHTML = displaySentences.map((item, index) => {
                const isSelected = this.selectedSentenceIndices.has(index);
                return `
                    <div class="flex items-center gap-2 p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-primary bg-primary/10' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-surface-dark'}">
                        <button onclick="event.stopPropagation(); dictationApp.toggleSentenceSelection(${index})" class="flex-1 flex items-center gap-3 cursor-pointer">
                            <span class="material-symbols-outlined ${isSelected ? 'text-primary' : 'text-gray-300'}">${isSelected ? 'check_circle' : 'radio_button_unchecked'}</span>
                            <div class="flex-1 text-left">
                                <div class="font-semibold text-text-main dark:text-white">${item.sentence}</div>
                            </div>
                        </button>
                        <button class="${playBtnClass}" ${!this.isLoggedIn ? '' : `onclick="dictationApp.handlePlayClick(this, 'sentences', ${index})"`}>
                            <span class="material-symbols-outlined text-[20px]">volume_up</span>
                        </button>
                    </div>
                `;
            }).join('');
        }

        this.updateSelectionCounts();
    }

    toggleWordSelection(index) {
        if (this.selectedWordIndices.has(index)) {
            this.selectedWordIndices.delete(index);
        } else {
            // For guest users, limit to 2 words max
            if (!this.isLoggedIn && this.selectedWordIndices.size >= 2) {
                this.showToast('未登錄用戶最多可選擇 2 個單詞', 'error');
                return;
            }
            this.selectedWordIndices.add(index);
        }
        this.renderSelectionList();
    }

    toggleSentenceSelection(index) {
        if (this.selectedSentenceIndices.has(index)) {
            this.selectedSentenceIndices.delete(index);
        } else {
            // For guest users, limit to 2 sentences max
            if (!this.isLoggedIn && this.selectedSentenceIndices.size >= 2) {
                this.showToast('未登錄用戶最多可選擇 2 個句子', 'error');
                return;
            }
            this.selectedSentenceIndices.add(index);
        }
        this.renderSelectionList();
    }

    updateSelectionCounts() {
        const wordsCount = document.getElementById('selected-words-count');
        const sentencesCount = document.getElementById('selected-sentences-count');
        const totalSelected = document.getElementById('total-selected');
        const startBtn = document.getElementById('start-selected-btn');

        if (wordsCount) wordsCount.textContent = `(${this.selectedWordIndices.size}/${this.maxWordSelection})`;
        if (sentencesCount) sentencesCount.textContent = `(${this.selectedSentenceIndices.size}/${this.maxSentenceSelection})`;

        const total = this.selectedWordIndices.size + this.selectedSentenceIndices.size;
        if (totalSelected) totalSelected.textContent = total;

        if (startBtn) {
            if (total > 0) {
                startBtn.disabled = false;
                startBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            } else {
                startBtn.disabled = true;
                startBtn.classList.add('opacity-50', 'cursor-not-allowed');
            }
        }
    }

    // ==================== GENERATE AND START (From Verify Page) ====================
    async generateAndStart() {
        const allItems = [];

        // For guest users, limit to 2 words + 2 sentences
        const wordLimit = this.isLoggedIn ? 20 : 2;
        const sentenceLimit = this.isLoggedIn ? 20 : 2;

        // Get words (limited)
        this.allWords.slice(0, wordLimit).forEach((word, index) => {
            allItems.push({
                word: word.word,
                phonetic: word.phonetic || '',
                meaning: word.meaning || '',
                type: 'word',
                id: `word_${index}`,
                audio_url: this.ttsCache.get(word.word) || null
            });
        });

        // Get sentences (limited)
        this.allSentences.slice(0, sentenceLimit).forEach((sentence, index) => {
            allItems.push({
                sentence: sentence.sentence,
                meaning: sentence.meaning || '',
                type: 'sentence',
                id: `sentence_${index}`,
                audio_url: this.ttsCache.get(sentence.sentence) || null
            });
        });

        if (allItems.length === 0) {
            this.showToast('暫無內容，請先上傳圖片', 'error');
            return;
        }

        this.items = allItems;
        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));

        // Generate audio for items not yet cached
        const itemsNeedingTTS = this.items.filter(item => !item.audio_url);
        if (itemsNeedingTTS.length > 0) {
            this.showLoading(`正在生成 ${itemsNeedingTTS.length} 個音頻...`);
            await this.generateMissingAudio();
            this.hideLoading();
        }

        this.updateDictationUI();
        this.showPage('page-dictation');

        // Auto-play first audio if enabled
        if (this.autoPlay) {
            setTimeout(() => this.playCurrentAudio(), 500);
        }
    }

    // ==================== GENERATE AND START FROM SELECTION ====================
    async startDictationFromSelection() {
        const selectedItems = [];

        // Get selected words
        this.selectedWordIndices.forEach(index => {
            const word = this.allWords[index];
            selectedItems.push({
                word: word.word,
                phonetic: word.phonetic || '',
                meaning: word.meaning || '',
                type: 'word',
                id: `word_${index}`,
                audio_url: this.ttsCache.get(word.word) || null
            });
        });

        // Get selected sentences
        this.selectedSentenceIndices.forEach(index => {
            const sentence = this.allSentences[index];
            selectedItems.push({
                sentence: sentence.sentence,
                meaning: sentence.meaning || '',
                type: 'sentence',
                id: `sentence_${index}`,
                audio_url: this.ttsCache.get(sentence.sentence) || null
            });
        });

        if (selectedItems.length === 0) {
            this.showToast('請至少選擇一項！', 'error');
            return;
        }

        this.items = selectedItems;
        this.currentIndex = 0;
        this.dictationMode = selectedItems[0].type;

        // Generate audio only for items not yet cached
        const itemsNeedingTTS = selectedItems.filter(item => !item.audio_url);
        if (itemsNeedingTTS.length > 0) {
            this.showLoading(`正在生成 ${itemsNeedingTTS.length} 個音頻...`);
            await this.generateMissingAudio();
            this.hideLoading();
        }

        // Initialize results
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));

        this.updateDictationUI();
        this.updateDictationAutoPlayUI();
        this.showPage('page-dictation');

        // Auto-play first audio if enabled
        if (this.autoPlay) {
            setTimeout(() => this.playCurrentAudio(), 500);
        }
    }

    async generateMissingAudio() {
        const itemsNeedingTTS = this.items.filter(item => !item.audio_url);
        if (itemsNeedingTTS.length === 0) return;

        try {
            const response = await fetch('/api/tts/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: itemsNeedingTTS.map(item => ({
                        text: item.word || item.sentence,
                        type: item.type,
                        id: item.id
                    })),
                    voice_id: this.voiceId,
                    rate: this.speechRate,
                    pitch: -5
                })
            });

            const data = await response.json();

            if (data.success) {
                data.results.forEach(result => {
                    const item = this.items.find(i => i.id === result.id);
                    if (item && result.success) {
                        item.audio_url = result.audio_url;
                        // Cache the TTS result
                        const text = item.word || item.sentence;
                        this.ttsCache.set(text, result.audio_url);
                    }
                });
            }
        } catch (error) {
            console.error('TTS Error:', error);
        }
    }

    updateItem(type, index, value) {
        if (type === 'words') {
            this.allWords[index].word = value;
        } else {
            this.allSentences[index].sentence = value;
        }
    }

    deleteItem(type, index) {
        if (confirm('確定要刪除此項目嗎？')) {
            if (type === 'words') {
                this.allWords.splice(index, 1);
            } else {
                this.allSentences.splice(index, 1);
            }
            this.renderContentList();
        }
    }

    addNewItem() {
        const newItem = this.contentType === 'words'
            ? { word: '新詞語', phonetic: '', meaning: '', id: Date.now() }
            : { sentence: '新句子', meaning: '', id: Date.now() };

        if (this.contentType === 'words') {
            this.allWords.push(newItem);
        } else {
            this.allSentences.push(newItem);
        }

        this.renderContentList();

        setTimeout(() => {
            const list = document.getElementById('content-list');
            if (list) list.scrollTop = list.scrollHeight;
        }, 100);
    }

    // ==================== AUDIO PLAYBACK ====================
    async playItemAudio(type, index, buttonElement) {
        const items = type === 'words' ? this.allWords : this.allSentences;
        const item = items[index];
        const text = item.word || item.sentence;

        // Check if already cached - play immediately
        if (this.ttsCache.has(text)) {
            this.audioPlayer.src = this.ttsCache.get(text);
            this.audioPlayer.play().catch(e => console.log('Audio play error:', e));
            return;
        }

        // Show loading animation on button
        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.classList.add('loading');
            const icon = buttonElement.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.textContent = 'sync';
                icon.classList.add('animate-spin');
            }
        }

        // Generate new TTS
        try {
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    voice_id: this.voiceId,
                    rate: this.speechRate + (this.slowMode ? -30 : 0),
                    pitch: -5
                })
            });

            const data = await response.json();

            if (data.success && data.audio_url) {
                this.ttsCache.set(text, data.audio_url);
                this.audioPlayer.src = data.audio_url;
                // Play after setting src
                this.audioPlayer.play().catch(e => console.log('Audio play error:', e));
            } else {
                alert('音頻生成失敗，請重試');
            }
        } catch (error) {
            console.error('TTS Error:', error);
            alert('音頻生成失敗，請重試');
        } finally {
            // Restore button state
            if (buttonElement) {
                buttonElement.disabled = false;
                buttonElement.classList.remove('loading');
                const icon = buttonElement.querySelector('.material-symbols-outlined');
                if (icon) {
                    icon.textContent = 'volume_up';
                    icon.classList.remove('animate-spin');
                }
            }
        }
    }

    // ==================== ANSWER VISIBILITY TOGGLE ====================
    toggleAnswerVisibility(show) {
        const hiddenState = document.getElementById('answer-hidden-state');
        const visibleState = document.getElementById('answer-visible-state');

        if (show) {
            hiddenState.classList.add('hidden');
            visibleState.classList.remove('hidden');
        } else {
            hiddenState.classList.remove('hidden');
            visibleState.classList.add('hidden');
        }
    }

    // ==================== DICTATION SESSION ====================
    switchAudioMode(mode) {
        // Update mode and filter items
        this.dictationMode = mode;
        this.items = this.items.filter(item => item.type === mode);
        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));
        this.updateDictationUI();
    }

    // Navigation
    prevItem() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updateDictationUI();
        }
    }

    nextItem() {
        if (this.currentIndex < this.items.length - 1) {
            this.currentIndex++;
            this.updateDictationUI();
        }
    }

    // Auto-play toggle on dictation page
    toggleDictationAutoPlay() {
        this.dictationAutoPlay = !this.dictationAutoPlay;
        this.updateDictationAutoPlayUI();
    }

    updateDictationAutoPlayUI() {
        const btn = document.getElementById('dictation-autoplay-btn');
        if (btn) {
            if (this.dictationAutoPlay) {
                btn.classList.remove('bg-gray-100', 'dark:bg-gray-700');
                btn.classList.add('bg-primary');
                btn.querySelector('.material-symbols-outlined').classList.add('text-white');
                btn.querySelector('.text-xs').classList.add('text-white');
                btn.querySelector('.text-xs').classList.remove('text-gray-600', 'dark:text-gray-300');
            } else {
                btn.classList.add('bg-gray-100', 'dark:bg-gray-700');
                btn.classList.remove('bg-primary');
                btn.querySelector('.material-symbols-outlined').classList.remove('text-white');
                btn.querySelector('.text-xs').classList.remove('text-white');
                btn.querySelector('.text-xs').classList.add('text-gray-600', 'dark:text-gray-300');
            }
        }
    }

    updateDictationUI() {
        if (!this.items || this.items.length === 0) return;
        if (this.currentIndex < 0 || this.currentIndex >= this.items.length) this.currentIndex = 0;

        const item = this.items[this.currentIndex];
        if (!item) return;

        const total = this.items.length;
        const progress = Math.round(((this.currentIndex + 1) / total) * 100);

        document.getElementById('session-number').textContent = this.currentIndex + 1;
        document.getElementById('current-item-num').textContent = this.currentIndex + 1;
        document.getElementById('total-items-num').textContent = total;
        document.getElementById('progress-percent').textContent = progress + '%';
        document.getElementById('dictation-progress-bar').style.width = progress + '%';

        const text = item.word || item.sentence || '---';
        document.getElementById('reveal-answer').textContent = text;
        document.getElementById('reveal-pinyin').textContent = item.phonetic || item.meaning || '';

        // Reset answer visibility
        this.toggleAnswerVisibility(false);

        this.updatePlayButton(false);
    }

    playCurrentAudio() {
        const item = this.items[this.currentIndex];
        if (!item || !item.audio_url) {
            console.log('No audio URL for current item');
            return;
        }

        if (this.isPlaying) {
            this.audioPlayer.pause();
            this.isPlaying = false;
            this.updatePlayButton(false);
        } else {
            this.audioPlayer.src = item.audio_url;
            this.audioPlayer.playbackRate = this.slowMode ? this.slowModeSpeed : 1.0;
            this.audioPlayer.play();
            this.isPlaying = true;
            this.updatePlayButton(true);

            this.audioPlayer.onended = () => {
                this.isPlaying = false;
                this.updatePlayButton(false);

                // Auto-play next item if enabled
                if (this.dictationAutoPlay && this.currentIndex < this.items.length - 1) {
                    setTimeout(() => {
                        this.nextItem();
                        this.playCurrentAudio();
                    }, 1000);
                }
            };
        }
    }

    updatePlayButton(playing) {
        const icon = document.getElementById('play-icon');
        if (icon) {
            if (playing) {
                icon.textContent = 'pause';
                icon.classList.remove('ml-1');
            } else {
                icon.textContent = 'play_arrow';
                icon.classList.add('ml-1');
            }
        }
    }

    // ==================== RECORDING ====================
    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                this.recordedAudio = URL.createObjectURL(audioBlob);
            };

            this.mediaRecorder.start();
            this.isRecording = true;

            const btn = document.getElementById('record-btn-card');
            if (btn) {
                btn.classList.add('recording');
                btn.classList.add('bg-red-500', 'text-white');
                btn.classList.remove('text-primary');
            }

        } catch (error) {
            console.error('Recording error:', error);
            alert('無法訪問麥克風，請確保已授予權限');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;

            const btn = document.getElementById('record-btn-card');
            if (btn) {
                btn.classList.remove('recording');
                btn.classList.remove('bg-red-500', 'text-white');
                btn.classList.add('text-primary');
            }
        }
    }

    // ==================== MARK ANSWER ====================
    markAnswer(isCorrect) {
        const result = this.results[this.currentIndex];
        result.isCorrect = isCorrect;
        result.userAnswer = result.userAnswer || '未作答';

        if (!isCorrect) {
            this.addWrongWord(result.word || result.sentence, result.meaning || '', result.userAnswer);
        }

        const main = document.querySelector('#page-dictation main');
        if (main) {
            main.classList.add(isCorrect ? 'bg-green-100' : 'bg-red-100', 'dark:bg-green-900/20', 'dark:bg-red-900/20');
            setTimeout(() => {
                main.classList.remove('bg-green-100', 'bg-red-100', 'dark:bg-green-900/20', 'dark:bg-red-900/20');
            }, 500);
        }

        setTimeout(() => {
            if (this.currentIndex < this.items.length - 1) {
                this.currentIndex++;
                this.updateDictationUI();
                // Auto-play next if enabled
                if (this.autoPlay || this.dictationAutoPlay) {
                    setTimeout(() => this.playCurrentAudio(), 500);
                }
            } else {
                this.finishDictation();
            }
        }, 800);
    }

    // ==================== RESULTS ====================
    finishDictation() {
        const correct = this.results.filter(r => r.isCorrect === true).length;
        const incorrect = this.results.filter(r => r.isCorrect === false).length;
        const total = this.results.length;
        const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

        this.recordSession(correct, incorrect);

        // Record practice session to server (if logged in)
        if (this.isLoggedIn) {
            this.recordPracticeSession(correct, incorrect);
        }

        const headline = document.getElementById('result-headline');
        if (accuracy >= 90) {
            headline.textContent = '太棒了！🎉';
        } else if (accuracy >= 70) {
            headline.textContent = '做得不錯！💪';
        } else {
            headline.textContent = '繼續加油！📚';
        }

        const ringLight = document.getElementById('accuracy-ring-light');
        const ringDark = document.getElementById('accuracy-ring-dark');
        if (ringLight) ringLight.style.background = `conic-gradient(#22c3c3 ${accuracy}%, #f1f5f9 0)`;
        if (ringDark) ringDark.style.background = `conic-gradient(#22c3c3 ${accuracy}%, #374151 0)`;

        document.getElementById('accuracy-display').innerHTML = `${accuracy}<span class="text-2xl align-top text-gray-400 ml-1">%</span>`;

        document.getElementById('perfect-count').textContent = correct;
        document.getElementById('review-count').textContent = incorrect;
        document.getElementById('mistakes-count').textContent = `${incorrect} 題`;

        this.renderMistakesList();

        this.showPage('page-results');
    }

    renderMistakesList() {
        const container = document.getElementById('mistakes-list');
        const mistakes = this.results.filter(r => r.isCorrect === false);

        if (mistakes.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">全部正確！太厲害了！</p>';
            return;
        }

        container.innerHTML = mistakes.map(m => {
            const text = m.word || m.sentence;
            const userAnswer = m.userAnswer || '';

            return `
                <div class="group relative bg-white dark:bg-surface-dark rounded-xl p-4 shadow-soft border border-gray-100 dark:border-gray-800 overflow-hidden">
                    <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-soft-red rounded-l-xl"></div>
                    <div class="flex items-center justify-between pl-2">
                        <div class="flex flex-col">
                            <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">目標詞語</span>
                            <span class="text-xl font-bold text-gray-900 dark:text-white">${text}</span>
                        </div>
                        <div class="flex items-center gap-4">
                            <div class="text-right">
                                <span class="text-xs font-semibold text-red-400 dark:text-red-300 block mb-0.5">你寫的是</span>
                                <span class="text-lg font-medium text-red-500 dark:text-red-400 line-through decoration-2 decoration-red-500/40">${userAnswer}</span>
                            </div>
                            <button class="size-10 flex items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors" onclick="dictationApp.playMistakeAudio('${text}')">
                                <span class="material-symbols-outlined" style="font-size: 20px;">volume_up</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async playMistakeAudio(text) {
        // Check cache first
        if (this.ttsCache.has(text)) {
            this.audioPlayer.src = this.ttsCache.get(text);
            this.audioPlayer.play();
            return;
        }

        try {
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    voice_id: this.voiceId,
                    rate: this.speechRate,
                    pitch: -5
                })
            });

            const data = await response.json();
            if (data.success && data.audio_url) {
                this.ttsCache.set(text, data.audio_url);
                this.audioPlayer.src = data.audio_url;
                this.audioPlayer.play();
            }
        } catch (error) {
            console.error('TTS Error:', error);
        }
    }

    retryMistakes() {
        const mistakes = this.results.filter(r => r.isCorrect === false);
        if (mistakes.length === 0) {
            alert('沒有錯題需要複習！');
            return;
        }

        this.items = mistakes.map((m, i) => ({
            ...m,
            id: i,
            audio_url: this.ttsCache.get(m.word || m.sentence) || null
        }));

        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));

        // Generate audio for items not in cache
        const itemsNeedingTTS = this.items.filter(item => !item.audio_url);
        if (itemsNeedingTTS.length > 0) {
            this.showLoading('正在生成音頻...');
            this.generateMissingAudio().then(() => {
                this.hideLoading();
                this.updateDictationUI();
                this.showPage('page-dictation');
            });
        } else {
            this.updateDictationUI();
            this.showPage('page-dictation');
        }
    }

    saveAndExit() {
        this.showPage('page-home');
    }

    // ==================== STATISTICS ====================
    loadStatistics() {
        return JSON.parse(localStorage.getItem('dictationStatistics') || '{"sessions": 0, "correct": 0, "wrong": 0, "history": []}');
    }

    saveStatistics() {
        localStorage.setItem('dictationStatistics', JSON.stringify(this.statistics));
    }

    recordSession(correct, wrong) {
        const today = new Date().toDateString();
        this.statistics.sessions++;
        this.statistics.correct += correct;
        this.statistics.wrong += wrong;

        const todayEntry = this.statistics.history.find(h => h.date === today);
        if (todayEntry) {
            todayEntry.correct += correct;
            todayEntry.wrong += wrong;
        } else {
            this.statistics.history.push({ date: today, correct, wrong });
        }

        if (this.statistics.history.length > 30) {
            this.statistics.history = this.statistics.history.slice(-30);
        }

        this.saveStatistics();
        this.updateStatsDisplay();
    }

    updateStatsDisplay() {
        const stats = this.statistics;

        document.getElementById('total-sessions').textContent = stats.sessions;
        document.getElementById('stats-total-correct').textContent = stats.correct;
        document.getElementById('stats-total-wrong').textContent = stats.wrong;

        const avgAccuracy = stats.sessions > 0
            ? Math.round((stats.correct / (stats.correct + stats.wrong)) * 100)
            : 0;
        document.getElementById('stats-avg-accuracy').textContent = avgAccuracy + '%';

        const today = new Date().toDateString();
        const todayEntry = stats.history.find(h => h.date === today) || { correct: 0, wrong: 0 };
        document.getElementById('today-correct').textContent = todayEntry.correct;
        document.getElementById('today-wrong').textContent = todayEntry.wrong;

        const todayAccuracy = (todayEntry.correct + todayEntry.wrong) > 0
            ? Math.round((todayEntry.correct / (todayEntry.correct + todayEntry.wrong)) * 100)
            : 0;
        document.getElementById('today-accuracy').textContent = todayAccuracy + '%';
    }

    // ==================== WRONG WORDS ====================
    addWrongWord(word, meaning, userAnswer) {
        const exists = this.wrongWords.find(w => w.word.toLowerCase() === word.toLowerCase());
        if (!exists) {
            this.wrongWords.push({
                word: word,
                meaning: meaning || '',
                userAnswer: userAnswer || '',
                addedAt: new Date().toISOString(),
                reviewCount: 0
            });
            this.saveWrongWords();
            this.updateWrongWordsDisplay();
        }
    }

    saveWrongWords() {
        localStorage.setItem('wrongWords', JSON.stringify(this.wrongWords));
    }

    clearWrongWords() {
        if (confirm('確定要清除所有錯詞記錄嗎？')) {
            this.wrongWords = [];
            this.saveWrongWords();
            this.updateWrongWordsDisplay();
        }
    }

    updateWrongWordsDisplay() {
        const container = document.getElementById('wrong-words-list-page');
        const practiceBtn = document.getElementById('practice-wrong-btn');

        if (this.wrongWords.length === 0) {
            if (container) container.innerHTML = '<p class="text-gray-500 text-center py-8">暫無錯詞記錄</p>';
            if (practiceBtn) practiceBtn.disabled = true;
            return;
        }

        if (practiceBtn) practiceBtn.disabled = false;

        if (container) {
            container.innerHTML = this.wrongWords.map((item, index) => `
                <div class="bg-white dark:bg-surface-dark p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex justify-between items-center">
                    <div>
                        <div class="font-bold text-lg text-text-main dark:text-white">${item.word}</div>
                        ${item.meaning ? `<div class="text-xs text-gray-500">${item.meaning}</div>` : ''}
                        <div class="text-xs text-red-500">你寫的是: ${item.userAnswer}</div>
                        <div class="text-xs text-gray-400">複習次數: ${item.reviewCount}</div>
                    </div>
                    <button onclick="dictationApp.removeWrongWord(${index})" class="text-red-500 hover:text-red-700 p-2">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
            `).join('');
        }
    }

    removeWrongWord(index) {
        this.wrongWords.splice(index, 1);
        this.saveWrongWords();
        this.updateWrongWordsDisplay();
    }

    practiceWrongWords() {
        if (this.wrongWords.length === 0) return;

        this.items = this.wrongWords.map((w, i) => ({
            word: w.word,
            meaning: w.meaning,
            type: 'word',
            id: i,
            audio_url: this.ttsCache.get(w.word) || null
        }));

        this.wrongWords.forEach(w => w.reviewCount++);
        this.saveWrongWords();

        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));

        const itemsNeedingTTS = this.items.filter(item => !item.audio_url);
        if (itemsNeedingTTS.length > 0) {
            this.showLoading('正在生成音頻...');
            this.generateMissingAudio().then(() => {
                this.hideLoading();
                this.updateDictationUI();
                this.showPage('page-dictation');
            });
        } else {
            this.updateDictationUI();
            this.showPage('page-dictation');
        }
    }

    // ==================== DEMO ====================
    showResultsDemo() {
        this.finishDictation();
    }

    // ==================== AUTHENTICATION ====================
    toggleAuthModal() {
        const modal = document.getElementById('auth-modal');
        const content = document.getElementById('auth-modal-content');

        if (modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
            // Animate modal in
            setTimeout(() => {
                content.classList.remove('translate-y-full', 'sm:translate-y-0');
            }, 10);
            // Switch to login view by default
            this.switchAuthView('login');
        } else {
            // Animate modal out
            content.classList.add('translate-y-full', 'sm:translate-y-0');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300);
        }
    }

    switchAuthView(view) {
        const loginView = document.getElementById('auth-login-view');
        const registerView = document.getElementById('auth-register-view');

        if (view === 'register') {
            loginView.classList.add('hidden');
            registerView.classList.remove('hidden');
        } else {
            registerView.classList.add('hidden');
            loginView.classList.remove('hidden');
        }
    }

    togglePasswordVisibility(inputId) {
        const input = document.getElementById(inputId);
        if (input.type === 'password') {
            input.type = 'text';
        } else {
            input.type = 'password';
        }
    }

    async loginWithGoogle() {
        // Redirect to Google OAuth endpoint
        window.location.href = '/auth/google';
    }

    async loginWithEmail() {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        if (!email || !password) {
            alert('請填寫郵箱和密碼');
            return;
        }

        this.showLoading('正在登錄...');

        try {
            const response = await fetch('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.success) {
                this.hideLoading();
                this.toggleAuthModal();
                this.updateUserDisplay(data.user);
                alert('登錄成功！');
            } else {
                this.hideLoading();
                alert(data.message || '登錄失敗，請檢查郵箱和密碼');
            }
        } catch (error) {
            this.hideLoading();
            console.error('Login error:', error);
            alert('登錄失敗，請稍後重試');
        }
    }

    async registerWithEmail() {
        const name = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const termsAccepted = document.getElementById('terms-checkbox').checked;

        if (!name || !email || !password) {
            alert('請填寫所有必填欄位');
            return;
        }

        if (password.length < 8) {
            alert('密碼必須至少 8 個字符');
            return;
        }

        if (!/\d/.test(password)) {
            alert('密碼必須包含至少 1 個數字');
            return;
        }

        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
            alert('密碼必須包含至少 1 個符號');
            return;
        }

        if (!termsAccepted) {
            alert('請同意服務條款和隱私政策');
            return;
        }

        this.showLoading('正在註冊...');

        try {
            const response = await fetch('/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });

            const data = await response.json();

            if (data.success) {
                this.hideLoading();
                this.toggleAuthModal();
                this.updateUserDisplay(data.user);
                alert('註冊成功！歡迎使用默書助手！');
            } else {
                this.hideLoading();
                alert(data.message || '註冊失敗，請稍後重試');
            }
        } catch (error) {
            this.hideLoading();
            console.error('Register error:', error);
            alert('註冊失敗，請稍後重試');
        }
    }

    updateUserDisplay(user) {
        if (user) {
            // Update header with user info
            const userNameEl = document.getElementById('user-name');
            const userModeLabelEl = document.getElementById('user-mode-label');
            const userAvatarEl = document.getElementById('user-avatar');
            const userBadgeEl = document.getElementById('user-badge');
            const loginBtnEl = document.getElementById('login-btn');
            const notificationsBtnEl = document.getElementById('notifications-btn');

            if (userNameEl) {
                userNameEl.textContent = `${user.name} 👋`;
            }
            if (userModeLabelEl) {
                userModeLabelEl.textContent = '家長模式';
            }

            // Update avatar - replace icon with image
            if (userAvatarEl && user.avatar_url) {
                userAvatarEl.innerHTML = '';
                userAvatarEl.style.backgroundImage = `url('${user.avatar_url}')`;
                userAvatarEl.style.borderColor = '#22c3c3';
                userAvatarEl.classList.remove('bg-gray-100', 'dark:bg-gray-700');
            }

            // Show user badge (star)
            if (userBadgeEl) {
                userBadgeEl.classList.remove('hidden');
            }

            // Show notifications, hide login button
            if (loginBtnEl) {
                loginBtnEl.classList.add('hidden');
            }
            if (notificationsBtnEl) {
                notificationsBtnEl.classList.remove('hidden');
            }

            // Update auth state and selection limits
            this.isLoggedIn = true;
            this.maxWordSelection = 20;
            this.maxSentenceSelection = 20;

            // Refresh selection page if visible
            const selectionPage = document.getElementById('page-selection');
            if (selectionPage && !selectionPage.classList.contains('hidden')) {
                this.updateSelectionCounts();
                this.renderSelectionList();
            }

            // Load recent activity from database
            this.loadRecentActivity();

            // Store user info in localStorage
            localStorage.setItem('currentUser', JSON.stringify(user));
        }
    }

    resetToGuestMode() {
        const userNameEl = document.getElementById('user-name');
        const userModeLabelEl = document.getElementById('user-mode-label');
        const userAvatarEl = document.getElementById('user-avatar');
        const userBadgeEl = document.getElementById('user-badge');
        const loginBtnEl = document.getElementById('login-btn');
        const notificationsBtnEl = document.getElementById('notifications-btn');

        // Reset to guest mode display
        if (userNameEl) {
            userNameEl.textContent = 'Welcome 👋';
        }
        if (userModeLabelEl) {
            userModeLabelEl.textContent = 'Guest Mode';
        }

        // Reset avatar to default icon
        if (userAvatarEl) {
            userAvatarEl.innerHTML = '<span class="material-symbols-outlined text-gray-400 dark:text-gray-500 text-2xl">account_circle</span>';
            userAvatarEl.style.backgroundImage = 'none';
            userAvatarEl.style.borderColor = '';
            userAvatarEl.classList.add('bg-gray-100', 'dark:bg-gray-700');
        }

        // Hide user badge
        if (userBadgeEl) {
            userBadgeEl.classList.add('hidden');
        }

        // Show login button, hide notifications
        if (loginBtnEl) {
            loginBtnEl.classList.remove('hidden');
        }
        if (notificationsBtnEl) {
            notificationsBtnEl.classList.add('hidden');
        }
    }

    // ==================== STATS LOGIN CHECK ====================
    checkLoginForStats() {
        if (!this.isLoggedIn) {
            this.toggleAuthModal();
        } else {
            this.showPage('page-stats');
        }
    }

    // ==================== USER MENU ====================
    toggleUserMenu() {
        if (this.isLoggedIn) {
            // Show profile modal
            this.showProfileModal();
        } else {
            // Show auth modal
            this.toggleAuthModal();
        }
    }

    showLogoutModal() {
        // Close profile modal first
        this.closeProfileModal();
        const modal = document.getElementById('logout-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    closeLogoutModal() {
        const modal = document.getElementById('logout-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    // ==================== PROFILE MODAL ====================
    showProfileModal() {
        const currentUser = localStorage.getItem('currentUser');
        if (currentUser) {
            const user = JSON.parse(currentUser);
            const avatarDisplay = document.getElementById('profile-avatar-display');
            const nicknameInput = document.getElementById('profile-nickname');
            const emailInput = document.getElementById('profile-email');

            if (avatarDisplay && user.avatar_url) {
                avatarDisplay.style.backgroundImage = `url('${user.avatar_url}')`;
            }
            if (nicknameInput) {
                nicknameInput.value = user.name || '';
            }
            if (emailInput) {
                emailInput.value = user.email || '';
            }
        }
        const modal = document.getElementById('profile-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    closeProfileModal() {
        const modal = document.getElementById('profile-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    async handleAvatarUpload(input) {
        const file = input.files[0];
        if (!file) return;

        // Validate file size (max 2MB)
        const MAX_SIZE = 2 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            this.showToast('圖片大小不能超過 2MB', 'error');
            return;
        }

        // Show loading state on avatar button
        const avatarBtn = document.querySelector('#profile-modal .absolute.bottom-0.right-0');
        if (avatarBtn) {
            avatarBtn.disabled = true;
            avatarBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">sync</span>';
        }

        try {
            const formData = new FormData();
            formData.append('avatar', file);

            const response = await fetch('/auth/upload-avatar', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (data.success) {
                // Update local user data
                const currentUser = localStorage.getItem('currentUser');
                if (currentUser) {
                    const user = JSON.parse(currentUser);
                    user.avatar_url = data.avatar_url;
                    localStorage.setItem('currentUser', JSON.stringify(user));

                    // Update display
                    this.updateUserDisplay(user);
                    this.showProfileModal();
                }
                this.showToast('頭像已更新！', 'success');
            } else {
                this.showToast(data.message || '上傳失敗', 'error');
            }
        } catch (error) {
            console.error('Avatar upload error:', error);
            this.showToast('上傳失敗，請重試', 'error');
        } finally {
            // Restore avatar button
            if (avatarBtn) {
                avatarBtn.disabled = false;
                avatarBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">camera</span>';
            }
        }
    }

    async saveProfile() {
        const nicknameInput = document.getElementById('profile-nickname');
        const nickname = nicknameInput ? nicknameInput.value.trim() : '';
        const saveBtn = document.querySelector('#profile-modal button[onclick="dictationApp.saveProfile()"]');

        if (!nickname) {
            this.showToast('請輸入暱稱', 'error');
            return;
        }

        // Show loading on save button
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="material-symbols-outlined animate-spin">sync</span> 保存中...';
        }

        try {
            const response = await fetch('/auth/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nickname })
            });

            const data = await response.json();
            if (data.success) {
                // Update local user data
                const currentUser = localStorage.getItem('currentUser');
                if (currentUser) {
                    const user = JSON.parse(currentUser);
                    user.name = data.user.name;
                    user.avatar_url = data.user.avatar_url;
                    localStorage.setItem('currentUser', JSON.stringify(user));

                    // Update display
                    this.updateUserDisplay(user);
                }
                this.closeProfileModal();
                this.showToast('資料已更新！', 'success');
            } else {
                this.showToast(data.message || '保存失敗', 'error');
            }
        } catch (error) {
            console.error('Save profile error:', error);
            this.showToast('保存失敗，請重試', 'error');
        } finally {
            // Restore save button
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = 'Save Changes';
            }
        }
    }

    async confirmLogout() {
        // Show loading before making the request
        this.showLoading('登出中...');

        try {
            const response = await fetch('/auth/logout');
            this.hideLoading();

            if (response.redirected || response.ok) {
                // Clear localStorage and reset UI
                localStorage.removeItem('currentUser');
                this.isLoggedIn = false;
                this.maxWordSelection = 2;
                this.maxSentenceSelection = 2;
                this.resetToGuestMode();

                // Close modal
                this.closeLogoutModal();

                // Navigate to home page
                this.showPage('page-home');
            }
        } catch (error) {
            this.hideLoading();
            console.error('Logout error:', error);
        }
    }

    async logout() {
        try {
            const response = await fetch('/auth/logout');
            if (response.redirected || response.ok) {
                // Clear localStorage and reset UI
                localStorage.removeItem('currentUser');
                this.isLoggedIn = false;
                this.maxWordSelection = 2;
                this.maxSentenceSelection = 2;
                this.resetToGuestMode();

                // Navigate to home page
                this.showPage('page-home');
            }
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    // ==================== PRACTICE RECORDING ====================
    async recordPracticeSession(correct, wrong) {
        const total = correct + wrong;
        const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

        // Prepare words data with audio info for all items
        const wordsData = this.results.map(r => {
            const text = r.word || r.sentence;
            // Extract audio_id from audio_url if it's a database URL
            let audioId = null;
            if (r.audio_url && r.audio_url.includes('/api/audio/')) {
                audioId = parseInt(r.audio_url.split('/api/audio/')[1]) || null;
            }
            return {
                text: text,
                type: r.type || 'word',
                isCorrect: r.isCorrect,
                userAnswer: r.userAnswer || '',
                audio_url: r.audio_url || null,
                audio_id: audioId
            };
        });

        try {
            const response = await fetch('/api/practice/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: `練習 ${new Date().toLocaleDateString('zh-HK')}`,
                    total_items: total,
                    correct_count: correct,
                    wrong_count: wrong,
                    accuracy: accuracy,
                    words_data: JSON.stringify(wordsData)
                })
            });

            const data = await response.json();
            if (data.success) {
                console.log('Practice session recorded successfully');
            } else {
                console.error('Failed to record practice session:', data.error);
            }
        } catch (error) {
            console.error('Error recording practice session:', error);
        }
    }

    // ==================== EVENTS ====================
    bindEvents() {
        document.getElementById('image-input').addEventListener('change', (e) => {
            this.handleImageFile(e.target.files[0]);
        });

        this.audioPlayer.addEventListener('ended', () => {
            this.isPlaying = false;
            this.updatePlayButton(false);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.dictationApp = new DictationApp();
});
