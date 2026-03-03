const SIZE_CONFIG = {
  size1: { id: "size1", label: "🙂 Easy", cols: 4, rows: 3 },
  size2: { id: "size2", label: "😐 Medium", cols: 4, rows: 4 },
  size3: { id: "size3", label: "🌶️ Spicy", cols: 5, rows: 4 },
  size4: { id: "size4", label: "🔥 Hot", cols: 6, rows: 4 },
};

const SIZE_ORDER = ["size1", "size2", "size3", "size4"];

// IMPORTANT: No longer modify or reset these.
// These are the canonical layout definitions that clue sessions will reference and generate against.
const LAYOUTS = {
  size1: ["ABB!ACC*DDEE", "AA*!BBCDEECD", "AAB!CDB*CDEE", "ABC*ABC!DDEE"],
  size2: ["AA!*BBCDEECDFFGG", "AABBCC!*DEFGDEFG", "AA!BCD*BCDEEFFGG", "AAB!CCB*DEFFDEGG"],
  size3: ["AABB!CDEE*CDFFGHHIIG", "AABC*DDBC!EEFGHIIFGH", "ABCDDABC*!EFGHHEFGII", "ABBCCADE*FGDE!FGHHII"],
  size4: [
    "ABCCDDABEE*FGGHI!FJJHIKK",
    "AABC!*DDBCEEFFGGHIJJKKHI",
    "ABCCD*ABEED!FFGHIIJJGHKK",
    "AABB!CDDEF*CGGEFHHIIJJKK",
  ],
};

const LETTER_COLORS = {
  A: "#e53935",
  B: "#1e88e5",
  C: "#d81b60",
  D: "#43a047",
  E: "#fb8c00",
  F: "#8e24aa",
  G: "#00acc1",
  H: "#fdd835",
  I: "#3949ab",
  J: "#00897b",
  K: "#6d4c41",
};

const LETTER_SEQUENCE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const VALID_SYMBOL_REGEX = /^[A-K!*]$/;

const state = {
  sizeId: SIZE_ORDER[0],
  layoutIndex: 0,
  board: [],
  selectedIndex: null,
  isAnimatingSwap: false,
  pendingSizeHotkey: null,
  pendingSizeHotkeyTimer: null,
  phase: "clue_free",
  candidateLayoutIndexes: [],
  proposedLayoutIndex: null,
  clues: {
    freeIndex: null,
    wildIndex: null,
    pairs: [],
  },
  pendingPairFirstIndex: null,
  validSecondPairIndexes: new Set(),
  revealedByClue: new Map(),
  clueHistory: [],
  generatedLayoutText: "",
  generatedLayoutExistsIndex: null,
};

const sizeSelect = document.getElementById("size-select");
const layoutSelect = document.getElementById("layout-select");
const layoutControlEl = document.getElementById("layout-control");
const boardEl = document.getElementById("board");
const messageEl = document.getElementById("message");
const hotkeyPopupEl = document.getElementById("hotkey-popup");
const hotkeyPopupTextEl = document.getElementById("hotkey-popup-text");
const cluePanelEl = document.getElementById("clue-panel");
const cluePromptEl = document.getElementById("clue-prompt");
const candidateCountEl = document.getElementById("candidate-count");
const proposedLayoutLabelEl = document.getElementById("proposed-layout-label");
const useProposedButton = document.getElementById("use-proposed");
const clueBackButton = document.getElementById("clue-back");
const clueRestartButton = document.getElementById("clue-restart");
const generatedLayoutEl = document.getElementById("generated-layout");

function parseLayout(layoutString) {
  return layoutString.split("");
}

function validateLayout(layoutString, rows, cols) {
  if (typeof layoutString !== "string") {
    return false;
  }

  if (layoutString.length !== rows * cols) {
    return false;
  }

  for (const symbol of layoutString) {
    if (!VALID_SYMBOL_REGEX.test(symbol)) {
      return false;
    }
  }
  return true;
}

function toGridTemplate(cols) {
  return `repeat(${cols}, minmax(56px, 1fr))`;
}

function clearMessage() {
  messageEl.textContent = "";
}

function setMessage(text) {
  messageEl.textContent = text;
}

function showHotkeyPopup(text) {
  hotkeyPopupTextEl.textContent = text;
  hotkeyPopupEl.classList.add("visible");
  hotkeyPopupEl.setAttribute("aria-hidden", "false");
}

