/**
 * Text Voice Web - Main JavaScript
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

        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
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

        // Audio player events
        this.audioPlayer.addEventListener('ended', () => {
            this.onAudioEnded();
        });
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

        // Display sentences
        const sentencesContainer = document.getElementById('sentences-container');
        sentencesContainer.innerHTML = this.sentences.map(s => `
            <div class="bg-white p-3 rounded shadow text-sm">
                ${s.sentence}
            </div>
        `).join('');

        // Show word/sentence counts
        const wordsBtn = document.getElementById('start-words-btn');
        const sentencesBtn = document.getElementById('start-sentences-btn');

        if (wordsBtn) {
            wordsBtn.innerHTML = `<i class="fas fa-headphones mr-2"></i>聽寫單詞 (${this.words.length}個)`;
            wordsBtn.onclick = () => {
                console.log('Words button clicked, words:', this.words);
                this.startDictation('words');
            };
        }

        if (sentencesBtn) {
            sentencesBtn.innerHTML = `<i class="fas fa-book-reader mr-2"></i>聽寫句子 (${this.sentences.length}個)`;
            sentencesBtn.onclick = () => {
                console.log('Sentences button clicked, sentences:', this.sentences);
                this.startDictation('sentences');
            };
        }
    }

    async startDictation(mode) {
        console.log('startDictation called with mode:', mode);
        this.dictationMode = mode;
        this.items = mode === 'words'
            ? this.words.map((w, i) => ({...w, type: 'word', id: i}))
            : this.sentences.map((s, i) => ({...s, type: 'sentence', id: i}));

        console.log('Items created:', this.items);

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

        console.log('Results initialized:', this.results);

        // Generate TTS for all items
        await this.generateAllAudio();

        console.log('After generateAllAudio, items:', this.items);

        // Update UI
        const dictationTitle = document.getElementById('dictation-title');
        const totalCount = document.getElementById('total-count');
        const currentItemType = document.getElementById('current-item-type');

        if (dictationTitle) dictationTitle.textContent = mode === 'words' ? '單詞聽寫' : '句子聽寫';
        if (totalCount) totalCount.textContent = this.items.length;
        if (currentItemType) currentItemType.textContent = mode === 'words' ? '單詞' : '句子';

        this.updateDictationUI();
        this.showSection('step-dictation');
    }

    async generateAllAudio() {
        const btnId = this.dictationMode === 'words' ? 'start-words-btn' : 'start-sentences-btn';
        const btn = document.getElementById(btnId);
        if (!btn) {
            console.error('Button not found:', btnId);
            return;
        }
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>正在生成語音...';
        btn.disabled = true;

        try {
            const itemsToTTS = this.items.map(item => ({
                text: item.word || item.sentence,
                type: item.type,
                id: item.id
            }));

            console.log('Sending TTS batch request for', itemsToTTS.length, 'items');

            const response = await fetch('/api/tts/batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    items: itemsToTTS,
                    voice_id: 'en-US-natalie',
                    rate: -15,  // Slower speed for better clarity
                    pitch: -5   // Slightly lower pitch for softer voice
                })
            });

            const data = await response.json();

            console.log('TTS batch response:', data);

            if (data.success) {
                data.results.forEach(result => {
                    const item = this.items.find(i => i.id === result.id);
                    if (item && result.success) {
                        item.audio_url = result.audio_url;
                        console.log('Added audio_url to item', result.id, ':', result.audio_url);
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

        // Update audio loading state
        const playBtn = document.getElementById('play-audio-btn');
        const playIcon = playBtn.querySelector('i');

        if (item.audio_url) {
            // Reset audio player and preload
            this.audioPlayer.src = item.audio_url;
            this.audioPlayer.load();

            // Show loading state
            playIcon.classList.remove('fa-play', 'fa-pause', 'pl-1');
            playIcon.classList.add('fa-spinner', 'fa-spin');
            playBtn.disabled = true;
            playBtn.title = '音頻加載中...';

            // Enable play button when audio is ready
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
                console.error('Audio load error for:', item.audio_url);
                this.audioPlayer.removeEventListener('canplay', onCanPlay);
                this.audioPlayer.removeEventListener('error', onError);
            };

            this.audioPlayer.addEventListener('canplay', onCanPlay, { once: true });
            this.audioPlayer.addEventListener('error', onError, { once: true });
        } else {
            // No audio URL - show warning
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
            this.audioPlayer.play().catch(e => {
                console.error('Play error:', e);
                alert('無法播放音頻，請檢查網絡連接');
            });
            this.isPlaying = true;
            this.updatePlayButton(true);
        }
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

    toggleAutoPlay() {
        this.autoPlay = !this.autoPlay;
        const btn = document.getElementById('auto-play-btn');
        const icon = btn.querySelector('i');

        if (this.autoPlay) {
            icon.classList.remove('text-gray-600');
            icon.classList.add('text-blue-500');
            btn.style.backgroundColor = '#dbeafe';
            // Start auto play from current item
            if (!this.isPlaying) {
                this.togglePlay();
            }
        } else {
            icon.classList.add('text-gray-600');
            icon.classList.remove('text-blue-500');
            btn.style.backgroundColor = '';
            if (this.isPlaying) {
                this.togglePlay();
            }
        }
    }

    onAudioEnded() {
        this.isPlaying = false;
        this.updatePlayButton(false);

        if (this.autoPlay && this.currentIndex < this.items.length - 1) {
            // Auto advance to next item
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

        // Auto-mark based on simple comparison
        const item = this.items[this.currentIndex];
        const correctAnswer = item.word || item.sentence;
        const isCorrect = answer.toLowerCase() === correctAnswer.toLowerCase();

        this.markAnswer(isCorrect);
    }

    markAnswer(isCorrect) {
        const result = this.results[this.currentIndex];
        result.isCorrect = isCorrect;
        result.checked = true;

        // Visual feedback
        const card = document.getElementById('current-item-card');
        card.classList.remove('bg-green-100', 'bg-red-100');
        card.classList.add(isCorrect ? 'bg-green-100' : 'bg-red-100');

        // Auto advance after short delay
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
        // Calculate results
        const correct = this.results.filter(r => r.isCorrect === true).length;
        const incorrect = this.results.filter(r => r.isCorrect === false).length;
        const accuracy = this.results.length > 0
            ? Math.round((correct / this.results.length) * 100)
            : 0;

        // Update summary
        document.getElementById('correct-count').textContent = correct;
        document.getElementById('incorrect-count').textContent = incorrect;
        document.getElementById('accuracy').textContent = `${accuracy}%`;

        // Display results list
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

        this.showSection('step-results');
    }

    retry() {
        this.startDictation(this.dictationMode);
    }

    goHome() {
        this.showSection('step-upload');
        // Reset state
        this.currentStep = 'upload';
        this.recognizedText = '';
        this.words = [];
        this.sentences = [];
        this.currentIndex = 0;
        this.items = [];
        this.results = [];

        // Reset UI
        document.getElementById('preview-image').classList.add('hidden');
        document.getElementById('upload-placeholder').classList.remove('hidden');
        document.getElementById('recognize-btn').disabled = true;
        document.getElementById('image-input').value = '';
    }

    showSection(sectionId) {
        ['step-upload', 'step-content', 'step-dictation', 'step-results'].forEach(id => {
            document.getElementById(id).classList.add('hidden');
        });
        document.getElementById(sectionId).classList.remove('hidden');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.dictationApp = new DictationApp();
});
