// ============================================================
// SOLIDITY CONTRACT — deploy via Remix IDE
// Full source is in MedicalChain.sol
// After redeploying, update CONTRACT_ADDRESS below
// ============================================================

// ============================================================
// FRONTEND JAVASCRIPT
// ============================================================

// --- Paste your NEW deployed contract address here after redeploying ---
const CONTRACT_ADDRESS = "0x2ef015659F930979DFE5356Ebcf5dB36Bd8EE888";

const CONTRACT_ABI = [
    // Write
    "function addRecord(string memory _name, string memory _diagnosis) public",
    "function togglePrivacy(uint _index) public",
    "function authorizeDoctor(address _doc) public",
    "function revokeDoctor(address _doc) public",
    "function authorizePatient(address _patient, string memory _name) public",
    "function revokePatient(address _patient) public",
    // Read
    "function getRecord(uint _index) public view returns (string, string, uint256, address, bool)",
    "function totalRecords() public view returns (uint)",
    "function authorizedDoctors(address) public view returns (bool)",
    "function patientNames(address) public view returns (string)",
    "function admin() public view returns (address)"
];

// Public read-only RPC — used for unrecognized wallets reading public records
const SEPOLIA_RPC = "https://eth-sepolia.g.alchemy.com/v2/demo";

// ─── App State ─────────────────────────────────────────────────
let provider         = null;
let signer           = null;
let contract         = null;
let connectedAddress = null;

// Role: 'none' | 'unrecognized' | 'patient' | 'doctor' | 'admin'
let currentRole        = 'none';
let currentPatientName = null;

// ─── Local simulation chain (fallback only) ────────────────────
class Block {
    constructor(index, timestamp, patientName, diagnosis, previousHash = '') {
        this.index        = index;
        this.timestamp    = timestamp;
        this.patientName  = patientName;
        this.diagnosis    = diagnosis;
        this.previousHash = previousHash;
        this.hash         = this.calculateHash();
        this.isPrivate    = false;
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
        const b = new Block(
            this.chain.length, new Date().toISOString(),
            patientName, diagnosis, this.getLatestBlock().hash
        );
        this.chain.push(b);
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
        await window.ethereum.request({ method: 'eth_requestAccounts' });

        provider         = new ethers.providers.Web3Provider(window.ethereum);
        signer           = provider.getSigner();
        connectedAddress = await signer.getAddress();
        contract         = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        updateWalletUI(connectedAddress);
        await detectRole();
        await renderChain();

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
        detectRole().then(() => renderChain());
    }
}

function disconnectWallet() {
    provider = null; signer = null; contract = null;
    connectedAddress = null; currentRole = 'none'; currentPatientName = null;

    document.getElementById('walletAddress').innerText = "Belum terhubung";
    document.getElementById('connectBtn').innerText    = "Hubungkan MetaMask";
    document.getElementById('walletBadge').className   = "wallet-badge disconnected";
    document.getElementById('walletBadge').innerText   = "Offline";

    updateRoleUI();
    document.getElementById('chain').innerHTML =
        '<div class="loading">Hubungkan MetaMask untuk melihat data.</div>';
    document.getElementById('status').innerText = "Tidak terhubung";
    document.getElementById('status').className = "status-bar invalid";
}

function updateWalletUI(address) {
    const short = address.slice(0, 6) + '...' + address.slice(-4);
    document.getElementById('walletAddress').innerText = short;
    document.getElementById('connectBtn').innerText    = "Terhubung";
    document.getElementById('walletBadge').innerText   = "Online";
    document.getElementById('walletBadge').className   = "wallet-badge connected";
}

// ─── Detect role from wallet ────────────────────────────────
async function detectRole() {
    currentRole        = 'unrecognized';
    currentPatientName = null;

    if (!contract || !connectedAddress) { currentRole = 'none'; updateRoleUI(); return; }

    try {
        // Admin?
        const adminAddr = await contract.admin();
        if (adminAddr.toLowerCase() === connectedAddress.toLowerCase()) {
            currentRole = 'admin'; updateRoleUI(); return;
        }
        // Doctor?
        const isDoctor = await contract.authorizedDoctors(connectedAddress);
        if (isDoctor) {
            currentRole = 'doctor'; updateRoleUI(); return;
        }
        // Patient?
        const pName = await contract.patientNames(connectedAddress);
        if (pName && pName.trim() !== '') {
            currentRole        = 'patient';
            currentPatientName = pName;
            updateRoleUI(); return;
        }
        // Unrecognized
        currentRole = 'unrecognized';
        updateRoleUI();

    } catch (e) {
        console.warn("Tidak bisa deteksi peran:", e.message);
        currentRole = 'unrecognized';
        updateRoleUI();
    }
}