function hideHotkeyPopup() {
  hotkeyPopupEl.classList.remove("visible");
  hotkeyPopupEl.setAttribute("aria-hidden", "true");
}

function clearPendingSizeHotkey() {
  state.pendingSizeHotkey = null;
  if (state.pendingSizeHotkeyTimer !== null) {
    window.clearTimeout(state.pendingSizeHotkeyTimer);
    state.pendingSizeHotkeyTimer = null;
  }
  hideHotkeyPopup();
}

function getLayoutsForSize(sizeId) {
  return LAYOUTS[sizeId] || [];
}

function getValidLayoutIndexesForSize(sizeId) {
  const size = SIZE_CONFIG[sizeId];
  if (!size) {
    return [];
  }

  return getLayoutsForSize(sizeId)
    .map((layout, index) => ({ layout, index }))
    .filter(({ layout }) => validateLayout(layout, size.rows, size.cols))
    .map(({ index }) => index);
}

function getLayoutString(sizeId, layoutIndex) {
  const layouts = getLayoutsForSize(sizeId);
  if (layoutIndex < 0 || layoutIndex >= layouts.length) {
    return null;
  }
  return layouts[layoutIndex];
}

function getLayoutSymbols(sizeId, layoutIndex) {
  const layoutString = getLayoutString(sizeId, layoutIndex);
  if (!layoutString) {
    return [];
  }
  return parseLayout(layoutString);
}

function getCellColor(symbol) {
  if (symbol === "!" || symbol === "*") {
    return "";
  }
  return LETTER_COLORS[symbol] || "#666";
}

function getCellDisplay(symbol) {
  if (symbol === "*") return "⭐";
  if (symbol === "!") return "😈";
  return symbol;
}

function getProposedIconColor(symbol) {
  if (symbol === "*") return "#d0a400";
  if (symbol === "!") return "#7d4ce0";
  return getCellColor(symbol) || "#35577c";
}

function getCardClass(symbol) {
  if (symbol === "!") return "wild";
  if (symbol === "*") return "free";
  return "";
}

function getOrthogonalNeighbors(index, rows, cols) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const neighbors = [];

  if (row > 0) neighbors.push(index - cols);
  if (row < rows - 1) neighbors.push(index + cols);
  if (col > 0) neighbors.push(index - 1);
  if (col < cols - 1) neighbors.push(index + 1);

  return neighbors;
}

function isOrthogonallyAdjacent(a, b, rows, cols) {
  return getOrthogonalNeighbors(a, rows, cols).includes(b);
}

function getValidWildIndexes() {
  const size = SIZE_CONFIG[state.sizeId];
  if (!size || state.clues.freeIndex === null) {
    return new Set();
  }

  return new Set(getOrthogonalNeighbors(state.clues.freeIndex, size.rows, size.cols));
}

function populateSizeSelect() {
  sizeSelect.innerHTML = "";
  for (const sizeId of SIZE_ORDER) {
    const size = SIZE_CONFIG[sizeId];
    const option = document.createElement("option");
    option.value = sizeId;
    option.textContent = size.label;
    sizeSelect.append(option);
  }
  sizeSelect.value = state.sizeId;
}

function populateLayoutSelect() {
  layoutSelect.innerHTML = "";
  const layouts = getLayoutsForSize(state.sizeId);

  if (layouts.length === 0) {
    const option = document.createElement("option");
    option.value = "-1";
    option.textContent = "No layouts available";
    layoutSelect.append(option);
    layoutSelect.disabled = true;
    state.layoutIndex = -1;
    return;
  }

  layouts.forEach((_, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `Layout ${index + 1}`;
    layoutSelect.append(option);
  });

  layoutSelect.disabled = false;
  if (state.layoutIndex < 0 || state.layoutIndex >= layouts.length) {
    state.layoutIndex = 0;
  }
  layoutSelect.value = String(state.layoutIndex);
}

function getLetterFromIndex(index) {
  if (index < LETTER_SEQUENCE.length) {
    return LETTER_SEQUENCE[index];
  }
  return `X${index + 1}`;
}

