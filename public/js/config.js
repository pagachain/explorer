/* Pagachain Explorer — datos públicos de la cadena */
export const CHAIN_ID = 3690369;
export const CHAIN_ID_HEX = "0x384f81";
export const CHAIN_NAME = "Pagachain";
export const RPC_DIRECT = "https://pagachain.com";
export const RPC_PROXY = "/rpc";
export const LOG_RANGE = 100000; // límite de op-reth: "query exceeds max block range 100000"
export const HOME_BLOCK_BATCH = 20;
export const HOME_LOOKBACK = 80;
export const HOME_TARGET_BLOCKS = 20;
export const HOME_TARGET_TXS = 15;

export const NATIVE = {
  name: "Cent",
  symbol: "CENT",
  decimals: 18,
  icon: "/assets/cent.png",
};

export const SYSTEM_FROM = "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0001";
export const L1_BLOCK = "0x4200000000000000000000000000000000000015";

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const PAGA = "0xbfE1D53cb99f5873E3d62EfaAc4F7d0cC2f94b9A";
export const WCENT = "0x4200000000000000000000000000000000000006";

export const TOKENS = {
  "0xbfe1d53cb99f5873e3d62efaac4f7d0cc2f94b9a": {
    name: "Paga",
    symbol: "PAGA",
    decimals: 6,
    icon: "/assets/paga.png",
    address: PAGA,
  },
  "0x4200000000000000000000000000000000000006": {
    name: "Wrapped Cent",
    symbol: "WCENT",
    decimals: 18,
    icon: "/assets/cent.png",
    address: WCENT,
  },
};

export const SELECTORS = {
  "0xa9059cbb": "transfer",
  "0x23b872dd": "transferFrom",
  "0x095ea7b3": "approve",
  "0x70a08231": "balanceOf",
  "0x3db6be2b": "setL1BlockValues",
};

export function knownToken(addr) {
  if (!addr) return null;
  return TOKENS[addr.toLowerCase()] || null;
}

export function isSystemTx(tx) {
  if (!tx) return false;
  const from = (tx.from || "").toLowerCase();
  const to = (tx.to || "").toLowerCase();
  const type = (tx.type || "").toLowerCase();
  return (
    from === SYSTEM_FROM ||
    to === L1_BLOCK ||
    type === "0x7e"
  );
}

export function userTxs(block) {
  const txs = block && block.transactions ? block.transactions : [];
  if (!txs.length) return [];
  if (typeof txs[0] === "string") return null;
  return txs.filter((tx) => !isSystemTx(tx));
}

export function isEmptyBlock(block) {
  const txs = block && block.transactions ? block.transactions : [];
  if (!txs.length) return true;
  if (typeof txs[0] === "string") {
    return txs.length === 0;
  }
  return userTxs(block).length === 0;
}
