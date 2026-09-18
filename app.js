(() => {
  "use strict";

  const DDRAGON = "https://ddragon.leagueoflegends.com";

  const ROLE_POOL = [
    { id: "TOP", name: "Top" },
    { id: "JUNGLE", name: "Jungle" },
    { id: "MID", name: "Mid" },
    { id: "ADC", name: "ADC" },
    { id: "SUPPORT", name: "Support" }
  ];

  const SPELL_IDS = new Set([
    "SummonerFlash", "SummonerHeal", "SummonerHaste", "SummonerBarrier",
    "SummonerExhaust", "SummonerTeleport", "SummonerSmite",
    "SummonerDot", "SummonerBoost"
  ]);

  const MODE_COPY = {
    easy: {
      title: "Mode Facile",
      desc: "Le hasard reste encore un peu civilisé.",
      risk: "Risque faible"
    },
    hard: {
      title: "Mode Difficile",
      desc: "Tu gardes ton champion. Le reste devient une discussion.",
      risk: "Risque sérieux"
    },
    nightmare: {
      title: "Mode Cauchemar",
      desc: "Six achats, deux sorts, aucune circonstance atténuante.",
      risk: "Risque terminal"
    }
  };

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

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const els = {
    status: $("#dataStatus"),
    patch: $("#patchBadge"),
    modeTitle: $("#modeTitle"),
    modeDescription: $("#modeDescription"),
    modeRisk: $("#modeRisk"),
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

  function seededRandom(seed) { return mulberry32(xmur3(seed)()); }
  function pick(array, random) { return array[Math.floor(random() * array.length)]; }

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
    if (!item.gold?.purchasable || !item.maps?.["11"]) return false;
    if (Array.isArray(item.into) && item.into.length > 0) return false;

    const tags = item.tags || [];
    if (tags.includes("Consumable") || tags.includes("Trinket") || tags.includes("GoldPer")) return false;

    const description = cleanText(item.description).toLowerCase();
    const name = (item.name || "").toLowerCase();
    const banned = ["requires an ally", "ornn", "masterwork", "transform", "quest", "special event"];
    if (banned.some(term => description.includes(term) || name.includes(term))) return false;

    const isBoots = tags.includes("Boots");
    if (!isBoots && item.gold.total < 1800) return false;
    return true;
  }

  async function loadData() {
    try {
      const versionsResponse = await fetch(`${DDRAGON}/api/versions.json`);
      if (!versionsResponse.ok) throw new Error("Version Riot indisponible.");
      const versions = await versionsResponse.json();
      state.version = versions[0];

      const [championJson, spellJson, itemJson] = await Promise.all([
        fetch(`${DDRAGON}/cdn/${state.version}/data/fr_FR/champion.json`).then(r => r.json()),
        fetch(`${DDRAGON}/cdn/${state.version}/data/fr_FR/summoner.json`).then(r => r.json()),
        fetch(`${DDRAGON}/cdn/${state.version}/data/fr_FR/item.json`).then(r => r.json())
      ]);

      state.champions = Object.values(championJson.data).sort((a,b) => a.name.localeCompare(b.name));
      state.spells = Object.values(spellJson.data)
        .filter(spell => SPELL_IDS.has(spell.id))
        .sort((a,b) => a.name.localeCompare(b.name));
      state.items = Object.entries(itemJson.data)
        .map(([id,data]) => ({ id, ...data }))
        .filter(isFinalPurchasableItem)
        .sort((a,b) => a.name.localeCompare(b.name));

      if (!state.champions.length || state.spells.length < 2 || state.items.length < 20) {
        throw new Error("Données Riot incomplètes.");
      }

      els.status.innerHTML = `<i></i>PRÊT — ${state.champions.length} CHAMPIONS / ${state.items.length} ITEMS`;
      els.status.classList.add("ready");
      els.patch.textContent = `DD ${state.version}`;
      els.patch.hidden = false;
      els.roll.disabled = false;

      readUrlState();
      if (new URL(location.href).searchParams.has("seed")) await roll(false);
    } catch (error) {
      console.error(error);
      els.status.innerHTML = "<i></i>DONNÉES RIOT INDISPONIBLES";
      els.status.classList.add("error");
    }
  }

  function readUrlState() {
    const params = new URL(location.href).searchParams;
    const mode = params.get("mode");
    if (["easy","hard","nightmare"].includes(mode)) setMode(mode);
    state.seed = params.get("seed") || newSeed();
    els.seed.textContent = state.seed;
  }

  function setMode(mode) {
    state.mode = mode;
    document.body.dataset.mode = mode;

    $$(".mode-card").forEach(btn => btn.classList.toggle("selected", btn.dataset.mode === mode));
    els.modeTitle.textContent = MODE_COPY[mode].title;
    els.modeDescription.textContent = MODE_COPY[mode].desc;
    els.modeRisk.textContent = MODE_COPY[mode].risk;

    if (mode === "easy") {
      els.itemsArea.hidden = true;
    } else {
      els.itemsArea.hidden = false;
      const count = mode === "hard" ? 2 : 6;
      els.itemCount.textContent = String(count).padStart(2,"0") + " ITEMS";
      if (!state.result) renderEmptyItems(count);
    }
  }

  function generateResult() {
    const random = seededRandom(`${state.seed}|${state.mode}|rr-v2`);
    const champion = pick(state.champions, random);
    const role = pick(ROLE_POOL, random);

    let spells;
    if (state.mode === "easy") {
      const flash = state.spells.find(s => s.id === "SummonerFlash") || state.spells[0];
      const others = state.spells.filter(s => s.id !== "SummonerFlash");
      spells = [flash, pick(others, random)];
    } else {
      spells = shuffle(state.spells, random).slice(0,2);
    }

    const target = state.mode === "easy" ? 0 : state.mode === "hard" ? 2 : 6;
    const items = [];
    let bootsUsed = false;

    for (const item of shuffle(state.items, random)) {
      const isBoots = (item.tags || []).includes("Boots");
      if (isBoots && bootsUsed) continue;
      items.push(item);
      if (isBoots) bootsUsed = true;
      if (items.length === target) break;
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

  function roleSvg(id) {
    const common = 'viewBox="0 0 64 64" aria-hidden="true"';
    const icons = {
      TOP: `<svg ${common}><path d="M13 49V15h34M13 15l13 13M47 15 26 36M26 36h21v13H13"/></svg>`,
      JUNGLE: `<svg ${common}><path d="M32 52V28M32 39 18 25M32 34l12-16M20 52c0-9 5-14 12-14s12 5 12 14M15 18c6 2 11 7 14 14M49 13c-6 5-10 11-12 19"/></svg>`,
      MID: `<svg ${common}><path d="M14 50 50 14M14 14h16L14 30V14ZM50 50H34l16-16v16Z"/><path d="M23 41 41 23"/></svg>`,
      ADC: `<svg ${common}><circle cx="28" cy="36" r="14"/><path d="m38 26 13-13M39 13h12v12"/><path d="M20 36h16M28 28v16"/></svg>`,
      SUPPORT: `<svg ${common}><path d="M32 10 49 17v13c0 11-6 19-17 24-11-5-17-13-17-24V17l17-7Z"/><path d="M24 31h16M32 23v16"/></svg>`
    };
    return icons[id] || icons.MID;
  }

  function renderCard(slot, label, image, isRole = false, roleId = "") {
    const card = document.querySelector(`[data-slot="${slot}"]`);
    const visual = card.querySelector(isRole ? ".role-icon" : ".image-wrap");
    const strong = card.querySelector(".result-name strong");

    if (isRole) {
      visual.className = "role-icon";
      visual.innerHTML = roleSvg(roleId);
    } else {
      visual.innerHTML = `<img src="${image}" alt="" loading="eager">`;
    }
    strong.textContent = label;
    card.classList.add("revealed");
  }

  function renderItems(items) {
    els.itemsGrid.innerHTML = "";
    items.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "item-card";
      card.innerHTML = `
        <img src="${itemImage(item)}" alt="" loading="eager">
        <strong title="${item.name.replaceAll('"','&quot;')}">${item.name}</strong>
        <small>${String(index + 1).padStart(2,"0")} / ${item.gold.total} PO</small>
      `;
      els.itemsGrid.appendChild(card);
    });
  }

  function renderEmptyItems(count) {
    els.itemsGrid.innerHTML = Array.from({length:count}, (_,i) => `
      <div class="item-card">
        <div class="item-placeholder placeholder">?</div>
        <strong>En attente</strong>
        <small>${String(i+1).padStart(2,"0")} / —</small>
      </div>
    `).join("");
  }

  function setSpinning(on) {
    $$(".draw-cell").forEach(card => card.classList.toggle("spinning", on));
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
    await delay(420);
    setSpinning(false);

    const { champion, role, spells, items } = state.result;
    renderCard("champion", champion.name, championImage(champion));
    await delay(75);
    renderCard("role", role.name, null, true, role.id);
    await delay(75);
    renderCard("spell1", spells[0].name, spellImage(spells[0]));
    await delay(75);
    renderCard("spell2", spells[1].name, spellImage(spells[1]));
    if (items.length) {
      await delay(90);
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

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function resultText() {
    if (!state.result) return "";
    const { champion, role, spells, items } = state.result;
    const mode = {easy:"FACILE", hard:"DIFFICILE", nightmare:"CAUCHEMAR"}[state.mode];
    const lines = [
      `RIFT / RANDOMIZER — ${mode}`,
      `Champion : ${champion.name}`,
      `Poste : ${role.name}`,
      `Sorts : ${spells.map(s => s.name).join(" + ")}`
    ];
    if (items.length) lines.push(`Items : ${items.map(i => i.name).join(" → ")}`);
    lines.push(`Seed : ${state.seed}`);
    return lines.join("\n");
  }

  async function copyText(value, message) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast(message);
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => els.toast.classList.remove("show"), 1700);
  }

  function resetVisibleResult() {
    state.result = null;
    $$(".draw-cell").forEach(card => card.classList.remove("revealed"));
    $$(".result-name strong").forEach(el => el.textContent = "???");
    $$(".image-wrap").forEach(el => el.innerHTML = '<div class="placeholder">?</div>');
    const role = $(".role-icon");
    if (role) {
      role.className = "role-icon placeholder";
      role.textContent = "?";
    }
    if (state.mode !== "easy") renderEmptyItems(state.mode === "hard" ? 2 : 6);
    els.copy.disabled = true;
    els.share.disabled = true;
  }

  $$(".mode-card").forEach(button => {
    button.addEventListener("click", () => {
      if (state.rolling) return;
      setMode(button.dataset.mode);
      state.seed = newSeed();
      els.seed.textContent = state.seed;
      resetVisibleResult();
    });
  });

  els.roll.addEventListener("click", () => roll(true));

  document.addEventListener("keydown", event => {
    if (event.code === "Space" && !event.repeat && !["INPUT","TEXTAREA","BUTTON"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      roll(true);
    }
  });

  els.rerollSeed.addEventListener("click", () => {
    if (state.rolling) return;
    state.seed = newSeed();
    els.seed.textContent = state.seed;
    resetVisibleResult();
    toast("Nouveau seed prêt.");
  });

  els.copy.addEventListener("click", () => copyText(resultText(), "Challenge copié."));

  els.share.addEventListener("click", async () => {
    updateUrl();
    const payload = { title:"Rift Randomizer", text:resultText(), url:location.href };
    if (navigator.share) {
      try { await navigator.share(payload); return; }
      catch (error) { if (error?.name === "AbortError") return; }
    }
    await copyText(location.href, "Lien du tirage copié.");
  });

  loadData();
})();