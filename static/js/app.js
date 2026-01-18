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

    handleImageFile(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            this.imageData = e.target.result;

            const preview = document.getElementById('ocr-preview');
            if (preview) {
                preview.style.backgroundImage = `url('${this.imageData}')`;
            }

            this.showPage('page-verify');
            this.performOCR();
        };
        reader.readAsDataURL(file);
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

    // ==================== CONTENT LIST ====================
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
            if (this.selectedWordIndices.size >= this.maxWordSelection) {
                // Remove oldest selection
                const firstIndex = this.selectedWordIndices.values().next().value;
                this.selectedWordIndices.delete(firstIndex);
            }
            this.selectedWordIndices.add(index);
        }
        this.renderSelectionList();
    }

    toggleSentenceSelection(index) {
        if (this.selectedSentenceIndices.has(index)) {
            this.selectedSentenceIndices.delete(index);
        } else {
            if (this.selectedSentenceIndices.size >= this.maxSentenceSelection) {
                const firstIndex = this.selectedSentenceIndices.values().next().value;
                this.selectedSentenceIndices.delete(firstIndex);
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

        // Get all words
        this.allWords.forEach((word, index) => {
            allItems.push({
                word: word.word,
                phonetic: word.phonetic || '',
                meaning: word.meaning || '',
                type: 'word',
                id: `word_${index}`,
                audio_url: this.ttsCache.get(word.word) || null
            });
        });

        // Get all sentences
        this.allSentences.forEach((sentence, index) => {
            allItems.push({
                sentence: sentence.sentence,
                meaning: sentence.meaning || '',
                type: 'sentence',
                id: `sentence_${index}`,
                audio_url: this.ttsCache.get(sentence.sentence) || null
            });
        });

        if (allItems.length === 0) {
            alert('暫無內容，請先上傳圖片');
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
            this.showLoading('正在生成音頻...');
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
            alert('請至少選擇一項！');
            return;
        }

        this.items = selectedItems;
        this.currentIndex = 0;
        this.dictationMode = selectedItems[0].type;

        // Generate audio only for items not yet cached
        const itemsNeedingTTS = selectedItems.filter(item => !item.audio_url);
        if (itemsNeedingTTS.length > 0) {
            this.showLoading('正在生成音頻...');
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

            // Update auth state
            this.isLoggedIn = true;
            this.maxWordSelection = 20;
            this.maxSentenceSelection = 20;

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
            // Show logout confirmation modal
            this.showLogoutModal();
        } else {
            // Show auth modal
            this.toggleAuthModal();
        }
    }

    showLogoutModal() {
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

    async confirmLogout() {
        try {
            const response = await fetch('/auth/logout');
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

        // Prepare words data (only wrong answers)
        const wordsData = this.results
            .filter(r => r.isCorrect === false)
            .map(r => ({
                word: r.word || r.sentence,
                userAnswer: r.userAnswer || ''
            }));

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
                    words_data: wordsData.length > 0 ? JSON.stringify(wordsData) : null
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
