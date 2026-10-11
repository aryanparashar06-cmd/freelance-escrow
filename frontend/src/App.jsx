import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { LOCAL_CHAIN_ID, ESCROW_ADDRESS, ESCROW_ABI } from "./escrow";
import "./App.css";
import AcceptJob from "./AcceptJob";
import SubmitWork from "./SubmitWork";
import ApproveWork from "./ApproveWork";
import RaiseDispute from "./RaiseDispute";
import ResolveDispute from "./ResolveDispute";

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
      <div className="space-scene" aria-hidden="true">
        <div className="stars" />
        <div className="moon" />
        <div className="horizon-glow" />
        <div className="planetary-horizon" />
      </div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="Freelance Escrow home">
          <span className="brand-orbit" aria-hidden="true" />
          Freelance<span>Escrow</span>
        </a>
        <div className={account ? "wallet-badge connected" : "wallet-badge"}>
          <span className="status-dot" />
          {account ? "Wallet connected" : "Wallet not connected"}
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">A new horizon for freelance trust</p>
          <h1 id="hero-title">FREELANCE <span>ESCROW</span></h1>
          <p className="subtitle">Decentralized escrow for secure freelance transactions</p>
          <a className="hero-link" href="#create-job">Create your next opportunity <span aria-hidden="true">↓</span></a>
          <div className="hero-caption" aria-hidden="true"><span /> BUILT ON ETHEREUM <span /></div>
        </section>

        <section className="workspace" aria-label="Escrow workspace">
          <div className="status-grid">
            <div className="status-card">
              <span className="status-label">01 / YOUR WALLET</span>
              {account ? (
                <p className="status-value" title={account}>{shortAddress(account)} <span className="small-dot" /></p>
              ) : (
                <button className="connect-button" onClick={connectWallet} disabled={connecting || !window.ethereum}>
                  {connecting ? "Connecting..." : "Connect MetaMask"} <span aria-hidden="true">↗</span>
                </button>
              )}
              <p className="status-detail">{account ? "Connected as client" : window.ethereum
                ? "Connect to begin your next project"
                : "Install MetaMask to continue"}</p>
            </div>
            <div className="status-card">
              <span className="status-label">02 / NETWORK</span>
              <p className="status-value">{account ? network || "Loading..." : "Hardhat Localhost"}</p>
              <p className="status-detail">Local development · Chain ID 31337</p>
            </div>
            <div className="status-card jobs-card">
              <span className="status-label">03 / TOTAL JOBS</span>
              <p className="status-value job-count" aria-live="polite">{account && !readError ? jobCount ?? "Loading..." : "—"}</p>
              <p className="status-detail">{readError ? "Count unavailable" : account ? "Recorded on the blockchain" : "Connect wallet to view"}</p>
            </div>
          </div>

          {(error || readError) && (
            <p className="error" role="alert">{error || readError}</p>
          )}

          <div className="form-panel" id="create-job">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">YOUR NEXT CHAPTER</p>
                <h2>Create escrow job</h2>
              </div>
              <span className="panel-symbol" aria-hidden="true">◇</span>
            </div>
            <p className="panel-intro">Great work starts with trust. Define your project and secure its payment in escrow.</p>
            <form className="create-job" onSubmit={createJob}>
              <fieldset disabled={submitting}>
                <div className="field">
                  <label htmlFor="title">Job title</label>
                  <input id="title" name="title" type="text" required placeholder="e.g. Design and build a landing page" />
                </div>
                <div className="field">
                  <label htmlFor="freelancer">Freelancer wallet address</label>
                  <input id="freelancer" name="freelancer" type="text" required placeholder="0x..." />
                </div>
                <div className="field">
                  <label htmlFor="arbitrator">Arbitrator wallet address</label>
                  <input id="arbitrator" name="arbitrator" type="text" required placeholder="0x..." />
                </div>
                <p className="field-note">You are the client. Use a different wallet address for each of the three roles.</p>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="deadline">Deadline <span>· local time</span></label>
                    <input id="deadline" name="deadline" type="datetime-local" required />
                  </div>
                  <div className="field">
                    <label htmlFor="paymentAmount">Escrow amount <span>· ETH</span></label>
                    <input id="paymentAmount" name="paymentAmount" type="text" inputMode="decimal" required placeholder="0.01" />
                  </div>
                </div>
                <button className="create-button" type="submit" disabled={!account || submitting}>
                  {submitting ? "Creating job..." : "Create Job"} <span aria-hidden="true">↗</span>
                </button>
              </fieldset>
              <p className="form-note">Payment is held on Hardhat Localhost. MetaMask approval and local ETH for payment plus gas are required.</p>
            </form>
            {transactionStatus && <p className="transaction" role="status">{transactionStatus}</p>}
            {transactionError && <p className="error" role="alert">{transactionError}</p>}
            {transactionHash && <p className="transaction transaction-hash">Transaction hash: {transactionHash}</p>}
          </div>
          <AcceptJob account={account} />
          <SubmitWork account={account} />
          <ApproveWork account={account} />
          <RaiseDispute account={account} />
          <ResolveDispute account={account} />
          <p className="security-note">Reading Total Jobs does not require gas or transaction approval.<br />This application does not access your private key.</p>
        </section>
      </main>
      <footer className="site-footer"><span>FREELANCE ESCROW</span><span>Powered by smart contracts. Built on trust.</span></footer>
    </div>
  );
}

export default App;
