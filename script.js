// ============================================================
// SOLIDITY CONTRACT (deploy this separately via Remix IDE)
// Save as MedicalChain.sol and deploy to Sepolia Testnet
// ============================================================
/*
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MedicalChain {
    struct Record {
        string patientName;
        string diagnosis;
        uint256 timestamp;
        address addedBy;
    }

    Record[] public records;
    mapping(address => bool) public authorizedDoctors;
    address public admin;

    constructor() { admin = msg.sender; }

    modifier onlyAdmin() { require(msg.sender == admin, "Bukan Admin"); _; }
    modifier onlyDoctor() { require(authorizedDoctors[msg.sender], "Akses Ditolak: Bukan Dokter"); _; }

    function authorizeDoctor(address _doc) public onlyAdmin { authorizedDoctors[_doc] = true; }
    function revokeDoctor(address _doc) public onlyAdmin { authorizedDoctors[_doc] = false; }

    function addRecord(string memory _name, string memory _diagnosis) public onlyDoctor {
        records.push(Record(_name, _diagnosis, block.timestamp, msg.sender));
    }

    function getRecord(uint index) public view returns (string memory, string memory, uint256, address) {
        Record memory r = records[index];
        return (r.patientName, r.diagnosis, r.timestamp, r.addedBy);
    }

    function totalRecords() public view returns (uint) { return records.length; }
}
*/

// ============================================================
// FRONTEND JAVASCRIPT (this file — script.js)
// ============================================================

// --- STEP 1: Paste your deployed contract address and ABI here ---
const CONTRACT_ADDRESS = "0xAd2958c16137244094Cc14b1D9A53cD2585A3C9E";
// const CONTRACT_ADDRESS = "0x..."; wallet
const CONTRACT_ABI = [
    "function addRecord(string memory _name, string memory _diagnosis) public",
    "function getRecord(uint index) public view returns (string, string, uint256, address)",
    "function totalRecords() public view returns (uint)",
    "function authorizedDoctors(address) public view returns (bool)",
    "function admin() public view returns (address)"
];

// --- App State ---
let provider = null;
let signer = null;
let contract = null;
let connectedAddress = null;

// Local simulation chain (used as fallback / tamper demo)
class Block {
    constructor(index, timestamp, patientName, diagnosis, previousHash = '') {
        this.index = index;
        this.timestamp = timestamp;
        this.patientName = patientName;
        this.diagnosis = diagnosis;
        this.previousHash = previousHash;
        this.hash = this.calculateHash();
    }
    calculateHash() {
        return CryptoJS.SHA256(
            this.index + this.previousHash + this.timestamp + this.patientName + this.diagnosis
        ).toString();
    }
}

class Blockchain {
    constructor() { this.chain = [this.createGenesisBlock()]; }
    createGenesisBlock() {
        return new Block(0, new Date().toISOString(), "Genesis Block", "System Initialization", "0");
    }
    getLatestBlock() { return this.chain[this.chain.length - 1]; }
    addBlock(patientName, diagnosis) {
        const newBlock = new Block(
            this.chain.length, new Date().toISOString(),
            patientName, diagnosis, this.getLatestBlock().hash
        );
        this.chain.push(newBlock);
    }
    isChainValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const cur = this.chain[i], prev = this.chain[i - 1];
            if (cur.hash !== cur.calculateHash()) return false;
            if (cur.previousHash !== prev.hash) return false;
        }
        return true;
    }
}

const localChain = new Blockchain();

// ============================================================
// METAMASK CONNECTION
// ============================================================

async function connectMetaMask() {
    if (!window.ethereum) {
        alert("MetaMask tidak ditemukan!\nInstall di https://metamask.io");
        return;
    }

    try {
        // Request wallet access
        await window.ethereum.request({ method: 'eth_requestAccounts' });

        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();
        connectedAddress = await signer.getAddress();

        // Connect to smart contract
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        // Update UI
        updateWalletUI(connectedAddress);
        await detectRoleFromWallet();
        await renderChain();

        // Listen for account/network changes
        window.ethereum.on('accountsChanged', handleAccountChange);
        window.ethereum.on('chainChanged', () => window.location.reload());

    } catch (err) {
        if (err.code === 4001) {
            alert("Koneksi ditolak oleh pengguna.");
        } else {
            console.error(err);
            alert("Gagal terhubung: " + err.message);
        }
    }
}

