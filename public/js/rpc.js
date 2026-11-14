/* JSON-RPC: directo a pagachain.com, con reserva /rpc si falla */
import { RPC_DIRECT, RPC_PROXY, LOG_RANGE, TRANSFER_TOPIC } from "./config.js";

let endpoint = RPC_DIRECT;
let id = 1;
const blockCache = new Map();

export function rpcEndpoint() {
  return endpoint;
}

async function post(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error("RPC HTTP " + res.status + (text ? ": " + text.slice(0, 180) : ""));
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function postWithFallback(payload) {
  try {
    return await post(endpoint, payload);
  } catch (err) {
    const other = endpoint === RPC_DIRECT ? RPC_PROXY : RPC_DIRECT;
    if (other === endpoint) throw err;
    try {
      const data = await post(other, payload);
      endpoint = other;
      return data;
    } catch (err2) {
      throw err;
    }
  }
}

function unwrap(item, call) {
  if (!item) throw new Error("Respuesta RPC vacía");
  if (item.error) {
    const e = new Error(item.error.message || "Error RPC");
    e.code = item.error.code;
    e.data = item.error.data;
    e.method = call && call[0];
    throw e;
  }
  return item.result;
}

export async function rpc(method, params = []) {
  const payload = { jsonrpc: "2.0", id: id++, method, params };
  const data = await postWithFallback(payload);
  return unwrap(data, [method, params]);
}

export async function rpcBatch(calls) {
  if (!calls.length) return [];
  if (calls.length === 1) return [await rpc(calls[0][0], calls[0][1] || [])];
  const payload = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: c[0],
    params: c[1] || [],
  }));
  const data = await postWithFallback(payload);
  if (!Array.isArray(data)) {
    // algunos proxies devuelven un solo objeto si falla el lote
    if (data && data.error) {
      const e = new Error(data.error.message || "Error RPC");
      e.code = data.error.code;
      throw e;
    }
    throw new Error("El RPC no aceptó el lote");
  }
  const byId = new Map(data.map((item) => [item.id, item]));
  return calls.map((c, i) => unwrap(byId.get(i), c));
}

export async function getChainId() {
  return parseInt(await rpc("eth_chainId", []), 16);
}

export async function getBlockNumber() {
  return parseInt(await rpc("eth_blockNumber", []), 16);
}

export async function getBlock(nOrHash, full = true) {
  const key = String(nOrHash).toLowerCase() + ":" + (full ? "1" : "0");
  if (blockCache.has(key)) return blockCache.get(key);
  const method = String(nOrHash).length >= 64 && String(nOrHash).startsWith("0x")
    ? "eth_getBlockByHash"
    : "eth_getBlockByNumber";
  const id = method === "eth_getBlockByNumber" && typeof nOrHash === "number"
    ? "0x" + nOrHash.toString(16)
    : nOrHash;
  const block = await rpc(method, [id, full]);
  if (block) {
    blockCache.set(key, block);
    if (blockCache.size > 400) {
      const first = blockCache.keys().next().value;
      blockCache.delete(first);
    }
  }
  return block;
}

export async function getBlocksByNumbers(numbers, full = true) {
  const missing = [];
  const out = new Map();
  for (const n of numbers) {
    const key = n + ":" + (full ? "1" : "0");
    if (blockCache.has(key)) out.set(n, blockCache.get(key));
    else missing.push(n);
  }
  if (missing.length) {
    const results = await rpcBatch(
      missing.map((n) => ["eth_getBlockByNumber", ["0x" + n.toString(16), full]])
    );
    results.forEach((block, i) => {
      const n = missing[i];
      if (block) {
        const key = n + ":" + (full ? "1" : "0");
        blockCache.set(key, block);
        out.set(n, block);
      }
    });
  }
  return numbers.map((n) => out.get(n) || null);
}

export async function getTx(hash) {
  return rpc("eth_getTransactionByHash", [hash]);
}

export async function getReceipt(hash) {
  return rpc("eth_getTransactionReceipt", [hash]);
}

export async function getBalance(addr) {
  return BigInt(await rpc("eth_getBalance", [addr, "latest"]));
}

export async function getCode(addr) {
  return rpc("eth_getCode", [addr, "latest"]);
}

export async function ethCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

export async function getLogs(filter) {
  return rpc("eth_getLogs", [filter]);
}

/** Ventana de getLogs respetando el tope de 100000 bloques (inclusivo). */
export function windowFor(latest, page, range = LOG_RANGE) {
  const to = latest - page * range;
  const from = Math.max(0, to - range + 1);
  if (to < 0) return null;
  return { fromBlock: from, toBlock: to };
}

export async function getTransferLogs({ token, from, to, fromBlock, toBlock }) {
  const topics = [TRANSFER_TOPIC];
  if (from) topics[1] = padTopic(from);
  if (to) {
    if (!from) topics[1] = null;
    topics[2] = padTopic(to);
  }
  return getLogs({
    fromBlock: "0x" + fromBlock.toString(16),
    toBlock: "0x" + toBlock.toString(16),
    address: token,
    topics,
  });
}

export function padTopic(addr) {
  return "0x" + addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

export function topicAddress(topic) {
  if (!topic) return null;
  return "0x" + topic.slice(26);
}
