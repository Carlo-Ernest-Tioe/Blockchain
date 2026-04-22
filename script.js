// ============================================================
// CONFIGURATION & CONTRACT ABI
// ============================================================
const CONTRACT_ADDRESS = "0x42E13cF748687a035ab79D3FBeB1a2ADE8f89Bf0";

const CONTRACT_ABI = [
    // Write Functions
    "function addRecord(uint256 _patientId, string memory _patientName, string memory _diagnosis) public",
    "function editRecord(uint256 _recordIndex, string memory _newDiagnosis) public",
    "function togglePrivacy(uint256 _recordIndex) public",
    "function authorizeDoctor(address _doc) public",
    "function revokeDoctor(address _doc) public",
    "function authorizePatient(address _patient, string memory _name) public",
    "function revokePatient(address _patient) public",
    // Read Functions
    "function getRecord(uint256 _index) public view returns (uint256, string, string, uint256, address, bool)",
    "function getRecordHistory(uint256 _index) public view returns (string[], uint256[])",
    "function totalRecords() public view returns (uint256)",
    "function authorizedDoctors(address) public view returns (bool)",
    "function getPatientInfo(address _wallet) public view returns (uint256, string, bool)",
    "function patientIdToName(uint256) public view returns (string)",
    "function admin() public view returns (address)"
];

// ─── App State ─────────────────────────────────────────────────
let provider = null;
let signer = null;
let contract = null;
let connectedAddress = null;

let currentRole = 'none';
let currentPatientId = null;
let currentPatientName = null;

const patientNameCache = new Map();

// ─── Local Simulation Classes (Fallback) ──────────────────────
class Block {
    constructor(index, timestamp, patientId, patientName, diagnosis, previousHash = '') {
        this.index = index;
        this.timestamp = timestamp;
        this.patientId = patientId;
        this.patientName = patientName;
        this.diagnosis = diagnosis;
        this.previousHash = previousHash;
        this.hash = this.calculateHash();
        this.isPrivate = false;
        this.history = [];
    }
    calculateHash() {
        return CryptoJS.SHA256(this.index + this.previousHash + this.timestamp + this.patientId + this.diagnosis).toString();
    }
}

class Blockchain {
    constructor() { this.chain = [this.createGenesisBlock()]; }
    createGenesisBlock() { return new Block(0, new Date().toISOString(), 0, "Genesis", "System Initialization", "0"); }
    getLatestBlock() { return this.chain[this.chain.length - 1]; }
    addBlock(pId, pName, diag) {
        const b = new Block(this.chain.length, new Date().toISOString(), pId, pName, diag, this.getLatestBlock().hash);
        this.chain.push(b);
    }
    isChainValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const cur = this.chain[i], prev = this.chain[i - 1];
            if (cur.hash !== cur.calculateHash() || cur.previousHash !== prev.hash) return false;
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
        alert("MetaMask tidak ditemukan!");
        return;
    }
    try {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();
        connectedAddress = await signer.getAddress();
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        updateWalletUI(connectedAddress);
        await detectRole();
        await renderChain();

        window.ethereum.on('accountsChanged', (accounts) => {
            if (accounts.length === 0) location.reload();
            else connectMetaMask();
        });
        window.ethereum.on('chainChanged', () => window.location.reload());
    } catch (err) {
        console.error("Connection error:", err);
    }
}

function updateWalletUI(address) {
    const short = address.slice(0, 6) + '...' + address.slice(-4);
    document.getElementById('walletAddress').innerText = short;
    document.getElementById('connectBtn').innerText = "Terhubung";
    document.getElementById('walletBadge').className = "wallet-badge connected";
    document.getElementById('walletBadge').innerText = "Online";
}

// ─── Role Detection ──────────────────────────────────────────
async function detectRole() {
    if (!contract || !connectedAddress) return;
    try {
        const adminAddr = await contract.admin();
        if (adminAddr.toLowerCase() === connectedAddress.toLowerCase()) {
            currentRole = 'admin';
        } else if (await contract.authorizedDoctors(connectedAddress)) {
            currentRole = 'doctor';
        } else {
            const [pid, pName, exists] = await contract.getPatientInfo(connectedAddress);
            if (exists) {
                currentRole = 'patient';
                currentPatientId = pid.toNumber();
                currentPatientName = pName;
            } else {
                currentRole = 'unrecognized';
            }
        }
        updateRoleUI();
    } catch (e) {
        console.warn("Role detection failed:", e);
    }
}

