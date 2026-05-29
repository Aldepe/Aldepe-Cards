const STORAGE_KEYS = {
  config: "aldepe-forge:supabase-config",
  demo: "aldepe-forge:demo-state-v4",
  player: "aldepe-forge:last-player",
  sound: "aldepe-forge:sound",
};

const PACK_SIZE = 3;
const PACK_COOLDOWN_MS = 8 * 60 * 60 * 1000;
const HOLO_CHANCE = 0.025;

const RARITIES = {
  comun: {
    label: "Común",
    color: "#9fd6b4",
    weight: 60,
    fallback: "linear-gradient(135deg, #1d4b3d, #9fd6b4)",
  },
  rara: {
    label: "Rara",
    color: "#6dc8ff",
    weight: 24,
    fallback: "linear-gradient(135deg, #123f68, #6dc8ff)",
  },
  epica: {
    label: "Épica",
    color: "#ff8ac1",
    weight: 9,
    fallback: "linear-gradient(135deg, #5a2148, #ff8ac1)",
  },
  legendaria: {
    label: "Legendaria",
    color: "#f2bd4b",
    weight: 2,
    fallback: "linear-gradient(135deg, #5b3a0e, #f2bd4b)",
  },
};

const state = {
  mode: "demo",
  profile: null,
  isAdmin: false,
  packs: [],
  selectedPackId: null,
  cards: [],
  collection: {},
  holoCollection: {},
  allCollections: {},
  allHoloCollections: {},
  players: [],
  trades: [],
  activity: [],
  lastPackOpenedAt: null,
  activeView: "arena",
  activeFilter: "all",
  opening: false,
  soundEnabled: localStorage.getItem(STORAGE_KEYS.sound) !== "off",
};

let supabaseClient = null;
let toastTimer = null;
let audioContext = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  loginGate: $("#loginGate"),
  workspace: $("#workspace"),
  loginForm: $("#loginForm"),
  playerName: $("#playerName"),
  playerPassword: $("#playerPassword"),
  playerTitle: $("#playerTitle"),
  modeBadge: $("#modeBadge"),
  soundButton: $("#soundButton"),
  logoutButton: $("#logoutButton"),
  ownedStat: $("#ownedStat"),
  uniqueStat: $("#uniqueStat"),
  completionStat: $("#completionStat"),
  openPackButton: $("#openPackButton"),
  cooldownCopy: $("#cooldownCopy"),
  packMachine: $("#packMachine"),
  packObject: $("#packObject"),
  packCoverImage: $("#packCoverImage"),
  activePackName: $("#activePackName"),
  activePackMeta: $("#activePackMeta"),
  packSelector: $("#packSelector"),
  resultRail: $("#resultRail"),
  oddsRow: $("#oddsRow"),
  collectionGrid: $("#collectionGrid"),
  rarityFilters: $("#rarityFilters"),
  tradeForm: $("#tradeForm"),
  tradePlayer: $("#tradePlayer"),
  tradeOfferCard: $("#tradeOfferCard"),
  tradeRequestCard: $("#tradeRequestCard"),
  tradeList: $("#tradeList"),
  activityList: $("#activityList"),
  packForm: $("#packForm"),
  packName: $("#packName"),
  packCover: $("#packCover"),
  packColor: $("#packColor"),
  importForm: $("#importForm"),
  importFile: $("#importFile"),
  cardForm: $("#cardForm"),
  cardPack: $("#cardPack"),
  cardRarity: $("#cardRarity"),
  cardWeight: $("#cardWeight"),
  adminPackList: $("#adminPackList"),
  adminCardList: $("#adminCardList"),
  adminPlayerList: $("#adminPlayerList"),
  settingsButton: $("#settingsButton"),
  settingsModal: $("#settingsModal"),
  supabaseUrl: $("#supabaseUrl"),
  supabaseAnonKey: $("#supabaseAnonKey"),
  saveConfigButton: $("#saveConfigButton"),
  clearConfigButton: $("#clearConfigButton"),
  toast: $("#toast"),
};

init();

function init() {
  els.playerName.value = localStorage.getItem(STORAGE_KEYS.player) || "";
  bindEvents();
  updateAdminVisibility();
  renderConfigState();
  renderRarityFilters();
  renderSoundButton();
  setInterval(renderCooldown, 1000);
  renderIcons();
}

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLogin);
  els.openPackButton.addEventListener("click", openPack);
  els.packForm.addEventListener("submit", handlePackCreate);
  els.importForm.addEventListener("submit", handlePackImport);
  els.cardForm.addEventListener("submit", handleCardCreate);
  els.tradeForm.addEventListener("submit", handleTradeCreate);
  els.soundButton.addEventListener("click", toggleSound);
  els.logoutButton.addEventListener("click", logout);
  els.cardRarity.addEventListener("change", () => {
    els.cardWeight.value = String(RARITIES[els.cardRarity.value]?.weight || 20);
  });

  els.packSelector.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pack-id]");
    if (!button) return;
    selectPack(button.dataset.packId);
    playSound("tap");
  });

  els.packObject.addEventListener("pointermove", tiltPack);
  els.packObject.addEventListener("pointerleave", resetPackTilt);
  els.adminPackList.addEventListener("click", handleAdminListClick);
  els.adminCardList.addEventListener("click", handleAdminListClick);
  els.tradePlayer.addEventListener("change", renderTradePanel);
  els.tradeList.addEventListener("click", handleTradeAction);

  $$(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.settingsButton.addEventListener("click", () => {
    const config = getConfig();
    els.supabaseUrl.value = config?.url || "";
    els.supabaseAnonKey.value = config?.anonKey || "";
    els.settingsModal.showModal();
  });

  els.saveConfigButton.addEventListener("click", saveConfig);
  els.clearConfigButton.addEventListener("click", clearConfig);
}

async function handleLogin(event) {
  event.preventDefault();
  const username = els.playerName.value.trim();
  const password = els.playerPassword.value;
  if (!username) {
    showToast("Pon un nombre de jugador para entrar.");
    return;
  }

  localStorage.setItem(STORAGE_KEYS.player, username);
  const config = getConfig();

  try {
    if (!(await validateAccessPassword(password, config))) {
      showToast("Contraseña incorrecta.");
      return;
    }

    if (config?.url && config?.anonKey) {
      await startSupabaseSession(username, config);
    } else {
      startDemoSession(username, password, config);
    }
    showWorkspace();
  } catch (error) {
    console.error(error);
    showToast(error.message || "No he podido iniciar sesión.");
  }
}

function startDemoSession(username, password, config) {
  const saved = readDemoState();
  const playerId = `demo:${slugify(username)}`;
  const existingPlayer = saved.players.find((player) => player.id === playerId);
  const player = existingPlayer || {
    id: playerId,
    username,
    created_at: new Date().toISOString(),
    last_pack_opened_at: null,
  };
  player.username = username;
  state.mode = "demo";
  state.profile = player;
  state.isAdmin = isDemoAdmin(username, password, config);
  state.packs = saved.packs;
  state.selectedPackId = saved.selectedPackId || saved.packs[0]?.id || null;
  state.cards = saved.cards;
  state.players = [player, ...saved.players.filter((candidate) => candidate.id !== playerId)];
  state.allCollections = saved.collectionsByPlayer || {};
  state.allHoloCollections = saved.holoCollectionsByPlayer || {};
  state.collection = state.allCollections[playerId] || {};
  state.holoCollection = state.allHoloCollections[playerId] || {};
  state.trades = saved.trades || [];
  state.activity = saved.activity;
  state.lastPackOpenedAt = saved.lastPackOpenedAtByPlayer?.[playerId] || player.last_pack_opened_at || null;
  renderAll();
  saveDemoState();
}

