// Register the scorer (an Evaluator adapter) on the Telegraph Diamond, Ethereum Sepolia testnet.
//
//   node --env-file=../.env adapter/register.mjs --package <file.safetensors> --wasm-url <https url of the same file> \
//        --runnable-url <https url of the running executor> [--family WEATHER_FORECAST] [--dry-run]
//
// It checks before it spends: the hosted package must be byte-identical to the local one, the family must
// be a registered prefix, the executor must answer a real batch request with this package's hash, and the
// call is simulated first. The bond is 5 test USDC and comes back in full on deregistration.
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, keccak256 } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const rpc = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const USDC = process.env.USDC || "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const DIAMOND = process.env.DIAMOND || "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const NODE = process.env.TELEGRAPH_NODE || "https://devnode.telegraphprotocol.com";
const args = process.argv.slice(2);
const arg = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dryRun = args.includes("--dry-run");
const pkgPath = arg("--package");
const wasmUrl = arg("--wasm-url");
const runnableUrl = arg("--runnable-url");
const family = arg("--family", "WEATHER_FORECAST");
if (!pkgPath || !wasmUrl || !runnableUrl) throw new Error("--package, --wasm-url and --runnable-url are required");

const local = readFileSync(pkgPath);
const hash = keccak256(local);
const hosted = Buffer.from(await (await fetch(wasmUrl)).arrayBuffer());
if (keccak256(hosted) !== hash) throw new Error(`The hosted package differs from the local file.\n local  ${hash}\n hosted ${keccak256(hosted)} (${hosted.length} bytes)`);
console.log(`package ${pkgPath} (${local.length} bytes)\n keccak256 ${hash}\n hosted copy matches: ${wasmUrl}`);

// A real batch request: two tiny token lists ([CLS] x [SEP] in ModernBERT's vocabulary). The reply must carry
// one score per item and name this package's hash.
const probe = await fetch(runnableUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch: [{ tokens: [50281, 2594, 50282] }, { tokens: [50281, 9846, 4868, 50282] }] }), signal: AbortSignal.timeout(180000) });
const reply = await probe.json().catch(() => null);
if (probe.status !== 200 || !Array.isArray(reply?.results) || reply.results.length !== 2 || reply.results.some((x) => typeof x.score !== "number")) throw new Error(`the executor did not answer the batch request: HTTP ${probe.status} ${JSON.stringify(reply).slice(0, 300)}`);
if (String(reply.adapter_hash).toLowerCase() !== hash.slice(2).toLowerCase()) throw new Error(`the executor is running a different package: ${reply.adapter_hash}`);
console.log(`executor answers the batch request with this package (foundation ${String(reply.foundation_hash).slice(0, 12)}…)`);

const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const diamond = parseAbi(["function getPrefixes() view returns (string[], uint8[])", "function registerWasm(bytes32,string,string,address,string) returns (uint256)"]);

const [prefixes] = await pub.readContract({ address: DIAMOND, abi: diamond, functionName: "getPrefixes" });
if (!prefixes.includes(family)) throw new Error(`${family} is not a registered prefix`);
const resolve = await fetch(`${NODE}/api/wasm?resolve=${family}_GENERAL`).then((r) => r.json());
console.log(`${family} is a registered prefix. ${family}_GENERAL is scored by: ${resolve.resolve?.served_by} (class ${resolve.resolve?.class})`);

const BOND = 5_000_000n;
const bal = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`bond: 5 test USDC (wallet has ${formatUnits(bal, 6)})`);
if (bal < BOND) throw new Error("not enough test USDC for the bond");
if (dryRun) {
  console.log("[dry run] nothing sent");
  process.exit(0);
}
const send = async (label, req) => {
  const tx = await wallet.writeContract(req);
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${tx}`);
  console.log(`${label}: ${tx}`);
  return receipt;
};
const allowance = await pub.readContract({ address: USDC, abi: erc20, functionName: "allowance", args: [account.address, DIAMOND] });
if (allowance < BOND) await send("approve the bond", { address: USDC, abi: erc20, functionName: "approve", args: [DIAMOND, BOND] });

let sim;
for (let attempt = 1; ; attempt++) {
  try {
    sim = await pub.simulateContract({ address: DIAMOND, abi: diamond, functionName: "registerWasm", args: [hash, wasmUrl, family, account.address, runnableUrl], account });
    break;
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 6000)); // the RPC can lag a block behind the approval
  }
}
console.log(`simulation ok: registration id would be ${sim.result}`);
const receipt = await send("registerWasm", sim.request);
console.log(`registered. registration id ${sim.result}  tx https://sepolia.etherscan.io/tx/${receipt.transactionHash}`);
console.log(`Follow it with:\n  curl -s ${NODE}/api/wasm/${sim.result}`);