function updateRoleUI() {
    const inputForm = document.getElementById('inputForm');
    const roleBadge = document.getElementById('roleBadge');
    if (inputForm) inputForm.classList.toggle('hidden', currentRole !== 'doctor' && currentRole !== 'admin');

    const labels = {
        'none': { text: 'Tidak Terhubung', cls: 'role-none' },
        'unrecognized': { text: 'Tamu (Wallet Tidak Dikenal)', cls: 'role-guest' },
        'patient': { text: `Pasien: ${currentPatientName} [ID: ${currentPatientId}]`, cls: 'role-patient' },
        'doctor': { text: 'Dokter', cls: 'role-doctor' },
        'admin': { text: 'Admin IT', cls: 'role-admin' },
    };
    const info = labels[currentRole] || labels['none'];
    if (roleBadge) {
        roleBadge.innerText = info.text;
        roleBadge.className = `role-badge ${info.cls}`;
    }
}

// ============================================================
// CORE RENDERING ENGINE
// ============================================================

async function renderChain() {
    const chainEl = document.getElementById('chain');
    const status = document.getElementById('status');
    if (currentRole === 'none') return;

    chainEl.innerHTML = '<div class="loading">Memuat data...</div>';

    try {
        const total = await contract.totalRecords();
        const allBlocks = [];

        for (let i = 0; i < total; i++) {
            const [pId, patientName, diagnosis, timestamp, addedBy, isPrivate] = await contract.getRecord(i);
            const [historyDiag, historyTime] = await contract.getRecordHistory(i);

            const pid = pId.toNumber();
            // Use the name stored ON-CHAIN by the doctor — this is the actual patient name
            const resolvedName = (patientName && patientName.trim() !== '')
                ? patientName.trim()
                : `Pasien #${pid}`;
            // Cache the most recent name for this ID (used by column header)
            patientNameCache.set(pid, resolvedName);

            allBlocks.push({
                recordIndex: i, patientId: pid, patientName: resolvedName,
                diagnosis, isPrivate, addedBy,
                timestamp: new Date(Number(timestamp) * 1000).toISOString(),
                history: historyDiag.map((d, idx) => ({
                    diagnosis: d, timestamp: new Date(Number(historyTime[idx]) * 1000).toISOString()
                }))
            });
        }

        // Compute SHA256 hashes per-column (grouped by patientId, ordered by recordIndex)
        // This creates a visual hash chain like the original demo
        computeBlockHashes(allBlocks);

        const visible = filterBlocksByRole(allBlocks);
        renderGroupedChain(chainEl, visible);
        status.innerText = "SISTEM AMAN: Data Terverifikasi di Jaringan Ethereum";
        status.className = "status-bar valid";
    } catch (err) {
        console.error("Render failed, using local fallback", err);
        renderLocalFallback(chainEl, status);
    }
}

// ============================================================
// HASH CHAIN COMPUTATION (visual only — mirrors original demo)
// Hashes are computed from on-chain data using CryptoJS SHA256
// Each column is an independent chain: genesis → block1 → block2 ...
// ============================================================
function computeBlockHashes(blocks) {
    // Group by patientId, sort each group by recordIndex
    const groups = new Map();
    blocks.forEach(b => {
        if (!groups.has(b.patientId)) groups.set(b.patientId, []);
        groups.get(b.patientId).push(b);
    });

    groups.forEach(chain => {
        chain.sort((a, b) => a.recordIndex - b.recordIndex);
        let prevHash = '0000000000000000';
        chain.forEach(block => {
            block.previousHash = prevHash;
            block.currentHash  = CryptoJS.SHA256(
                block.recordIndex + prevHash + block.timestamp +
                block.patientId   + block.patientName + block.diagnosis
            ).toString();
            prevHash = block.currentHash;
        });
    });
}

// Recompute a single block's hash from its current data (used after tamper)
function recomputeHash(block) {
    return CryptoJS.SHA256(
        block.recordIndex + block.previousHash + block.timestamp +
        block.patientId   + block.patientName  + block.diagnosis
    ).toString();
}

function filterBlocksByRole(blocks) {
    if (currentRole === 'admin' || currentRole === 'doctor') return blocks;
    if (currentRole === 'patient') return blocks.filter(b => !b.isPrivate || b.patientId === currentPatientId);
    return blocks.filter(b => !b.isPrivate);
}