async function startSupabaseSession(username, config) {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  supabaseClient = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  let {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session) {
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) {
      throw new Error("Activa Anonymous sign-ins en Supabase Auth y vuelve a entrar.");
    }
    session = data.session;
  }

  const userId = session.user.id;
  const { error: insertProfileError } = await supabaseClient.from("profiles").insert({ id: userId, username });

  if (insertProfileError && insertProfileError.code !== "23505") {
    throw new Error(`No se pudo guardar el perfil: ${insertProfileError.message}`);
  }

  if (insertProfileError?.code === "23505") {
    const { error: updateProfileError } = await supabaseClient
      .from("profiles")
      .update({ username })
      .eq("id", userId);

    if (updateProfileError) {
      throw new Error(`No se pudo actualizar el perfil: ${updateProfileError.message}`);
    }
  }

  const { data: profile, error: readError } = await supabaseClient
    .from("profiles")
    .select("id, username, is_admin, last_pack_opened_at")
    .eq("id", userId)
    .single();

  if (readError) {
    throw new Error(`No se pudo leer el perfil: ${readError.message}`);
  }

  state.mode = "supabase";
  state.profile = profile;
  state.isAdmin = Boolean(profile.is_admin);
  state.lastPackOpenedAt = profile.last_pack_opened_at;

  await loadRemoteData();
  renderAll();
}

async function loadRemoteData() {
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("id, username, is_admin, last_pack_opened_at")
    .eq("id", state.profile.id)
    .single();

  if (profile) {
    state.profile = profile;
    state.isAdmin = Boolean(profile.is_admin);
    state.lastPackOpenedAt = profile.last_pack_opened_at;
  }

  const { data: packs, error: packError } = await supabaseClient
    .from("packs")
    .select("id, name, cover_url, color, active, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (packError) {
    throw new Error(`No se pudieron cargar sobres: ${packError.message}`);
  }

  const { data: cards, error: cardError } = await supabaseClient
    .from("cards")
    .select("id, pack_id, name, description, rarity, image_url, weight, active, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (cardError) {
    throw new Error(`No se pudieron cargar cartas: ${cardError.message}`);
  }

  const { data: players, error: playersError } = await supabaseClient
    .from("profiles")
    .select("id, username, is_admin, last_pack_opened_at, created_at")
    .order("created_at", { ascending: true });

  if (playersError) {
    throw new Error(`No se pudieron cargar jugadores: ${playersError.message}`);
  }

  const { data: owned, error: ownedError } = await supabaseClient
    .from("user_cards")
    .select("user_id, card_id, copies, holo_copies");

  if (ownedError) {
    throw new Error(`No se pudo cargar la colección: ${ownedError.message}`);
  }

  const { data: trades, error: tradesError } = await supabaseClient
    .from("trades")
    .select("id, from_user_id, to_user_id, offer_card_id, request_card_id, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (tradesError) {
    throw new Error(`No se pudieron cargar intercambios: ${tradesError.message}`);
  }

  const { data: activity } = await supabaseClient
    .from("pack_opens")
    .select("created_at, profiles!pack_opens_user_profile_fkey(username), packs!pack_opens_pack_fkey(id, name, cover_url), cards(id, pack_id, name, rarity, image_url)")
    .order("created_at", { ascending: false })
    .limit(10);

  state.packs = packs || [];
  if (!state.packs.some((pack) => pack.id === state.selectedPackId)) {
    state.selectedPackId = state.packs[0]?.id || null;
  }
  state.cards = cards || [];
  state.players = players || [];
  state.allCollections = groupCollectionsByPlayer(owned || []);
  state.allHoloCollections = groupHoloCollectionsByPlayer(owned || []);
  state.collection = state.allCollections[state.profile.id] || {};
  state.holoCollection = state.allHoloCollections[state.profile.id] || {};
  state.trades = trades || [];
  state.activity = (activity || []).map((row) => ({
    username: row.profiles?.username || "Alguien",
    created_at: row.created_at,
    pack: normalizePack(row.packs),
    card: normalizeCard(row.cards),
  }));
}

function showWorkspace() {
  els.loginGate.classList.add("is-hidden");
  els.workspace.classList.remove("is-hidden");
  els.logoutButton.classList.remove("is-hidden");
  updateAdminVisibility();
  switchView("arena", { silent: true });
  renderConfigState();
  renderIcons();
}

async function logout() {
  playSound("tap");
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  state.mode = "demo";
  state.profile = null;
  state.isAdmin = false;
  state.packs = [];
  state.selectedPackId = null;
  state.cards = [];
  state.collection = {};
  state.holoCollection = {};
  state.allCollections = {};
  state.allHoloCollections = {};
  state.players = [];
  state.trades = [];
  state.activity = [];
  state.lastPackOpenedAt = null;
  els.playerPassword.value = "";
  els.workspace.classList.add("is-hidden");
  els.loginGate.classList.remove("is-hidden");
  els.logoutButton.classList.add("is-hidden");
  updateAdminVisibility();
  renderConfigState();
  renderIcons();
}

function switchView(view, options = {}) {
  if (view === "admin" && !state.isAdmin) {
    if (!options.silent) {
      showToast("Solo el admin puede entrar ahí.");
    }
    return;
  }

  state.activeView = view;
  $$("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("is-hidden", panel.dataset.viewPanel !== view);
  });
  $$(".nav-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
}

function updateAdminVisibility() {
  const adminTab = document.querySelector('[data-view="admin"]');
  if (adminTab) {
    adminTab.classList.toggle("is-hidden", !state.isAdmin);
  }

  if (!state.isAdmin && state.activeView === "admin") {
    switchView("arena", { silent: true });
  }
}

async function openPack() {
  if (state.opening) return;
  const activePack = getActivePack();
  const packCards = getActivePackCards();
  if (!activePack) {
    showToast("El admin tiene que crear un sobre primero.");
    return;
  }
  if (!packCards.length) {
    showToast("Este sobre todavía no tiene cartas.");
    return;
  }
  const cooldownMs = getCooldownMs();
  if (cooldownMs > 0) {
    renderCooldown();
    showToast(`Podrás abrir otro sobre en ${formatDuration(cooldownMs)}.`);
    return;
  }

  state.opening = true;
  els.openPackButton.disabled = true;
  els.packMachine.classList.add("is-opening");
  playSound("open");

  try {
    const pulls = state.mode === "supabase" ? await openRemotePack() : openDemoPack();
    await playPackReveal(pulls);
    renderAll({ keepResults: true });
  } catch (error) {
    console.error(error);
    showToast(error.message || "El sobre se ha resistido.");
  } finally {
    state.opening = false;
    renderCooldown();
    els.packMachine.classList.remove("is-opening");
  }
}

async function openRemotePack() {
  const { data, error } = await supabaseClient.rpc("open_pack", {
    draw_count: PACK_SIZE,
    pack_uuid: state.selectedPackId,
  });
  if (error) {
    throw new Error(`No se pudo abrir el sobre: ${error.message}`);
  }
  state.lastPackOpenedAt = new Date().toISOString();
  await loadRemoteData();
  return (data || []).map(normalizeCard);
}

function openDemoPack() {
  const pulls = [];
  const packCards = getActivePackCards();
  const activePack = getActivePack();
  for (let index = 0; index < PACK_SIZE; index += 1) {
    const card = weightedPick(packCards);
    const isHolo = Math.random() < HOLO_CHANCE;
    if (isHolo) {
      state.holoCollection[card.id] = (state.holoCollection[card.id] || 0) + 1;
    } else {
      state.collection[card.id] = (state.collection[card.id] || 0) + 1;
    }
    state.allCollections[state.profile.id] = state.collection;
    state.allHoloCollections[state.profile.id] = state.holoCollection;
    pulls.push({
      ...card,
      is_holo: isHolo,
      copy_count: isHolo ? state.holoCollection[card.id] : state.collection[card.id],
    });
    state.activity.unshift({
      username: state.profile.username,
      created_at: new Date().toISOString(),
      pack: activePack,
      card,
      is_holo: isHolo,
    });
  }
  state.activity = state.activity.slice(0, 12);
  state.lastPackOpenedAt = new Date().toISOString();
  state.players = state.players.map((player) =>
    player.id === state.profile.id ? { ...player, last_pack_opened_at: state.lastPackOpenedAt } : player,
  );
  saveDemoState();
  return pulls;
}

async function playPackReveal(pulls) {
  els.resultRail.innerHTML = "";
  burstParticles("legendaria");
  await sleep(520);

  for (const pull of pulls) {
    burstParticles(pull.rarity);
    playSound(pull.is_holo || pull.rarity === "legendaria" ? "legendary" : "reveal");
    els.resultRail.insertAdjacentHTML("beforeend", renderCard(pull, { reveal: true }));
    renderIcons();
    await sleep(340);
  }
}

