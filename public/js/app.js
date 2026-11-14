/* Pagachain Explorer — interfaz y rutas EIP-3091 */
import {
  CHAIN_ID, CHAIN_NAME, NATIVE, PAGA, WCENT, TOKENS, LOG_RANGE,
  HOME_BLOCK_BATCH, HOME_LOOKBACK, HOME_TARGET_BLOCKS, HOME_TARGET_TXS,
  knownToken, isSystemTx, userTxs, isEmptyBlock,
} from "./config.js";
import {
  rpcEndpoint, getChainId, getBlockNumber, getBlock, getBlocksByNumbers,
  getTx, getReceipt, getBalance, getCode, ethCall, getTransferLogs,
  windowFor, topicAddress,
} from "./rpc.js";
import {
  checksumAddress, shortHash, shortAddr, hexToBig, fmtInt, fmtAmount,
  fmtToken, fmtTime, timeAgo, methodOf, decodeAbiString,
  looksLikeTx, looksLikeAddr, looksLikeBlock,
} from "./format.js";

const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");
const searchForm = $("#search-form");
const searchInput = $("#search-input");
const heightEl = $("#chain-height");
const statusEl = $("#rpc-status");

let lastLatest = 0;
let homeState = null;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function go(path, replace = false) {
  const url = path.startsWith("/") ? path : "/" + path;
  if (replace) history.replaceState({ path: url }, "", url);
  else if (location.pathname !== url) history.pushState({ path: url }, "", url);
  render();
}

function pathOf() {
  return location.pathname || "/";
}

function aBlock(n) {
  return `<a href="/block/${n}">${fmtInt(n)}</a>`;
}
function aTx(h, label) {
  return `<a class="mono" href="/tx/${h}" title="${esc(h)}">${esc(label || shortHash(h))}</a>`;
}
function aAddr(addr, label) {
  if (!addr) return `<span class="muted">contrato creado</span>`;
  const c = checksumAddress(addr);
  const tok = knownToken(c);
  const text = label || (tok ? tok.symbol : shortAddr(c));
  const href = tok ? `/token/${c}` : `/address/${c}`;
  return `<a class="mono" href="${href}" title="${esc(c)}">${esc(text)}</a>`;
}
function copyBtn(text) {
  return `<button type="button" class="copy" data-copy="${esc(text)}" title="Copiar">copiar</button>`;
}
function spinner(msg = "Cargando…") {
  return `<div class="loading"><span class="spin"></span>${esc(msg)}</div>`;
}
function errBox(e) {
  return `<div class="error">No se pudo cargar: ${esc(e.message || e)}</div>`;
}

/* ---------- router ---------- */
function parseRoute(path) {
  const p = path.replace(/\/+$/, "") || "/";
  let m;
  if (p === "/") return { name: "home" };
  if ((m = p.match(/^\/block\/(\d+)$/))) return { name: "block", id: Number(m[1]) };
  if ((m = p.match(/^\/block\/(0x[0-9a-fA-F]{64})$/))) return { name: "block", id: m[1] };
  if ((m = p.match(/^\/tx\/(0x[0-9a-fA-F]{64})$/i))) return { name: "tx", hash: m[1] };
  if ((m = p.match(/^\/address\/(0x[0-9a-fA-F]{40})$/i))) return { name: "address", addr: m[1] };
  if ((m = p.match(/^\/token\/(0x[0-9a-fA-F]{40})$/i))) return { name: "token", addr: m[1] };
  return { name: "notfound", path: p };
}

async function render() {
  const route = parseRoute(pathOf());
  document.title =
    route.name === "home"
      ? "Pagachain Explorer"
      : `${titleOf(route)} · Pagachain Explorer`;
  app.innerHTML = spinner();
  try {
    if (route.name === "home") await renderHome();
    else if (route.name === "block") await renderBlock(route.id);
    else if (route.name === "tx") await renderTx(route.hash);
    else if (route.name === "address") await renderAddress(route.addr);
    else if (route.name === "token") await renderToken(route.addr);
    else {
      app.innerHTML = `<div class="card"><h1>No encontrado</h1><p>No hay una página para <span class="mono">${esc(route.path)}</span>.</p><p><a href="/">Volver al inicio</a></p></div>`;
    }
  } catch (e) {
    console.error(e);
    app.innerHTML = errBox(e) + `<p><a href="/">Volver al inicio</a></p>`;
  }
}

function titleOf(route) {
  if (route.name === "block") return "Bloque " + route.id;
  if (route.name === "tx") return "Transacción " + shortHash(route.hash);
  if (route.name === "address") return shortAddr(route.addr);
  if (route.name === "token") return (knownToken(route.addr) || {}).symbol || "Token";
  return "Pagachain Explorer";
}

