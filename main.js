const SCOPE = "game";
const feedEl = document.getElementById("feed");
const choicesEl = document.getElementById("choices");
const hudEl = document.getElementById("hud");

// Global game state
const G = {
  rngSeed: 987654321,
  wallet: 20,
  vars: { mood: 0, trust: 0, heat: 0, drunk: 0, romance: 0, guard_near: 1, crowd: 2 },
  events: {},
  directives: [],
  inventory: null,
  prefs: null,
  quests: null,
  scenes: null,
  barks: null
};

// Behavior3
let bb, barkeepTree, guardTree, strangerTree;

// RNG
function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(G.rngSeed);

// UI helpers
function say(speaker, text) {
  const p = document.createElement("p");
  p.innerHTML = `<span class="k">${speaker}</span>: ${text}`;
  feedEl.appendChild(p);
  feedEl.scrollTop = feedEl.scrollHeight;
}
function sys(text) {
  const p = document.createElement("p");
  p.className = "sys";
  p.textContent = text;
  feedEl.appendChild(p);
  feedEl.scrollTop = feedEl.scrollHeight;
}
function setHud() {
  const s = G.inventory?.stock || {};
  const stockLine = Object.entries(s).slice(0,6).map(([k,v]) => `${k}:${v}`).join(" ");
  hudEl.innerHTML = `cash <span class="v">$${G.wallet}</span> • trust <span class="v">${G.vars.trust}</span> • heat <span class="v">${G.vars.heat}</span> • drunk <span class="v">${G.vars.drunk}</span> • stock <span class="v">${stockLine}</span>`;
}

// Events
function pushEvent(name) {
  const c = G.events[name] || 0;
  G.events[name] = c + 1;
}
function consumeEvent(name) {
  if (!G.events[name]) return false;
  G.events[name]--;
  if (G.events[name] <= 0) delete G.events[name];
  return true;
}

// Reducers
function canServe(drink) {
  const rec = G.inventory.recipes[drink];
  if (!rec) return { ok: false, reason: "unknown" };
  if (G.wallet < rec.price) return { ok: false, reason: "funds" };
  for (const [ing, need] of Object.entries(rec.ingredients)) {
    if ((G.inventory.stock[ing] || 0) < need) return { ok: false, reason: "stock", ing };
  }
  return { ok: true, price: rec.price };
}
function serve(drink) {
  const rec = G.inventory.recipes[drink];
  for (const [ing, need] of Object.entries(rec.ingredients)) {
    G.inventory.stock[ing] -= need;
  }
  G.wallet -= rec.price;
  G.vars.drunk += rec.effects?.drunk ?? 1;
  G.vars.mood += rec.effects?.mood ?? 1;
  G.vars.trust += rec.effects?.trust ?? 0;
  setHud();
  return true;
}
function tip(amount) {
  if (G.wallet < amount) return false;
  G.wallet -= amount;
  G.vars.trust += amount >= 5 ? 2 : 1;
  G.vars.heat = Math.max(0, G.vars.heat - (amount >= 5 ? 1 : 0));
  setHud();
  return true;
}

// Scenes
function divert(path) {
  const entry = G.scenes[path];
  if (!entry) { sys(`missing scene: ${path}`); return; }
  const lines = Array.isArray(entry) ? entry : [entry];
  const pick = lines[Math.floor(rng() * lines.length)];
  say(pick.speaker || "Scene", pick.text || String(pick));
}

// Directive queue
function enqueue(d) {
  G.directives.push(d);
}
function applyDirectives() {
  const q = G.directives.splice(0);
  for (const d of q) {
    if (d.type === "say") say(d.speaker || "NPC", d.text);
    if (d.type === "divert") divert(d.path);
  }
}