function burstParticles(rarity) {
  const color = RARITIES[rarity]?.color || "#f2bd4b";
  const amount = rarity === "legendaria" ? 34 : rarity === "epica" ? 24 : 16;
  for (let index = 0; index < amount; index += 1) {
    const particle = document.createElement("span");
    const angle = (Math.PI * 2 * index) / amount;
    const distance = 90 + Math.random() * 130;
    particle.className = "particle";
    particle.style.setProperty("--particle-color", color);
    particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
    els.packMachine.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove(), { once: true });
  }
}

async function handleCardCreate(event) {
  event.preventDefault();

  if (!state.isAdmin) {
    showToast("Tu perfil no tiene permisos de admin.");
    return;
  }

  const form = new FormData(els.cardForm);
  const file = form.get("cardImage");
  const packId = String(form.get("cardPack") || "");
  const card = {
    pack_id: packId,
    name: String(form.get("cardName") || "").trim(),
    description: String(form.get("cardDescription") || "").trim(),
    rarity: String(form.get("cardRarity") || "comun"),
    weight: Math.max(1, Number(form.get("cardWeight") || RARITIES.comun.weight)),
  };

  if (!state.packs.some((pack) => pack.id === packId)) {
    showToast("Crea o elige un sobre antes de añadir cartas.");
    return;
  }

  if (!card.name) {
    showToast("Ponle nombre a la carta.");
    return;
  }

  if (!file || !file.size) {
    showToast("Sube una imagen para la carta.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast("La imagen pesa más de 5 MB. Recórtala un poco.");
    return;
  }

  try {
    if (state.mode === "supabase") {
      await createRemoteCard(card, file);
      await loadRemoteData();
    } else {
      await createDemoCard(card, file);
    }

    els.cardForm.reset();
    els.cardPack.value = state.selectedPackId || state.packs[0]?.id || "";
    els.cardWeight.value = String(RARITIES.comun.weight);
    renderAll();
    showToast("Carta creada. Ya puede salir en los sobres.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No he podido crear la carta.");
  }
}

async function handlePackCreate(event) {
  event.preventDefault();

  if (!state.isAdmin) {
    showToast("Tu perfil no tiene permisos de admin.");
    return;
  }

  const form = new FormData(els.packForm);
  const file = form.get("packCover");
  const pack = {
    name: String(form.get("packName") || "").trim(),
    color: String(form.get("packColor") || "#ff6f61"),
  };

  if (!pack.name) {
    showToast("Ponle nombre al sobre.");
    return;
  }

  if (!file || !file.size) {
    showToast("Sube una portada para el sobre.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast("La portada pesa más de 5 MB. Recórtala un poco.");
    return;
  }

  try {
    playSound("tap");
    if (state.mode === "supabase") {
      await createRemotePack(pack, file);
      await loadRemoteData();
    } else {
      await createDemoPack(pack, file);
    }

    els.packForm.reset();
    els.packColor.value = "#ff6f61";
    renderAll();
    showToast("Sobre creado.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No he podido crear el sobre.");
  }
}

async function handlePackImport(event) {
  event.preventDefault();

  if (!state.isAdmin) {
    showToast("Solo admin puede importar sobres.");
    return;
  }

  const file = new FormData(els.importForm).get("importFile");
  if (!file || !file.size) {
    showToast("Sube un JSON de sobre.");
    return;
  }

  try {
    const payload = JSON.parse(await file.text());
    const packName = String(payload.name || payload.packName || file.name.replace(/\.json$/i, "")).trim();
    const packColor = String(payload.color || "#ff6f61");
    const cards = Array.isArray(payload.cards) ? payload.cards : [];

    if (!packName) {
      throw new Error("El JSON necesita un nombre de sobre.");
    }

    const coverFile = await imageSourceToFile(payload.coverImage || payload.cover || payload.cover_url, `${packName}-cover`, packColor);
    let packId;

    if (state.mode === "supabase") {
      packId = await createRemotePack({ name: packName, color: packColor }, coverFile);
    } else {
      packId = await createDemoPack({ name: packName, color: packColor }, coverFile);
    }

    for (const item of cards) {
      const cardName = String(item.name || "").trim();
      if (!cardName) continue;
      const card = {
        pack_id: packId,
        name: cardName,
        description: String(item.description || item.desc || ""),
        rarity: RARITIES[item.rarity] ? item.rarity : "comun",
        weight: Math.max(1, Number(item.weight || RARITIES[item.rarity]?.weight || RARITIES.comun.weight)),
      };
      const imageFile = await imageSourceToFile(item.image || item.image_url || item.imageDataUrl, cardName, packColor);

      if (state.mode === "supabase") {
        await createRemoteCard(card, imageFile);
      } else {
        await createDemoCard(card, imageFile);
      }
    }

    if (state.mode === "supabase") {
      await loadRemoteData();
    }

    els.importForm.reset();
    renderAll();
    showToast(`Importado: ${packName}.`);
  } catch (error) {
    console.error(error);
    showToast(error.message || "No he podido importar ese JSON.");
  }
}

async function handleAdminListClick(event) {
  const deletePackButton = event.target.closest("[data-delete-pack-id]");
  const deleteCardButton = event.target.closest("[data-delete-card-id]");

  if (deletePackButton) {
    const pack = state.packs.find((candidate) => candidate.id === deletePackButton.dataset.deletePackId);
    if (!pack) return;
    if (!window.confirm(`¿Borrar el sobre "${pack.name}" y todas sus cartas?`)) return;
    await deletePack(pack.id);
    return;
  }

  if (deleteCardButton) {
    const card = state.cards.find((candidate) => candidate.id === deleteCardButton.dataset.deleteCardId);
    if (!card) return;
    if (!window.confirm(`¿Borrar la carta "${card.name}"?`)) return;
    await deleteCard(card.id);
  }
}

async function deletePack(packId) {
  try {
    playSound("tap");
    if (state.mode === "supabase") {
      const { error } = await supabaseClient.from("packs").delete().eq("id", packId);
      if (error) throw new Error(error.message);
      await loadRemoteData();
    } else {
      const cardIds = new Set(state.cards.filter((card) => card.pack_id === packId).map((card) => card.id));
      state.packs = state.packs.filter((pack) => pack.id !== packId);
      state.cards = state.cards.filter((card) => card.pack_id !== packId);
      removeCardsFromAllCollections(cardIds);
      state.trades = state.trades.filter(
        (trade) => !cardIds.has(trade.offer_card_id) && !cardIds.has(trade.request_card_id),
      );
      if (state.selectedPackId === packId) {
        state.selectedPackId = state.packs[0]?.id || null;
      }
      saveDemoState();
    }
    renderAll();
    showToast("Sobre borrado.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No he podido borrar el sobre.");
  }
}

async function deleteCard(cardId) {
  try {
    playSound("tap");
    if (state.mode === "supabase") {
      const { error } = await supabaseClient.from("cards").delete().eq("id", cardId);
      if (error) throw new Error(error.message);
      await loadRemoteData();
    } else {
      state.cards = state.cards.filter((card) => card.id !== cardId);
      removeCardsFromAllCollections(new Set([cardId]));
      state.trades = state.trades.filter((trade) => trade.offer_card_id !== cardId && trade.request_card_id !== cardId);
      saveDemoState();
    }
    renderAll();
    showToast("Carta borrada.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No he podido borrar la carta.");
  }
}

async function handleTradeCreate(event) {
  event.preventDefault();

  const toUserId = els.tradePlayer.value;
  const offerCardId = els.tradeOfferCard.value;
  const requestCardId = els.tradeRequestCard.value;

  if (!toUserId || !offerCardId || !requestCardId) {
    showToast("Elige jugador, carta que das y carta que pides.");
    return;
  }

  if ((state.collection[offerCardId] || 0) <= 0) {
    showToast("No tienes esa carta para ofrecer.");
    return;
  }

  if (((state.allCollections[toUserId] || {})[requestCardId] || 0) <= 0) {
    showToast("Ese jugador ya no tiene esa carta.");
    return;
  }

  try {
    playSound("tap");
    if (state.mode === "supabase") {
      const { error } = await supabaseClient.from("trades").insert({
        from_user_id: state.profile.id,
        to_user_id: toUserId,
        offer_card_id: offerCardId,
        request_card_id: requestCardId,
      });
      if (error) throw new Error(error.message);
      await loadRemoteData();
    } else {
      state.trades.unshift({
        id: crypto.randomUUID(),
        from_user_id: state.profile.id,
        to_user_id: toUserId,
        offer_card_id: offerCardId,
        request_card_id: requestCardId,
        status: "pending",
        created_at: new Date().toISOString(),
      });
      saveDemoState();
    }
    renderAll();
    showToast("Intercambio propuesto.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No he podido crear el intercambio.");
  }
}

async function handleTradeAction(event) {
  const actionButton = event.target.closest("[data-trade-action]");
  if (!actionButton) return;

  const tradeId = actionButton.dataset.tradeId;
  const action = actionButton.dataset.tradeAction;
  const trade = state.trades.find((candidate) => candidate.id === tradeId);
  if (!trade) return;

  try {
    playSound("tap");
    if (state.mode === "supabase") {
      if (action === "accept") {
        const { error } = await supabaseClient.rpc("accept_trade", { trade_uuid: tradeId });
        if (error) throw new Error(error.message);
      } else {
        const status = action === "decline" ? "declined" : "cancelled";
        const { error } = await supabaseClient.from("trades").update({ status }).eq("id", tradeId);
        if (error) throw new Error(error.message);
      }
      await loadRemoteData();
    } else {
      if (action === "accept") {
        acceptDemoTrade(trade);
      } else {
        trade.status = action === "decline" ? "declined" : "cancelled";
      }
      state.trades = state.trades.filter((candidate) => candidate.status === "pending");
      state.collection = state.allCollections[state.profile.id] || {};
      saveDemoState();
    }
    renderAll();
    showToast(action === "accept" ? "Intercambio completado." : "Intercambio actualizado.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "No he podido actualizar el intercambio.");
  }
}

async function createRemotePack(pack, file) {
  const styledImage = await stylizePackCover(file, pack.name, pack.color);
  const imageUrl = await uploadStyledImage(styledImage, `${Date.now()}-${slugify(pack.name)}`);
  const { data, error } = await supabaseClient
    .from("packs")
    .insert({
      name: pack.name,
      cover_url: imageUrl,
      color: pack.color,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`No se pudo crear el sobre: ${error.message}`);
  }

  state.selectedPackId = data.id;
  return data.id;
}

async function createDemoPack(pack, file) {
  const styledImage = await stylizePackCover(file, pack.name, pack.color);
  const newPack = {
    id: crypto.randomUUID(),
    name: pack.name,
    cover_url: styledImage.dataUrl,
    color: pack.color,
    active: true,
    created_at: new Date().toISOString(),
  };
  state.packs.unshift(newPack);
  state.selectedPackId = newPack.id;
  saveDemoState();
  return newPack.id;
}

async function createRemoteCard(card, file) {
  const styledImage = await stylizeCardImage(file, card);
  const imageUrl = await uploadStyledImage(styledImage, `${Date.now()}-${slugify(card.name)}`);
  const { error: insertError } = await supabaseClient.from("cards").insert({
    ...card,
    image_url: imageUrl,
  });

  if (insertError) {
    throw new Error(`No se pudo crear la carta: ${insertError.message}`);
  }
}

async function uploadStyledImage(styledImage, filename) {
  const extension = styledImage.extension;
  const path = `${state.profile.id}/${filename}.${extension}`;
  const { error: uploadError } = await supabaseClient.storage
    .from("card-images")
    .upload(path, styledImage.file, {
      cacheControl: "3600",
      upsert: false,
      contentType: styledImage.file.type,
    });

  if (uploadError) {
    throw new Error(`No se pudo subir la imagen: ${uploadError.message}`);
  }

  const { data: publicData } = supabaseClient.storage.from("card-images").getPublicUrl(path);
  return publicData.publicUrl;
}

async function createDemoCard(card, file) {
  const styledImage = await stylizeCardImage(file, card);
  state.cards.unshift({
    id: crypto.randomUUID(),
    ...card,
    image_url: styledImage.dataUrl,
    active: true,
    created_at: new Date().toISOString(),
  });
  saveDemoState();
}

function renderAll(options = {}) {
  renderConfigState();
  updateAdminVisibility();
  renderStats();
  renderCooldown();
  renderPacks();
  renderOdds();
  renderCollection();
  renderTradePanel();
  renderActivity();
  renderAdminPackList();
  renderAdminList();
  renderAdminPlayers();

  if (!options.keepResults && !els.resultRail.children.length) {
    els.resultRail.innerHTML = `<div class="empty-state">Cuando el admin añada fotos, aquí aparecerán las cartas recién obtenidas.</div>`;
  }

  els.playerTitle.textContent = state.profile?.username || "Invitado";
  renderIcons();
}

function renderConfigState() {
  const config = getConfig();
  els.modeBadge.textContent = config?.url && config?.anonKey ? "Online" : "Local";
  if (state.mode === "supabase") {
    els.modeBadge.textContent = state.isAdmin ? "Admin" : "Jugador";
  }
  if (state.mode === "demo" && state.isAdmin) {
    els.modeBadge.textContent = "Admin";
  }
}

function renderStats() {
  const totalCopies =
    Object.values(state.collection).reduce((sum, copies) => sum + Number(copies || 0), 0) +
    Object.values(state.holoCollection).reduce((sum, copies) => sum + Number(copies || 0), 0);
  const ownedIds = new Set([
    ...Object.keys(state.collection).filter((id) => Number(state.collection[id]) > 0),
    ...Object.keys(state.holoCollection).filter((id) => Number(state.holoCollection[id]) > 0),
  ]);
  const uniqueOwned = ownedIds.size;
  const completion = state.cards.length ? Math.round((uniqueOwned / state.cards.length) * 100) : 0;
  els.ownedStat.textContent = String(totalCopies);
  els.uniqueStat.textContent = String(uniqueOwned);
  els.completionStat.textContent = `${completion}%`;
}

function renderPacks() {
  const activePack = getActivePack();
  const packCards = getActivePackCards();

  if (!state.packs.length) {
    els.packSelector.innerHTML = `<div class="empty-state">Sin sobres creados.</div>`;
    els.activePackName.textContent = "Sin sobre";
    els.activePackMeta.textContent = "El admin puede crear colecciones desde Admin.";
    els.packCoverImage.removeAttribute("src");
    els.packCoverImage.alt = "";
    els.cardPack.innerHTML = `<option value="">Crea un sobre primero</option>`;
    els.cardPack.disabled = true;
    return;
  }

  els.packSelector.innerHTML = state.packs
    .map((pack) => {
      const count = state.cards.filter((card) => card.pack_id === pack.id).length;
      return `
        <button class="pack-chip ${pack.id === state.selectedPackId ? "is-active" : ""}" type="button" data-pack-id="${pack.id}" style="--pack-color:${escapeAttribute(pack.color || "#ff6f61")}">
          <img src="${escapeAttribute(pack.cover_url)}" alt="${escapeAttribute(pack.name)}" />
          <span>${escapeHtml(pack.name)}</span>
          <small>${count}</small>
        </button>
      `;
    })
    .join("");

  els.cardPack.disabled = false;
  els.cardPack.innerHTML = state.packs
    .map((pack) => `<option value="${pack.id}">${escapeHtml(pack.name)}</option>`)
    .join("");
  els.cardPack.value = state.selectedPackId || state.packs[0].id;

  if (activePack) {
    els.activePackName.textContent = activePack.name;
    els.activePackMeta.textContent = `${packCards.length} cartas en esta colección.`;
    els.packCoverImage.src = activePack.cover_url;
    els.packCoverImage.alt = activePack.name;
    els.packObject.style.setProperty("--pack-color", activePack.color || "#ff6f61");
  }
}

function selectPack(packId) {
  if (!state.packs.some((pack) => pack.id === packId)) return;
  state.selectedPackId = packId;
  saveDemoState();
  els.resultRail.innerHTML = "";
  renderAll();
}

function getActivePack() {
  return state.packs.find((pack) => pack.id === state.selectedPackId) || state.packs[0] || null;
}

function getActivePackCards() {
  const activePack = getActivePack();
  if (!activePack) return [];
  return state.cards.filter((card) => card.pack_id === activePack.id && card.active !== false);
}

function renderCooldown() {
  if (!state.profile) return;
  const cooldownMs = getCooldownMs();
  const canOpenPack = Boolean(getActivePack() && getActivePackCards().length);
  if (cooldownMs > 0) {
    els.cooldownCopy.textContent = `Faltan ${formatDuration(cooldownMs)} para abrir otro sobre.`;
    els.openPackButton.disabled = true;
    return;
  }

  els.cooldownCopy.textContent = "Listo para abrir.";
  els.openPackButton.disabled = state.opening || !canOpenPack;
}

function getCooldownMs() {
  if (!state.lastPackOpenedAt) {
    return 0;
  }

  const openedAt = new Date(state.lastPackOpenedAt).getTime();
  if (Number.isNaN(openedAt)) {
    return 0;
  }

  return Math.max(0, openedAt + PACK_COOLDOWN_MS - Date.now());
}

function renderOdds() {
  const activePack = getActivePack();
  const packCards = getActivePackCards();
  const total = packCards.reduce((sum, card) => sum + Number(card.weight || 0), 0);
  if (!activePack) {
    els.oddsRow.innerHTML = `<span class="odds-chip">Crea el primer sobre</span>`;
    return;
  }
  if (!total) {
    els.oddsRow.innerHTML = `<span class="odds-chip">Este sobre tiene 0 cartas</span>`;
    return;
  }

  els.oddsRow.innerHTML = Object.entries(RARITIES)
    .map(([key, rarity]) => {
      const rarityWeight = packCards
        .filter((card) => card.rarity === key)
        .reduce((sum, card) => sum + Number(card.weight || 0), 0);
      const pct = Math.round((rarityWeight / total) * 1000) / 10;
      return `<span class="odds-chip" style="border-color:${rarity.color}66">${rarity.label}: ${pct}%</span>`;
    })
    .join("");
}

function renderRarityFilters() {
  const chips = [
    `<button class="filter-chip is-active" type="button" data-filter="all">Todas</button>`,
    ...Object.entries(RARITIES).map(
      ([key, rarity]) => `<button class="filter-chip" type="button" data-filter="${key}">${rarity.label}</button>`,
    ),
  ];

  els.rarityFilters.innerHTML = chips.join("");
  els.rarityFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.activeFilter = button.dataset.filter;
    $$(".filter-chip").forEach((chip) => chip.classList.toggle("is-active", chip === button));
    renderCollection();
  });
}

function renderCollection() {
  const ownedCards = state.cards.filter((card) => {
    const copies = Number(state.collection[card.id] || 0) + Number(state.holoCollection[card.id] || 0);
    return copies > 0 && (state.activeFilter === "all" || card.rarity === state.activeFilter);
  });

  if (!ownedCards.length) {
    els.collectionGrid.innerHTML = `<div class="empty-state">Ahora hay 0 fotos en el álbum.</div>`;
    return;
  }

  els.collectionGrid.innerHTML = state.packs
    .map((pack) => {
      const packCards = ownedCards.filter((card) => card.pack_id === pack.id);
      if (!packCards.length) return "";
      return `
        <section class="collection-pack-section">
          <div class="collection-pack-head">
            <img src="${escapeAttribute(pack.cover_url)}" alt="${escapeAttribute(pack.name)}" />
            <div>
              <p class="eyebrow">${escapeHtml(state.profile?.username || "Jugador")}</p>
              <h3>${escapeHtml(pack.name)}</h3>
            </div>
          </div>
          <div class="collection-pack-grid">
            ${packCards
              .map((card) => {
                const normal = Number(state.collection[card.id] || 0);
                const holo = Number(state.holoCollection[card.id] || 0);
                return [
                  normal > 0 ? renderCard(card, { forceUnlocked: true, copyCount: normal }) : "",
                  holo > 0 ? renderCard(card, { forceUnlocked: true, forceHolo: true, copyCount: holo }) : "",
                ].join("");
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderCard(inputCard, options = {}) {
  const card = normalizeCard(inputCard);
  const rarity = RARITIES[card.rarity] || RARITIES.comun;
  const isHolo = Boolean(options.forceHolo || card.is_holo);
  const copies = Number(
    options.copyCount ?? card.copy_count ?? (isHolo ? state.holoCollection[card.id] : state.collection[card.id]) ?? 0,
  );
  const locked = options.forceUnlocked ? false : copies <= 0 && !options.reveal;
  const description = locked ? "Carta por descubrir." : card.description || "Sin descripción.";
  const image = card.image_url
    ? `<img src="${escapeAttribute(card.image_url)}" alt="${escapeAttribute(card.name)}" loading="lazy" />`
    : "";

  return `
    <article class="tcg-card ${options.reveal ? "is-new" : ""} ${locked ? "is-locked" : ""} ${isHolo ? "is-holo" : ""}"
      style="--rarity-color:${rarity.color};--art-fallback:${rarity.fallback}">
      <div class="card-topline">
        <span class="rarity-badge">${rarity.label}</span>
        ${isHolo ? `<span class="holo-badge">HOLO</span>` : ""}
        <span class="copy-badge">${locked ? "0" : `x${copies || 1}`}</span>
      </div>
      <div class="card-art">${image}</div>
      <div>
        <h3 class="card-name">${locked ? "Carta oculta" : escapeHtml(card.name)}</h3>
        <p class="card-description">${escapeHtml(description)}</p>
      </div>
    </article>
  `;
}

function renderActivity() {
  if (!state.activity.length) {
    els.activityList.innerHTML = `<div class="empty-state">Todavía no hay actividad.</div>`;
    return;
  }

  els.activityList.innerHTML = state.activity
    .slice(0, 8)
    .map((item) => {
      const card = normalizeCard(item.card);
      const rarity = RARITIES[card.rarity] || RARITIES.comun;
      return `
        <article class="activity-item" style="--rarity-color:${rarity.color}">
          <img class="activity-thumb" src="${escapeAttribute(card.image_url)}" alt="${escapeAttribute(card.name)}" />
          <div>
            <p><strong>${escapeHtml(item.username)}</strong> sacó ${escapeHtml(card.name)}${item.is_holo ? " HOLO" : ""}</p>
            <span>${rarity.label} · ${escapeHtml(item.pack?.name || "Sobre")} · ${relativeTime(item.created_at)}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTradePanel() {
  if (!state.profile) return;

  const otherPlayers = state.players.filter((player) => player.id !== state.profile.id);
  const ownCards = getCardsFromCollection(state.profile.id);
  const selectedPlayerId = otherPlayers.some((player) => player.id === els.tradePlayer.value)
    ? els.tradePlayer.value
    : otherPlayers[0]?.id || "";
  const targetCards = selectedPlayerId ? getCardsFromCollection(selectedPlayerId) : [];

  els.tradePlayer.innerHTML = otherPlayers.length
    ? otherPlayers.map((player) => `<option value="${player.id}">${escapeHtml(player.username)}</option>`).join("")
    : `<option value="">No hay otros jugadores</option>`;
  els.tradePlayer.value = selectedPlayerId;
  els.tradePlayer.disabled = !otherPlayers.length;

  els.tradeOfferCard.innerHTML = ownCards.length
    ? ownCards.map((card) => `<option value="${card.id}">${escapeHtml(card.name)} x${state.collection[card.id]}</option>`).join("")
    : `<option value="">No tienes cartas</option>`;
  els.tradeOfferCard.disabled = !ownCards.length;

  els.tradeRequestCard.innerHTML = targetCards.length
    ? targetCards
        .map((card) => {
          const copies = state.allCollections[selectedPlayerId]?.[card.id] || 0;
          return `<option value="${card.id}">${escapeHtml(card.name)} x${copies}</option>`;
        })
        .join("")
    : `<option value="">Sin cartas disponibles</option>`;
  els.tradeRequestCard.disabled = !targetCards.length;

  const canPropose = Boolean(otherPlayers.length && ownCards.length && targetCards.length);
  els.tradeForm.querySelector("button").disabled = !canPropose;

  const relevantTrades = state.trades.filter(
    (trade) => trade.from_user_id === state.profile.id || trade.to_user_id === state.profile.id,
  );

  if (!relevantTrades.length) {
    els.tradeList.innerHTML = `<div class="empty-state">No hay intercambios pendientes.</div>`;
    return;
  }

  els.tradeList.innerHTML = relevantTrades
    .map((trade) => {
      const incoming = trade.to_user_id === state.profile.id;
      const fromPlayer = getPlayer(trade.from_user_id);
      const toPlayer = getPlayer(trade.to_user_id);
      const offerCard = getCard(trade.offer_card_id);
      const requestCard = getCard(trade.request_card_id);
      const actions = incoming
        ? `
          <button class="secondary-button" type="button" data-trade-action="decline" data-trade-id="${trade.id}">Rechazar</button>
          <button class="primary-button" type="button" data-trade-action="accept" data-trade-id="${trade.id}">Aceptar</button>
        `
        : `<button class="secondary-button" type="button" data-trade-action="cancel" data-trade-id="${trade.id}">Cancelar</button>`;

      return `
        <article class="trade-item">
          <div>
            <p><strong>${escapeHtml(fromPlayer?.username || "Jugador")}</strong> ofrece ${escapeHtml(offerCard?.name || "Carta")}</p>
            <span>por ${escapeHtml(requestCard?.name || "Carta")} de ${escapeHtml(toPlayer?.username || "Jugador")}</span>
          </div>
          <div class="trade-actions">${actions}</div>
        </article>
      `;
    })
    .join("");
}

function renderAdminPackList() {
  if (!state.packs.length) {
    els.adminPackList.innerHTML = `<div class="empty-state">Ahora hay 0 sobres.</div>`;
    return;
  }

  els.adminPackList.innerHTML = state.packs
    .map((pack) => {
      const count = state.cards.filter((card) => card.pack_id === pack.id).length;
      return `
        <article class="small-card-row" style="--pack-color:${escapeAttribute(pack.color || "#ff6f61")}">
          <img class="small-card-thumb" src="${escapeAttribute(pack.cover_url)}" alt="${escapeAttribute(pack.name)}" />
          <div>
            <p><strong>${escapeHtml(pack.name)}</strong></p>
            <span>${count} cartas</span>
          </div>
          <button class="icon-button danger-button" type="button" data-delete-pack-id="${pack.id}" aria-label="Borrar ${escapeAttribute(pack.name)}">
            <i data-lucide="trash-2"></i>
          </button>
        </article>
      `;
    })
    .join("");
}

function renderAdminList() {
  if (!state.cards.length) {
    els.adminCardList.innerHTML = `<div class="empty-state">Ahora hay 0 fotos en el archivo.</div>`;
    return;
  }

  els.adminCardList.innerHTML = state.cards
    .slice(0, 18)
    .map((card) => {
      const rarity = RARITIES[card.rarity] || RARITIES.comun;
      const pack = state.packs.find((candidate) => candidate.id === card.pack_id);
      return `
        <article class="small-card-row">
          <img class="small-card-thumb" src="${escapeAttribute(card.image_url)}" alt="${escapeAttribute(card.name)}" />
          <div>
            <p><strong>${escapeHtml(card.name)}</strong></p>
            <span>${rarity.label} · ${escapeHtml(pack?.name || "Sin sobre")} · peso ${Number(card.weight || 0)}</span>
          </div>
          <button class="icon-button danger-button" type="button" data-delete-card-id="${card.id}" aria-label="Borrar ${escapeAttribute(card.name)}">
            <i data-lucide="trash-2"></i>
          </button>
        </article>
      `;
    })
    .join("");
}

function renderAdminPlayers() {
  if (!state.isAdmin) {
    els.adminPlayerList.innerHTML = "";
    return;
  }
  if (!state.players.length) {
    els.adminPlayerList.innerHTML = `<div class="empty-state">Aún no hay jugadores.</div>`;
    return;
  }

  els.adminPlayerList.innerHTML = state.players
    .map((player) => {
      const collection = state.allCollections[player.id] || {};
      const holoCollection = state.allHoloCollections[player.id] || {};
      const totalCopies =
        Object.values(collection).reduce((sum, copies) => sum + Number(copies || 0), 0) +
        Object.values(holoCollection).reduce((sum, copies) => sum + Number(copies || 0), 0);
      const unique = new Set([
        ...Object.keys(collection).filter((cardId) => Number(collection[cardId]) > 0),
        ...Object.keys(holoCollection).filter((cardId) => Number(holoCollection[cardId]) > 0),
      ]).size;
      const holos = Object.values(holoCollection).reduce((sum, copies) => sum + Number(copies || 0), 0);
      const cooldown = getPlayerCooldown(player);
      return `
        <article class="small-card-row player-row">
          <div class="player-avatar">${escapeHtml(player.username.slice(0, 2).toUpperCase())}</div>
          <div>
            <p><strong>${escapeHtml(player.username)}</strong>${player.is_admin ? " · admin" : ""}</p>
            <span>${totalCopies} cartas · ${unique} únicas · ${holos} holo · ${cooldown}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function getConfig() {
  const staticConfig = getStaticConfig();
  if (staticConfig?.url || staticConfig?.anonKey || staticConfig?.accessPassword || staticConfig?.adminPassword) {
    return staticConfig;
  }

  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.config) || "null");
  } catch {
    return null;
  }
}

function getStaticConfig() {
  const staticConfig = window.ALDEPE_CONFIG || window.PACKFORGE_CONFIG;
  const url = staticConfig?.supabaseUrl?.trim();
  const anonKey = staticConfig?.supabaseAnonKey?.trim();
  const accessPassword = staticConfig?.accessPassword?.trim();
  const accessPasswordSha256 = staticConfig?.accessPasswordSha256?.trim();
  const adminPassword = staticConfig?.adminPassword?.trim();

  if (!url && !anonKey && !accessPassword && !accessPasswordSha256 && !adminPassword) {
    return null;
  }

  return { url, anonKey, accessPassword, accessPasswordSha256, adminPassword };
}

async function validateAccessPassword(password, config) {
  const expected = config?.accessPassword || "aldepe";
  const expectedHash = config?.accessPasswordSha256;
  const adminPassword = config?.adminPassword || "aldepe-admin";

  if (password === adminPassword || password === expected) {
    return true;
  }

  if (!expectedHash) {
    return false;
  }

  return (await sha256(password)) === expectedHash;
}

function isDemoAdmin(username, password, config) {
  const adminPassword = config?.adminPassword || "aldepe-admin";
  return password === adminPassword;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function saveConfig() {
  const url = els.supabaseUrl.value.trim();
  const anonKey = els.supabaseAnonKey.value.trim();

  if (!url || !anonKey) {
    showToast("Pega la Project URL y la anon public key.");
    return;
  }

  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify({ url, anonKey }));
  els.settingsModal.close();
  renderConfigState();
  showToast("Conexión guardada.");
}

function clearConfig() {
  localStorage.removeItem(STORAGE_KEYS.config);
  supabaseClient = null;
  state.mode = "demo";
  els.supabaseUrl.value = "";
  els.supabaseAnonKey.value = "";
  els.settingsModal.close();
  renderConfigState();
  showToast("Modo local activado.");
}

function readDemoState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.demo) || "null");
    if (saved) {
      return {
        packs: saved.packs || [],
        selectedPackId: saved.selectedPackId || null,
        cards: saved.cards || [],
        players: ensureDemoTestPlayer(saved.players || []),
        collectionsByPlayer: saved.collectionsByPlayer || {},
        holoCollectionsByPlayer: saved.holoCollectionsByPlayer || {},
        trades: saved.trades || [],
        activity: saved.activity || [],
        lastPackOpenedAtByPlayer: saved.lastPackOpenedAtByPlayer || {},
      };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEYS.demo);
  }

  const initial = {
    packs: [],
    selectedPackId: null,
    cards: [],
    players: ensureDemoTestPlayer([]),
    collectionsByPlayer: {},
    holoCollectionsByPlayer: {},
    trades: [],
    activity: [],
    lastPackOpenedAtByPlayer: {},
  };
  localStorage.setItem(STORAGE_KEYS.demo, JSON.stringify(initial));
  return initial;
}

function ensureDemoTestPlayer(players) {
  const testPlayerId = "demo:tester";
  if (players.some((player) => player.id === testPlayerId)) {
    return players;
  }

  return [
    ...players,
    {
      id: testPlayerId,
      username: "Tester",
      is_admin: false,
      created_at: new Date().toISOString(),
      last_pack_opened_at: null,
    },
  ];
}

function saveDemoState() {
  if (state.mode !== "demo") return;
  localStorage.setItem(
    STORAGE_KEYS.demo,
    JSON.stringify({
      cards: state.cards,
      packs: state.packs,
      selectedPackId: state.selectedPackId,
      players: state.players.map((player) =>
        player.id === state.profile.id ? { ...player, last_pack_opened_at: state.lastPackOpenedAt } : player,
      ),
      collectionsByPlayer: {
        ...state.allCollections,
        [state.profile.id]: state.collection,
      },
      holoCollectionsByPlayer: {
        ...state.allHoloCollections,
        [state.profile.id]: state.holoCollection,
      },
      trades: state.trades,
      activity: state.activity,
      lastPackOpenedAtByPlayer: {
        ...(readDemoState().lastPackOpenedAtByPlayer || {}),
        [state.profile.id]: state.lastPackOpenedAt,
      },
    }),
  );
}

function weightedPick(cards) {
  const candidates = cards.filter((card) => card.active !== false && Number(card.weight) > 0);
  const total = candidates.reduce((sum, card) => sum + Number(card.weight || 0), 0);
  let roll = Math.random() * total;

  for (const card of candidates) {
    roll -= Number(card.weight || 0);
    if (roll <= 0) {
      return card;
    }
  }

  return candidates[candidates.length - 1];
}

function groupCollectionsByPlayer(rows) {
  return rows.reduce((collections, row) => {
    if (!collections[row.user_id]) {
      collections[row.user_id] = {};
    }
    collections[row.user_id][row.card_id] = Number(row.copies || 0);
    return collections;
  }, {});
}

function groupHoloCollectionsByPlayer(rows) {
  return rows.reduce((collections, row) => {
    const copies = Number(row.holo_copies || 0);
    if (!copies) return collections;
    if (!collections[row.user_id]) {
      collections[row.user_id] = {};
    }
    collections[row.user_id][row.card_id] = copies;
    return collections;
  }, {});
}

function getCardsFromCollection(userId) {
  const collection = state.allCollections[userId] || {};
  return state.cards.filter((card) => Number(collection[card.id] || 0) > 0);
}

function getPlayer(userId) {
  return state.players.find((player) => player.id === userId);
}

function getCard(cardId) {
  return state.cards.find((card) => card.id === cardId);
}

function getPlayerCooldown(player) {
  if (!player?.last_pack_opened_at) {
    return "sobre listo";
  }

  const openedAt = new Date(player.last_pack_opened_at).getTime();
  if (Number.isNaN(openedAt)) {
    return "sobre listo";
  }

  const remaining = Math.max(0, openedAt + PACK_COOLDOWN_MS - Date.now());
  return remaining > 0 ? `faltan ${formatDuration(remaining)}` : "sobre listo";
}

function removeCardsFromAllCollections(cardIds) {
  for (const collection of Object.values(state.allCollections)) {
    for (const cardId of cardIds) {
      delete collection[cardId];
    }
  }
  for (const collection of Object.values(state.allHoloCollections)) {
    for (const cardId of cardIds) {
      delete collection[cardId];
    }
  }
  state.collection = state.allCollections[state.profile.id] || {};
  state.holoCollection = state.allHoloCollections[state.profile.id] || {};
}

function acceptDemoTrade(trade) {
  const fromCollection = state.allCollections[trade.from_user_id] || {};
  const toCollection = state.allCollections[trade.to_user_id] || {};

  if ((fromCollection[trade.offer_card_id] || 0) <= 0 || (toCollection[trade.request_card_id] || 0) <= 0) {
    throw new Error("Alguna carta ya no está disponible.");
  }

  moveCardCopy(fromCollection, toCollection, trade.offer_card_id);
  moveCardCopy(toCollection, fromCollection, trade.request_card_id);
  trade.status = "accepted";
}

function moveCardCopy(fromCollection, toCollection, cardId) {
  fromCollection[cardId] = Number(fromCollection[cardId] || 0) - 1;
  if (fromCollection[cardId] <= 0) {
    delete fromCollection[cardId];
  }
  toCollection[cardId] = Number(toCollection[cardId] || 0) + 1;
}

function normalizeCard(card) {
  if (!card) {
    return {
      id: "missing",
      name: "Carta desconocida",
      rarity: "comun",
      description: "",
      image_url: "",
      weight: 1,
    };
  }

  return {
    id: card.id,
    pack_id: card.pack_id,
    name: card.name,
    rarity: card.rarity || "comun",
    description: card.description || "",
    image_url: card.image_url || "",
    weight: Number(card.weight || 1),
    active: card.active !== false,
    copy_count: card.copy_count,
    is_holo: Boolean(card.is_holo),
  };
}

function normalizePack(pack) {
  if (!pack) {
    return {
      id: "missing-pack",
      name: "Sobre",
      cover_url: "",
    };
  }

  return {
    id: pack.id,
    name: pack.name || "Sobre",
    cover_url: pack.cover_url || "",
    color: pack.color || "#ff6f61",
    active: pack.active !== false,
  };
}

async function stylizeCardImage(file, card) {
  const source = await loadImage(file);
  const rarity = RARITIES[card.rarity] || RARITIES.comun;
  const canvas = document.createElement("canvas");
  const width = 700;
  const height = 980;
  const frame = 34;
  const art = {
    x: 62,
    y: 84,
    width: width - 124,
    height: height - 238,
  };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = "#171716";
  ctx.fillRect(0, 0, width, height);
  drawCoverImage(ctx, source, art.x, art.y, art.width, art.height);

  const imageData = ctx.getImageData(art.x, art.y, art.width, art.height);
  const tint = hexToRgb(rarity.color);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const x = (index / 4) % art.width;
    const y = Math.floor(index / 4 / art.width);
    const noise = ((x * 13 + y * 17 + x * y) % 29) - 14;
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const ink = luma < 70 ? 0.86 : luma > 198 ? 1.12 : 1;

    imageData.data[index] = clamp(Math.round(posterize(red * 1.14 * ink + tint.r * 0.14 + noise, 28)));
    imageData.data[index + 1] = clamp(Math.round(posterize(green * 1.12 * ink + tint.g * 0.12 + noise, 28)));
    imageData.data[index + 2] = clamp(Math.round(posterize(blue * 1.08 * ink + tint.b * 0.16 + noise, 28)));
  }
  ctx.putImageData(imageData, art.x, art.y);

  const vignette = ctx.createRadialGradient(width / 2, height * 0.4, 60, width / 2, height * 0.44, height * 0.68);
  vignette.addColorStop(0, "rgba(255,255,255,0.12)");
  vignette.addColorStop(0.58, "rgba(255,255,255,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.44)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  for (let y = art.y; y < art.y + art.height; y += 18) {
    ctx.beginPath();
    ctx.moveTo(art.x, y + 0.5);
    ctx.lineTo(art.x + art.width, y + 0.5);
    ctx.stroke();
  }

  const border = ctx.createLinearGradient(0, 0, width, height);
  border.addColorStop(0, "#f6f2e8");
  border.addColorStop(0.32, rarity.color);
  border.addColorStop(0.68, "#11110f");
  border.addColorStop(1, "#f2bd4b");

  ctx.lineWidth = frame;
  ctx.strokeStyle = border;
  ctx.strokeRect(frame / 2, frame / 2, width - frame, height - frame);

  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(246,242,232,0.76)";
  ctx.strokeRect(art.x - 10, art.y - 10, art.width + 20, art.height + 20);

  ctx.fillStyle = "rgba(17,17,15,0.82)";
  ctx.fillRect(62, 836, width - 124, 84);
  ctx.strokeStyle = `${rarity.color}cc`;
  ctx.lineWidth = 3;
  ctx.strokeRect(62, 836, width - 124, 84);

  ctx.fillStyle = "#f6f2e8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitText(ctx, card.name, width - 166, 42, "Inter, Arial, sans-serif");
  ctx.fillText(card.name, width / 2, 878);

  ctx.fillStyle = rarity.color;
  ctx.fillRect(92, 54, 142, 28);
  ctx.fillStyle = "#11110f";
  ctx.font = "700 18px Inter, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(rarity.label.toUpperCase(), 102, 69);

  const blob = await canvasToBlob(canvas);
  const extension = blob.type.includes("webp") ? "webp" : "png";
  const styledFile = new File([blob], `${slugify(card.name)}.${extension}`, { type: blob.type });

  return {
    dataUrl: await blobToDataUrl(blob),
    extension,
    file: styledFile,
  };
}

async function stylizePackCover(file, packName, color = "#ff6f61") {
  const source = await loadImage(file);
  const accent = hexToRgb(color);
  const canvas = document.createElement("canvas");
  const width = 700;
  const height = 980;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = "#11110f";
  ctx.fillRect(0, 0, width, height);
  drawCoverImage(ctx, source, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const x = (index / 4) % width;
    const y = Math.floor(index / 4 / width);
    const noise = ((x * 11 + y * 19 + x * y) % 31) - 15;
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const luma = red * 0.25 + green * 0.58 + blue * 0.17;

    imageData.data[index] = clamp(posterize(luma * 0.82 + accent.r * 0.32 + noise, 24));
    imageData.data[index + 1] = clamp(posterize(green * 0.72 + accent.g * 0.28 + noise, 24));
    imageData.data[index + 2] = clamp(posterize(blue * 0.72 + accent.b * 0.36 + noise, 24));
  }
  ctx.putImageData(imageData, 0, 0);

  const wash = ctx.createLinearGradient(0, 0, width, height);
  wash.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},0.34)`);
  wash.addColorStop(0.42, "rgba(255,111,97,0.2)");
  wash.addColorStop(1, "rgba(62,216,163,0.26)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(246,242,232,0.22)";
  ctx.lineWidth = 2;
  for (let y = 18; y < height; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + Math.sin(y * 0.04) * 16);
    ctx.stroke();
  }

  ctx.lineWidth = 42;
  const border = ctx.createLinearGradient(0, 0, width, height);
  border.addColorStop(0, color);
  border.addColorStop(0.45, "#ff6f61");
  border.addColorStop(1, "#3ed8a3");
  ctx.strokeStyle = border;
  ctx.strokeRect(21, 21, width - 42, height - 42);

  ctx.fillStyle = "rgba(17,17,15,0.82)";
  ctx.fillRect(72, 760, width - 144, 120);
  ctx.strokeStyle = "rgba(246,242,232,0.72)";
  ctx.lineWidth = 4;
  ctx.strokeRect(72, 760, width - 144, 120);

  ctx.fillStyle = "#f6f2e8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitText(ctx, packName, width - 190, 54, "Inter, Arial, sans-serif");
  ctx.fillText(packName, width / 2, 820);

  const blob = await canvasToBlob(canvas);
  const extension = blob.type.includes("webp") ? "webp" : "png";
  const styledFile = new File([blob], `${slugify(packName)}.${extension}`, { type: blob.type });

  return {
    dataUrl: await blobToDataUrl(blob),
    extension,
    file: styledFile,
  };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo procesar la imagen."));
    };
    image.src = url;
  });
}

function drawCoverImage(ctx, image, x, y, width, height) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (imageRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        canvas.toBlob((fallbackBlob) => {
          if (fallbackBlob) resolve(fallbackBlob);
          else reject(new Error("No se pudo generar la carta estilizada."));
        }, "image/png");
      }
    }, "image/webp", 0.92);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen estilizada."));
    reader.readAsDataURL(blob);
  });
}

