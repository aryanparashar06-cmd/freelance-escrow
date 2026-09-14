import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { LOCAL_CHAIN_ID, ESCROW_ADDRESS, ESCROW_ABI } from "./escrow";
import "./App.css";

function App() {
  const [account, setAccount] = useState("");
  const [network, setNetwork] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [jobCount, setJobCount] = useState(null);
  const [readError, setReadError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState("");
  const [transactionError, setTransactionError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");

  async function createJob(event) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    // Capture values before disabling the fieldset (disabled fields are omitted).
    const fields = new FormData(form);
    setSubmitting(true);
    setTransactionError("");
    setTransactionStatus("");
    setTransactionHash("");

    try {
      if (!window.ethereum || !account) throw new Error("Connect MetaMask before creating a job.");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const networkData = await provider.getNetwork();
      if (networkData.chainId !== LOCAL_CHAIN_ID) {
        throw new Error("Select Hardhat Localhost (Chain ID: 31337) in MetaMask.");
      }
      const accounts = await provider.send("eth_accounts", []);
      if (!accounts.length || accounts[0].toLowerCase() !== account.toLowerCase()) {
        throw new Error("Your wallet account changed or disconnected. Reconnect and try again.");
      }

      const title = fields.get("title").trim();
      const freelancer = fields.get("freelancer").trim();
      const arbitrator = fields.get("arbitrator").trim();
      const paymentAmount = fields.get("paymentAmount").trim();
      if (!title) throw new Error("Enter a job title.");
      if (!ethers.isAddress(freelancer) || freelancer === ethers.ZeroAddress) {
        throw new Error("Enter a valid, non-zero freelancer wallet address.");
      }
      if (!ethers.isAddress(arbitrator) || arbitrator === ethers.ZeroAddress) {
        throw new Error("Enter a valid, non-zero arbitrator wallet address.");
      }
      const client = accounts[0].toLowerCase();
      if (client === freelancer.toLowerCase()) throw new Error("Client cannot be the freelancer.");
      if (client === arbitrator.toLowerCase()) throw new Error("Client cannot be the arbitrator.");
      if (freelancer.toLowerCase() === arbitrator.toLowerCase()) {
        throw new Error("Freelancer and arbitrator must be different addresses.");
      }
      // Keep ETH as a string: parseEther converts it exactly to bigint wei.
      let paymentWei;
      try {
        paymentWei = ethers.parseEther(paymentAmount);
      } catch {
        throw new Error("Enter an ETH amount with at most 18 decimal places, such as 0.01.");
      }
      if (paymentWei <= 0n) throw new Error("Payment must be greater than zero.");

      // datetime-local uses the browser's local time zone. Date returns milliseconds.
      const deadlineTimestamp = Math.floor(new Date(fields.get("deadline")).getTime() / 1000);
      if (!Number.isFinite(deadlineTimestamp) || deadlineTimestamp <= Math.floor(Date.now() / 1000)) {
        throw new Error("Choose a deadline in the future.");
      }
      const latestBlock = await provider.getBlock("latest");
      if (!latestBlock || deadlineTimestamp <= latestBlock.timestamp) {
        throw new Error("Choose a deadline later than the local blockchain's current time.");
      }
      if (await provider.getCode(ESCROW_ADDRESS) === "0x") {
        throw new Error("No contract found. Check the local deployment and configured contract address.");
      }

      // Writes require the connected wallet's signer and MetaMask approval.
      const signer = await provider.getSigner();
      if ((await signer.getAddress()).toLowerCase() !== client) {
        throw new Error("Your wallet account changed. Try again with the selected account.");
      }
      if (BigInt(await provider.send("eth_chainId", [])) !== LOCAL_CHAIN_ID) {
        throw new Error("Network changed. Select Hardhat Localhost (Chain ID: 31337).");
      }
      const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
      setTransactionStatus("Waiting for MetaMask confirmation. Review and confirm the transaction in MetaMask.");
      const tx = await contract.createJob(title, freelancer, arbitrator, deadlineTimestamp, {
        value: ethers.parseEther(paymentAmount),
      });
      setTransactionHash(tx.hash);
      setTransactionStatus("Transaction submitted. Waiting for blockchain confirmation...");
      await tx.wait();
      setTransactionStatus("Transaction confirmed. Job created successfully.");
      form.reset();
      // Reuse the guarded read effect; a failed count refresh does not undo success.
      setRefreshVersion((version) => version + 1);
    } catch (err) {
      const rejected = err.code === 4001 || err.code === "ACTION_REJECTED"
        || err.info?.error?.code === 4001 || err.error?.code === 4001;
      setTransactionStatus("");
      setTransactionError(rejected
        ? "Transaction cancelled in MetaMask. You can try again."
        : `Create Job error: ${err.reason || err.shortMessage || err.message || "Unable to create job."}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function connectWallet() {
    try {
      setError("");
      setConnecting(true);
      if (!window.ethereum) {
        setError("MetaMask is not installed.");
        return;
      }

      // This requests account access, not a transaction signature.
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      if (!accounts || accounts.length === 0) {
        setError("No wallet account was selected.");
        return;
      }
      setAccount(accounts[0]);
    } catch (err) {
      setError(err.code === 4001
        ? "Wallet connection was cancelled."
        : "Unable to connect wallet.");
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    const wallet = window.ethereum;
    if (!wallet) return;

    // Ignore old reads if the account or chain changes while awaiting a reply.
    let requestId = 0;

    async function refreshContract() {
      const currentRequest = ++requestId;
      setReadError("");
      setJobCount(null);
      try {
        const provider = new ethers.BrowserProvider(wallet);
        const networkData = await provider.getNetwork();
        if (currentRequest !== requestId) return;

        setNetwork(`${networkData.name} (Chain ID: ${networkData.chainId})`);
        if (networkData.chainId !== LOCAL_CHAIN_ID) {
          setReadError("Wrong network. Select Hardhat Localhost (Chain ID: 31337) in MetaMask.");
          return;
        }

        // A provider can read the contract without a signer.
        const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
        const count = await escrow.jobCount();
        if (currentRequest !== requestId) return;
        setJobCount(count.toString());
      } catch {
        if (currentRequest !== requestId) return;
        setReadError("Unable to read Total Jobs. Check that the local node is running and the contract is deployed at the configured address.");
      }
    }

    function clearRead() {
      ++requestId;
      setNetwork("");
      setJobCount(null);
      setReadError("");
      setError("");
    }

    function handleAccountsChanged(accounts) {
      clearRead();
      setAccount(accounts[0] || "");
      if (accounts[0] === account && account) void refreshContract();
    }

    function handleChainChanged() {
      clearRead();
      if (account) void refreshContract();
    }

    wallet.on("accountsChanged", handleAccountsChanged);
    wallet.on("chainChanged", handleChainChanged);
    if (account) void refreshContract();

    return () => {
      ++requestId;
      wallet.removeListener("accountsChanged", handleAccountsChanged);
      wallet.removeListener("chainChanged", handleChainChanged);
    };
  }, [account, refreshVersion]);

  function shortAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  return (
    <div className="app">
      <div className="card">
        <h1>Freelance Escrow</h1>
        <p className="subtitle">
          Decentralized escrow for secure freelance transactions
        </p>

        {!account ? (
          <>
            <p>{window.ethereum
              ? "Connect your wallet to view Total Jobs."
              : "MetaMask is not installed. Install MetaMask to continue."}</p>
            <button onClick={connectWallet} disabled={connecting || !window.ethereum}>
              {connecting ? "Connecting..." : "Connect MetaMask"}
            </button>
          </>
        ) : (
          <div className="wallet-info">
            <h2>Wallet Connected ✓</h2>
            <p><strong>Account:</strong> {shortAddress(account)}</p>
            <p><strong>Network:</strong> {network || "Loading..."}</p>
            {!readError && (
              <p aria-live="polite"><strong>Total Jobs:</strong> {jobCount ?? "Loading..."}</p>
            )}
          </div>
        )}

        {(error || readError) && (
          <p className="error" role="alert">{error || readError}</p>
        )}
        <form className="create-job" onSubmit={createJob}>
          <h2>Create Job</h2>
          <p>You are the client. Use three different wallet addresses. Payment is held in escrow on Hardhat Localhost.</p>
          <fieldset disabled={submitting}>
            <label htmlFor="title">Job title</label>
            <input id="title" name="title" type="text" required placeholder="Build a landing page" />
            <label htmlFor="freelancer">Freelancer wallet address</label>
            <input id="freelancer" name="freelancer" type="text" required placeholder="0x..." />
            <label htmlFor="arbitrator">Arbitrator wallet address</label>
            <input id="arbitrator" name="arbitrator" type="text" required placeholder="0x..." />
            <label htmlFor="deadline">Deadline (your local date and time)</label>
            <input id="deadline" name="deadline" type="datetime-local" required />
            <label htmlFor="paymentAmount">Escrow payment amount in ETH</label>
            <input id="paymentAmount" name="paymentAmount" type="text" inputMode="decimal" required placeholder="0.01" />
            <button type="submit" disabled={!account || submitting}>
              {submitting ? "Creating job..." : "Create Job"}
            </button>
          </fieldset>
          <p>Creating a job requires transaction approval in MetaMask and local ETH for payment plus gas.</p>
        </form>
        {transactionStatus && <p className="transaction" role="status">{transactionStatus}</p>}
        {transactionError && <p className="error" role="alert">{transactionError}</p>}
        {transactionHash && <p className="transaction">Transaction hash: {transactionHash}</p>}
        <p className="security-note">
          Reading Total Jobs does not require gas or transaction approval.
          This application does not access your private key.
        </p>
      </div>
    </div>
  );
}

export default App;