function renderGroupedChain(chainEl, blocks) {
    chainEl.innerHTML = '';
    const groups = new Map();
    blocks.forEach(b => {
        if (!groups.has(b.patientId)) groups.set(b.patientId, []);
        groups.get(b.patientId).push(b);
    });

    // --- RESTORED: Sort IDs Numerically ---
    const sortedIds = Array.from(groups.keys()).sort((a, b) => a - b);

    const grid = document.createElement('div');
    grid.className = 'chain-grid';

    sortedIds.forEach((pid) => {
        const patientBlocks = groups.get(pid);
        const col = document.createElement('div');
        col.className = 'chain-column';
        
        const header = document.createElement('div');
        header.className = 'chain-column-header';
        // Use the most recently added record's name for the column header
        const latestBlock = [...patientBlocks].sort((a, b) => b.recordIndex - a.recordIndex)[0];
        const columnName  = latestBlock.patientName || `Pasien #${pid}`;
        header.innerHTML = `${columnName} <span class="patient-id-badge">ID: ${pid}</span>`;
        col.appendChild(header);

        const blocksWrapper = document.createElement('div');
        blocksWrapper.className = 'chain-column-blocks';

        [...patientBlocks].reverse().forEach((block, idx) => {
            blocksWrapper.appendChild(buildBlockElement(block));
            if (idx < patientBlocks.length - 1) {
                const conn = document.createElement('div');
                conn.className = 'chain-connector';
                conn.innerHTML = '↕';
                blocksWrapper.appendChild(conn);
            }
        });
        col.appendChild(blocksWrapper);
        grid.appendChild(col);
    });
    chainEl.appendChild(grid);
}

function buildBlockElement(block) {
    const el = document.createElement('div');
    el.className = `block ${block.isPrivate ? 'is-private' : ''} ${block.isTampered ? 'is-invalid' : ''}`;

    // Privacy Badge for Authorized Users
    const privacyBadge = ((currentRole === 'doctor' || currentRole === 'admin') && block.isPrivate)
        ? `<span class="privacy-indicator">Privat</span>` : '';

    // Added By Wallet Label
    const addedByHtml = block.addedBy 
        ? `<small>DITAMBAHKAN OLEH:</small><span class="hash-label">${block.addedBy}</span>` : '';

    // --- RESTORED: Detailed History List ---
    let historySection = '';
    if (block.history && block.history.length > 0) {
        const items = [...block.history].reverse().map((h, i) => `
            <div class="history-item">
                <span class="history-label">Entri #${block.history.length - i}</span>
                <span class="history-diagnosis">${h.diagnosis}</span>
                <span class="history-time">${new Date(h.timestamp).toLocaleString()}</span>
            </div>`).join('');

        historySection = `
            <button class="history-toggle-btn" onclick="toggleHistory(${block.recordIndex})" id="history-btn-${block.recordIndex}">
                Tampilkan Riwayat (${block.history.length})
            </button>
            <div class="history-panel hidden" id="history-${block.recordIndex}">${items}</div>`;
    }

    // Actions (Edit/Privacy for Patient, Tamper Simulation for Admin)
    let actions = '';
    if (currentRole === 'patient' && block.patientId === currentPatientId) {
        actions = `
            <div class="edit-section">
                <button class="edit-toggle-btn" onclick="toggleEditForm(${block.recordIndex})">✏️ Koreksi Diagnosis</button>
                <div class="edit-form hidden" id="edit-form-${block.recordIndex}">
                    <input type="text" class="edit-input" id="edit-input-${block.recordIndex}" placeholder="Diagnosis baru..." />
                    <button class="edit-save-btn" onclick="submitEdit(${block.recordIndex})">Simpan</button>
                </div>
            </div>
            <button class="privacy-btn ${block.isPrivate ? 'is-private-btn' : ''}" onclick="togglePrivacy(${block.recordIndex})">
                ${block.isPrivate ? 'Set Publik' : 'Set Privat'}
            </button>`;
    } 
    else if (currentRole === 'admin') {
        const isTampered = block.isTampered || tamperState.has(block.recordIndex);
        actions = `
            <div class="admin-actions">
                <button class="tamper-btn ${isTampered ? 'tamper-active' : ''}"
                    onclick="tamperOnChain(${block.recordIndex})">
                    ${isTampered ? 'Ditamper' : 'Simulasi Tamper'}
                </button>
                ${isTampered
                    ? `<button class="reset-tamper-btn" onclick="resetTamper(${block.recordIndex})">↩ Reset</button>`
                    : ''}
            </div>`;
    }

    // Hash display — admin only, mirrors original demo
    const hashSection = (currentRole === 'admin' && block.previousHash)
        ? `<small>PREVIOUS HASH:</small>
           <span class="hash-label">${block.previousHash}</span>
           <small>CURRENT HASH:</small>
           <span class="hash-label ${block.isTampered ? 'hash-invalid' : ''}">${block.isTampered ? block.tamperedHash : block.currentHash}</span>`
        : '';

    el.innerHTML = `
        <div class="block-header">
            <span class="block-timestamp">${new Date(block.timestamp).toLocaleString()}</span>
            ${privacyBadge}
        </div>
        <div class="block-data">
            <span class="block-patient-id">#${block.patientId}</span> ${block.patientName}:
            <span class="block-diagnosis">${block.isTampered ? `<span class="tampered-diagnosis">${block.tamperedDiagnosis}</span>` : block.diagnosis}</span>
        </div>
        ${addedByHtml}
        ${hashSection}
        ${historySection}
        ${actions}
    `;
    return el;
}