// ─── Sync UI to current role ─────────────────────────────────
function updateRoleUI() {
    const inputForm = document.getElementById('inputForm');
    const roleBadge = document.getElementById('roleBadge');

    // Only doctors and admin can add records
    inputForm.classList.toggle('hidden', currentRole !== 'doctor' && currentRole !== 'admin');

    const labels = {
        'none':         { text: 'Tidak Terhubung',              cls: 'role-none'    },
        'unrecognized': { text: 'Tamu (Wallet Tidak Dikenal)',   cls: 'role-guest'   },
        'patient':      { text: `Pasien: ${currentPatientName}`, cls: 'role-patient' },
        'doctor':       { text: 'Dokter',                        cls: 'role-doctor'  },
        'admin':        { text: 'Admin IT',                      cls: 'role-admin'   },
    };
    const info = labels[currentRole] || labels['none'];
    roleBadge.innerText = info.text;
    roleBadge.className = `role-badge ${info.cls}`;
}

// ============================================================
// RENDER CHAIN
// ============================================================

async function renderChain() {
    const chainEl   = document.getElementById('chain');
    const statusBar = document.getElementById('status');

    if (currentRole === 'none') {
        chainEl.innerHTML   = '<div class="loading">Hubungkan MetaMask untuk melihat data.</div>';
        statusBar.innerText = "Tidak terhubung";
        statusBar.className = "status-bar invalid";
        return;
    }

    chainEl.innerHTML = '<div class="loading">Memuat data...</div>';

    if (contract && CONTRACT_ADDRESS !== "0xYOUR_NEW_CONTRACT_ADDRESS_HERE") {
        try {
            const total     = await contract.totalRecords();
            const allBlocks = [];

            for (let i = 0; i < total; i++) {
                const [name, diagnosis, timestamp, addedBy, isPrivate] = await contract.getRecord(i);
                allBlocks.push({
                    index:       i + 1,
                    patientName: name,
                    diagnosis,
                    timestamp:   new Date(Number(timestamp) * 1000).toISOString(),
                    previousHash: "On-Chain (Ethereum)",
                    hash:        "Verified by Ethereum Network",
                    addedBy,
                    isPrivate,
                    recordIndex: i
                });
            }

            const visible = filterBlocksByRole(allBlocks);
            renderGroupedChain(chainEl, visible);

            statusBar.innerText = "SISTEM AMAN: Data Terverifikasi di Jaringan Ethereum";
            statusBar.className = "status-bar valid";
            return;
        } catch (err) {
            console.warn("Gagal baca dari kontrak, fallback ke lokal:", err.message);
        }
    }

    // Fallback local chain
    const isValid     = localChain.isChainValid();
    const localBlocks = localChain.chain.map((block, index) => {
        let blockValid = true;
        if (index > 0) {
            const prev = localChain.chain[index - 1];
            blockValid = block.hash === block.calculateHash() && block.previousHash === prev.hash;
        }
        return { ...block, blockValid, isLocal: true, localIndex: index };
    });

    renderGroupedChain(chainEl, localBlocks);
    statusBar.innerText = isValid
        ? "MODE SIMULASI LOKAL: Integritas Data Terverifikasi"
        : "PERINGATAN: Terdeteksi Manipulasi Data pada Ledger!";
    statusBar.className = `status-bar ${isValid ? 'valid' : 'invalid'}`;
}

// ─── Filter records by role ──────────────────────────────────
function filterBlocksByRole(blocks) {
    switch (currentRole) {
        case 'unrecognized':
            // Only public records
            return blocks.filter(b => !b.isPrivate);

        case 'patient':
            // Own records (public + private) + all other public records
            return blocks.filter(b =>
                !b.isPrivate ||
                b.patientName.toLowerCase() === currentPatientName.toLowerCase()
            );

        case 'doctor':
        case 'admin':
            // All records
            return blocks;

        default:
            return [];
    }
}

// ─── Grouped column renderer ─────────────────────────────────
function renderGroupedChain(chainEl, blocks) {
    chainEl.innerHTML = '';

    if (blocks.length === 0) {
        chainEl.innerHTML = '<div class="loading">Tidak ada rekam medis yang dapat ditampilkan.</div>';
        return;
    }

    const groups = new Map();
    blocks.forEach(block => {
        const key = block.patientName;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(block);
    });

    const grid = document.createElement('div');
    grid.className = 'chain-grid';

    groups.forEach((patientBlocks, patientName) => {
        const col = document.createElement('div');
        col.className = 'chain-column';

        const header = document.createElement('div');
        header.className = 'chain-column-header';
        header.innerHTML = `<span>🩺</span> ${patientName}`;
        col.appendChild(header);

        const blocksWrapper = document.createElement('div');
        blocksWrapper.className = 'chain-column-blocks';

        [...patientBlocks].reverse().forEach((block, colIdx) => {
            blocksWrapper.appendChild(buildBlockElement(block));
            if (colIdx < patientBlocks.length - 1) {
                const connector = document.createElement('div');
                connector.className = 'chain-connector';
                connector.innerHTML = '↕';
                blocksWrapper.appendChild(connector);
            }
        });

        col.appendChild(blocksWrapper);
        grid.appendChild(col);
    });

    chainEl.appendChild(grid);
}