/* ---------- search ---------- */
async function onSearch(q) {
  const query = q.trim();
  if (!query) return;
  $("#search-msg").textContent = "Buscando…";
  try {
    if (looksLikeTx(query)) {
      const tx = await getTx(query);
      if (tx && tx.hash) {
        $("#search-msg").textContent = "";
        return go("/tx/" + tx.hash);
      }
      const block = await getBlock(query, false);
      if (block) {
        $("#search-msg").textContent = "";
        return go("/block/" + parseInt(block.number, 16));
      }
      throw new Error("No hay transacción ni bloque con ese hash");
    }
    if (looksLikeAddr(query)) {
      $("#search-msg").textContent = "";
      const tok = knownToken(query);
      if (tok) return go("/token/" + checksumAddress(query));
      return go("/address/" + checksumAddress(query));
    }
    if (/^\d+$/.test(query)) {
      $("#search-msg").textContent = "";
      return go("/block/" + Number(query));
    }
    throw new Error("Escribe un número de bloque, un hash o una dirección 0x");
  } catch (e) {
    $("#search-msg").textContent = e.message || String(e);
  }
}

/* ---------- ERC-20 helpers ---------- */
const sel = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  balanceOf: (addr) => "0x70a08231" + addr.replace(/^0x/, "").toLowerCase().padStart(64, "0"),
};

async function readToken(addr) {
  const known = knownToken(addr);
  try {
    const [nameH, symH, decH, supH] = await Promise.all([
      ethCall(addr, sel.name),
      ethCall(addr, sel.symbol),
      ethCall(addr, sel.decimals),
      ethCall(addr, sel.totalSupply),
    ]);
    const decimals = Number(hexToBig(decH));
    return {
      address: checksumAddress(addr),
      name: decodeAbiString(nameH) || (known && known.name) || "Token",
      symbol: decodeAbiString(symH) || (known && known.symbol) || "TOKEN",
      decimals: Number.isFinite(decimals) ? decimals : (known && known.decimals) || 18,
      totalSupply: hexToBig(supH),
      icon: (known && known.icon) || null,
    };
  } catch (e) {
    if (known) {
      return { ...known, totalSupply: null, error: e.message };
    }
    throw e;
  }
}

async function tokenBalance(token, addr) {
  const hex = await ethCall(token, sel.balanceOf(addr));
  return hexToBig(hex);
}

function parseTransfer(log) {
  return {
    token: log.address,
    from: topicAddress(log.topics[1]),
    to: topicAddress(log.topics[2]),
    value: hexToBig(log.data),
    tx: log.transactionHash,
    block: parseInt(log.blockNumber, 16),
    idx: parseInt(log.logIndex, 16),
  };
}

async function transfersInWindow({ token, addr, fromBlock, toBlock }) {
  if (addr) {
    const [outL, inL] = await Promise.all([
      getTransferLogs({ token, from: addr, fromBlock, toBlock }),
      getTransferLogs({ token, to: addr, fromBlock, toBlock }),
    ]);
    const seen = new Set();
    const all = [];
    for (const log of [...inL, ...outL]) {
      const k = log.transactionHash + ":" + log.logIndex;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(parseTransfer(log));
    }
    all.sort((a, b) => b.block - a.block || b.idx - a.idx);
    return all;
  }
  const logs = await getTransferLogs({ token, fromBlock, toBlock });
  return logs.map(parseTransfer).sort((a, b) => b.block - a.block || b.idx - a.idx);
}

/* ---------- home ---------- */
async function renderHome() {
  const latest = await getBlockNumber();
  lastLatest = latest;
  updateHeight(latest);
  const showEmpty = !!(homeState && homeState.showEmpty);
  const packed = await collectHome(latest, { showEmpty, reset: true });
  homeState = packed;
  paintHome(packed);
}

