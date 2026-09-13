import { useEffect, useState } from "react";
import { ethers } from "ethers";
import "./App.css";

function App() {
  const [account, setAccount] = useState("");
  const [network, setNetwork] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function connectWallet() {
    try {
      setError("");
      setConnecting(true);

      // Check whether MetaMask or another injected wallet exists
      if (!window.ethereum) {
        setError("MetaMask is not installed.");
        return;
      }

      // Ask MetaMask for permission to access wallet accounts
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      if (!accounts || accounts.length === 0) {
        setError("No wallet account was selected.");
        return;
      }

      // Ethers v6 provider for browser wallets
      const provider = new ethers.BrowserProvider(
        window.ethereum
      );

      const networkData = await provider.getNetwork();

      setAccount(accounts[0]);

      setNetwork(
        `${networkData.name} (Chain ID: ${networkData.chainId.toString()})`
      );
    } catch (err) {
      console.error("Wallet connection error:", err);

      // MetaMask code 4001 means user rejected the request
      if (err.code === 4001) {
        setError("Wallet connection was cancelled.");
      } else {
        setError("Unable to connect wallet.");
      }
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    if (!window.ethereum) {
      return;
    }

    // Update UI if user changes MetaMask account
    function handleAccountsChanged(accounts) {
      if (accounts.length === 0) {
        setAccount("");
        setNetwork("");
      } else {
        setAccount(accounts[0]);
      }
    }

    // Refresh network information if chain changes
    async function handleChainChanged() {
      try {
        const provider =
          new ethers.BrowserProvider(window.ethereum);

        const networkData =
          await provider.getNetwork();

        setNetwork(
          `${networkData.name} (Chain ID: ${networkData.chainId.toString()})`
        );
      } catch {
        setNetwork("");
      }
    }

    window.ethereum.on(
      "accountsChanged",
      handleAccountsChanged
    );

    window.ethereum.on(
      "chainChanged",
      handleChainChanged
    );

    // Cleanup listeners when component is removed
    return () => {
      window.ethereum.removeListener(
        "accountsChanged",
        handleAccountsChanged
      );

      window.ethereum.removeListener(
        "chainChanged",
        handleChainChanged
      );
    };
  }, []);

  function shortAddress(address) {
    if (!address) {
      return "";
    }

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
          <button
            onClick={connectWallet}
            disabled={connecting}
          >
            {connecting
              ? "Connecting..."
              : "Connect MetaMask"}
          </button>
        ) : (
          <div className="wallet-info">
            <h2>Wallet Connected ✓</h2>

            <p>
              <strong>Account:</strong>{" "}
              {shortAddress(account)}
            </p>

            <p>
              <strong>Network:</strong>{" "}
              {network || "Loading..."}
            </p>
          </div>
        )}

        {error && (
          <p className="error">
            {error}
          </p>
        )}

        <p className="security-note">
          Wallet transactions are signed inside MetaMask.
          This application does not access your private key.
        </p>
      </div>
    </div>
  );
}

export default App;