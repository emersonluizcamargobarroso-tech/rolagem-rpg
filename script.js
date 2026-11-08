
"use strict";

/* =========================================
   ROLAGEM RPG — CONFIGURAÇÕES
========================================= */

const DICE_TYPES = [2, 4, 6, 8, 10, 12, 20, 100];
const MAX_PER_TYPE = 1000;
const HISTORY_LIMIT = 10;
const STORAGE_KEY = "rolagemRPG_v1";

const DEFAULT_STATE = {
  quantities: {
    2: 0,
    4: 0,
    6: 0,
    8: 0,
    10: 0,
    12: 0,
    20: 0,
    100: 0
  },
  cut: 70,
  history: []
};

let state = loadState();
let selectedHistoryId = null;
let pressTimer = null;
let pressTarget = null;
let pressStartX = 0;
let pressStartY = 0;
let pressTriggered = false;

/* =========================================
   ELEMENTOS DA INTERFACE
========================================= */

const quantityInputs = DICE_TYPES.map(faces => ({
  faces,
  input: document.getElementById(`quantity-d${faces}`)
}));

const selectedCountElement = document.getElementById("selected-count");
const rollButton = document.getElementById("roll-button");

const resultSection = document.getElementById("result-section");
const resultTotal = document.getElementById("result-total");
const resultDetails = document.getElementById("result-details");
const resultDiceCount = document.getElementById("result-dice-count");

const historyList = document.getElementById("history-list");

const settingsDialog = document.getElementById("settings-dialog");
const historyMenuDialog = document.getElementById("history-menu-dialog");
const cutSelect = document.getElementById("cut-select");

/* =========================================
   ARMAZENAMENTO LOCAL
========================================= */

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

    if (!saved || typeof saved !== "object") {
      return structuredClone(DEFAULT_STATE);
    }

    const quantities = {};

    for (const faces of DICE_TYPES) {
      const value = Number(saved.quantities?.[faces] ?? 0);

      quantities[faces] = Number.isInteger(value)
        ? Math.max(0, Math.min(MAX_PER_TYPE, value))
        : 0;
    }

    const validCuts = [30, 50, 60, 70, 80, 90, 100];

    const cut = validCuts.includes(Number(saved.cut))
      ? Number(saved.cut)
      : DEFAULT_STATE.cut;

    const history = Array.isArray(saved.history)
      ? saved.history
          .filter(item =>
            item &&
            typeof item.id === "string" &&
            Number.isSafeInteger(item.total) &&
            item.total >= 0 &&
            Number.isInteger(item.diceCount) &&
            Array.isArray(item.groups) &&
            item.groups.every(group =>
              Number.isInteger(group.faces) &&
              DICE_TYPES.includes(group.faces) &&
              Number.isInteger(group.count) &&
              group.count > 0
            )
          )
          .slice(0, HISTORY_LIMIT)
      : [];

    return { quantities, cut, history };

  } catch (error) {
    console.warn("Não foi possível carregar os dados salvos.", error);
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Não foi possível salvar os dados.", error);
    alert("Não foi possível salvar os dados neste dispositivo.");
  }
}

/* =========================================
   ALEATORIEDADE CRIPTOGRÁFICA
========================================= */

function randomInteger(min, max) {
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    max < min
  ) {
    throw new Error("Intervalo aleatório inválido.");
  }

  if (min === max) return min;

  if (!globalThis.crypto?.getRandomValues) {
    throw new Error(
      "Este navegador não oferece aleatoriedade criptográfica segura."
    );
  }

  const range = max - min + 1;
  const universe = 4294967296;
  const limit = Math.floor(universe / range) * range;
  const buffer = new Uint32Array(1);

  let value;

  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);

  return min + (value % range);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInteger(0, i);
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

/* =========================================
   LEITURA E VALIDAÇÃO DOS DADOS
========================================= */

function getSelectedDice() {
  const dice = [];

  for (const { faces, input } of quantityInputs) {
    const rawValue = input.value.trim();
    const quantity = Number(rawValue);

    if (
      rawValue === "" ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > MAX_PER_TYPE
    ) {
      throw new Error(
        `A quantidade de D${faces} deve ser um número inteiro entre 0 e ${MAX_PER_TYPE}.`
      );
    }

    for (let i = 0; i < quantity; i++) {
      dice.push({ faces });
    }
  }

  return dice;
}

function updateSelectionSummary() {
  let total = 0;

  for (const { input } of quantityInputs) {
    const value = Number(input.value);

    if (Number.isInteger(value) && value > 0) {
      total += Math.min(value, MAX_PER_TYPE);
    }
  }

  selectedCountElement.textContent = total.toLocaleString("pt-BR");
}

function normalizeInput(input) {
  const rawValue = input.value.trim();
  const value = Number(rawValue);

  if (rawValue === "" || !Number.isInteger(value) || value < 0) {
    input.value = "0";
  } else if (value > MAX_PER_TYPE) {
    input.value = String(MAX_PER_TYPE);
  }

  updateSelectionSummary();
  saveQuantities();
}