async function collectHome(latest, { showEmpty, reset, more }) {
  const prev = !reset && homeState ? homeState : { blocks: [], txs: [], scannedTo: latest + 1, tokenTxs: [] };
  let scannedTo = more ? prev.scannedTo : latest + 1;
  const blocks = more ? prev.blocks.slice() : [];
  const txs = more ? prev.txs.slice() : [];
  const seenTx = new Set(txs.map((t) => t.hash));

  let tokenTxs = prev.tokenTxs || [];
  if (reset || !tokenTxs.length) {
    try {
      const from = Math.max(0, latest - LOG_RANGE + 1);
      const lists = await Promise.all(
        Object.values(TOKENS).map((t) =>
          getTransferLogs({ token: t.address, fromBlock: from, toBlock: latest })
        )
      );
      tokenTxs = lists
        .flat()
        .map(parseTransfer)
        .sort((a, b) => b.block - a.block || b.idx - a.idx)
        .slice(0, 25);
    } catch (e) {
      tokenTxs = prev.tokenTxs || [];
      console.warn("getLogs home", e);
    }
  }

  const wantBlocks = HOME_TARGET_BLOCKS;
  const wantTxs = HOME_TARGET_TXS;
  const cap = showEmpty ? wantBlocks + 5 : HOME_LOOKBACK;
  let scanned = 0;

  while (scannedTo > 0 && scanned < cap) {
    const haveBlocks = showEmpty
      ? blocks.length >= wantBlocks
      : blocks.filter((b) => !b._empty).length >= wantBlocks;
    const haveTxs = txs.length >= wantTxs;
    if (!more && haveBlocks && (haveTxs || showEmpty)) break;
    if (more && haveBlocks && haveTxs && scanned > 0) break;

    const end = scannedTo - 1;
    const start = Math.max(0, end - HOME_BLOCK_BATCH + 1);
    const nums = [];
    for (let n = end; n >= start; n--) nums.push(n);
    const raw = await getBlocksByNumbers(nums, true);
    for (const block of raw) {
      if (!block) continue;
      const num = parseInt(block.number, 16);
      const empty = isEmptyBlock(block);
      const entry = { ...block, _empty: empty };
      if (showEmpty || !empty) {
        if (!blocks.some((b) => parseInt(b.number, 16) === num)) blocks.push(entry);
      }
      for (const tx of userTxs(block) || []) {
        if (!seenTx.has(tx.hash)) {
          seenTx.add(tx.hash);
          txs.push({ ...tx, _blockTs: parseInt(block.timestamp, 16) });
        }
      }
    }
    scanned += nums.length;
    scannedTo = start;
    if (showEmpty && blocks.length >= wantBlocks) break;
  }

  return {
    latest,
    showEmpty,
    blocks,
    txs,
    tokenTxs,
    scannedTo,
    scannedFrom: latest,
  };
}

