import sendRequestToBackend from "./backend_gateway.js";

const SPACER_CHAR = "\u00a0";
const INITIAL_WORD_COUND = 16;
const TOTAL_WORDS_ON_UPDATE = 8;
const MODIFIER_KEYS = ["Control", "Alt", "Shift", "Meta", "Tab", "Escape"];

const content = document.getElementById("content");

// cursor keeps track of the furthest position reached.
let cursor = 0;
let maxCursor = 0;

// track the current active text elements
let currentWord;
let currentLetter;

// use text element relative indexes to avoid unneccessary DOM queries and make guten blazingly fast.
let currentWordIndex;
let currentLetterIndex;

// keep track of the word time start;
let wordTimeStart = null;
let letterTimeStart = null;
let currentStats = {
    wpm: 0,
};

// main function
await main();

// sliders
const sp = document.getElementById("sp");
const menu = document.getElementById("menu");

//
content.onmouseover = function () {
    content.style.cursor = "none";
    content.classList.remove("blur");
    sp.style.opacity = 0;
    sp.style.transition = "opacity .2s";

    menu.style.opacity = 0;
    menu.style.transition = "opacity .2s";
};

content.onmouseleave = function () {
    content.classList.add("blur");
    sp.style.opacity = 1;
    sp.style.transition = "opacity .2s";

    menu.style.opacity = 1;
    menu.style.transition = "opacity .2s";
};
async function handleKeyDownEvent(event) {
    {
        if (MODIFIER_KEYS.includes(event.key)) {
            if (event.key === "Escape") {
                await init();
            }
            console.log(`modifier key pressed: ${event.key}`);
        } else if (event.code === "Backspace") {
            setCurrentIndexesToPreviousLetter();
            updateActiveElements();
            letterTimeStart = Date.now();

            currentLetter.classList.remove("correct", "incorrect", "typed");
            cursor--;
            if (
                currentWord.nextElementSibling.offsetLeft ===
                    content.offsetLeft &&
                currentLetter ===
                    currentWord.children[currentWord.children.length - 1]
            ) {
                scrollContentToCenterWord();
            }
        } else {
            // update backend when word is completed typing
            currentLetter.classList.add("typed");
            console.log(`${currentLetter.textContent}, ${currentLetter.innerText}`)
            if (event.key === currentLetter.textContent || (event.key === ' ' && currentLetter.textContent === SPACER_CHAR)) {
                currentLetter.classList.add("correct");
            } else {
                currentLetter.classList.add("incorrect", "miss");
            }
            currentLetter.duration = Date.now() - letterTimeStart;
            letterTimeStart = Date.now();

            //handle last letter of word.
            console.log(
                `${currentWord.children.length}, ${currentLetterIndex}`,
            );
            await onLetterCompleted();
        }
        console.log(
            `${event.key} (${event.code}), ${currentWordIndex}:${currentLetterIndex}, ${cursor}, ${maxCursor}`,
        );

        await updateContentIfNeeded(event);
    }
}
async function onLetterCompleted() {
    if (
        currentLetterIndex === currentWord.children.length - 1 &&
        !currentWord.classList.contains("spacer") &&
        cursor === maxCursor
    ) {
        await sendWordCompletedStatus(currentWordIndex);
        await updateStats();
    }
    setCurrentIndexesToNextLetter();
    updateActiveElements();
    if (
        currentWord.offsetLeft === content.offsetLeft &&
        currentLetterIndex === 0
    ) {
        scrollContentToCenterWord();
    }
    incrementMaxCursorIfNeeded(cursor);
    cursor++;
}

function incrementMaxCursorIfNeeded(cursor) {
    maxCursor = cursor === maxCursor ? maxCursor + 1 : maxCursor;
}

async function updateContentIfNeeded(keyDownEvent) {
    console.log(
        `${currentWordIndex % TOTAL_WORDS_ON_UPDATE === 0}, ${currentLetterIndex}, ${cursor}, ${maxCursor}`,
    );
    if (
        currentWordIndex % TOTAL_WORDS_ON_UPDATE === 0 &&
        currentLetterIndex === 0 &&
        keyDownEvent.key !== "Backspace" &&
        cursor === maxCursor
    ) {
        await addWordsToContent(TOTAL_WORDS_ON_UPDATE);
    }
}
async function main() {
    content.focus();
    await init();
    content.addEventListener("keydown", handleKeyDownEvent);
}