function saveQuantities() {
  for (const { faces, input } of quantityInputs) {
    const value = Number(input.value);

    state.quantities[faces] =
      Number.isInteger(value) && value >= 0
        ? Math.min(value, MAX_PER_TYPE)
        : 0;
  }

  saveState();
}

/* =========================================
   DISTRIBUIÇÃO DA SOMA ENTRE OS DADOS
========================================= */

function distributeTotal(dice, total) {
  const shuffledDice = shuffleArray([...dice]);

  // Soma máxima possível dos dados que ainda serão distribuídos.
  const suffixMaximum = new Array(shuffledDice.length + 1).fill(0);

  for (let i = shuffledDice.length - 1; i >= 0; i--) {
    suffixMaximum[i] =
      suffixMaximum[i + 1] + shuffledDice[i].faces;
  }

  const results = [];
  let remainingTotal = total;

  for (let i = 0; i < shuffledDice.length; i++) {
    const die = shuffledDice[i];
    const remainingDice = shuffledDice.length - i - 1;
    const remainingMaximum = suffixMaximum[i + 1];

    // Garante que os dados restantes consigam completar a soma.
    const minimumAllowed = Math.max(
      1,
      remainingTotal - remainingMaximum
    );

    const maximumAllowed = Math.min(
      die.faces,
      remainingTotal - remainingDice
    );

    if (minimumAllowed > maximumAllowed) {
      throw new Error(
        "Não foi possível distribuir a soma entre os dados."
      );
    }

    const value = randomInteger(
      minimumAllowed,
      maximumAllowed
    );

    results.push({
      faces: die.faces,
      value
    });

    remainingTotal -= value;
  }

  if (remainingTotal !== 0) {
    throw new Error(
      "A soma distribuída não corresponde ao total."
    );
  }

  return results;
}

/* =========================================
   EXECUÇÃO DA ROLAGEM
========================================= */

function rollDice() {
  try {
    const dice = getSelectedDice();

    if (dice.length === 0) {
      alert("Selecione pelo menos um dado para rolar.");
      return;
    }

    const maximumTotal = dice.reduce(
      (sum, die) => sum + die.faces,
      0
    );

    // O corte define o piso mínimo da soma total.
    const minimumTotal = Math.ceil(
      maximumTotal * state.cut / 100
    );

    // Com corte de 100%, todos os dados atingem o máximo.
    const total = state.cut === 100
      ? maximumTotal
      : randomInteger(minimumTotal, maximumTotal);

    // Distribui a soma entre os dados sem ultrapassar seus limites.
    const individualResults = distributeTotal(dice, total);

    // Agrupa os dados por tipo, sem guardar os resultados individuais.
    const groupsMap = new Map();

    for (const result of individualResults) {
      groupsMap.set(
        result.faces,
        (groupsMap.get(result.faces) || 0) + 1
      );
    }

    const groups = DICE_TYPES
      .filter(faces => groupsMap.has(faces))
      .map(faces => ({
        faces,
        count: groupsMap.get(faces)
      }));

    const diceCount = dice.length;

    showResult(total, groups, diceCount);

    const historyItem = {
      id: createHistoryId(),
      total,
      diceCount,
      groups,
      date: new Date().toISOString()
    };

    state.history.unshift(historyItem);
    state.history = state.history.slice(0, HISTORY_LIMIT);

    saveState();
    renderHistory();

  } catch (error) {
    console.error("Erro na rolagem:", error);
    alert(error.message || "Não foi possível realizar a rolagem.");
  }
}