function canonicalizeFlatSymbols(symbols) {
  const map = new Map();
  let next = 0;

  return symbols.map((symbol) => {
    if (symbol === "*" || symbol === "!") {
      return symbol;
    }

    if (!map.has(symbol)) {
      map.set(symbol, getLetterFromIndex(next));
      next += 1;
    }

    return map.get(symbol);
  });
}

function buildLayoutStringFromCluesIfComplete() {
  const size = SIZE_CONFIG[state.sizeId];
  if (!size) {
    return null;
  }

  const totalCards = size.rows * size.cols;
  const filled = new Array(totalCards).fill(null);

  if (state.clues.freeIndex !== null) {
    filled[state.clues.freeIndex] = "*";
  }
  if (state.clues.wildIndex !== null) {
    filled[state.clues.wildIndex] = "!";
  }

  const sortedPairs = [...state.clues.pairs].sort((a, b) => a.id - b.id);
  sortedPairs.forEach((pair) => {
    const token = `pair:${pair.id}`;
    filled[pair.a] = token;
    filled[pair.b] = token;
  });

  if (filled.some((value) => value === null)) {
    return null;
  }

  return canonicalizeFlatSymbols(filled).join("");
}

function findExistingEquivalentLayoutIndex(generatedLayoutString) {
  const validIndexes = getValidLayoutIndexesForSize(state.sizeId);

  for (const layoutIndex of validIndexes) {
    const symbols = getLayoutSymbols(state.sizeId, layoutIndex);
    const canonicalExisting = canonicalizeFlatSymbols(symbols).join("");
    if (canonicalExisting === generatedLayoutString) {
      return layoutIndex;
    }
  }

  return null;
}

function ensureGeneratedLayoutAvailableForSession(generatedLayoutString) {
  const existingIndex = findExistingEquivalentLayoutIndex(generatedLayoutString);
  if (existingIndex !== null) {
    return { index: existingIndex, added: false };
  }

  const layouts = getLayoutsForSize(state.sizeId);
  layouts.push(generatedLayoutString);
  return { index: layouts.length - 1, added: true };
}

function updateGeneratedLayoutState(generatedLayoutString, ensuredLayout) {
  if (!generatedLayoutString) {
    state.generatedLayoutText = "";
    state.generatedLayoutExistsIndex = null;
    return;
  }

  state.generatedLayoutExistsIndex = ensuredLayout.index;
  state.generatedLayoutText = `"${generatedLayoutString}",`;
}

function resetClueState() {
  state.phase = "clue_free";
  state.board = [];
  state.selectedIndex = null;
  state.isAnimatingSwap = false;
  state.candidateLayoutIndexes = [];
  state.proposedLayoutIndex = null;
  state.clues = {
    freeIndex: null,
    wildIndex: null,
    pairs: [],
  };
  state.pendingPairFirstIndex = null;
  state.validSecondPairIndexes = new Set();
  state.revealedByClue = new Map();
  state.clueHistory = [];
  state.generatedLayoutText = "";
  state.generatedLayoutExistsIndex = null;
}

function startClueSession() {
  resetClueState();
  populateLayoutSelect();
  evaluateCluesAndTransition();
}

function filterCandidateLayouts() {
  const size = SIZE_CONFIG[state.sizeId];
  if (!size) {
    return [];
  }

  const freeIndex = state.clues.freeIndex;
  const wildIndex = state.clues.wildIndex;

  return getValidLayoutIndexesForSize(state.sizeId).filter((layoutIndex) => {
    const symbols = getLayoutSymbols(state.sizeId, layoutIndex);

    if (freeIndex !== null && symbols[freeIndex] !== "*") {
      return false;
    }

    if (wildIndex !== null && symbols[wildIndex] !== "!") {
      return false;
    }

    if (
      freeIndex !== null &&
      wildIndex !== null &&
      !isOrthogonallyAdjacent(freeIndex, wildIndex, size.rows, size.cols)
    ) {
      return false;
    }

    for (const pair of state.clues.pairs) {
      if (!isOrthogonallyAdjacent(pair.a, pair.b, size.rows, size.cols)) {
        return false;
      }
      if (symbols[pair.a] !== symbols[pair.b]) {
        return false;
      }
      if (symbols[pair.a] === "*" || symbols[pair.a] === "!") {
        return false;
      }
    }

    return true;
  });
}

function computeBasePhaseFromClues() {
  if (state.clues.freeIndex === null) {
    return "clue_free";
  }
  if (state.clues.wildIndex === null) {
    return "clue_wild";
  }
  return "clue_pair_first";
}

