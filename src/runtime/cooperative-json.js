"use strict";

// Async, cooperative JSON serializer. Returns a string byte-identical to
// JSON.stringify(value) for JSON-safe data, but YIELDS to the event loop on a
// time budget so serializing the multi-MB database never blocks interaction
// handling for the seconds a single synchronous JSON.stringify takes on a slow
// host. (Node has no async JSON.stringify; a 20MB stringify froze the loop ~3.5s
// on Railway, which both tripped Discord's 3s ack window AND defeated the ack
// watchdog — its timer can't fire while the loop is blocked.)
//
// Semantics matched to JSON.stringify exactly for the JSON-safe subset the db
// uses:
//   • object keys in insertion order (Object.keys);
//   • keys whose value is undefined / function / symbol are dropped;
//   • those same values become null inside arrays;
//   • .toJSON() is honored (Date → ISO string, etc.);
//   • all string/number escaping (and NaN/Infinity → null) is delegated to the
//     native JSON.stringify of each leaf.
// No replacer / spacer support — the db is always persisted compact.
//
// Chunking keeps each synchronous slice tiny WITHOUT exploding the promise count
// on a db with millions of nodes:
//   • a big keyed map or array (>= ATOMIC_FANOUT children) is iterated and each
//     CHILD is serialized with one native JSON.stringify (records are small), and
//     the loop yields every SLICE — so a 100k-entry map never blocks;
//   • a small (low-fanout) container is recursed into, so a low-fanout-but-deep or
//     huge subtree (e.g. sot.activity) is still broken into yieldable pieces;
//   • leaves use native JSON.stringify.
// The only unbounded-block risk left is a single oversized RECORD inside a big map
// (rare, and bounded to that one record) — orders of magnitude better than
// stringifying the whole db at once.

const ATOMIC_FANOUT = 32;
const MAX_RECURSE_DEPTH = 256; // guard against pathological nesting / stack depth
const DEFAULT_SLICE_MS = 8;

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

// Returns { json, maxSliceMs }. `json` is undefined only when the ROOT itself is
// undefined/function/symbol (mirrors JSON.stringify(undefined) === undefined).
async function stringifyCooperative(root, options = {}) {
  const sliceMs = Number(options.sliceMs) > 0 ? Number(options.sliceMs) : DEFAULT_SLICE_MS;
  let sliceStart = nowMs();
  let ops = 0;
  let maxSliceMs = 0;

  async function maybeYield() {
    ops += 1;
    // Sample the clock cheaply — only every 1024 emitted pieces.
    if ((ops & 1023) !== 0) return;
    const elapsed = nowMs() - sliceStart;
    if (elapsed >= sliceMs) {
      if (elapsed > maxSliceMs) maxSliceMs = elapsed;
      await new Promise((resolve) => setImmediate(resolve));
      sliceStart = nowMs();
    }
  }

  function isPlainContainer(value) {
    return value !== null && typeof value === "object" && typeof value.toJSON !== "function";
  }

  // Serialize one value. Returns a JSON string, or undefined for values that
  // JSON.stringify omits (undefined / function / symbol / toJSON()->undefined).
  async function ser(value, depth) {
    if (!isPlainContainer(value)) {
      // leaf (null, string, number, boolean, Date-via-toJSON, …) — native handles
      // escaping and the undefined/function/symbol -> undefined contract.
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      const n = value.length;
      if (n === 0) return "[]";
      const atomicChildren = n >= ATOMIC_FANOUT || depth >= MAX_RECURSE_DEPTH;
      let out = "[";
      for (let i = 0; i < n; i += 1) {
        if (i > 0) out += ",";
        const part = atomicChildren ? JSON.stringify(value[i]) : await ser(value[i], depth + 1);
        out += part === undefined ? "null" : part;
        await maybeYield();
      }
      return out + "]";
    }

    const keys = Object.keys(value);
    const n = keys.length;
    if (n === 0) return "{}";
    const atomicChildren = n >= ATOMIC_FANOUT || depth >= MAX_RECURSE_DEPTH;
    let out = "";
    for (let i = 0; i < n; i += 1) {
      const key = keys[i];
      const child = value[key];
      const part = atomicChildren ? JSON.stringify(child) : await ser(child, depth + 1);
      if (part === undefined) continue; // JSON.stringify omits these keys entirely
      out += (out ? "," : "") + JSON.stringify(key) + ":" + part;
      await maybeYield();
    }
    return "{" + out + "}";
  }

  const json = await ser(root, 0);
  return { json, maxSliceMs };
}

module.exports = { stringifyCooperative };