function handleAccountChange(accounts) {
    if (accounts.length === 0) {
        disconnectWallet();
    } else {
        connectedAddress = accounts[0];
        updateWalletUI(connectedAddress);
        detectRoleFromWallet();
        renderChain();
    }
}

function disconnectWallet() {
    provider = null; signer = null; contract = null; connectedAddress = null;
    document.getElementById('walletAddress').innerText = "Belum terhubung";
    document.getElementById('connectBtn').innerText = "🦊 Hubungkan MetaMask";
    document.getElementById('walletBadge').className = "wallet-badge disconnected";
    renderChain(); // fallback to local chain
}

function updateWalletUI(address) {
    const short = address.slice(0, 6) + '...' + address.slice(-4);
    document.getElementById('walletAddress').innerText = short;
    document.getElementById('connectBtn').innerText = "✅ Terhubung";
    document.getElementById('walletBadge').innerText = "Online";
    document.getElementById('walletBadge').className = "wallet-badge connected";
}

// Detect if connected wallet is admin or authorized doctor
async function detectRoleFromWallet() {
    if (!contract || !connectedAddress) return;

    try {
        const isAdmin = (await contract.admin()).toLowerCase() === connectedAddress.toLowerCase();
        const isDoctor = await contract.authorizedDoctors(connectedAddress);

        const roleSelect = document.getElementById('currentRole');
        if (isAdmin) {
            roleSelect.value = 'admin';
        } else if (isDoctor) {
            roleSelect.value = 'doctor';
        } else {
            roleSelect.value = 'patient';
        }
        updateUIByRole();
    } catch (e) {
        console.warn("Tidak bisa deteksi peran dari kontrak (mungkin belum deploy):", e.message);
    }
}

// ============================================================
// UI ROLE MANAGEMENT
// ============================================================

function updateUIByRole() {
    const role = document.getElementById('currentRole').value;
    const inputForm = document.getElementById('inputForm');
    inputForm.classList.toggle('hidden', role !== 'doctor');
    renderChain();
}

// ============================================================
// RENDER CHAIN
// ============================================================

async function renderChain() {
    const chainEl = document.getElementById('chain');
    const statusBar = document.getElementById('status');
    const role = document.getElementById('currentRole').value;

    chainEl.innerHTML = '<div class="loading">Memuat data...</div>';

    // If connected to contract, read from blockchain
    if (contract && CONTRACT_ADDRESS !== "0xYOUR_CONTRACT_ADDRESS_HERE") {
        try {
            const total = await contract.totalRecords();
            chainEl.innerHTML = '';

            // Always show genesis block
            chainEl.appendChild(buildBlockElement({
                index: 0, patientName: "Genesis Block",
                diagnosis: "System Initialization",
                timestamp: new Date().toISOString(),
                previousHash: "0000000000000000",
                hash: "ETHEREUM_GENESIS",
                isGenesis: true
            }, role));

            for (let i = 0; i < total; i++) {
                const [name, diagnosis, timestamp, addedBy] = await contract.getRecord(i);
                chainEl.appendChild(buildBlockElement({
                    index: i + 1,
                    patientName: name,
                    diagnosis: diagnosis,
                    timestamp: new Date(timestamp * 1000).toISOString(),
                    previousHash: "On-Chain (Ethereum)",
                    hash: "Verified by Ethereum Network ✅",
                    addedBy: addedBy
                }, role));
            }

            statusBar.innerText = "SISTEM AMAN: Data Terverifikasi di Jaringan Ethereum";
            statusBar.className = "status-bar valid";
            return;
        } catch (err) {
            console.warn("Gagal baca dari kontrak, fallback ke lokal:", err.message);
        }
    }

    // Fallback: local simulation chain
    chainEl.innerHTML = '';
    const isValid = localChain.isChainValid();

    localChain.chain.forEach((block, index) => {
        let blockValid = true;
        if (index > 0) {
            const prev = localChain.chain[index - 1];
            blockValid = (block.hash === block.calculateHash() && block.previousHash === prev.hash);
        }
        chainEl.appendChild(buildBlockElement({ ...block, blockValid, isLocal: true }, role, index));
    });

    statusBar.innerText = isValid
        ? "MODE SIMULASI LOKAL: Integritas Data Terverifikasi"
        : "PERINGATAN: Terdeteksi Manipulasi Data pada Ledger!";
    statusBar.className = `status-bar ${isValid ? 'valid' : 'invalid'}`;
}

