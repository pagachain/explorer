/* Formato de importes, fechas, direcciones y keccak/EIP-55 */
import { keccak_256 } from "./vendor/sha3.js";

export function keccakHex(hexOrBytes) {
  let bytes;
  if (typeof hexOrBytes === "string") {
    const h = hexOrBytes.replace(/^0x/, "");
    bytes = new Uint8Array(h.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  } else {
    bytes = hexOrBytes;
  }
  const out = keccak_256(bytes);
  return "0x" + Array.from(out).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function checksumAddress(addr) {
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return addr;
  const lower = addr.slice(2).toLowerCase();
  const hash = keccakHex(new TextEncoder().encode(lower)).slice(2);
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

export function shortHash(h, left = 8, right = 6) {
  if (!h) return "—";
  if (h.length <= left + right + 3) return h;
  return h.slice(0, left + 2) + "…" + h.slice(-right);
}

export function shortAddr(addr) {
  if (!addr) return "—";
  const c = checksumAddress(addr);
  return c.slice(0, 6) + "…" + c.slice(-4);
}

export function hexToBig(h) {
  if (h == null || h === "0x" || h === "0x0") return 0n;
  return BigInt(h);
}

export function fmtInt(n) {
  return Number(n).toLocaleString("es-ES");
}

/** Importe con decimales fijos, estilo es-ES. */
export function fmtAmount(value, decimals = 18, maxFrac) {
  const v = typeof value === "bigint" ? value : hexToBig(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const d = Number(decimals);
  const base = 10n ** BigInt(d);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(d, "0");
  let keep = maxFrac;
  if (keep == null) {
    keep = d <= 6 ? d : 8;
    if (whole === 0n && abs > 0n) {
      const first = frac.search(/[1-9]/);
      keep = first < 0 ? d : Math.min(d, first + 4);
    }
  }
  frac = frac.slice(0, keep).replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const s = frac ? wholeStr + "," + frac : wholeStr;
  return (neg ? "−" : "") + s;
}

export function fmtToken(value, decimals, symbol, maxFrac) {
  return fmtAmount(value, decimals, maxFrac) + (symbol ? " " + symbol : "");
}

export function fmtTime(ts) {
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function timeAgo(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
  if (s < 60) return "hace " + s + " s";
  const m = Math.floor(s / 60);
  if (m < 60) return "hace " + m + " min";
  const h = Math.floor(m / 60);
  if (h < 48) return "hace " + h + " h";
  const d = Math.floor(h / 24);
  return "hace " + d + " d";
}

export function methodOf(tx) {
  const input = (tx && tx.input) || "0x";
  if (!input || input === "0x" || input === "0x0") {
    return hexToBig(tx && tx.value) > 0n ? "transferencia" : "llamada";
  }
  const sel = input.slice(0, 10).toLowerCase();
  const map = {
    "0xa9059cbb": "transfer",
    "0x23b872dd": "transferFrom",
    "0x095ea7b3": "approve",
    "0x3db6be2b": "setL1BlockValues",
    "0x440a5e20": "setL1BlockValues",
  };
  return map[sel] || sel;
}

export function decodeAbiString(hex) {
  if (!hex || hex === "0x") return "";
  const h = hex.slice(2);
  if (h.length < 128) {
    const raw = h.replace(/00+$/, "");
    try {
      return decodeURIComponent(raw.replace(/[0-9a-f]{2}/g, (m) => "%" + m));
    } catch {
      return "";
    }
  }
  const off = parseInt(h.slice(0, 64), 16) * 2;
  const len = parseInt(h.slice(off, off + 64), 16);
  const s = h.slice(off + 64, off + 64 + len * 2);
  try {
    return decodeURIComponent(s.replace(/[0-9a-f]{2}/g, (m) => "%" + m));
  } catch {
    return "";
  }
}

export function looksLikeTx(q) {
  return /^0x[0-9a-fA-F]{64}$/.test(q);
}
export function looksLikeAddr(q) {
  return /^0x[0-9a-fA-F]{40}$/.test(q);
}
export function looksLikeBlock(q) {
  return /^\d+$/.test(q) || /^0x[0-9a-fA-F]{1,15}$/.test(q);
}
