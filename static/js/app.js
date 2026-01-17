/**
 * Text Voice Web - Main JavaScript
 * Enhanced with dark mode, speed control, recording, wrong words book, and statistics
 */

class DictationApp {
    constructor() {
        this.currentStep = 'upload';
        this.recognizedText = '';
        this.words = [];
        this.sentences = [];
        this.dictationMode = 'words';
        this.currentIndex = 0;
        this.items = [];
        this.results = [];
        this.isPlaying = false;
        this.autoPlay = false;
        this.audioPlayer = document.getElementById('audio-player');

        // New features
        this.darkMode = false;
        this.speechRate = 0;
        this.voiceId = 'en-US-natalie';
        this.repeatCount = 1;
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

    // Settings Management
    loadSettings() {
        const settings = JSON.parse(localStorage.getItem('dictationSettings') || '{}');
        this.darkMode = settings.darkMode || false;
        this.speechRate = settings.speechRate || 0;
        this.voiceId = settings.voiceId || 'en-US-natalie';
        this.autoPlay = settings.autoPlay || false;

        // Update UI
        document.getElementById('speed-slider').value = this.speechRate;
        document.getElementById('voice-select').value = this.voiceId;
        document.getElementById('auto-play-toggle').checked = this.autoPlay;
        this.updateSpeedDisplay();
        this.updateAutoPlaySwitch();
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

    // Dark Mode
    toggleDarkMode() {
        this.darkMode = !this.darkMode;
        this.applyDarkMode();
        this.saveSettings();
    }

    applyDarkMode() {
        document.body.classList.toggle('dark', this.darkMode);
        const btn = document.getElementById('dark-mode-btn');
        if (this.darkMode) {
            btn.innerHTML = '<i class="fas fa-sun text-xl"></i>';
        } else {
            btn.innerHTML = '<i class="fas fa-moon text-xl"></i>';
        }
    }

    // Speed Control
    setSpeechRate(rate) {
        this.speechRate = rate;
        document.getElementById('speed-slider').value = rate;
        this.updateSpeedDisplay();
        this.saveSettings();
    }

    updateSpeedDisplay() {
        const value = this.speechRate;
        const display = document.getElementById('speed-value');
        if (value < -10) {
            display.textContent = '很慢';
        } else if (value < 0) {
            display.textContent = '較慢';
        } else if (value === 0) {
            display.textContent = '正常';
        } else if (value < 10) {
            display.textContent = '較快';
        } else {
            display.textContent = '很快';
        }
    }

    // Voice Selection
    setVoiceId(voiceId) {
        this.voiceId = voiceId;
        this.saveSettings();
    }

    // Auto Play
    toggleAutoPlay() {
        this.autoPlay = !this.autoPlay;
        this.updateAutoPlaySwitch();
        this.saveSettings();
    }

    updateAutoPlaySwitch() {
        const toggle = document.getElementById('auto-play-toggle');
        const sw = document.getElementById('auto-play-switch');
        if (this.autoPlay) {
            sw.classList.add('bg-blue-500');
            sw.querySelector('div').classList.add('translate-x-4');
        } else {
            sw.classList.remove('bg-blue-500');
            sw.querySelector('div').classList.remove('translate-x-4');
        }
    }

    // Repeat Count
    setRepeatCount(count) {
        this.repeatCount = count;
        document.querySelectorAll('.repeat-btn').forEach(btn => {
            btn.classList.remove('bg-blue-500', 'text-white');
            btn.classList.add('bg-gray-200');
        });
        if (event) {
            event.target.classList.remove('bg-gray-200');
            event.target.classList.add('bg-blue-500', 'text-white');
        }
    }

    // Statistics Management
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

        // Check if today already has stats
        const todayEntry = this.statistics.history.find(h => h.date === today);
        if (todayEntry) {
            todayEntry.correct += correct;
            todayEntry.wrong += wrong;
        } else {
            this.statistics.history.push({ date: today, correct, wrong });
        }

        // Keep only last 30 days
        if (this.statistics.history.length > 30) {
            this.statistics.history = this.statistics.history.slice(-30);
        }

        this.saveStatistics();
        this.updateStatsDisplay();
    }

    updateStatsDisplay() {
        const stats = this.statistics;

        // Overall stats
        document.getElementById('total-sessions').textContent = stats.sessions;
        document.getElementById('total-correct').textContent = stats.correct;
        document.getElementById('total-wrong').textContent = stats.wrong;

        const avgAccuracy = stats.sessions > 0
            ? Math.round((stats.correct / (stats.correct + stats.wrong)) * 100)
            : 0;
        document.getElementById('avg-accuracy').textContent = avgAccuracy + '%';

        // Today's stats
        const today = new Date().toDateString();
        const todayEntry = stats.history.find(h => h.date === today) || { correct: 0, wrong: 0 };
        document.getElementById('today-correct').textContent = todayEntry.correct;
        document.getElementById('today-wrong').textContent = todayEntry.wrong;

        const todayAccuracy = (todayEntry.correct + todayEntry.wrong) > 0
            ? Math.round((todayEntry.correct / (todayEntry.correct + todayEntry.wrong)) * 100)
            : 0;
        document.getElementById('today-accuracy').textContent = todayAccuracy + '%';
    }

    // Wrong Words Management
    loadWrongWords() {
        this.wrongWords = JSON.parse(localStorage.getItem('wrongWords') || '[]');
    }

    saveWrongWords() {
        localStorage.setItem('wrongWords', JSON.stringify(this.wrongWords));
    }

    addWrongWord(word, meaning, userAnswer) {
        // Check if already exists
        const exists = this.wrongWords.find(w => w.word.toLowerCase() === word.toLowerCase());
        if (!exists) {
            this.wrongWords.push({
                word: word,
                meaning: meaning || '',
                userAnswer: userAnswer,
                addedAt: new Date().toISOString(),
                reviewCount: 0
            });
            this.saveWrongWords();
            this.updateWrongWordsDisplay();
        }
    }

    clearWrongWords() {
        this.wrongWords = [];
        this.saveWrongWords();
        this.updateWrongWordsDisplay();
    }

    updateWrongWordsDisplay() {
        const container = document.getElementById('wrong-words-list');
        const practiceBtn = document.getElementById('practice-wrong-words');

        if (this.wrongWords.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">暫無錯詞記錄</p>';
            practiceBtn.disabled = true;
            return;
        }

        practiceBtn.disabled = false;
        container.innerHTML = this.wrongWords.map((item, index) => `
            <div class="bg-white p-3 rounded shadow flex justify-between items-center">
                <div>
                    <div class="font-bold text-lg">${item.word}</div>
                    ${item.meaning ? `<div class="text-xs text-gray-500">${item.meaning}</div>` : ''}
                    <div class="text-xs text-red-500">你寫的是: ${item.userAnswer}</div>
                    <div class="text-xs text-gray-400">複習次數: ${item.reviewCount}</div>
                </div>
                <button onclick="dictationApp.removeWrongWord(${index})" class="text-red-500 hover:text-red-700">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }

    removeWrongWord(index) {
        this.wrongWords.splice(index, 1);
        this.saveWrongWords();
        this.updateWrongWordsDisplay();
    }

    // Recording functionality
    async initRecording() {
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
                document.getElementById('play-record-btn').disabled = false;
                document.getElementById('recording-status').textContent = '錄音完成，點擊播放按鈕聆聽';
            };

            return true;
        } catch (err) {
            console.error('Error accessing microphone:', err);
            document.getElementById('recording-status').textContent = '無法訪問麥克風，請確保已授予權限';
            return false;
        }
    }

    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    async startRecording() {
        const initialized = await this.initRecording();
        if (!initialized) return;

        this.isRecording = true;
        this.audioChunks = [];
        this.mediaRecorder.start();

        const btn = document.getElementById('record-btn');
        btn.classList.add('recording');
        btn.innerHTML = '<i class="fas fa-stop text-xl"></i>';
        document.getElementById('recording-status').textContent = '錄音中...點擊停止';
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;

            const btn = document.getElementById('record-btn');
            btn.classList.remove('recording');
            btn.innerHTML = '<i class="fas fa-microphone text-xl"></i>';
        }
    }

    playRecording() {
        if (this.recordedAudio) {
            const audio = new Audio(this.recordedAudio);
            audio.play();
        }
    }

    bindEvents() {
        // Header buttons
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.toggleSection('settings-panel');
        });
        document.getElementById('stats-btn').addEventListener('click', () => {
            this.updateStatsDisplay();
            this.toggleSection('step-stats');
        });
        document.getElementById('wrong-words-btn').addEventListener('click', () => {
            this.updateWrongWordsDisplay();
            this.toggleSection('step-wrong-words');
        });
        document.getElementById('dark-mode-btn').addEventListener('click', () => {
            this.toggleDarkMode();
        });

        // Settings
        document.getElementById('close-settings').addEventListener('click', () => {
            document.getElementById('settings-panel').classList.add('hidden');
        });
        document.getElementById('speed-slider').addEventListener('input', (e) => {
            this.setSpeechRate(parseInt(e.target.value));
        });
        document.getElementById('voice-select').addEventListener('change', (e) => {
            this.setVoiceId(e.target.value);
        });
        document.getElementById('auto-play-toggle').addEventListener('click', () => {
            this.toggleAutoPlay();
        });

        // Stats
        document.getElementById('close-stats').addEventListener('click', () => {
            document.getElementById('step-stats').classList.add('hidden');
        });

        // Wrong Words
        document.getElementById('close-wrong-words').addEventListener('click', () => {
            document.getElementById('step-wrong-words').classList.add('hidden');
        });
        document.getElementById('clear-wrong-words').addEventListener('click', () => {
            if (confirm('確定要清除所有錯詞記錄嗎？')) {
                this.clearWrongWords();
            }
        });
        document.getElementById('practice-wrong-words').addEventListener('click', () => {
            this.practiceWrongWords();
        });

        // Upload area
        const uploadArea = document.getElementById('upload-area');
        const imageInput = document.getElementById('image-input');

        uploadArea.addEventListener('click', () => imageInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('border-blue-500');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('border-blue-500');
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('border-blue-500');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                this.handleImageFile(file);
            }
        });

        imageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleImageFile(file);
            }
        });

        // Recognize button
        document.getElementById('recognize-btn').addEventListener('click', () => {
            this.performOCR();
        });

        // Start dictation buttons
        document.getElementById('start-words-btn').addEventListener('click', () => {
            this.startDictation('words');
        });
        document.getElementById('start-sentences-btn').addEventListener('click', () => {
            this.startDictation('sentences');
        });

        // Audio controls
        document.getElementById('play-audio-btn').addEventListener('click', () => {
            this.togglePlay();
        });
        document.getElementById('prev-audio-btn').addEventListener('click', () => {
            this.playPrev();
        });
        document.getElementById('next-audio-btn').addEventListener('click', () => {
            this.playNext();
        });
        document.getElementById('auto-play-btn').addEventListener('click', () => {
            this.toggleAutoPlay();
            this.saveSettings();
        });

        // Recording
        document.getElementById('record-btn').addEventListener('click', () => {
            this.toggleRecording();
        });
        document.getElementById('play-record-btn').addEventListener('click', () => {
            this.playRecording();
        });

        // Answer input
        document.getElementById('answer-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.checkAnswer();
            }
        });

        // Marking buttons
        document.getElementById('mark-correct-btn').addEventListener('click', () => {
            this.markAnswer(true);
        });
        document.getElementById('mark-incorrect-btn').addEventListener('click', () => {
            this.markAnswer(false);
        });

        // Navigation
        document.getElementById('back-btn').addEventListener('click', () => {
            this.goBack();
        });
        document.getElementById('finish-btn').addEventListener('click', () => {
            this.finishDictation();
        });
        document.getElementById('retry-btn').addEventListener('click', () => {
            this.retry();
        });
        document.getElementById('home-btn').addEventListener('click', () => {
            this.goHome();
        });

        // Save wrong words
        document.getElementById('save-wrong-words').addEventListener('click', () => {
            this.saveWrongWordsToBook();
        });

        // Audio player events
        this.audioPlayer.addEventListener('ended', () => {
            this.onAudioEnded();
        });
    }

    toggleSection(sectionId) {
        const section = document.getElementById(sectionId);
        if (section.classList.contains('hidden')) {
            section.classList.remove('hidden');
        } else {
            section.classList.add('hidden');
        }
    }

    handleImageFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById('preview-image');
            const placeholder = document.getElementById('upload-placeholder');
            const recognizeBtn = document.getElementById('recognize-btn');

            preview.src = e.target.result;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
            recognizeBtn.disabled = false;

            // Store base64 data
            this.imageData = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    async performOCR() {
        const loading = document.getElementById('ocr-loading');
        const errorDiv = document.getElementById('ocr-error');
        const recognizeBtn = document.getElementById('recognize-btn');

        errorDiv.classList.add('hidden');
        loading.classList.remove('hidden');
        recognizeBtn.disabled = true;

        try {
            const response = await fetch('/api/ocr', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image: this.imageData
                })
            });

            const data = await response.json();

            if (data.success) {
                this.recognizedText = data.text;
                this.words = data.extracted.words || [];
                this.sentences = data.extracted.sentences || [];

                this.displayExtractedContent();
                this.showSection('step-content');
            } else {
                throw new Error(data.error || 'OCR failed');
            }
        } catch (error) {
            errorDiv.textContent = `錯誤: ${error.message}`;
            errorDiv.classList.remove('hidden');
        } finally {
            loading.classList.add('hidden');
            recognizeBtn.disabled = false;
        }
    }

    displayExtractedContent() {
        // Display words
        const wordsContainer = document.getElementById('words-container');
        wordsContainer.innerHTML = this.words.map((w, i) => `
            <div class="bg-white p-2 rounded shadow text-center text-sm">
                <div class="font-bold">${w.word}</div>
                ${w.meaning ? `<div class="text-xs text-gray-500">${w.meaning}</div>` : ''}
            </div>
        `).join('');

        // Update words count
        document.getElementById('words-count').textContent = this.words.length;

        // Display sentences
        const sentencesContainer = document.getElementById('sentences-container');
        sentencesContainer.innerHTML = this.sentences.map(s => `
            <div class="bg-white p-3 rounded shadow text-sm">
                ${s.sentence}
            </div>
        `).join('');

        // Update sentences count
        document.getElementById('sentences-count').textContent = this.sentences.length;

        // Show word/sentence counts
        const wordsBtn = document.getElementById('start-words-btn');
        const sentencesBtn = document.getElementById('start-sentences-btn');

        if (wordsBtn) {
            wordsBtn.innerHTML = `<i class="fas fa-headphones mr-2"></i>聽寫單詞 (${this.words.length}個)`;
            wordsBtn.onclick = () => {
                this.startDictation('words');
            };
        }

        if (sentencesBtn) {
            sentencesBtn.innerHTML = `<i class="fas fa-book-reader mr-2"></i>聽寫句子 (${this.sentences.length}個)`;
            sentencesBtn.onclick = () => {
                this.startDictation('sentences');
            };
        }
    }

    async startDictation(mode) {
        this.dictationMode = mode;
        this.items = mode === 'words'
            ? this.words.map((w, i) => ({...w, type: 'word', id: i}))
            : this.sentences.map((s, i) => ({...s, type: 'sentence', id: i}));

        if (this.items.length === 0) {
            alert('沒有可用的項目！');
            return;
        }

        // Reset state
        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null,
            checked: false
        }));

        // Generate TTS for all items with user's preferred speed
        await this.generateAllAudio();

        // Update UI
        const dictationTitle = document.getElementById('dictation-title');
        const totalCount = document.getElementById('total-count');

        if (dictationTitle) dictationTitle.textContent = mode === 'words' ? '單詞聽寫' : '句子聽寫';
        if (totalCount) totalCount.textContent = this.items.length;

        this.updateDictationUI();
        this.showSection('step-dictation');
    }

    async generateAllAudio() {
        const btnId = this.dictationMode === 'words' ? 'start-words-btn' : 'start-sentences-btn';
        const btn = document.getElementById(btnId);
        if (!btn) return;

        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>正在生成語音...';
        btn.disabled = true;

        try {
            const itemsToTTS = this.items.map(item => ({
                text: item.word || item.sentence,
                type: item.type,
                id: item.id
            }));

            const response = await fetch('/api/tts/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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
            console.error('TTS batch error:', error);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    updateDictationUI() {
        const item = this.items[this.currentIndex];

        // Update progress
        document.getElementById('current-index').textContent = this.currentIndex + 1;
        document.getElementById('progress-bar').style.width =
            `${((this.currentIndex + 1) / this.items.length) * 100}%`;

        // Update item display
        document.getElementById('item-type-badge').textContent =
            this.dictationMode === 'words' ? '單詞' : '句子';
        document.getElementById('current-item-text').textContent =
            item.word || item.sentence;

        const meaningEl = document.getElementById('current-item-meaning');
        if (item.meaning) {
            meaningEl.textContent = item.meaning;
            meaningEl.classList.remove('hidden');
        } else {
            meaningEl.classList.add('hidden');
        }

        // Update answer input
        const currentResult = this.results[this.currentIndex];
        document.getElementById('answer-input').value = currentResult.userAnswer || '';
        document.getElementById('answer-input').focus();

        // Update play button icon
        this.updatePlayButton(false);

        // Reset recording
        this.recordedAudio = null;
        document.getElementById('play-record-btn').disabled = true;
        document.getElementById('recording-status').textContent = '點擊麥克風開始錄音';

        // Update audio loading state
        const playBtn = document.getElementById('play-audio-btn');
        const playIcon = playBtn.querySelector('i');

        if (item.audio_url) {
            this.audioPlayer.src = item.audio_url;
            this.audioPlayer.load();

            playIcon.classList.remove('fa-play', 'fa-pause', 'pl-1');
            playIcon.classList.add('fa-spinner', 'fa-spin');
            playBtn.disabled = true;
            playBtn.title = '音頻加載中...';

            const onCanPlay = () => {
                playIcon.classList.remove('fa-spinner', 'fa-spin');
                playIcon.classList.add('fa-play', 'pl-1');
                playBtn.disabled = false;
                playBtn.title = '播放/暫停';
                this.audioPlayer.removeEventListener('canplay', onCanPlay);
                this.audioPlayer.removeEventListener('error', onError);
            };

            const onError = () => {
                playIcon.classList.remove('fa-spinner', 'fa-spin');
                playIcon.classList.add('fa-play', 'pl-1');
                playBtn.disabled = false;
                playBtn.title = '播放/暫停';
                this.audioPlayer.removeEventListener('canplay', onCanPlay);
                this.audioPlayer.removeEventListener('error', onError);
            };

            this.audioPlayer.addEventListener('canplay', onCanPlay, { once: true });
            this.audioPlayer.addEventListener('error', onError, { once: true });
        } else {
            playIcon.classList.remove('fa-play', 'fa-pause', 'pl-1');
            playIcon.classList.add('fa-exclamation-triangle');
            playBtn.title = '音頻尚未生成';
        }
    }

    togglePlay() {
        if (this.isPlaying) {
            this.audioPlayer.pause();
            this.isPlaying = false;
            this.updatePlayButton(false);
        } else {
            // Play multiple times based on repeat count
            this.playWithRepeat(this.repeatCount);
        }
    }

    playWithRepeat(count) {
        let played = 0;
        const playNext = () => {
            if (played < count) {
                this.audioPlayer.currentTime = 0;
                this.audioPlayer.play().then(() => {
                    played++;
                    this.audioPlayer.onended = playNext;
                }).catch(e => {
                    console.error('Play error:', e);
                });
            }
        };
        playNext();
        this.isPlaying = true;
        this.updatePlayButton(true);
    }

    updatePlayButton(playing) {
        const btn = document.getElementById('play-audio-btn');
        const icon = btn.querySelector('i');
        if (playing) {
            icon.classList.remove('fa-play', 'pl-1');
            icon.classList.add('fa-pause');
            btn.classList.add('playing');
        } else {
            icon.classList.add('fa-play', 'pl-1');
            icon.classList.remove('fa-pause');
            btn.classList.remove('playing');
        }
    }

    playPrev() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updateDictationUI();
        }
    }

    playNext() {
        if (this.currentIndex < this.items.length - 1) {
            this.currentIndex++;
            this.updateDictationUI();
        }
    }

    onAudioEnded() {
        this.isPlaying = false;
        this.updatePlayButton(false);

        if (this.autoPlay && this.currentIndex < this.items.length - 1) {
            this.currentIndex++;
            this.updateDictationUI();
            setTimeout(() => {
                this.togglePlay();
            }, 500);
        }
    }

    checkAnswer() {
        const answer = document.getElementById('answer-input').value.trim();
        this.results[this.currentIndex].userAnswer = answer;

        const item = this.items[this.currentIndex];
        const correctAnswer = item.word || item.sentence;
        const isCorrect = answer.toLowerCase() === correctAnswer.toLowerCase();

        this.markAnswer(isCorrect);
    }

    markAnswer(isCorrect) {
        const result = this.results[this.currentIndex];
        result.isCorrect = isCorrect;
        result.checked = true;

        const card = document.getElementById('current-item-card');
        card.classList.remove('bg-green-100', 'bg-red-100');
        card.classList.add(isCorrect ? 'bg-green-100' : 'bg-red-100');

        setTimeout(() => {
            card.classList.remove('bg-green-100', 'bg-red-100');

            if (this.currentIndex < this.items.length - 1) {
                this.currentIndex++;
                this.updateDictationUI();
            } else {
                this.finishDictation();
            }
        }, 1000);
    }

    goBack() {
        this.showSection('step-content');
    }

    finishDictation() {
        const correct = this.results.filter(r => r.isCorrect === true).length;
        const incorrect = this.results.filter(r => r.isCorrect === false).length;
        const accuracy = this.results.length > 0
            ? Math.round((correct / this.results.length) * 100)
            : 0;

        document.getElementById('correct-count').textContent = correct;
        document.getElementById('incorrect-count').textContent = incorrect;
        document.getElementById('accuracy').textContent = `${accuracy}%`;

        // Performance message
        const messageEl = document.getElementById('performance-message');
        messageEl.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'bg-yellow-100', 'text-yellow-700', 'bg-red-100', 'text-red-700');
        if (accuracy >= 90) {
            messageEl.classList.add('bg-green-100', 'text-green-700');
            messageEl.textContent = '太棒了！表現非常優秀！繼續保持！';
        } else if (accuracy >= 70) {
            messageEl.classList.add('bg-yellow-100', 'text-yellow-700');
            messageEl.textContent = '做得不錯！再練習一下可以更好！';
        } else {
            messageEl.classList.add('bg-red-100', 'text-red-700');
            messageEl.textContent = '需要加油！建議複習錯詞本再試一次！';
        }

        const resultsList = document.getElementById('results-list');
        resultsList.innerHTML = this.results.map((r, i) => {
            const icon = r.isCorrect === true ? '✓' : (r.isCorrect === false ? '✗' : '?');
            const iconClass = r.isCorrect === true ? 'text-green-500' : (r.isCorrect === false ? 'text-red-500' : 'text-yellow-500');
            const answer = r.userAnswer || '(未作答)';

            return `
                <div class="quiz-item ${r.isCorrect === true ? 'correct' : (r.isCorrect === false ? 'incorrect' : 'pending')} p-4 rounded">
                    <div class="flex justify-between items-start">
                        <div>
                            <span class="font-bold text-lg">${i + 1}. ${r.word || r.sentence}</span>
                            <div class="text-sm text-gray-600 mt-1">
                                你的答案: <span class="${r.isCorrect === true ? 'text-green-600' : 'text-red-600'}">${answer}</span>
                            </div>
                        </div>
                        <span class="text-2xl ${iconClass}">${icon}</span>
                    </div>
                </div>
            `;
        }).join('');

        // Record statistics
        this.recordSession(correct, incorrect);

        this.showSection('step-results');
    }

    saveWrongWordsToBook() {
        const wrongResults = this.results.filter(r => r.isCorrect === false);
        if (wrongResults.length === 0) {
            alert('沒有錯誤的詞語需要保存！');
            return;
        }

        wrongResults.forEach(r => {
            this.addWrongWord(r.word || r.sentence, r.meaning || '', r.userAnswer || '');
        });

        alert(`已保存 ${wrongResults.length} 個錯詞到錯詞本！`);
    }

    practiceWrongWords() {
        if (this.wrongWords.length === 0) return;

        this.items = this.wrongWords.map((w, i) => ({
            word: w.word,
            meaning: w.meaning,
            type: 'word',
            id: i
        }));

        // Increment review count
        this.wrongWords.forEach(w => w.reviewCount++);
        this.saveWrongWords();

        this.currentIndex = 0;
        this.results = this.items.map(item => ({
            ...item,
            userAnswer: '',
            isCorrect: null,
            checked: false
        }));

        this.generateAllAudio().then(() => {
            const dictationTitle = document.getElementById('dictation-title');
            const totalCount = document.getElementById('total-count');

            if (dictationTitle) dictationTitle.textContent = '錯詞複習';
            if (totalCount) totalCount.textContent = this.items.length;

            this.updateDictationUI();
            this.showSection('step-dictation');
        });
    }

    retry() {
        this.startDictation(this.dictationMode);
    }

    goHome() {
        this.showSection('step-upload');
        this.currentStep = 'upload';
        this.recognizedText = '';
        this.words = [];
        this.sentences = [];
        this.currentIndex = 0;
        this.items = [];
        this.results = [];

        document.getElementById('preview-image').classList.add('hidden');
        document.getElementById('upload-placeholder').classList.remove('hidden');
        document.getElementById('recognize-btn').disabled = true;
        document.getElementById('image-input').value = '';
    }

    showSection(sectionId) {
        ['step-upload', 'step-content', 'step-dictation', 'step-results', 'step-stats', 'step-wrong-words', 'settings-panel'].forEach(id => {
            document.getElementById(id).classList.add('hidden');
        });
        document.getElementById(sectionId).classList.remove('hidden');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.dictationApp = new DictationApp();
});