async function init() {
    wordTimeStart = Date.now();
    content.innerHTML = "";
    currentWordIndex = 0;
    currentLetterIndex = 0;

    await addWordsToContent(INITIAL_WORD_COUND);

    currentWord = content.firstElementChild;
    currentWord.classList.add("active");

    currentLetter = currentWord.firstElementChild;
    currentLetter.classList.add("active");
}

function updateActiveElements() {
    // remove active status from current text elements.
    currentLetter.classList.remove("active");
    currentWord.classList.remove("active");

    // update current text elements based on calculated index.
    currentWord = content.children[currentWordIndex];
    currentLetter = currentWord.children[currentLetterIndex];

    // add active statur to new current text elements.
    currentLetter.classList.add("active");
    currentWord.classList.add("active");
}

function setCurrentIndexesToNextLetter() {
    currentLetterIndex++;
    if (currentLetterIndex >= currentWord.children.length) {
        currentLetterIndex = 0;
        currentWordIndex++;
    }
}

function setCurrentIndexesToPreviousLetter() {
    const contentElement = document.getElementById("content");
    currentLetterIndex--;
    if (currentLetterIndex < 0) {
        if (currentWordIndex === 0) {
            currentWordIndex = 0;
            currentLetterIndex = 0;
        } else {
            currentWordIndex--;
            currentLetterIndex =
                contentElement.children[currentWordIndex].children.length - 1;
        }
    }
}

function scrollContentToCenterWord() {
    currentWord.scrollIntoView({
        behavior: "smooth",
        block: "center",
    });
}

function createLetterElement(letter) {
    const letterElement = document.createElement("letter");
    letterElement.className = "letter";
    letterElement.textContent = letter;
    return letterElement;
}

async function createWordElement(word) {
    const wordElement = document.createElement("div");
    wordElement.className = "word";
    wordElement.word = word;
    for (const letter of word) {
        const letterElement = createLetterElement(letter);
        wordElement.appendChild(letterElement);
    }
    wordElement.appendChild(createLetterElement(SPACER_CHAR));
    return wordElement;
}

async function addWordsToContent(wordCount) {
    const contentElement = document.getElementById("content");
    let words;
    try {
        words = await getNewWordsByCount(wordCount);
    } catch (error) {
        console.error(`error fetching words: ${error}`);
    }
    for (const word of words) {
        const wordElement = await createWordElement(word);
        contentElement.appendChild(wordElement);
    }
}

async function updateStats() {
    try {
        currentStats = await getUpdatedStats();
    } catch (error) {
        console.warn(`counld not update stats.`);
    }
    const wpmElement = document.getElementById("wpm");
    wpmElement.innerText = currentStats.wpm;
}

async function getUpdatedStats() {
    const route = `stats`;
    try {
        const stats = await sendRequestToBackend(route);
        console.log(`stats update: ${stats}`);
        return stats;
    } catch (error) {
        console.log(`could not update stats`);
    }
}
async function getNewWordsByCount(wordCount) {
    const route = `words?n=${wordCount}`;
    try {
        const words = await sendRequestToBackend(route);
        console.log(`added new words: [${words}].`);
        return words;
    } catch (error) {
        console.error(`${error}`);
    }
}

async function sendWordCompletedStatus(wordIndex) {
    const route = `word/completed`;
    const word = content.children[wordIndex];
    const wordLettersData = [];
    for (const letter of word.children) {
        if (letter.innerHTML === "&nbsp;"){
            continue
        }
        wordLettersData.push({
            letter: letter.innerHTML,
            duration: letter.duration,
            miss: letter.classList.contains("miss"),
        });
    }
    const data = {
        word_count: wordIndex,
        duration: Date.now() - wordTimeStart,
        word_letters_data: wordLettersData,
    };
    console.log(`complted: ${JSON.stringify(data)}`);
    try {
        await sendRequestToBackend(route, "POST", data);
    } catch (error) {
        console.error(`failed to send word completed update.`);
    }
}


async function sendMisspelledWord(wordIndex) {
    const route = `word/incorrect`;
    const data = {
        word: content.children[wordIndex].word,
    };
    try {
        await sendRequestToBackend(route, "POST", data);
    } catch (error) {
        console.error(`failed to sent misspelled word "${word}" to backend.`);
    }
}