function loadResolvedBoard(layoutIndex) {
  state.layoutIndex = layoutIndex;
  layoutSelect.value = String(layoutIndex);
  state.board = getLayoutSymbols(state.sizeId, layoutIndex);
  state.phase = "resolved";
  state.selectedIndex = null;
  state.pendingPairFirstIndex = null;
  state.validSecondPairIndexes = new Set();
  setMessage(`Using Layout ${layoutIndex + 1}. You can now swap cards.`);
}

function evaluateCluesAndTransition() {
  state.candidateLayoutIndexes = filterCandidateLayouts();
  state.proposedLayoutIndex = state.candidateLayoutIndexes.length > 0 ? state.candidateLayoutIndexes[0] : null;

  if (state.pendingPairFirstIndex !== null) {
    state.phase = "clue_pair_second";
  } else {
    state.phase = computeBasePhaseFromClues();
  }

  const generatedLayoutString = buildLayoutStringFromCluesIfComplete();
  if (generatedLayoutString) {
    const ensuredLayout = ensureGeneratedLayoutAvailableForSession(generatedLayoutString);
    state.candidateLayoutIndexes = filterCandidateLayouts();
    state.proposedLayoutIndex =
      state.candidateLayoutIndexes.length > 0 ? state.candidateLayoutIndexes[0] : ensuredLayout.index;
    state.phase = "clue_complete";
    updateGeneratedLayoutState(generatedLayoutString, ensuredLayout);
    populateLayoutSelect();
    layoutSelect.value = String(ensuredLayout.index);
    if (ensuredLayout.added) {
      setMessage(`Added this layout as Layout ${ensuredLayout.index + 1} for this session.`);
    } else {
      clearMessage();
    }
    render();
    return;
  }

  updateGeneratedLayoutState(null, null);

  if (state.candidateLayoutIndexes.length === 0) {
    setMessage("No current layout matches these clues yet. Continue adding pairs.");
  } else if (state.candidateLayoutIndexes.length === 1) {
    clearMessage();
  }

  render();
}

function shouldBlockPairFirstSelection(index) {
  if (index === state.clues.freeIndex || index === state.clues.wildIndex) {
    return true;
  }
  return state.revealedByClue.has(index);
}

function beginPairSelection(firstIndex) {
  const size = SIZE_CONFIG[state.sizeId];
  if (!size) {
    return;
  }

  const neighbors = getOrthogonalNeighbors(firstIndex, size.rows, size.cols);
  const valid = neighbors.filter((neighborIndex) => {
    if (neighborIndex === state.clues.freeIndex || neighborIndex === state.clues.wildIndex) {
      return false;
    }
    return !state.revealedByClue.has(neighborIndex);
  });

  if (valid.length === 0) {
    setMessage("No valid adjacent card from that position. Pick another first card.");
    return;
  }

  state.pendingPairFirstIndex = firstIndex;
  state.validSecondPairIndexes = new Set(valid);
  state.phase = "clue_pair_second";
  clearMessage();
  render();
}

function commitPair(secondIndex) {
  const firstIndex = state.pendingPairFirstIndex;
  if (firstIndex === null) {
    return;
  }

  const pairId = state.clues.pairs.length + 1;
  const pair = { a: firstIndex, b: secondIndex, id: pairId };

  state.clues.pairs.push(pair);
  state.clueHistory.push({ type: "pair", pair });
  state.revealedByClue.set(firstIndex, `pair:${pairId}`);
  state.revealedByClue.set(secondIndex, `pair:${pairId}`);

  state.pendingPairFirstIndex = null;
  state.validSecondPairIndexes = new Set();
  evaluateCluesAndTransition();
}