function paintHome(state) {
  const { latest, showEmpty, blocks, txs, tokenTxs, scannedTo, scannedFrom } = state;
  const visible = showEmpty ? blocks : blocks.filter((b) => !b._empty);
  const blockRows = visible
    .slice(0, HOME_TARGET_BLOCKS)
    .map((b) => {
      const n = parseInt(b.number, 16);
      const ts = parseInt(b.timestamp, 16);
      const users = userTxs(b) || [];
      const total = (b.transactions || []).length;
      const emptyTag = b._empty ? `<span class="tag">vacío</span>` : "";
      return `<tr>
        <td>${aBlock(n)} ${emptyTag}</td>
        <td title="${esc(fmtTime(ts))}">${esc(timeAgo(ts))}</td>
        <td>${fmtInt(users.length)}${users.length !== total ? `<span class="muted"> / ${fmtInt(total)}</span>` : ""}</td>
        <td class="mono hide-sm">${aTx(b.hash, shortHash(b.hash, 10, 8))}</td>
      </tr>`;
    })
    .join("");

  const merged = mergeHomeTxs(txs, tokenTxs).slice(0, HOME_TARGET_TXS);
  const txRows = merged
    .map((row) => {
      if (row.kind === "token") {
        const tok = knownToken(row.token) || { symbol: "token", decimals: 18 };
        return `<tr>
          <td>${aTx(row.tx)}</td>
          <td>${aBlock(row.block)}</td>
          <td>${aAddr(row.from)}</td>
          <td>${aAddr(row.to)}</td>
          <td class="right">${esc(fmtToken(row.value, tok.decimals, tok.symbol))}</td>
        </tr>`;
      }
      const value = hexToBig(row.value);
      const amount = value > 0n
        ? fmtToken(value, 18, "CENT")
        : methodOf(row);
      return `<tr>
        <td>${aTx(row.hash)}</td>
        <td>${aBlock(parseInt(row.blockNumber, 16))}</td>
        <td>${aAddr(row.from)}</td>
        <td>${row.to ? aAddr(row.to) : `<span class="muted">contrato nuevo</span>`}</td>
        <td class="right">${esc(amount)}</td>
      </tr>`;
    })
    .join("");

  const looked = scannedFrom - scannedTo + 1;
  app.innerHTML = `
    <section class="hero-strip">
      <div>
        <div class="kicker">Pagachain · cadena ${CHAIN_ID}</div>
        <h1>Altura ${fmtInt(latest)}</h1>
        <p class="muted">Explorador ligero. Lee la cadena en directo, sin base de datos.</p>
      </div>
    </section>
    <section class="card">
      <div class="card-head">
        <h2>Últimos bloques</h2>
        <label class="toggle"><input type="checkbox" id="show-empty" ${showEmpty ? "checked" : ""}> Mostrar bloques vacíos</label>
      </div>
      ${visible.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Bloque</th><th>Cuando</th><th>Tx</th><th class="hide-sm">Hash</th></tr></thead>
        <tbody>${blockRows}</tbody>
      </table></div>` : `<p class="muted">No hay bloques con transacciones de usuario en los últimos ${fmtInt(looked)} bloques.</p>`}
      <p class="hint">Los bloques que solo llevan la transacción de sistema se consideran vacíos. Revisados: ${fmtInt(looked)} bloques.</p>
      <button type="button" class="btn ghost" id="more-blocks">Cargar más atrás</button>
    </section>
    <section class="card">
      <div class="card-head"><h2>Últimas transacciones</h2></div>
      ${merged.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Hash</th><th>Bloque</th><th>De</th><th>A</th><th class="right">Valor / método</th></tr></thead>
        <tbody>${txRows}</tbody>
      </table></div>` : `<p class="muted">No hay transacciones de usuario recientes en el tramo revisado. Las transferencias de PAGA más antiguas aparecen al buscar una dirección o el token.</p>`}
    </section>
  `;

  $("#show-empty").addEventListener("change", async (ev) => {
    homeState.showEmpty = ev.target.checked;
    app.querySelector(".card").insertAdjacentHTML("afterbegin", spinner("Actualizando bloques…"));
    try {
      const latestNow = await getBlockNumber();
      lastLatest = latestNow;
      updateHeight(latestNow);
      homeState = await collectHome(latestNow, { showEmpty: ev.target.checked, reset: true });
      paintHome(homeState);
    } catch (e) {
      app.innerHTML = errBox(e);
    }
  });
  $("#more-blocks").addEventListener("click", async () => {
    const btn = $("#more-blocks");
    btn.disabled = true;
    btn.textContent = "Cargando…";
    try {
      const latestNow = homeState.latest;
      homeState = await collectHome(latestNow, { showEmpty: homeState.showEmpty, more: true });
      paintHome(homeState);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = e.message || "Error";
    }
  });
}

function mergeHomeTxs(user, tokenTxs) {
  const out = [];
  const seen = new Set();
  for (const t of user) {
    seen.add(t.hash);
    out.push({ kind: "tx", ...t });
  }
  for (const t of tokenTxs) {
    if (seen.has(t.tx)) continue;
    seen.add(t.tx);
    out.push({ kind: "token", ...t });
  }
  out.sort((a, b) => {
    const ba = a.kind === "token" ? a.block : parseInt(a.blockNumber, 16);
    const bb = b.kind === "token" ? b.block : parseInt(b.blockNumber, 16);
    return bb - ba;
  });
  return out;
}

/* ---------- block ---------- */
async function renderBlock(id) {
  const block = await getBlock(id, true);
  if (!block) {
    app.innerHTML = `<div class="card"><h1>Bloque no encontrado</h1><p>No existe el bloque ${esc(id)}.</p></div>`;
    return;
  }
  const n = parseInt(block.number, 16);
  const ts = parseInt(block.timestamp, 16);
  const txs = block.transactions || [];
  const users = userTxs(block) || [];
  const gasUsed = hexToBig(block.gasUsed);
  const gasLimit = hexToBig(block.gasLimit);
  const empty = isEmptyBlock(block);
  const parent = parseInt(block.parentHash ? "0" : "0", 16);
  const parentNum = n > 0 ? n - 1 : null;

  const rows = txs
    .map((tx) => {
      const sys = isSystemTx(tx);
      const value = hexToBig(tx.value);
      return `<tr class="${sys ? "sys" : ""}">
        <td>${aTx(tx.hash)}</td>
        <td>${aAddr(tx.from)}</td>
        <td>${tx.to ? aAddr(tx.to) : `<span class="muted">contrato nuevo</span>`}</td>
        <td class="right">${value > 0n ? esc(fmtToken(value, 18, "CENT")) : esc(methodOf(tx))}</td>
        <td>${sys ? `<span class="tag">sistema</span>` : esc(methodOf(tx))}</td>
      </tr>`;
    })
    .join("");

  app.innerHTML = `
    <p class="crumb"><a href="/">Inicio</a> · Bloque</p>
    <div class="card">
      <div class="card-head">
        <h1>Bloque ${fmtInt(n)}</h1>
        ${empty ? `<span class="tag">vacío</span>` : ""}
      </div>
      <div class="kv">
        ${kv("Número", fmtInt(n) + (parentNum != null ? ` · <a href="/block/${parentNum}">anterior</a> · <a href="/block/${n + 1}">siguiente</a>` : ""))}
        ${kv("Hash", `<span class="mono wrap">${esc(block.hash)}</span> ${copyBtn(block.hash)}`)}
        ${kv("Padre", `<span class="mono wrap">${esc(block.parentHash)}</span>`)}
        ${kv("Cuando", esc(fmtTime(ts)) + " · " + esc(timeAgo(ts)))}
        ${kv("Transacciones", `${fmtInt(users.length)} de usuario · ${fmtInt(txs.length)} en total`)}
        ${kv("Gas usado", `${fmtInt(gasUsed)} / ${fmtInt(gasLimit)}`)}
        ${block.miner ? kv("Secuenciador", aAddr(block.miner)) : ""}
      </div>
    </div>
    <div class="card">
      <h2>Transacciones</h2>
      ${txs.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Hash</th><th>De</th><th>A</th><th class="right">Valor</th><th>Método</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : `<p class="muted">Este bloque no tiene transacciones.</p>`}
    </div>
  `;
}

