/**
 * Dictation App - Main JavaScript
 * New UI Design Implementation with dark mode, statistics, wrong words book
 */

class DictationApp {
    constructor() {
        this.currentPage = 'page-home';
        this.recognizedText = '';
        this.words = [];
        this.sentences = [];
        this.contentType = 'words'; // 'words' or 'sentences'
        this.dictationMode = 'words';
        this.currentIndex = 0;
        this.items = [];
        this.results = [];
        this.isPlaying = false;
        this.autoPlay = false;
        this.slowMode = false;
        this.slowModeSpeed = 0.5;
        this.audioPlayer = document.getElementById('audio-player');

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

        this.init();
    }

    init() {
        this.loadSettings();
        this.bindEvents();
        this.applyDarkMode();
        this.updateStatsDisplay();
        this.updateWrongWordsDisplay();
    }

    // ==================== SETTINGS ====================
    loadSettings() {
        const settings = JSON.parse(localStorage.getItem('dictationSettings') || '{}');
        this.darkMode = settings.darkMode || false;
        this.speechRate = settings.speechRate || 0;
        this.voiceId = settings.voiceId || 'en-US-natalie';
        this.autoPlay = settings.autoPlay || false;

        // Update UI
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
        // Hide all pages
        document.querySelectorAll('[id^="page-"]').forEach(page => {
            page.classList.add('hidden');
        });

        // Show target page
        const targetPage = document.getElementById(pageId);
        if (targetPage) {
            targetPage.classList.remove('hidden');
            targetPage.classList.add('fade-in');
            this.currentPage = pageId;
        }

        // Special page initializations
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
        // For mobile devices, trigger file input
        document.getElementById('image-input').click();
    }