function onClueCardActivate(index) {
  if (state.phase === "clue_complete") {
    return;
  }

  if (state.phase === "clue_free") {
    state.clues.freeIndex = index;
    state.clueHistory.push({ type: "free", index });
    state.revealedByClue.set(index, "free");
    evaluateCluesAndTransition();
    return;
  }

  if (state.phase === "clue_wild") {
    const validWildIndexes = getValidWildIndexes();
    if (index === state.clues.freeIndex) {
      setMessage("Wild card cannot be the same as Free card.");
      return;
    }
    if (!validWildIndexes.has(index)) {
      setMessage("Wild must be adjacent to Free.");
      return;
    }

    state.clues.wildIndex = index;
    state.clueHistory.push({ type: "wild", index });
    state.revealedByClue.set(index, "wild");
    evaluateCluesAndTransition();
    return;
  }

  if (state.phase === "clue_pair_first") {
    if (shouldBlockPairFirstSelection(index)) {
      setMessage("That card is already assigned. Choose another card.");
      return;
    }
    beginPairSelection(index);
    return;
  }

  if (state.phase === "clue_pair_second") {
    if (index === state.pendingPairFirstIndex) {
      state.pendingPairFirstIndex = null;
      state.validSecondPairIndexes = new Set();
      state.phase = "clue_pair_first";
      clearMessage();
      render();
      return;
    }

    if (!state.validSecondPairIndexes.has(index)) {
      return;
    }

    commitPair(index);
  }
}

function swapBoardPositions(firstIndex, secondIndex) {
  const temp = state.board[firstIndex];
  state.board[firstIndex] = state.board[secondIndex];
  state.board[secondIndex] = temp;
}

function onResolvedCardActivate(index) {
  if (state.isAnimatingSwap) {
    return;
  }

  if (state.selectedIndex === null) {
    state.selectedIndex = index;
    renderBoard();
    return;
  }

  if (state.selectedIndex === index) {
    state.selectedIndex = null;
    renderBoard();
    return;
  }

  const firstIndex = state.selectedIndex;
  state.selectedIndex = null;
  animateSwap(firstIndex, index);
}

function onCardActivate(index) {
  if (state.phase === "resolved") {
    onResolvedCardActivate(index);
    return;
  }

  onClueCardActivate(index);
}

async function animateSwap(firstIndex, secondIndex) {
  const firstEl = boardEl.querySelector(`[data-index="${firstIndex}"]`);
  const secondEl = boardEl.querySelector(`[data-index="${secondIndex}"]`);

  if (!firstEl || !secondEl) {
    swapBoardPositions(firstIndex, secondIndex);
    renderBoard();
    return;
  }

  state.isAnimatingSwap = true;
  firstEl.classList.remove("selected");

  const firstRect = firstEl.getBoundingClientRect();
  const secondRect = secondEl.getBoundingClientRect();
  const dx = secondRect.left - firstRect.left;
  const dy = secondRect.top - firstRect.top;
  const timing = { duration: 220, easing: "ease-in-out", fill: "forwards" };

  const firstAnimation = firstEl.animate(
    [
      { transform: "translate(0px, 0px)", zIndex: 6 },
      { transform: `translate(${dx}px, ${dy}px)`, zIndex: 6 },
    ],
    timing,
  );

  const secondAnimation = secondEl.animate(
    [
      { transform: "translate(0px, 0px)", zIndex: 6 },
      { transform: `translate(${-dx}px, ${-dy}px)`, zIndex: 6 },
    ],
    timing,
  );

  await Promise.allSettled([firstAnimation.finished, secondAnimation.finished]);

  swapBoardPositions(firstIndex, secondIndex);
  renderBoard();
  state.isAnimatingSwap = false;
}

function getPromptText() {
  if (state.phase === "clue_free") {
    return "1) Where is the Free space?";
  }
  if (state.phase === "clue_wild") {
    return "2) Where is the Wild space? (Must be adjacent to Free.)";
  }
  if (state.phase === "clue_pair_first") {
    return "3) Where is one pair? Select first card.";
  }
  if (state.phase === "clue_pair_second") {
    return "3) Select adjacent matching card. Click selected card again to cancel.";
  }
  if (state.phase === "clue_complete") {
    return "Board is fully specified. Use proposed layout or copy generated layout below.";
  }
  return "Layout chosen. You can now swap cards.";
}

function renderCluePanel() {
  const inCluePhase = state.phase !== "resolved";
  cluePanelEl.hidden = !inCluePhase;
  layoutControlEl.classList.toggle("layout-hidden", inCluePhase);

  if (!inCluePhase) {
    return;
  }

  cluePromptEl.textContent = getPromptText();
  candidateCountEl.textContent = `Candidate layouts: ${state.candidateLayoutIndexes.length}`;

  if (state.proposedLayoutIndex === null) {
    proposedLayoutLabelEl.textContent = "Proposed layout: none";
  } else {
    proposedLayoutLabelEl.textContent = `Proposed layout: Layout ${state.proposedLayoutIndex + 1}`;
  }

  useProposedButton.disabled = state.proposedLayoutIndex === null;
  clueBackButton.disabled = state.clueHistory.length === 0;

  generatedLayoutEl.hidden = state.generatedLayoutText === "";
  generatedLayoutEl.textContent = state.generatedLayoutText;
}