// ─── Interaction Helpers ─────────────────────────────────────
function toggleEditForm(idx) { 
    document.getElementById(`edit-form-${idx}`).classList.toggle('hidden');
}

function toggleHistory(idx) { 
    const p = document.getElementById(`history-${idx}`);
    p.classList.toggle('hidden');
    const btn = document.getElementById(`history-btn-${idx}`);
    btn.innerText = p.classList.contains('hidden') ? `Tampilkan Riwayat` : `Sembunyikan Riwayat`;
}

async function submitEdit(idx) {
    const val = document.getElementById(`edit-input-${idx}`).value.trim();
    if (!val) return;
    try {
        const tx = await contract.editRecord(idx, val);
        await tx.wait();
        renderChain();
    } catch (e) { alert("Gagal mengedit: " + e.message); }
}

async function togglePrivacy(idx) {
    try {
        const tx = await contract.togglePrivacy(idx);
        await tx.wait();
        renderChain();
    } catch (e) { alert("Gagal mengubah privasi: " + e.message); }
}

// ============================================================
// TAMPER SIMULATION (admin only)
// Visually breaks the hash chain exactly like the original demo
// Does NOT change blockchain data — purely educational
// ============================================================

// Stores tamper state per recordIndex so it survives re-renders
const tamperState = new Map();
function resetTamper(recordIndex) {
    tamperState.delete(recordIndex);
    if (tamperState.size === 0) {
        renderChain(); // full clean render
    } else {
        renderChainWithTamper(); // still some tampers active
    }
}


function tamperOnChain(recordIndex) {
    if (currentRole !== 'admin') { alert("Akses Ditolak!"); return; }

    const newDiag = prompt(
        "SIMULASI TAMPER (Admin)" +
        "\nDemonstrasi ubah diagnosis:",
        "Double click to add text"
    );
    if (!newDiag || !newDiag.trim()) return;

    // Store tamper locally
    tamperState.set(recordIndex, newDiag.trim());

    // Re-render to show broken chain
    renderChainWithTamper();
}