function fitText(ctx, text, maxWidth, maxSize, family) {
  let size = maxSize;
  do {
    ctx.font = `900 ${size}px ${family}`;
    size -= 1;
  } while (size > 18 && ctx.measureText(text).width > maxWidth);
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255,
  };
}

function posterize(value, step) {
  return Math.round(value / step) * step;
}

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}

async function imageSourceToFile(source, name, color = "#ff6f61") {
  if (!source) {
    return generatedPlaceholderFile(name, color);
  }

  if (typeof source !== "string") {
    return generatedPlaceholderFile(name, color);
  }

  if (source.startsWith("data:")) {
    const response = await fetch(source);
    const blob = await response.blob();
    return new File([blob], `${slugify(name)}.${blob.type.includes("png") ? "png" : "webp"}`, { type: blob.type });
  }

  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`No pude descargar imagen: ${source}`);
    const blob = await response.blob();
    return new File([blob], `${slugify(name)}.${blob.type.includes("png") ? "png" : "jpg"}`, { type: blob.type });
  }

  return generatedPlaceholderFile(name, color);
}

async function generatedPlaceholderFile(name, color = "#ff6f61") {
  const canvas = document.createElement("canvas");
  canvas.width = 700;
  canvas.height = 980;
  const ctx = canvas.getContext("2d");
  const accent = hexToRgb(color);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.48, "#f2bd4b");
  gradient.addColorStop(1, "#3ed8a3");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},0.28)`;
  for (let index = 0; index < 18; index += 1) {
    ctx.beginPath();
    ctx.arc((index * 97) % 700, (index * 181) % 980, 42 + (index % 5) * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(17,17,15,0.72)";
  ctx.fillRect(68, 420, 564, 140);
  ctx.fillStyle = "#f6f2e8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitText(ctx, name, 500, 54, "Inter, Arial, sans-serif");
  ctx.fillText(name, 350, 490);
  const blob = await canvasToBlob(canvas);
  return new File([blob], `${slugify(name)}.webp`, { type: blob.type });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "carta";
}

function safeExtension(filename) {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) {
    return extension === "jpeg" ? "jpg" : extension;
  }
  return "png";
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours) parts.push(`${hours}h`);
  if (minutes || hours) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function relativeTime(value) {
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  for (const [unit, amount] of units) {
    if (Math.abs(seconds) >= amount) {
      return formatter.format(Math.round(seconds / amount), unit);
    }
  }
  return formatter.format(seconds, "second");
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem(STORAGE_KEYS.sound, state.soundEnabled ? "on" : "off");
  renderSoundButton();
  playSound("tap");
}

function renderSoundButton() {
  els.soundButton.innerHTML = `<i data-lucide="${state.soundEnabled ? "volume-2" : "volume-x"}"></i>`;
  renderIcons();
}

function getAudioContext() {
  if (!state.soundEnabled) return null;
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

function playSound(type) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const patterns = {
    tap: [[420, 0.025, 0.035]],
    open: [
      [120, 0.05, 0.08],
      [180, 0.12, 0.09],
      [260, 0.22, 0.08],
    ],
    reveal: [
      [520, 0, 0.06],
      [780, 0.07, 0.08],
    ],
    legendary: [
      [392, 0, 0.08],
      [587, 0.08, 0.09],
      [880, 0.17, 0.14],
      [1175, 0.28, 0.2],
    ],
  };

  for (const [frequency, offset, duration] of patterns[type] || patterns.tap) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type === "legendary" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, now + offset);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.08, now + offset + duration);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(type === "open" ? 0.14 : 0.09, now + offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + duration + 0.02);
  }
}

function tiltPack(event) {
  const rect = els.packObject.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  els.packObject.style.setProperty("--tilt-x", `${-y * 10}deg`);
  els.packObject.style.setProperty("--tilt-y", `${x * 14}deg`);
}

function resetPackTilt() {
  els.packObject.style.setProperty("--tilt-x", "0deg");
  els.packObject.style.setProperty("--tilt-y", "0deg");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 3600);
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeSvgText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