function kv(k, v) {
  return `<div class="kv-row"><div class="kv-k">${esc(k)}</div><div class="kv-v">${v}</div></div>`;
}

/* ---------- tx ---------- */
async function renderTx(hash) {
  const [tx, receipt] = await Promise.all([getTx(hash), getReceipt(hash)]);
  if (!tx) {
    app.innerHTML = `<div class="card"><h1>Transacción no encontrada</h1><p class="mono wrap">${esc(hash)}</p></div>`;
    return;
  }
  const blockNum = tx.blockNumber ? parseInt(tx.blockNumber, 16) : null;
  const block = blockNum != null ? await getBlock(blockNum, false) : null;
  const ts = block ? parseInt(block.timestamp, 16) : null;
  const status = receipt ? parseInt(receipt.status || "0x0", 16) : null;
  const sys = isSystemTx(tx);
  const value = hexToBig(tx.value);
  const gasUsed = receipt ? hexToBig(receipt.gasUsed) : 0n;
  const gasLimit = hexToBig(tx.gas || tx.gasLimit);
  const gasPrice = receipt && receipt.effectiveGasPrice
    ? hexToBig(receipt.effectiveGasPrice)
    : hexToBig(tx.maxFeePerGas || tx.gasPrice || "0x0");
  const fee = gasUsed * gasPrice;
  const logs = (receipt && receipt.logs) || [];
  const transfers = logs
    .filter((l) => l.topics && l.topics[0] && l.topics[0].toLowerCase() === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" && l.topics.length >= 3)
    .map(parseTransfer);

  const transferRows = transfers
    .map((t) => {
      const tok = knownToken(t.token);
      const amount = tok
        ? fmtToken(t.value, tok.decimals, tok.symbol)
        : fmtToken(t.value, 18, shortAddr(t.token));
      return `<tr>
        <td>${aAddr(t.token, tok && tok.symbol)}</td>
        <td>${aAddr(t.from)}</td>
        <td>${aAddr(t.to)}</td>
        <td class="right">${esc(amount)}</td>
      </tr>`;
    })
    .join("");

  const st =
    status === 1
      ? `<span class="ok">Correcta</span>`
      : status === 0
        ? `<span class="bad">Fallida</span>`
        : `<span class="muted">Pendiente</span>`;

  app.innerHTML = `
    <p class="crumb"><a href="/">Inicio</a> · Transacción</p>
    <div class="card">
      <div class="card-head">
        <h1>Transacción</h1>
        ${st}
        ${sys ? `<span class="tag">sistema</span>` : ""}
      </div>
      <div class="kv">
        ${kv("Hash", `<span class="mono wrap">${esc(tx.hash)}</span> ${copyBtn(tx.hash)}`)}
        ${kv("Estado", st)}
        ${blockNum != null ? kv("Bloque", `${aBlock(blockNum)}${ts ? " · " + esc(fmtTime(ts)) + " · " + esc(timeAgo(ts)) : ""}`) : kv("Bloque", "Pendiente")}
        ${kv("De", `${aAddr(tx.from)} <span class="mono hide-sm">${esc(checksumAddress(tx.from))}</span> ${copyBtn(checksumAddress(tx.from))}`)}
        ${kv("A", tx.to ? `${aAddr(tx.to)} <span class="mono hide-sm">${esc(checksumAddress(tx.to))}</span> ${copyBtn(checksumAddress(tx.to))}` : `<span class="muted">creación de contrato</span>${receipt && receipt.contractAddress ? " · " + aAddr(receipt.contractAddress) : ""}`)}
        ${kv("Valor", esc(fmtToken(value, 18, "CENT")))}
        ${kv("Gas", `${fmtInt(gasUsed)} usado / ${fmtInt(gasLimit)} límite`)}
        ${kv("Precio del gas", esc(fmtToken(gasPrice, 18, "CENT")) + " por gas")}
        ${kv("Comisión", esc(fmtToken(fee, 18, "CENT")))}
        ${kv("Nonce", fmtInt(hexToBig(tx.nonce)))}
        ${kv("Método", esc(methodOf(tx)))}
      </div>
    </div>
    ${transfers.length ? `<div class="card"><h2>Transferencias de tokens</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Token</th><th>De</th><th>A</th><th class="right">Cantidad</th></tr></thead>
        <tbody>${transferRows}</tbody>
      </table></div>
    </div>` : ""}
    ${tx.input && tx.input !== "0x" ? `<div class="card"><h2>Datos</h2><pre class="data">${esc(tx.input)}</pre></div>` : ""}
  `;
}

/* ---------- address ---------- */
async function renderAddress(addr) {
  const c = checksumAddress(addr);
  const [latest, native, pagaBal, wcentBal, code] = await Promise.all([
    getBlockNumber(),
    getBalance(c),
    tokenBalance(PAGA, c).catch(() => 0n),
    tokenBalance(WCENT, c).catch(() => 0n),
    getCode(c),
  ]);
  lastLatest = latest;
  updateHeight(latest);
  const isContract = code && code !== "0x";
  const tok = knownToken(c);

  const history = await loadTokenHistory({ addr: c, latest, page: 0, auto: 3 });

  app.innerHTML = paintAddress({ c, native, pagaBal, wcentBal, isContract, tok, history, latest });
  bindHistoryNav(c, latest, history);
}

async function loadTokenHistory({ addr, latest, page, auto = 1, token = null }) {
  const tokens = token ? [token] : [PAGA, WCENT];
  let collected = [];
  let usedPage = page;
  let reachedStart = false;
  for (let i = 0; i < auto; i++) {
    const win = windowFor(latest, usedPage, LOG_RANGE);
    if (!win) {
      reachedStart = true;
      break;
    }
    const lists = await Promise.all(
      tokens.map((t) => transfersInWindow({ token: t, addr, fromBlock: win.fromBlock, toBlock: win.toBlock }))
    );
    const chunk = lists.flat().sort((a, b) => b.block - a.block || b.idx - a.idx);
    collected = collected.concat(chunk);
    if (win.fromBlock === 0) {
      reachedStart = true;
      break;
    }
    if (chunk.length || auto === 1) break;
    usedPage += 1;
  }
  return {
    items: collected,
    page: usedPage,
    startPage: page,
    reachedStart,
    win: windowFor(latest, usedPage, LOG_RANGE),
  };
}

function paintAddress({ c, native, pagaBal, wcentBal, isContract, tok, history, latest }) {
  const rows = history.items
    .map((t) => {
      const token = knownToken(t.token) || { symbol: shortAddr(t.token), decimals: 18 };
      const dir = t.to && t.to.toLowerCase() === c.toLowerCase() ? "entrada" : "salida";
      const cls = dir === "entrada" ? "ok" : "";
      return `<tr>
        <td>${aTx(t.tx)}</td>
        <td>${aBlock(t.block)}</td>
        <td><span class="tag ${cls}">${dir}</span> ${token.symbol}</td>
        <td>${aAddr(t.from)}</td>
        <td>${aAddr(t.to)}</td>
        <td class="right">${esc(fmtToken(t.value, token.decimals, token.symbol))}</td>
      </tr>`;
    })
    .join("");

  const win = history.win;
  const rangeLabel = win
    ? `bloques ${fmtInt(win.fromBlock)} – ${fmtInt(win.toBlock)} (máximo ${fmtInt(LOG_RANGE)} por consulta)`
    : "";

  return `
    <p class="crumb"><a href="/">Inicio</a> · Dirección</p>
    <div class="card">
      <div class="card-head">
        <h1>${isContract ? "Contrato" : "Dirección"}</h1>
        ${tok ? `<a class="tag gold" href="/token/${c}">${esc(tok.symbol)}</a>` : isContract ? `<span class="tag">contrato</span>` : ""}
      </div>
      <p class="mono wrap addr-line">${esc(c)} ${copyBtn(c)}</p>
      <div class="balances">
        <div class="bal">
          <img src="${NATIVE.icon}" alt="">
          <div>
            <div class="muted">Saldo nativo</div>
            <div class="big">${esc(fmtToken(native, 18, "CENT"))}</div>
          </div>
        </div>
        <div class="bal">
          <img src="/assets/paga.png" alt="">
          <div>
            <div class="muted">PAGA</div>
            <div class="big">${esc(fmtToken(pagaBal, 6, "PAGA"))}</div>
          </div>
        </div>
        ${wcentBal > 0n ? `<div class="bal">
          <img src="/assets/cent.png" alt="">
          <div>
            <div class="muted">WCENT</div>
            <div class="big">${esc(fmtToken(wcentBal, 18, "WCENT"))}</div>
          </div>
        </div>` : ""}
      </div>
    </div>
    <div class="card" id="hist-card">
      <div class="card-head"><h2>Historial de transferencias</h2></div>
      <p class="hint">CENT es el gas nativo de Pagachain: el saldo aparece arriba. Las transferencias nativas no emiten eventos, así que aquí se listan PAGA y WCENT con <span class="mono">eth_getLogs</span>, en los ${esc(rangeLabel)}.</p>
      ${rows ? `<div class="table-wrap"><table>
        <thead><tr><th>Tx</th><th>Bloque</th><th></th><th>De</th><th>A</th><th class="right">Cantidad</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : `<p class="muted">No hay transferencias de PAGA o WCENT en este tramo.</p>`}
      <div class="row-actions">
        <button type="button" class="btn ghost" id="hist-newer" ${history.startPage === 0 ? "disabled" : ""}>Más recientes</button>
        <button type="button" class="btn ghost" id="hist-older" ${history.reachedStart ? "disabled" : ""}>Más antiguas</button>
      </div>
    </div>
  `;
}

function bindHistoryNav(addr, latest, history) {
  const older = $("#hist-older");
  const newer = $("#hist-newer");
  if (older && !older.disabled) {
    older.addEventListener("click", async () => {
      older.disabled = true;
      older.textContent = "Cargando…";
      try {
        const next = await loadTokenHistory({ addr, latest, page: history.page + 1, auto: 3 });
        const c = checksumAddress(addr);
        const native = await getBalance(c);
        const pagaBal = await tokenBalance(PAGA, c).catch(() => 0n);
        const wcentBal = await tokenBalance(WCENT, c).catch(() => 0n);
        const code = await getCode(c);
        app.innerHTML = paintAddress({
          c, native, pagaBal, wcentBal,
          isContract: code && code !== "0x",
          tok: knownToken(c),
          history: next,
          latest,
        });
        bindHistoryNav(addr, latest, next);
      } catch (e) {
        older.disabled = false;
        older.textContent = e.message || "Error";
      }
    });
  }
  if (newer && !newer.disabled) {
    newer.addEventListener("click", async () => {
      newer.disabled = true;
      newer.textContent = "Cargando…";
      try {
        const prevPage = Math.max(0, history.startPage - 1);
        const next = await loadTokenHistory({ addr, latest, page: prevPage, auto: 1 });
        const c = checksumAddress(addr);
        const native = await getBalance(c);
        const pagaBal = await tokenBalance(PAGA, c).catch(() => 0n);
        const wcentBal = await tokenBalance(WCENT, c).catch(() => 0n);
        const code = await getCode(c);
        app.innerHTML = paintAddress({
          c, native, pagaBal, wcentBal,
          isContract: code && code !== "0x",
          tok: knownToken(c),
          history: next,
          latest,
        });
        bindHistoryNav(addr, latest, next);
      } catch (e) {
        newer.disabled = false;
        newer.textContent = e.message || "Error";
      }
    });
  }
}

/* ---------- token ---------- */
async function renderToken(addr) {
  const c = checksumAddress(addr);
  const latest = await getBlockNumber();
  lastLatest = latest;
  updateHeight(latest);
  let meta;
  try {
    meta = await readToken(c);
  } catch (e) {
    app.innerHTML = `<div class="card"><h1>Token no encontrado</h1><p>No parece un token ERC-20: ${esc(e.message || e)}</p><p><a href="/address/${c}">Ver como dirección</a></p></div>`;
    return;
  }
  const win = windowFor(latest, 0, LOG_RANGE);
  const items = await transfersInWindow({ token: c, fromBlock: win.fromBlock, toBlock: win.toBlock });

  const rows = items
    .map((t) => `<tr>
      <td>${aTx(t.tx)}</td>
      <td>${aBlock(t.block)}</td>
      <td>${aAddr(t.from)}</td>
      <td>${aAddr(t.to)}</td>
      <td class="right">${esc(fmtToken(t.value, meta.decimals, meta.symbol))}</td>
    </tr>`)
    .join("");

  const supply = meta.totalSupply != null
    ? fmtToken(meta.totalSupply, meta.decimals, meta.symbol)
    : "—";

  app.innerHTML = `
    <p class="crumb"><a href="/">Inicio</a> · Token</p>
    <div class="card">
      <div class="card-head token-head">
        ${meta.icon ? `<img class="token-icon" src="${esc(meta.icon)}" alt="">` : ""}
        <h1>${esc(meta.name)} <span class="muted">${esc(meta.symbol)}</span></h1>
      </div>
      <div class="kv">
        ${kv("Contrato", `<span class="mono wrap">${esc(c)}</span> ${copyBtn(c)} · <a href="/address/${c}">ver dirección</a>`)}
        ${kv("Decimales", String(meta.decimals))}
        ${kv("Suministro total", esc(supply))}
      </div>
    </div>
    <div class="card">
      <h2>Transferencias recientes</h2>
      <p class="hint">Tramo ${fmtInt(win.fromBlock)} – ${fmtInt(win.toBlock)} (tope de ${fmtInt(LOG_RANGE)} bloques por consulta).</p>
      ${rows ? `<div class="table-wrap"><table>
        <thead><tr><th>Tx</th><th>Bloque</th><th>De</th><th>A</th><th class="right">Cantidad</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : `<p class="muted">No hay transferencias en este tramo.</p>`}
      <div class="row-actions">
        <button type="button" class="btn ghost" id="tok-older">Más antiguas</button>
      </div>
    </div>
  `;

  let page = 0;
  $("#tok-older").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = "Cargando…";
    try {
      page += 1;
      const w = windowFor(latest, page, LOG_RANGE);
      if (!w) {
        btn.textContent = "Fin de la cadena";
        return;
      }
      const more = await transfersInWindow({ token: c, fromBlock: w.fromBlock, toBlock: w.toBlock });
      const tbody = app.querySelector("tbody");
      if (more.length && tbody) {
        tbody.insertAdjacentHTML(
          "beforeend",
          more
            .map((t) => `<tr>
              <td>${aTx(t.tx)}</td>
              <td>${aBlock(t.block)}</td>
              <td>${aAddr(t.from)}</td>
              <td>${aAddr(t.to)}</td>
              <td class="right">${esc(fmtToken(t.value, meta.decimals, meta.symbol))}</td>
            </tr>`)
            .join("")
        );
      }
      if (w.fromBlock === 0) {
        btn.textContent = "Fin de la cadena";
        return;
      }
      btn.disabled = false;
      btn.textContent = more.length ? "Más antiguas" : "Sin resultados, seguir atrás";
    } catch (e) {
      btn.disabled = false;
      btn.textContent = e.message || "Error";
    }
  });
}