function getClueTokenAtIndex(index) {
  return state.revealedByClue.get(index) || null;
}

function shouldDisableClueCard(index) {
  if (state.phase === "clue_complete") {
    return true;
  }

  if (state.phase === "clue_wild") {
    return !getValidWildIndexes().has(index);
  }

  if (state.phase === "clue_pair_first") {
    return shouldBlockPairFirstSelection(index);
  }

  if (state.phase === "clue_pair_second") {
    if (index === state.pendingPairFirstIndex) {
      return false;
    }
    return !state.validSecondPairIndexes.has(index);
  }

  return false;
}

function renderBoard() {
  boardEl.innerHTML = "";

  const size = SIZE_CONFIG[state.sizeId];
  if (!size) {
    boardEl.style.setProperty("--grid-template", toGridTemplate(4));
    return;
  }

  boardEl.style.setProperty("--grid-template", toGridTemplate(size.cols));
  boardEl.setAttribute("role", "grid");
  sizeBoard();

  const totalCards = size.rows * size.cols;
  const isResolved = state.phase === "resolved";
  const shouldShowProposedIcons =
    !isResolved && state.candidateLayoutIndexes.length === 1 && state.proposedLayoutIndex !== null;
  const proposedSymbols = shouldShowProposedIcons ? getLayoutSymbols(state.sizeId, state.proposedLayoutIndex) : [];

  for (let index = 0; index < totalCards; index += 1) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    card.dataset.index = String(index);
    card.setAttribute("role", "gridcell");

    if (isResolved) {
      const symbol = state.board[index];
      const typeClass = getCardClass(symbol);
      if (typeClass) {
        card.classList.add(typeClass);
      }
      if (state.selectedIndex === index) {
        card.classList.add("selected");
      }
      const color = getCellColor(symbol);
      if (color) {
        card.style.setProperty("--card-color", color);
      }
      card.textContent = getCellDisplay(symbol);
      card.setAttribute("aria-label", `Card ${symbol} at position ${index + 1}`);
    } else {
      const clueToken = getClueTokenAtIndex(index);
      const validWildIndexes = state.phase === "clue_wild" ? getValidWildIndexes() : null;

      if (clueToken === null) {
        card.classList.add("facedown");
        card.textContent = "?";
      } else if (clueToken === "free") {
        card.classList.add("free");
        card.textContent = "⭐";
      } else if (clueToken === "wild") {
        card.classList.add("wild");
        card.textContent = "😈";
      } else {
        const pairId = Number(clueToken.split(":")[1] || "0");
        card.classList.add("pair-clue");
        card.textContent = `P${pairId}`;
      }

      if (state.phase === "clue_pair_second") {
        if (index === state.pendingPairFirstIndex) {
          card.classList.add("selected");
        } else if (state.validSecondPairIndexes.has(index)) {
          card.classList.add("valid-target");
        } else {
          card.classList.add("blocked");
        }
      } else if (state.phase === "clue_wild" && validWildIndexes) {
        if (validWildIndexes.has(index)) {
          card.classList.add("valid-target");
        } else {
          card.classList.add("blocked");
        }
      }

      const disabled = shouldDisableClueCard(index);
      card.disabled = disabled;
      if (disabled && state.phase !== "clue_pair_second") {
        card.classList.add("blocked");
      }
      card.setAttribute("aria-label", `Clue card position ${index + 1}`);

      if (proposedSymbols.length === totalCards) {
        const proposedIcon = document.createElement("span");
        proposedIcon.className = "proposed-icon";
        const proposedSymbol = proposedSymbols[index];
        proposedIcon.textContent = getCellDisplay(proposedSymbol);
        proposedIcon.style.setProperty("--proposed-color", getProposedIconColor(proposedSymbol));
        proposedIcon.setAttribute("aria-hidden", "true");
        card.append(proposedIcon);
      }
    }

    card.addEventListener("click", () => onCardActivate(index));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onCardActivate(index);
      }
    });

    boardEl.append(card);
  }
}