    handleImageFile(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            this.imageData = e.target.result;

            // Show preview
            const preview = document.getElementById('ocr-preview');
            if (preview) {
                preview.style.backgroundImage = `url('${this.imageData}')`;
            }

            // Go to verify page and perform OCR
            this.showPage('page-verify');
            this.performOCR();
        };
        reader.readAsDataURL(file);
    }

    // ==================== OCR ====================
    async performOCR() {
        if (!this.imageData) return;

        try {
            const response = await fetch('/api/ocr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: this.imageData })
            });

            const data = await response.json();

            if (data.success) {
                this.recognizedText = data.text;
                this.words = data.extracted.words || [];
                this.sentences = data.extracted.sentences || [];

                this.renderContentList();
            } else {
                alert('OCR 識別失敗，請重試');
            }
        } catch (error) {
            console.error('OCR Error:', error);
            alert('OCR 識別失敗：' + error.message);
        }
    }

    // ==================== CONTENT LIST ====================
    switchContentType(type) {
        this.contentType = type;
        this.renderContentList();
    }

    renderContentList() {
        const container = document.getElementById('content-list');
        const items = this.contentType === 'words' ? this.words : this.sentences;

        // Update counts
        document.getElementById('words-count-badge').textContent = this.words.length;
        document.getElementById('sentences-count-badge').textContent = this.sentences.length;

        if (!container) return;

        if (items.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">暫無內容，請上傳圖片</p>';
            return;
        }

        container.innerHTML = items.map((item, index) => {
            const text = item.word || item.sentence;
            const num = index + 1;

            return `
                <div class="group flex items-center gap-3 bg-white dark:bg-surface-dark p-2 pr-3 rounded-xl shadow-soft border border-transparent focus-within:border-primary/50 transition-all duration-300 hover:shadow-md">
                    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-lg">
                        ${num}
                    </div>
                    <div class="flex-1 min-w-0">
                        <input class="w-full bg-transparent border-none p-0 text-base font-semibold text-text-main dark:text-white placeholder-gray-400 focus:ring-0" type="text" value="${text}" onchange="dictationApp.updateItem('${this.contentType}', ${index}, this.value)">
                        <span class="text-[10px] text-green-500 font-medium">高準確度</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <button class="p-2 text-gray-400 hover:text-primary transition-colors rounded-full hover:bg-gray-50 dark:hover:bg-gray-700" onclick="dictationApp.playItemAudio('${this.contentType}', ${index})">
                            <span class="material-symbols-outlined text-[20px]">volume_up</span>
                        </button>
                        <button class="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-full hover:bg-gray-50 dark:hover:bg-gray-700" onclick="dictationApp.deleteItem('${this.contentType}', ${index})">
                            <span class="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateItem(type, index, value) {
        if (type === 'words') {
            this.words[index].word = value;
        } else {
            this.sentences[index].sentence = value;
        }
    }

    deleteItem(type, index) {
        if (confirm('確定要刪除此項目嗎？')) {
            if (type === 'words') {
                this.words.splice(index, 1);
            } else {
                this.sentences.splice(index, 1);
            }
            this.renderContentList();
        }
    }

    addNewItem() {
        const newItem = this.contentType === 'words'
            ? { word: '新詞語', meaning: '', id: Date.now() }
            : { sentence: '新句子', id: Date.now() };

        if (this.contentType === 'words') {
            this.words.push(newItem);
        } else {
            this.sentences.push(newItem);
        }

        this.renderContentList();

        // Scroll to bottom
        setTimeout(() => {
            const list = document.getElementById('content-list');
            if (list) list.scrollTop = list.scrollHeight;
        }, 100);
    }

    async playItemAudio(type, index) {
        const items = type === 'words' ? this.words : this.sentences;
        const text = items[index].word || items[index].sentence;

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
                this.audioPlayer.src = data.audio_url;
                this.audioPlayer.play();
            }
        } catch (error) {
            console.error('TTS Error:', error);
        }
    }

    // ==================== GENERATE AND START ====================
    async generateAndStart() {
        const items = this.contentType === 'words' ? this.words : this.sentences;

        if (items.length === 0) {
            alert('沒有可用的內容！');
            return;
        }

        // Prepare items for dictation
        this.items = items.map((item, index) => ({
            ...item,
            type: this.contentType === 'words' ? 'word' : 'sentence',
            id: index,
            audio_url: null
        }));

        this.currentIndex = 0;
        this.dictationMode = this.contentType;

        // Generate audio for all items
        await this.generateAllAudio();

        // Initialize results
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));

        // Update UI and show dictation page
        this.updateDictationUI();
        this.showPage('page-dictation');
    }

    async generateAllAudio() {
        const btn = document.querySelector('#page-verify button[onclick="dictationApp.generateAndStart()"]');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 生成中...';
        }

        try {
            const itemsToTTS = this.items.map(item => ({
                text: item.word || item.sentence,
                type: item.type,
                id: item.id
            }));

            const response = await fetch('/api/tts/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: itemsToTTS,
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
                    }
                });
            }
        } catch (error) {
            console.error('TTS Error:', error);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `
                    <div class="flex items-center justify-center rounded-full bg-white/20 p-1">
                        <span class="material-symbols-outlined text-white text-[20px]">play_arrow</span>
                    </div>
                    <span class="text-lg font-bold text-white tracking-wide">生成音頻並開始</span>
                    <div class="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                        <span class="material-symbols-outlined text-white">chevron_right</span>
                    </div>
                `;
            }
        }
    }

    // ==================== DICTATION SESSION ====================
    switchAudioMode(mode) {
        // Just update the UI to show which mode is active
    }

    updateDictationUI() {
        if (!this.items[this.currentIndex]) return;

        const item = this.items[this.currentIndex];
        const total = this.items.length;
        const progress = Math.round(((this.currentIndex + 1) / total) * 100);

        // Update header info
        document.getElementById('session-number').textContent = this.currentIndex + 1;
        document.getElementById('session-title').textContent = 'Chapter 4 詞語';
        document.getElementById('current-item-num').textContent = this.currentIndex + 1;
        document.getElementById('total-items-num').textContent = total;
        document.getElementById('progress-percent').textContent = progress + '%';
        document.getElementById('dictation-progress-bar').style.width = progress + '%';

        // Update reveal section
        const text = item.word || item.sentence;
        document.getElementById('reveal-answer').textContent = text;
        document.getElementById('reveal-pinyin').textContent = item.meaning || '';

        // Reset play button
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

            // Update UI
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

            // Update UI
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

        // Add to wrong words if incorrect
        if (!isCorrect) {
            this.addWrongWord(result.word || result.sentence, result.meaning || '', result.userAnswer);
        }

        // Visual feedback
        const main = document.querySelector('#page-dictation main');
        if (main) {
            main.classList.add(isCorrect ? 'bg-green-100' : 'bg-red-100', 'dark:bg-green-900/20', 'dark:bg-red-900/20');
            setTimeout(() => {
                main.classList.remove('bg-green-100', 'bg-red-100', 'dark:bg-green-900/20', 'dark:bg-red-900/20');
            }, 500);
        }

        // Move to next or finish
        setTimeout(() => {
            if (this.currentIndex < this.items.length - 1) {
                this.currentIndex++;
                this.updateDictationUI();
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

        // Update statistics
        this.recordSession(correct, incorrect);

        // Update headline based on accuracy
        const headline = document.getElementById('result-headline');
        if (accuracy >= 90) {
            headline.textContent = '太棒了！🎉';
        } else if (accuracy >= 70) {
            headline.textContent = '做得不錯！💪';
        } else {
            headline.textContent = '繼續加油！📚';
        }

        // Update accuracy ring
        const ringLight = document.getElementById('accuracy-ring-light');
        const ringDark = document.getElementById('accuracy-ring-dark');
        if (ringLight) ringLight.style.background = `conic-gradient(#22c3c3 ${accuracy}%, #f1f5f9 0)`;
        if (ringDark) ringDark.style.background = `conic-gradient(#22c3c3 ${accuracy}%, #374151 0)`;

        document.getElementById('accuracy-display').innerHTML = `${accuracy}<span class="text-2xl align-top text-gray-400 ml-1">%</span>`;

        // Update stats
        document.getElementById('perfect-count').textContent = correct;
        document.getElementById('review-count').textContent = incorrect;
        document.getElementById('mistakes-count').textContent = `${incorrect} 題`;

        // Render mistakes list
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
                const audio = new Audio(data.audio_url);
                audio.play();
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

        // Filter items to only include mistakes
        this.items = mistakes.map((m, i) => ({
            ...m,
            id: i,
            audio_url: null
        }));

        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));

        this.generateAllAudio().then(() => {
            this.updateDictationUI();
            this.showPage('page-dictation');
        });
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

        // Today
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
            audio_url: null
        }));

        this.wrongWords.forEach(w => w.reviewCount++);
        this.saveWrongWords();

        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null
        }));

        this.generateAllAudio().then(() => {
            this.updateDictationUI();
            this.showPage('page-dictation');
        });
    }

    // ==================== DEMO ====================
    showResultsDemo() {
        // Demo results for recent activity click
        this.finishDictation();
    }

    // ==================== EVENTS ====================
    bindEvents() {
        // Image input
        document.getElementById('image-input').addEventListener('change', (e) => {
            this.handleImageFile(e.target.files[0]);
        });

        // Audio player
        this.audioPlayer.addEventListener('ended', () => {
            this.isPlaying = false;
            this.updatePlayButton(false);
        });
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    window.dictationApp = new DictationApp();
});
