import logging
import math
from string import ascii_lowercase
import random
from collections import defaultdict
from pathlib import Path
import statistics
import sortedcontainers
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sortedcontainers import SortedDict

logging.basicConfig(level=logging.INFO)
GUTNEBER_PATH = Path.cwd()
DICT_ENG_1K = GUTNEBER_PATH / "backend/api/dict/english1k.txt"
assert DICT_ENG_1K.exists()

MAX_ALLOWED_LETTER_DURATION = 1/(20 * 5.1 / 60000)  # equivalent to 20 WPM
DURATION_MOVING_AVERAGE_NUM = 50


class WordData(BaseModel):
    word: str


class LetterData(BaseModel):
    letter: str
    duration: int
    miss: bool


class CompletedWordData(BaseModel):
    word_count: int
    duration: int
    word_letters_data: list[LetterData]


app = FastAPI()

origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_word_list = []
_words_by_lead = defaultdict(list)
_words_by_len = defaultdict(list)
_words_by_letter = defaultdict(list)
_missed = set()


class LetterStats:
    def __init__(self, char: str):
        self.char = char
        self.durations = []
        self.miss_count = 0
        self.duration_moving_averages = []
        self.error_freq = 0

    def add_duration(self, duration: int):
        if duration < MAX_ALLOWED_LETTER_DURATION:
            self.durations.append(duration)
            self.calc_duration_moving_average()
            self.update_error_frequency()

    def calc_duration_moving_average(self):
        mean = self.get_average_duration()
        self.duration_moving_averages.append(mean)
        self.duration_moving_averages = self.duration_moving_averages[:DURATION_MOVING_AVERAGE_NUM]

    def add_miss(self):
        self.miss_count += 1

    def get_average_duration(self):
        return statistics.mean(self.durations[:DURATION_MOVING_AVERAGE_NUM]) if self.durations else None

    def update_error_frequency(self):
        if self.miss_count == 0:
            return
        self.error_freq = math.floor(len(self.durations) / self.miss_count)

    def as_dict(self):
        return {
            "letter": self.char,
            "durations": self.durations,
            "duration_moving_averages": self.duration_moving_averages,
            "mean": self.get_average_duration(),
            "miss": self.miss_count,
            "error_freq": self.error_freq,
            "occurances": len(self.durations),
        }


_letters: dict[str, LetterStats] = {char: LetterStats(char) for char in ascii_lowercase}
_letter_by_occurances = dict.fromkeys(ascii_lowercase, 0)
_letter_by_error_freq = dict.fromkeys(ascii_lowercase, 0)


def update_letter_by_occurance(char: str):
    global _letter_by_occurances
    _letter_by_occurances[char] = len(_letters[char].durations)
    _letter_by_occurances = dict(sorted(_letter_by_occurances.items(), key=lambda t: t[1]))


def update_letter_by_error_freq(char: str):
    global _letter_by_error_freq
    _letter_by_error_freq[char] = _letters[char].error_freq
    _letter_by_error_freq = dict(sorted(_letter_by_error_freq.items(), key=lambda t: t[1]))


def fill_words():
    with DICT_ENG_1K.open("r") as f:
        for _word in f.readlines():
            word = _word.strip("\n").lower()
            _word_list.append(word)
            _words_by_lead[word[0]].append(word)
            _words_by_len[len(word)].append(word)
            for letter in _word:
                _words_by_letter[letter].append(word)


def get_random_word():
    return random.sample(_word_list, 1)[0]


def least_used_letter_words(num_words, words_per_letter=2):
    words_to_add = []
    for letter, occurances in _letter_by_occurances.items():
        if num_words <= 0:
            break
        letter_words = random.sample(_words_by_letter[letter], min(num_words, words_per_letter))
        words_to_add.extend(letter_words)
        logging.info(f"{letter=}: {occurances=}, {letter_words}")
        num_words -= min(words_per_letter, num_words)
    return words_to_add


def freq_error_letters(num_words, words_per_letter=2):
    words_to_add = []
    for letter, error_freq in _letter_by_error_freq.items():
        if num_words <= 0:
            break
        if error_freq == 0:
            continue
        letter_words = random.sample(_words_by_letter[letter], min(num_words, words_per_letter))
        words_to_add.extend(letter_words)
        logging.info(f"{letter=}: {error_freq=}, {letter_words}")
        num_words -= min(words_per_letter, num_words)
    return words_to_add


@app.get("/word")
def get_word() -> str:
    return get_random_word()


@app.get("/words")
def get_words(n: int) -> list[str]:
    repeats = 2
    missed_to_pop = min(len(_missed), 2)
    words = [_missed.pop() for _ in range(missed_to_pop)] * repeats
    error_words_count = min((n - len(words)), 4)
    words.extend(freq_error_letters(error_words_count))
    least_used_letter_words_count = n - len(words)
    words.extend(least_used_letter_words(least_used_letter_words_count))
    random.shuffle(words)
    logging.info(f"{words=}")
    return words


@app.post("/word/incorrect")
def post_misspelled_word(data: WordData) -> None:
    _missed.add(data.word)


_wpm = 0


def update_wpm(word_count, duration_ms):
    global _wpm
    _wpm = word_count / (duration_ms / 60_000)  # FIX: Global use... blahhh


@app.post("/word/completed")
def post_completed_word_data(data: CompletedWordData) -> None:
    update_wpm(data.word_count, data.duration)
    for letter in data.word_letters_data:
        _letters[letter.letter].add_duration(letter.duration)
        if letter.miss:
            _letters[letter.letter].add_miss()
        update_letter_by_occurance(letter.letter)
        update_letter_by_error_freq(letter.letter)


@app.get("/stats")
def get_stats():
    return {"wpm": f"{_wpm:02.0f}"}


@app.get("/stats/letters")
def get_stats_letters() -> list[dict]:
    return [letter.as_dict() for letter in _letters.values()]


def _init():
    fill_words()


_init()

if __name__ == "__main__":
    uvicorn.run(app, port=5007)