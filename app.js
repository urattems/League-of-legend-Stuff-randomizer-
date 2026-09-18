(() => {
  "use strict";

  const DDRAGON = "https://ddragon.leagueoflegends.com";
  const ROLE_POOL = [
    { id: "TOP", name: "Top", icon: "⚔️" },
    { id: "JUNGLE", name: "Jungle", icon: "🌲" },
    { id: "MID", name: "Mid", icon: "✨" },
    { id: "ADC", name: "ADC", icon: "🏹" },
    { id: "SUPPORT", name: "Support", icon: "🛡️" }
  ];

  const SPELL_IDS = new Set([
    "SummonerFlash",
    "SummonerHeal",
    "SummonerHaste",
    "SummonerBarrier",
    "SummonerExhaust",
    "SummonerTeleport",
    "SummonerSmite",
    "SummonerDot",
    "SummonerBoost"
  ]);

  const state = {
    mode: "easy",
    version: null,
    champions: [],
    spells: [],
    items: [],
    seed: "",
    result: null,
    rolling: false
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const els = {
    status: $("#dataStatus"),
    patch: $("#patchBadge"),
    modeTitle: $("#modeTitle"),
    roll: $("#rollButton"),
    copy: $("#copyButton"),
    share: $("#shareButton"),
    rerollSeed: $("#rerollSeed"),
    seed: $("#seedValue"),
    itemsArea: $("#itemsArea"),
    itemsGrid: $("#itemsGrid"),
    itemCount: $("#itemCount"),
    toast: $("#toast")
  };

  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    return function () {
      h = Math.imul(h ^ h >>> 16, 2246822507);
      h = Math.imul(h ^ h >>> 13, 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(a) {
    return function () {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function seededRandom(seed) {
    return mulberry32(xmur3(seed)());
  }

  function pick(array, random) {
    return array[Math.floor(random() * array.length)];
  }

  function shuffle(array, random) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function newSeed() {
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    return [...bytes].map(n => n.toString(36).toUpperCase()).join("-").slice(0, 15);
  }

  function cleanText(html = "") {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || "";
  }

  function isFinalPurchasableItem(item) {
    if (!item.gold?.purchasable) return false;
    if (!item.maps?.["11"]) return false;
    if (Array.isArray(item.into) && item.into.length > 0) return false;

    const tags = item.tags || [];
    if (tags.includes("Consumable") || tags.includes("Trinket") || tags.includes("GoldPer")) return false;

    const description = cleanText(item.description).toLowerCase();
    const name = (item.name || "").toLowerCase();

    const bannedPhrases = [
      "requires an ally",
      "ornn",
      "masterwork",
      "transform",
      "quest",
      "special event"
    ];
    if (bannedPhrases.some(term => description.includes(term) || name.includes(term))) return false;

    // Keep completed boots and normal full items. Cheap non-boot finals are usually mode/quest leftovers.
    const isBoots = tags.includes("Boots");
    if (!isBoots && item.gold.total < 1800) return false;

    return true;
  }

  async function loadData() {
    try {
      const versions = await fetch(`${DDRAGON}/api/versions.json`).then(r => {
        if (!r.ok) throw new Error("Impossible de récupérer la version Riot.");
        return r.json();
      });
      const version = versions[0];
      state.version = version;

      const [championJson, spellJson, itemJson] = await Promise.all([
        fetch(`${DDRAGON}/cdn/${version}/data/fr_FR/champion.json`).then(r => r.json()),
        fetch(`${DDRAGON}/cdn/${version}/data/fr_FR/summoner.json`).then(r => r.json()),
        fetch(`${DDRAGON}/cdn/${version}/data/fr_FR/item.json`).then(r => r.json())
      ]);

      state.champions = Object.values(championJson.data).sort((a, b) => a.name.localeCompare(b.name));
      state.spells = Object.values(spellJson.data)
        .filter(spell => SPELL_IDS.has(spell.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      state.items = Object.entries(itemJson.data)
        .map(([id, data]) => ({ id, ...data }))
        .filter(isFinalPurchasableItem)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (!state.champions.length || state.spells.length < 2 || state.items.length < 20) {
        throw new Error("Les données Riot reçues sont incomplètes.");
      }

      els.status.textContent = `Prêt • ${state.champions.length} champions • ${state.items.length} items`;
      els.status.classList.add("ready");
      els.patch.textContent = `Data Dragon ${version}`;
      els.patch.hidden = false;
      els.roll.disabled = false;

      readUrlState();
      if (new URL(location.href).searchParams.has("seed")) {
        await roll(false);
      }
    } catch (error) {
      console.error(error);
      els.status.textContent = "Erreur de chargement Riot — recharge la page";
      els.status.classList.add("error");
    }
  }

  function readUrlState() {
    const params = new URL(location.href).searchParams;
    const mode = params.get("mode");
    const seed = params.get("seed");

    if (["easy", "hard", "nightmare"].includes(mode)) {
      setMode(mode);
    }
    state.seed = seed || newSeed();
    els.seed.textContent = state.seed;
  }

  function setMode(mode) {
    state.mode = mode;
    $$(".mode-card").forEach(button => button.classList.toggle("selected", button.dataset.mode === mode));

    const labels = {
      easy: "Mode Facile",
      hard: "Mode Difficile",
      nightmare: "Mode Cauchemar"
    };
    els.modeTitle.textContent = labels[mode];

    if (mode === "easy") {
      els.itemsArea.hidden = true;
    } else {
      els.itemsArea.hidden = false;
      els.itemCount.textContent = mode === "hard" ? "2 items" : "6 items";
      if (!state.result) renderEmptyItems(mode === "hard" ? 2 : 6);
    }
  }

  function generateResult() {
    const random = seededRandom(`${state.seed}|${state.mode}|lol-chaos-v1`);
    const champion = pick(state.champions, random);
    const role = pick(ROLE_POOL, random);

    let spells;
    if (state.mode === "easy") {
      const flash = state.spells.find(spell => spell.id === "SummonerFlash");
      const others = state.spells.filter(spell => spell.id !== "SummonerFlash");
      spells = [flash || state.spells[0], pick(others, random)];
    } else {
      spells = shuffle(state.spells, random).slice(0, 2);
    }

    const itemTarget = state.mode === "easy" ? 0 : state.mode === "hard" ? 2 : 6;
    const itemPool = shuffle(state.items, random);
    const items = [];
    let bootsUsed = false;

    for (const item of itemPool) {
      const isBoots = (item.tags || []).includes("Boots");
      if (isBoots && bootsUsed) continue;
      items.push(item);
      if (isBoots) bootsUsed = true;
      if (items.length === itemTarget) break;
    }

    return { champion, role, spells, items };
  }

  function championImage(champion) {
    return `${DDRAGON}/cdn/${state.version}/img/champion/${champion.image.full}`;
  }

  function spellImage(spell) {
    return `${DDRAGON}/cdn/${state.version}/img/spell/${spell.image.full}`;
  }

  function itemImage(item) {
    return `${DDRAGON}/cdn/${state.version}/img/item/${item.image.full}`;
  }

  function renderCard(slot, label, image, isRole = false) {
    const card = document.querySelector(`[data-slot="${slot}"]`);
    const visual = card.querySelector(isRole ? ".role-icon" : ".image-wrap");
    const strong = card.querySelector("strong");

    if (isRole) {
      visual.className = "role-icon";
      visual.textContent = image;
    } else {
      visual.innerHTML = `<img src="${image}" alt="" loading="eager">`;
    }
    strong.textContent = label;
    card.classList.add("revealed");
  }

  function renderItems(items) {
    els.itemsGrid.innerHTML = "";
    items.forEach(item => {
      const card = document.createElement("div");
      card.className = "item-card";
      card.innerHTML = `
        <img src="${itemImage(item)}" alt="" loading="eager">
        <strong title="${item.name.replaceAll('"', '&quot;')}">${item.name}</strong>
        <small>${item.gold.total} PO</small>
      `;
      els.itemsGrid.appendChild(card);
    });
  }

  function renderEmptyItems(count) {
    els.itemsGrid.innerHTML = Array.from({ length: count }, () => `
      <div class="item-card">
        <div class="placeholder" style="width:56px;height:56px;border-radius:12px;margin:0 auto 8px;background:#10182a">?</div>
        <strong>???</strong>
        <small>—</small>
      </div>
    `).join("");
  }

  function setSpinning(on) {
    $$("[data-slot]").forEach(card => card.classList.toggle("spinning", on));
    $$(".item-card").forEach(card => card.classList.toggle("spinning", on));
  }

  async function roll(makeNewSeed = true) {
    if (state.rolling || !state.champions.length) return;
    state.rolling = true;
    els.roll.disabled = true;
    els.copy.disabled = true;
    els.share.disabled = true;

    if (makeNewSeed) state.seed = newSeed();
    els.seed.textContent = state.seed;

    state.result = generateResult();

    if (state.mode !== "easy") {
      els.itemsArea.hidden = false;
      renderEmptyItems(state.mode === "hard" ? 2 : 6);
    }

    setSpinning(true);
    await delay(520);
    setSpinning(false);

    const { champion, role, spells, items } = state.result;
    renderCard("champion", champion.name, championImage(champion));
    await delay(90);
    renderCard("role", role.name, role.icon, true);
    await delay(90);
    renderCard("spell1", spells[0].name, spellImage(spells[0]));
    await delay(90);
    renderCard("spell2", spells[1].name, spellImage(spells[1]));

    if (items.length) {
      await delay(120);
      renderItems(items);
    }

    updateUrl();
    els.copy.disabled = false;
    els.share.disabled = false;
    els.roll.disabled = false;
    state.rolling = false;
  }

  function updateUrl() {
    const url = new URL(location.href);
    url.searchParams.set("mode", state.mode);
    url.searchParams.set("seed", state.seed);
    history.replaceState({}, "", url);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function resultText() {
    if (!state.result) return "";
    const { champion, role, spells, items } = state.result;
    const modeName = { easy: "FACILE", hard: "DIFFICILE", nightmare: "CAUCHEMAR" }[state.mode];

    const lines = [
      `🎰 LoL Roulette — ${modeName}`,
      `🧙 Champion : ${champion.name}`,
      `🗺️ Rôle : ${role.name}`,
      `✨ Sorts : ${spells.map(s => s.name).join(" + ")}`
    ];

    if (items.length) {
      lines.push(`🛒 Items : ${items.map(item => item.name).join(" → ")}`);
    }

    lines.push(`🌱 Seed : ${state.seed}`);
    return lines.join("\n");
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(successMessage);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      toast(successMessage);
    }
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => els.toast.classList.remove("show"), 1800);
  }

  $$(".mode-card").forEach(button => {
    button.addEventListener("click", () => {
      if (state.rolling) return;
      setMode(button.dataset.mode);
      state.result = null;
      state.seed = newSeed();
      els.seed.textContent = state.seed;
      els.copy.disabled = true;
      els.share.disabled = true;
      $$("[data-slot] strong").forEach(el => el.textContent = "???");
      if (state.mode !== "easy") renderEmptyItems(state.mode === "hard" ? 2 : 6);
    });
  });

  els.roll.addEventListener("click", () => roll(true));

  els.rerollSeed.addEventListener("click", () => {
    if (state.rolling) return;
    state.seed = newSeed();
    state.result = null;
    els.seed.textContent = state.seed;
    els.copy.disabled = true;
    els.share.disabled = true;
    toast("Nouveau seed prêt");
  });

  els.copy.addEventListener("click", () => copyText(resultText(), "Challenge copié 😈"));

  els.share.addEventListener("click", async () => {
    updateUrl();
    const payload = {
      title: "LoL Roulette du Chaos",
      text: resultText(),
      url: location.href
    };

    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    await copyText(location.href, "Lien du tirage copié 🔗");
  });

  loadData();
})();