function createHistoryId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${randomInteger(0, 4294967295)}`;
}

/* =========================================
   EXIBIÇÃO DOS RESULTADOS
========================================= */

function showResult(total, groups, diceCount) {
  resultTotal.textContent = total.toLocaleString("pt-BR");
  resultDetails.replaceChildren();

  for (const group of groups) {
    const tag = document.createElement("span");
    tag.textContent = `${group.count} × D${group.faces}`;
    resultDetails.appendChild(tag);
  }

  resultDiceCount.textContent =
    `${diceCount.toLocaleString("pt-BR")} dados rolados`;

  resultSection.hidden = false;
}

/* =========================================
   HISTÓRICO
========================================= */

function renderHistory() {
  historyList.replaceChildren();

  if (state.history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";

    const icon = document.createElement("span");
    icon.className = "empty-icon";
    icon.textContent = "◇";

    const message = document.createElement("p");
    message.textContent = "Nenhuma rolagem realizada.";

    empty.append(icon, message);
    historyList.appendChild(empty);

    return;
  }

  for (const item of state.history) {
    const card = document.createElement("article");
    card.className = "history-item";
    card.dataset.historyId = item.id;

    card.setAttribute(
      "aria-label",
      `Rolagem de ${item.diceCount} dados, total ${item.total}. Pressione e segure para opções.`
    );

    const main = document.createElement("div");
    main.className = "history-item-main";

    const details = document.createElement("div");
    details.className = "history-item-details";

    for (const group of item.groups) {
      const tag = document.createElement("span");
      tag.textContent = `${group.count} × D${group.faces}`;
      details.appendChild(tag);
    }

    const date = document.createElement("div");
    date.className = "history-item-details";

    const parsedDate = new Date(item.date);

    date.textContent = Number.isNaN(parsedDate.getTime())
      ? ""
      : parsedDate.toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        });

    main.append(details, date);

    const total = document.createElement("strong");
    total.className = "history-item-total";
    total.textContent = item.total.toLocaleString("pt-BR");

    card.append(main, total);
    historyList.appendChild(card);
  }
}

function deleteHistoryItem(id) {
  state.history = state.history.filter(
    item => item.id !== id
  );

  saveState();
  renderHistory();

  selectedHistoryId = null;

  if (historyMenuDialog.open) {
    historyMenuDialog.close();
  }
}

/* =========================================
   PRESSIONAR E SEGURAR PARA EXCLUIR
========================================= */

function cancelLongPress() {
  if (pressTimer !== null) {
    clearTimeout(pressTimer);
  }

  pressTimer = null;
  pressTarget = null;
}

historyList.addEventListener("pointerdown", event => {
  const card = event.target.closest(".history-item");

  if (!card || event.button === 2) return;

  cancelLongPress();

  pressTarget = card;
  pressTriggered = false;
  pressStartX = event.clientX;
  pressStartY = event.clientY;

  pressTimer = setTimeout(() => {
    if (!pressTarget || !pressTarget.isConnected) return;

    pressTriggered = true;
    selectedHistoryId = pressTarget.dataset.historyId;

    if (!historyMenuDialog.open) {
      historyMenuDialog.showModal();
    }

    if (navigator.vibrate) {
      navigator.vibrate(35);
    }
  }, 550);
});

document.addEventListener("pointerup", cancelLongPress);
document.addEventListener("pointercancel", cancelLongPress);

document.addEventListener("pointermove", event => {
  if (pressTimer === null) return;

  const distance = Math.hypot(
    event.clientX - pressStartX,
    event.clientY - pressStartY
  );

  if (distance > 10) {
    cancelLongPress();
  }
});

historyList.addEventListener("contextmenu", event => {
  if (event.target.closest(".history-item")) {
    event.preventDefault();
  }
});

historyList.addEventListener("click", event => {
  if (pressTriggered) {
    event.preventDefault();
    pressTriggered = false;
  }
});

/* =========================================
   CONTROLES DE QUANTIDADE
========================================= */

document.getElementById("dice-grid").addEventListener("click", event => {
  const button = event.target.closest(".quantity-button");

  if (!button) return;

  const card = button.closest(".dice-card");
  const faces = Number(card.dataset.die);
  const input = document.getElementById(`quantity-d${faces}`);

  let value = Number(input.value) || 0;

  if (button.dataset.action === "increase") {
    value = Math.min(MAX_PER_TYPE, value + 1);
  } else {
    value = Math.max(0, value - 1);
  }

  input.value = String(value);

  updateSelectionSummary();
  saveQuantities();
});

for (const { input } of quantityInputs) {
  input.addEventListener("input", updateSelectionSummary);

  input.addEventListener("change", () => {
    normalizeInput(input);
  });

  input.addEventListener("blur", () => {
    normalizeInput(input);
  });
}

/* =========================================
   CONFIGURAÇÕES
========================================= */

document.getElementById("settings-button").addEventListener("click", () => {
  cutSelect.value = String(state.cut);
  settingsDialog.showModal();
});

document.getElementById("close-settings-button").addEventListener("click", () => {
  settingsDialog.close();
});

document.getElementById("save-settings-button").addEventListener("click", () => {
  const selectedCut = Number(cutSelect.value);
  const validCuts = [30, 50, 60, 70, 80, 90, 100];

  if (!validCuts.includes(selectedCut)) {
    alert("Selecione uma configuração de corte válida.");
    return;
  }

  state.cut = selectedCut;
  saveState();
  settingsDialog.close();
});

document.getElementById("close-history-menu-button").addEventListener("click", () => {
  historyMenuDialog.close();
});

document.getElementById("delete-history-item-button").addEventListener("click", () => {
  if (selectedHistoryId) {
    deleteHistoryItem(selectedHistoryId);
  }
});

/* =========================================
   LIMPAR HISTÓRICO
========================================= */

document.getElementById("clear-history-button").addEventListener("click", () => {
  if (state.history.length === 0) return;

  const confirmed = confirm(
    "Deseja apagar todo o histórico de rolagens?"
  );

  if (!confirmed) return;

  state.history = [];
  saveState();
  renderHistory();
});

/* =========================================
   INICIALIZAÇÃO
========================================= */

function initializeApp() {
  for (const { faces, input } of quantityInputs) {
    input.value = String(state.quantities[faces] || 0);
  }

  cutSelect.value = String(state.cut);

  updateSelectionSummary();
  renderHistory();

  rollButton.addEventListener("click", rollDice);
}

initializeApp();
