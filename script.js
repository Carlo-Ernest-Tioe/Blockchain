// ============================================================
// CONFIGURATION & CONTRACT ABI
// ============================================================
const CONTRACT_ADDRESS = "0xe413386A62F2237Fc1107576e9D3e07BE21d0440";

const CONTRACT_ABI = [
    // Write Functions
    "function addRecord(uint256 _patientId, string memory _diagnosis) public",
    "function editRecord(uint256 _recordIndex, string memory _newDiagnosis) public",
    "function togglePrivacy(uint256 _recordIndex) public",
    "function authorizeDoctor(address _doc) public",
    "function revokeDoctor(address _doc) public",
    "function authorizePatient(address _patient, string memory _name) public",
    "function revokePatient(address _patient) public",
    // Read Functions
    "function getRecord(uint256 _index) public view returns (uint256, string, uint256, address, bool)",
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
            const [pId, diagnosis, timestamp, addedBy, isPrivate] = await contract.getRecord(i);
            const [historyDiag, historyTime] = await contract.getRecordHistory(i);
            
            const pid = pId.toNumber();
            let name = patientNameCache.get(pid);
            if (!name) {
                name = await contract.patientIdToName(pid);
                name = name || `Pasien #${pid}`;
                patientNameCache.set(pid, name);
            }

            allBlocks.push({
                recordIndex: i, patientId: pid, patientName: name,
                diagnosis, isPrivate, addedBy,
                timestamp: new Date(Number(timestamp) * 1000).toISOString(),
                history: historyDiag.map((d, idx) => ({
                    diagnosis: d, timestamp: new Date(Number(historyTime[idx]) * 1000).toISOString()
                }))
            });
        }

        const visible = filterBlocksByRole(allBlocks);
        renderGroupedChain(chainEl, visible);
        status.innerText = "SISTEM AMAN: Data Terverifikasi di Jaringan Ethereum";
        status.className = "status-bar valid";
    } catch (err) {
        console.error("Render failed, using local fallback", err);
        renderLocalFallback(chainEl, status);
    }
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
        header.innerHTML = `${patientBlocks[0].patientName} <span class="patient-id-badge">ID: ${pid}</span>`;
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
    el.className = `block ${block.isPrivate ? 'is-private' : ''}`;

    // Privacy Badge for Authorized Users
    const privacyBadge = ((currentRole === 'doctor' || currentRole === 'admin') && block.isPrivate)
        ? `<span class="privacy-indicator">🔒 Privat</span>` : '';

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
                📋 Tampilkan Riwayat (${block.history.length})
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
                ${block.isPrivate ? '🔓 Set Publik' : '🔒 Set Privat'}
            </button>`;
    } 
    // --- RESTORED: Admin Tamper Action ---
    else if (currentRole === 'admin') {
        actions = `
            <div class="admin-actions">
                <button class="tamper-btn" onclick="tamperOnChain(${block.recordIndex})">⚠️ Simulasi Tamper</button>
            </div>`;
    }

    el.innerHTML = `
        <div class="block-header">
            <span class="block-timestamp">${new Date(block.timestamp).toLocaleString()}</span>
            ${privacyBadge}
        </div>
        <div class="block-data">
            <span class="block-patient-id">#${block.patientId}</span> ${block.patientName}:
            <span class="block-diagnosis">${block.diagnosis}</span>
        </div>
        ${addedByHtml}
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
    btn.innerText = p.classList.contains('hidden') ? `📋 Tampilkan Riwayat` : `📋 Sembunyikan Riwayat`;
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

// --- RESTORED: Admin Tamper Simulation ---
function tamperOnChain(recordIndex) {
    if (currentRole !== 'admin') { alert("Akses Ditolak!"); return; }
    const newData = prompt(
        "SIMULASI TAMPER (Admin Only)\n\n" +
        "Ini hanya simulasi visual — data asli di blockchain tidak berubah.\n\n" +
        "Masukkan diagnosa palsu:", "Data Dimanipulasi"
    );
    if (!newData) return;
    alert(
        "⚠️ DEMONSTRASI KEAMANAN\n\n" +
        "Pada sistem tanpa blockchain, data ini bisa diubah menjadi:\n\"" + newData + "\"\n\n" +
        "Namun pada Bisma Medical Chain, perubahan ini TIDAK MUNGKIN terjadi " +
        "karena setiap record terkunci di Ethereum blockchain and tidak dapat dimodifikasi."
    );
}

async function addNewBlock() {
    const pid = document.getElementById('patientId').value;
    const diag = document.getElementById('diagnosis').value;
    if (!pid || !diag) { alert("Isi ID dan Diagnosa!"); return; }
    try {
        const tx = await contract.addRecord(pid, diag);
        await tx.wait();
        document.getElementById('patientId').value = '';
        document.getElementById('diagnosis').value = '';
        renderChain();
    } catch (e) { alert("Gagal menambah data: " + e.message); }
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