// Custom BT nodes
class IfEvent extends b3.Action {
  tick(t) { const name = this.properties.name; return G.events[name] ? b3.SUCCESS : b3.FAILURE; }
}
class ConsumeEvent extends b3.Action {
  tick(t) { const name = this.properties.name; return consumeEvent(name) ? b3.SUCCESS : b3.FAILURE; }
}
class AddVar extends b3.Action {
  tick(t) { const k = this.properties.key; const d = Number(this.properties.delta || 0); G.vars[k] = (G.vars[k] || 0) + d; setHud(); return b3.SUCCESS; }
}
class IfVarGte extends b3.Action {
  tick(t) { const k = this.properties.key; const v = Number(this.properties.value || 0); return (G.vars[k] || 0) >= v ? b3.SUCCESS : b3.FAILURE; }
}
class IfVarLte extends b3.Action {
  tick(t) { const k = this.properties.key; const v = Number(this.properties.value || 0); return (G.vars[k] || 0) <= v ? b3.SUCCESS : b3.FAILURE; }
}
class QueueSay extends b3.Action {
  tick(t) { enqueue({ type: "say", speaker: this.properties.speaker || "NPC", text: this.properties.text || "" }); return b3.SUCCESS; }
}
class QueueDivert extends b3.Action {
  tick(t) { enqueue({ type: "divert", path: this.properties.path }); return b3.SUCCESS; }
}
class ServeDrink extends b3.Action {
  tick(t) {
    const drink = this.properties.drink;
    const res = canServe(drink);
    if (res.ok) {
      serve(drink);
      enqueue({ type: "say", speaker: "Barkeep", text: G.barks.serve_success[Math.floor(rng() * G.barks.serve_success.length)] });
      enqueue({ type: "divert", path: "barkeep.serve" });
      return b3.SUCCESS;
    }
    if (res.reason === "funds") {
      enqueue({ type: "say", speaker: "Barkeep", text: G.barks.no_funds[Math.floor(rng() * G.barks.no_funds.length)] });
      enqueue({ type: "divert", path: "barkeep.deny" });
      return b3.SUCCESS;
    }
    if (res.reason === "stock") {
      enqueue({ type: "say", speaker: "Barkeep", text: G.barks.out_of_stock[Math.floor(rng()*G.barks.out_of_stock.length)].replace("{item}", res.ing) });
      enqueue({ type: "divert", path: "barkeep.out_of_stock" });
      return b3.SUCCESS;
    }
    return b3.FAILURE;
  }
}
class TakeTip extends b3.Action {
  tick(t) {
    const amt = Number(this.properties.amount || 1);
    if (tip(amt)) {
      enqueue({ type: "say", speaker: "Barkeep", text: G.barks.thanks[Math.floor(rng() * G.barks.thanks.length)] });
      return b3.SUCCESS;
    } else {
      enqueue({ type: "say", speaker: "Barkeep", text: G.barks.no_funds[Math.floor(rng() * G.barks.no_funds.length)] });
      return b3.SUCCESS;
    }
  }
}

// Load JSON helper
async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path);
  return r.json();
}

// Build trees
function buildTree(def) {
  const tree = new b3.BehaviorTree();
  tree.load(def, { IfEvent, ConsumeEvent, AddVar, IfVarGte, IfVarLte, QueueSay, QueueDivert, ServeDrink, TakeTip });
  return tree;
}

// Choices
const BASE_CHOICES = [
  { id: "order_ale", label: "Order Ale" },
  { id: "order_gin_tonic", label: "Order Gin & Tonic" },
  { id: "order_old_fashioned", label: "Order Old Fashioned" },
  { id: "tip_2", label: "Tip $2" },
  { id: "ask_rumor", label: "Ask for a rumor" },
  { id: "call_guard", label: "Call the guard" },
  { id: "walk_out", label: "Walk out without paying" }
];

function getChoices() {
  const cs = [];
  cs.push("order_ale","order_gin_tonic","order_old_fashioned","tip_2");
  if (G.vars.heat >= 2) cs.push("call_guard");
  cs.push("ask_rumor","walk_out");
  return cs.slice(0,6).map(id => ({ id, label: BASE_CHOICES.find(c => c.id === id).label }));
}

function renderChoices() {
  const cs = getChoices();
  choicesEl.innerHTML = "";
  cs.forEach(c => {
    const b = document.createElement("button");
    b.textContent = c.label;
    b.onclick = () => choose(c.id, c.label);
    choicesEl.appendChild(b);
  });
}

// Choice handler
function choose(id, label) {
  say("You", label);
  switch(id) {
    case "order_ale": pushEvent("order_ale"); break;
    case "order_gin_tonic": pushEvent("order_gin_tonic"); break;
    case "order_old_fashioned": pushEvent("order_old_fashioned"); break;
    case "tip_2": pushEvent("tip_2"); break;
    case "ask_rumor": pushEvent("ask_rumor"); break;
    case "call_guard": pushEvent("alarm"); break;
    case "walk_out": pushEvent("theft"); break;
  }
  tickAll();
  renderChoices();
}

function tickAll() {
  barkeepTree.tick({game:G}, bb);
  guardTree.tick({game:G}, bb);
  strangerTree.tick({game:G}, bb);
  applyDirectives();
  setHud();
  save();
}

// Persistence
function save() {
  localStorage.setItem("redwood-save", JSON.stringify({ G }));
}
function load() {
  try {
    const raw = localStorage.getItem("redwood-save");
    if (!raw) return;
    const s = JSON.parse(raw)?.G;
    if (!s) return;
    Object.assign(G, s);
  } catch {}
}

// Boot
(async function() {
  load();
  setHud();
  sys("loading content...");
  const [inventory, prefs, quests, scenes, barks, tBar, tGuard, tStranger] = await Promise.all([
    loadJSON("./data/inventory.json"),
    loadJSON("./data/preferences.json"),
    loadJSON("./data/quests.json"),
    loadJSON("./data/dialogue/scenes.json"),
    loadJSON("./data/dialogue/barks.json"),
    loadJSON("./bt/bar_scene.tree.json"),
    loadJSON("./bt/guard.tree.json"),
    loadJSON("./bt/stranger.tree.json")
  ]);
  G.inventory = inventory; G.prefs = prefs; G.quests = quests; G.scenes = scenes; G.barks = barks;
  bb = new b3.Blackboard();
  barkeepTree = buildTree(tBar);
  guardTree = buildTree(tGuard);
  strangerTree = buildTree(tStranger);
  sys("welcome to the Redwood Bar.");
  renderChoices();
  setHud();
})();