// ─── Build single block element ──────────────────────────────
function buildBlockElement(block) {
    const el = document.createElement('div');
    const isInvalid = block.blockValid === false;
    el.className = `block ${isInvalid ? 'is-invalid' : ''} ${block.isPrivate ? 'is-private' : ''}`;

    // Tamper button — local simulation admin only
    const tamperBtn = (block.isLocal && currentRole === 'admin' && block.localIndex > 0)
        ? `<button class="tamper-btn" onclick="tamperData(${block.localIndex})">⚠️ Edit (Simulasi Tamper)</button>`
        : '';

    // Privacy toggle — patient viewing their own record
    let privacyBtn = '';
    if (
        currentRole === 'patient' &&
        currentPatientName &&
        block.patientName.toLowerCase() === currentPatientName.toLowerCase() &&
        !block.isLocal
    ) {
        const label = block.isPrivate
            ? '🔒 Privat — Klik untuk Publik'
            : '🌐 Publik — Klik untuk Privat';
        privacyBtn = `<button class="privacy-btn ${block.isPrivate ? 'is-private-btn' : ''}"
            onclick="togglePrivacy(${block.recordIndex})">${label}</button>`;
    }

    // Privacy indicator shown to doctor / admin
    const privacyIndicator = ((currentRole === 'doctor' || currentRole === 'admin') && block.isPrivate)
        ? `<span class="privacy-indicator">🔒 Privat</span>`
        : '';

    const addedByHtml = block.addedBy
        ? `<small>ADDED BY:</small><span class="hash-label">${block.addedBy}</span>`
        : '';

    el.innerHTML = `
        <div class="block-header">
            <span>BLOCK #${block.index}</span>
            <span>${new Date(block.timestamp).toLocaleString()}</span>
            ${privacyIndicator}
        </div>
        <div class="block-data">
            🩺 ${block.patientName}: <span style="color: var(--primary)">${block.diagnosis}</span>
        </div>
        <small>PREVIOUS HASH:</small>
        <span class="hash-label">${block.previousHash}</span>
        <small>CURRENT HASH:</small>
        <span class="hash-label" style="color:#0f172a">${block.hash}</span>
        ${addedByHtml}
        ${privacyBtn}
        ${tamperBtn}
    `;
    return el;
}

// ============================================================
// TOGGLE PRIVACY (patient only)
// ============================================================

async function togglePrivacy(recordIndex) {
    if (currentRole !== 'patient') return;
    try {
        document.getElementById('status').innerText = "⏳ Mengubah status privasi...";
        const tx = await contract.togglePrivacy(recordIndex);
        await tx.wait();
        await renderChain();
    } catch (err) {
        if (err.code === 4001) {
            alert("Transaksi dibatalkan.");
        } else {
            alert("Gagal mengubah privasi:\n" + (err.reason || err.message));
        }
        await renderChain();
    }
}

// ============================================================
// ADD BLOCK (doctor / admin only)
// ============================================================

async function addNewBlock() {
    if (currentRole !== 'doctor' && currentRole !== 'admin') {
        alert("Akses Ditolak: Hanya Dokter yang dapat menambahkan rekam medis.");
        return;
    }

    const pName = document.getElementById('patientName');
    const diag  = document.getElementById('diagnosis');

    if (!pName.value || !diag.value) { alert("Harap isi semua data!"); return; }

    if (contract && CONTRACT_ADDRESS !== "0xYOUR_NEW_CONTRACT_ADDRESS_HERE") {
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

    // Fallback local
    localChain.addBlock(pName.value, diag.value);
    pName.value = ''; diag.value = '';
    renderChain();
}

// ============================================================
// TAMPER (local simulation only)
// ============================================================

function tamperData(index) {
    if (currentRole !== 'admin') { alert("Akses Ditolak!"); return; }
    const newData = prompt("Ubah Diagnosa Pasien secara paksa (simulasi tamper):", "Sehat Walafiat");
    if (newData) { localChain.chain[index].diagnosis = newData; renderChain(); }
}

// ============================================================
// INIT — page load
// ============================================================
document.getElementById('chain').innerHTML =
    '<div class="loading">Hubungkan MetaMask untuk melihat data.</div>';
document.getElementById('status').innerText = "Tidak terhubung — Hubungkan MetaMask";
document.getElementById('status').className = "status-bar invalid";

updateRoleUI();