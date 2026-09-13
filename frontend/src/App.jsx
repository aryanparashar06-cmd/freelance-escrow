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
  }, [account]);

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
        <p className="security-note">
          Reading Total Jobs does not require gas or transaction approval.
          This application does not access your private key.
        </p>
      </div>
    </div>
  );
}

export default App;