async function renderChainWithTamper() {
    const chainEl = document.getElementById('chain');
    const status  = document.getElementById('status');

    try {
        const total     = await contract.totalRecords();
        const allBlocks = [];

        for (let i = 0; i < total; i++) {
            const [pId, patientName, diagnosis, timestamp, addedBy, isPrivate] = await contract.getRecord(i);
            const [historyDiag, historyTime] = await contract.getRecordHistory(i);
            const pid          = pId.toNumber();
            const resolvedName = (patientName && patientName.trim() !== '')
                ? patientName.trim() : `Pasien #${pid}`;
            patientNameCache.set(pid, resolvedName);

            allBlocks.push({
                recordIndex: i, patientId: pid, patientName: resolvedName,
                diagnosis, isPrivate, addedBy,
                timestamp: new Date(Number(timestamp) * 1000).toISOString(),
                history: historyDiag.map((d, idx) => ({
                    diagnosis: d, timestamp: new Date(Number(historyTime[idx]) * 1000).toISOString()
                }))
            });
        }

        // Compute clean hashes first
        computeBlockHashes(allBlocks);

        // Apply tamper states — this breaks the chain visually
        let chainBroken = false;
        const groups = new Map();
        allBlocks.forEach(b => {
            if (!groups.has(b.patientId)) groups.set(b.patientId, []);
            groups.get(b.patientId).push(b);
        });

        groups.forEach(chain => {
            chain.sort((a, b) => a.recordIndex - b.recordIndex);
            let prevHash = '0000000000000000';
            let breakDetected = false;

            chain.forEach(block => {
                if (tamperState.has(block.recordIndex)) {
                    // This block was tampered — show fake diagnosis, broken hash
                    block.isTampered       = true;
                    block.tamperedDiagnosis = tamperState.get(block.recordIndex);
                    block.tamperedHash     = CryptoJS.SHA256(
                        block.recordIndex + prevHash + block.timestamp +
                        block.patientId + block.patientName + block.tamperedDiagnosis
                    ).toString();
                    // All subsequent blocks in this chain are now invalid
                    prevHash       = block.tamperedHash;
                    breakDetected  = true;
                    chainBroken    = true;
                } else if (breakDetected) {
                    // Block after tampered one — previousHash no longer matches
                    block.isInvalidated = true;
                    chainBroken = true;
                    prevHash = block.currentHash; // keep propagating
                }
            });
        });

        const visible = filterBlocksByRole(allBlocks);
        renderGroupedChainTampered(chainEl, visible);

        if (chainBroken) {
            status.innerText = "PERINGATAN: Terdeteksi Manipulasi Data pada Ledger!";
            status.className = "status-bar invalid";
        } else {
            status.innerText = "SISTEM AMAN: Data Terverifikasi di Jaringan Ethereum";
            status.className = "status-bar valid";
        }
    } catch (err) {
        console.error("Tamper render failed:", err);
    }
}

function renderGroupedChainTampered(chainEl, blocks) {
    // Same as renderGroupedChain but marks invalidated blocks
    blocks.forEach(b => {
        if (b.isInvalidated) b.isTampered = true; // reuse same styling
    });
    renderGroupedChain(chainEl, blocks);
}

async function addNewBlock() {
    const pid      = parseInt(document.getElementById('patientId').value);
    const nameEl   = document.getElementById('patientNameDisplay');
    const diag     = document.getElementById('diagnosis').value.trim();
    const nameVal  = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : `Pasien #${pid}`;

    if (!pid || isNaN(pid) || !diag) { alert("Harap isi ID Pasien dan Diagnosa!"); return; }

    // Check if ID is registered — warn if not, allow proceeding
    // if (contract) {
    //     try {
    //         const registeredName = await contract.patientIdToName(pid);
    //         const isRegistered   = registeredName && registeredName.trim() !== '';
    //         if (!isRegistered) {
    //             const proceed = confirm(
    //                 "\u26a0\ufe0f PERINGATAN\n\n" +
    //                 "ID Pasien \"" + pid + "\" tidak ditemukan dalam registri.\n\n" +
    //                 "Record akan tetap disimpan namun pasien ini tidak akan bisa\n" +
    //                 "melihat atau mengelola recordnya sendiri.\n\n" +
    //                 "Apakah Anda yakin ingin melanjutkan?"
    //             );
    //             if (!proceed) return;
    //         }
    //     } catch (e) {
    //         const proceed = confirm("\u26a0\ufe0f Tidak dapat memverifikasi ID \"" + pid + "\". Lanjutkan?");
    //         if (!proceed) return;
    //     }
    // }

    try {
        document.getElementById('status').innerText = "Mengirim transaksi ke Ethereum...";
        const tx = await contract.addRecord(pid, nameVal, diag);
        document.getElementById('status').innerText = "Menunggu konfirmasi blok...";
        await tx.wait();
        document.getElementById('patientId').value = '';
        document.getElementById('diagnosis').value = '';
        if (nameEl) nameEl.value = '';
        renderChain();
    } catch (e) {
        if (e.code === 4001) { alert("Transaksi dibatalkan."); }
        else { alert("Transaksi gagal:\n" + (e.reason || e.message)); }
    }
}

function renderLocalFallback(chainEl, status) {
    const localBlocks = localChain.chain.map(b => ({ ...b, isLocal: true }));
    renderGroupedChain(chainEl, localBlocks);
    status.innerText = "MODE SIMULASI: Menggunakan data lokal.";
    status.className = "status-bar invalid";
}

// ─── Initial State ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const chainEl = document.getElementById('chain');
    if (chainEl) chainEl.innerHTML = '<div class="loading">Hubungkan MetaMask untuk melihat data.</div>';
    updateRoleUI();
});