/* ---------- chrome ---------- */
function updateHeight(n) {
  if (heightEl) heightEl.textContent = n ? fmtInt(n) : "—";
}

async function refreshStatus() {
  try {
    const [id, n] = await Promise.all([getChainId(), getBlockNumber()]);
    lastLatest = n;
    updateHeight(n);
    if (statusEl) {
      statusEl.textContent =
        id === CHAIN_ID
          ? `Conectado · ${rpcEndpoint().replace(/^https?:\/\//, "")}`
          : `Cadena inesperada (${id})`;
      statusEl.classList.toggle("bad", id !== CHAIN_ID);
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = "Sin conexión con el RPC";
      statusEl.classList.add("bad");
    }
  }
}

document.addEventListener("click", (ev) => {
  const copy = ev.target.closest("[data-copy]");
  if (copy) {
    ev.preventDefault();
    const t = copy.getAttribute("data-copy");
    navigator.clipboard.writeText(t).then(
      () => {
        copy.textContent = "copiado";
        setTimeout(() => (copy.textContent = "copiar"), 1200);
      },
      () => {}
    );
    return;
  }
  const link = ev.target.closest("a");
  if (!link) return;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("http") || href.startsWith("mailto:") || link.target === "_blank") return;
  if (href.startsWith("/") && !href.startsWith("//")) {
    ev.preventDefault();
    go(href);
  }
});

searchForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  onSearch(searchInput.value);
});

window.addEventListener("popstate", () => render());

refreshStatus();
render();
setInterval(refreshStatus, 10000);