function buildBlockElement(block, role, localIndex = -1) {
    const el = document.createElement('div');
    const isInvalid = block.blockValid === false;
    el.className = `block ${isInvalid ? 'is-invalid' : ''}`;

    const tamperBtn = (block.isLocal && role === 'admin' && localIndex > 0)
        ? `<button class="tamper-btn" onclick="tamperData(${localIndex})">⚠️ Edit (Simulasi Tamper)</button>`
        : '';

    const addedByHtml = block.addedBy
        ? `<small>ADDED BY:</small><span class="hash-label">${block.addedBy}</span>`
        : '';

    el.innerHTML = `
        <div class="block-header">
            <span>BLOCK #${block.index}</span>
            <span>${new Date(block.timestamp).toLocaleString()}</span>
        </div>
        <div class="block-data">
            🩺 ${block.patientName}: <span style="color: var(--primary)">${block.diagnosis}</span>
        </div>
        <small>PREVIOUS HASH:</small>
        <span class="hash-label">${block.previousHash}</span>
        <small>CURRENT HASH:</small>
        <span class="hash-label" style="color:#0f172a">${block.hash}</span>
        ${addedByHtml}
        ${tamperBtn}
    `;
    return el;
}

// ============================================================
// ADD BLOCK
// ============================================================

async function addNewBlock() {
    const role = document.getElementById('currentRole').value;
    if (role !== 'doctor') {
        alert("Akses Ditolak: Hanya Dokter yang dapat menambahkan rekam medis.");
        return;
    }

    const pName = document.getElementById('patientName');
    const diag = document.getElementById('diagnosis');

    if (!pName.value || !diag.value) {
        alert("Harap isi semua data!");
        return;
    }

    // If MetaMask connected and contract ready → write to blockchain
    if (contract && CONTRACT_ADDRESS !== "0xYOUR_CONTRACT_ADDRESS_HERE") {
        try {
            document.getElementById('status').innerText = "⏳ Mengirim transaksi ke Ethereum...";
            const tx = await contract.addRecord(pName.value, diag.value);
            document.getElementById('status').innerText = "⏳ Menunggu konfirmasi blok...";
            await tx.wait();
            pName.value = ''; diag.value = '';
            await renderChain();
        } catch (err) {
            if (err.code === 4001) {
                alert("Transaksi dibatalkan oleh pengguna.");
            } else {
                alert("Transaksi gagal:\n" + (err.reason || err.message));
            }
            await renderChain();
        }
        return;
    }

    // Fallback: local simulation
    localChain.addBlock(pName.value, diag.value);
    pName.value = ''; diag.value = '';
    renderChain();
}

// ============================================================
// TAMPER (local simulation only)
// ============================================================

function tamperData(index) {
    if (document.getElementById('currentRole').value !== 'admin') {
        alert("Akses Ditolak!");
        return;
    }
    const newData = prompt("Ubah Diagnosa Pasien secara paksa (simulasi tamper):", "Sehat Walafiat");
    if (newData) {
        localChain.chain[index].diagnosis = newData;
        renderChain();
    }
}

// ============================================================
// INIT
// ============================================================
updateUIByRole();