function render() {
  renderCluePanel();
  renderBoard();
}

function undoLastClue() {
  if (state.clueHistory.length === 0) {
    return;
  }

  const last = state.clueHistory.pop();
  state.pendingPairFirstIndex = null;
  state.validSecondPairIndexes = new Set();

  if (last.type === "free") {
    state.revealedByClue.delete(last.index);
    state.clues.freeIndex = null;
  } else if (last.type === "wild") {
    state.revealedByClue.delete(last.index);
    state.clues.wildIndex = null;
  } else if (last.type === "pair") {
    state.revealedByClue.delete(last.pair.a);
    state.revealedByClue.delete(last.pair.b);
    state.clues.pairs = state.clues.pairs.filter((pair) => pair.id !== last.pair.id);
  }

  clearMessage();
  evaluateCluesAndTransition();
}

function onUseProposedLayout() {
  if (state.proposedLayoutIndex === null) {
    return;
  }
  loadResolvedBoard(state.proposedLayoutIndex);
  render();
}

function onSizeChange() {
  clearPendingSizeHotkey();
  state.sizeId = sizeSelect.value;
  clearMessage();
  startClueSession();
}

function onLayoutChange() {
  const selectedIndex = Number(layoutSelect.value);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) {
    return;
  }

  if (state.phase !== "resolved") {
    return;
  }

  const symbols = getLayoutSymbols(state.sizeId, selectedIndex);
  if (symbols.length === 0) {
    return;
  }

  state.layoutIndex = selectedIndex;
  state.board = symbols;
  state.selectedIndex = null;
  clearMessage();
  renderBoard();
}

function onRestartClues() {
  clearMessage();
  startClueSession();
}

function sizeBoard() {
  const size = SIZE_CONFIG[state.sizeId];
  if (!size) {
    return;
  }

  const boardWrap = boardEl.parentElement;
  if (!boardWrap) {
    return;
  }

  const styles = window.getComputedStyle(boardEl);
  const gap = Number.parseFloat(styles.gap) || 0;
  const availableWidth = Math.max(0, boardWrap.clientWidth - gap * (size.cols - 1));
  const availableHeight = Math.max(0, boardWrap.clientHeight - gap * (size.rows - 1));
  const cardSize = Math.max(36, Math.floor(Math.min(availableWidth / size.cols, availableHeight / size.rows)));
  boardEl.style.setProperty("--card-size", `${cardSize}px`);
}

function onGlobalKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const tagName = event.target && event.target.tagName ? event.target.tagName : "";
  if (tagName === "INPUT" || tagName === "TEXTAREA") {
    return;
  }

  const key = event.key;
  if (!/^[1-4]$/.test(key)) {
    clearPendingSizeHotkey();
    return;
  }

  event.preventDefault();
  const targetSizeId = SIZE_ORDER[Number(key) - 1];
  if (!targetSizeId) {
    clearPendingSizeHotkey();
    return;
  }

  if (state.pendingSizeHotkey === key) {
    clearPendingSizeHotkey();
    state.sizeId = targetSizeId;
    sizeSelect.value = targetSizeId;
    clearMessage();
    startClueSession();
    return;
  }

  state.pendingSizeHotkey = key;
  if (state.pendingSizeHotkeyTimer !== null) {
    window.clearTimeout(state.pendingSizeHotkeyTimer);
  }
  state.pendingSizeHotkeyTimer = window.setTimeout(() => {
    clearPendingSizeHotkey();
  }, 2200);

  if (state.sizeId === targetSizeId) {
    showHotkeyPopup(`Press ${key} again to restart clues for this size.`);
    return;
  }

  showHotkeyPopup(`Press ${key} again to switch to size ${SIZE_CONFIG[targetSizeId].label}.`);
}

function init() {
  populateSizeSelect();
  startClueSession();

  sizeSelect.addEventListener("change", onSizeChange);
  layoutSelect.addEventListener("change", onLayoutChange);
  useProposedButton.addEventListener("click", onUseProposedLayout);
  clueBackButton.addEventListener("click", undoLastClue);
  clueRestartButton.addEventListener("click", onRestartClues);
  window.addEventListener("resize", sizeBoard);
  window.addEventListener("keydown", onGlobalKeydown);
}

init();
