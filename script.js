// ============================================================
// SOLIDITY CONTRACT — deploy via Remix IDE
// Full source is in MedicalChain.sol
// After redeploying, update CONTRACT_ADDRESS below
// ============================================================

// ============================================================
// FRONTEND JAVASCRIPT
// ============================================================

// --- Paste your NEW deployed contract address here ---
const CONTRACT_ADDRESS = "0xe413386A62F2237Fc1107576e9D3e07BE21d0440";

const CONTRACT_ABI = [
    // Write
    "function addRecord(uint256 _patientId, string memory _diagnosis) public",
    "function editRecord(uint256 _recordIndex, string memory _newDiagnosis) public",
    "function togglePrivacy(uint256 _recordIndex) public",
    "function authorizeDoctor(address _doc) public",
    "function revokeDoctor(address _doc) public",
    "function authorizePatient(address _patient, string memory _name) public",
    "function revokePatient(address _patient) public",
    // Read
    "function getRecord(uint256 _index) public view returns (uint256, string, uint256, address, bool)",
    "function getRecordHistory(uint256 _index) public view returns (string[], uint256[])",
    "function totalRecords() public view returns (uint256)",
    "function authorizedDoctors(address) public view returns (bool)",
    "function getPatientInfo(address _wallet) public view returns (uint256, string, bool)",
    "function patientIdToName(uint256) public view returns (string)",
    "function getNextPatientId() public view returns (uint256)",
    "function admin() public view returns (address)"
];

const SEPOLIA_RPC = "https://eth-sepolia.g.alchemy.com/v2/demo";

// ─── App State ─────────────────────────────────────────────────
let provider         = null;
let signer           = null;
let contract         = null;
let connectedAddress = null;

let currentRole        = 'none';
let currentPatientId   = null;
let currentPatientName = null;

const patientNameCache = new Map();

// ─── Local simulation chain (fallback only) ────────────────────
class Block {
    constructor(index, timestamp, patientId, patientName, diagnosis, previousHash = '') {
        this.index        = index;
        this.timestamp    = timestamp;
        this.patientId    = patientId;
        this.patientName  = patientName;
        this.diagnosis    = diagnosis;
        this.previousHash = previousHash;
        this.hash         = this.calculateHash();
        this.isPrivate    = false;
        this.history      = [];
    }
    calculateHash() {
        return CryptoJS.SHA256(
            this.index + this.previousHash + this.timestamp + this.patientId + this.diagnosis
        ).toString();
    }
}

class Blockchain {
    constructor() { this.chain = [this.createGenesisBlock()]; }
    createGenesisBlock() {
        return new Block(0, new Date().toISOString(), 0, "Genesis", "System Initialization", "0");
    }
    getLatestBlock() { return this.chain[this.chain.length - 1]; }
    addBlock(patientId, patientName, diagnosis) {
        const b = new Block(
            this.chain.length, new Date().toISOString(),
            patientId, patientName, diagnosis, this.getLatestBlock().hash
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
    connectedAddress = null; currentRole = 'none';
    currentPatientId = null; currentPatientName = null;

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

// ─── Detect role ────────────────────────────────────────────
async function detectRole() {
    currentRole = 'unrecognized';
    currentPatientId = null; currentPatientName = null;

    if (!contract || !connectedAddress) { currentRole = 'none'; updateRoleUI(); return; }

    try {
        const adminAddr = await contract.admin();
        if (adminAddr.toLowerCase() === connectedAddress.toLowerCase()) {
            currentRole = 'admin'; updateRoleUI(); return;
        }
        const isDoctor = await contract.authorizedDoctors(connectedAddress);
        if (isDoctor) {
            currentRole = 'doctor'; updateRoleUI(); return;
        }
        const [pid, pName, exists] = await contract.getPatientInfo(connectedAddress);
        if (exists) {
            currentRole        = 'patient';
            currentPatientId   = pid.toNumber();
            currentPatientName = pName;
            updateRoleUI(); return;
        }
        currentRole = 'unrecognized';
        updateRoleUI();
    } catch (e) {
        console.warn("Tidak bisa deteksi peran:", e.message);
        currentRole = 'unrecognized';
        updateRoleUI();
    }
}

function updateRoleUI() {
    const inputForm = document.getElementById('inputForm');
    const roleBadge = document.getElementById('roleBadge');

    inputForm.classList.toggle('hidden', currentRole !== 'doctor' && currentRole !== 'admin');

    const labels = {
        'none':         { text: 'Tidak Terhubung',                                        cls: 'role-none'    },
        'unrecognized': { text: 'Tamu (Wallet Tidak Dikenal)',                             cls: 'role-guest'   },
        'patient':      { text: `Pasien: ${currentPatientName} [ID: ${currentPatientId}]`, cls: 'role-patient' },
        'doctor':       { text: 'Dokter',                                                  cls: 'role-doctor'  },
        'admin':        { text: 'Admin IT',                                                cls: 'role-admin'   },
    };
    const info = labels[currentRole] || labels['none'];
    roleBadge.innerText = info.text;
    roleBadge.className = `role-badge ${info.cls}`;
}

async function resolvePatientName(patientId) {
    const id = typeof patientId === 'object' ? patientId.toNumber() : Number(patientId);
    if (patientNameCache.has(id)) return patientNameCache.get(id);
    try {
        const name = await contract.patientIdToName(id);
        // Unregistered IDs return "" from Solidity — never cache empty strings
        const resolved = (name && name.trim() !== '') ? name.trim() : `Pasien #${id}`;
        patientNameCache.set(id, resolved);
        return resolved;
    } catch {
        const fallback = `Pasien #${id}`;
        patientNameCache.set(id, fallback);
        return fallback;
    }
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

    if (contract) {
        try {
            const total     = await contract.totalRecords();
            const allBlocks = [];

            for (let i = 0; i < total; i++) {
                const [patientId, diagnosis, timestamp, addedBy, isPrivate] =
                    await contract.getRecord(i);
                const [diagnosisHistory, historyTimestamps] =
                    await contract.getRecordHistory(i);

                const pid         = patientId.toNumber();
                const patientName = await resolvePatientName(pid);

                allBlocks.push({
                    recordIndex:  i,
                    patientId:    pid,
                    patientName,
                    diagnosis,
                    timestamp:    new Date(Number(timestamp) * 1000).toISOString(),
                    addedBy,
                    isPrivate,
                    history: diagnosisHistory.map((d, idx) => ({
                        diagnosis: d,
                        timestamp: new Date(Number(historyTimestamps[idx]) * 1000).toISOString()
                    }))
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

    // Fallback local
    const localBlocks = localChain.chain.map((block, index) => {
        let blockValid = true;
        if (index > 0) {
            const prev = localChain.chain[index - 1];
            blockValid = block.hash === block.calculateHash() && block.previousHash === prev.hash;
        }
        return { ...block, blockValid, isLocal: true, localIndex: index, history: [] };
    });
    renderGroupedChain(chainEl, localBlocks);
    statusBar.innerText = localChain.isChainValid()
        ? "MODE SIMULASI LOKAL: Integritas Data Terverifikasi"
        : "PERINGATAN: Terdeteksi Manipulasi Data pada Ledger!";
    statusBar.className = `status-bar ${localChain.isChainValid() ? 'valid' : 'invalid'}`;
}

function filterBlocksByRole(blocks) {
    switch (currentRole) {
        case 'unrecognized': return blocks.filter(b => !b.isPrivate);
        case 'patient':      return blocks.filter(b => !b.isPrivate || b.patientId === currentPatientId);
        case 'doctor':
        case 'admin':        return blocks;
        default:             return [];
    }
}

function renderGroupedChain(chainEl, blocks) {
    chainEl.innerHTML = '';
    if (blocks.length === 0) {
        chainEl.innerHTML = '<div class="loading">Tidak ada rekam medis yang dapat ditampilkan.</div>';
        return;
    }

    // Always group strictly by patientId — never by name
    // This ensures two patients with the same name get separate columns
    const groups = new Map();
    blocks.forEach(block => {
        const key = block.patientId; // strictly numeric ID only
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(block);
    });

    const grid = document.createElement('div');
    grid.className = 'chain-grid';

    groups.forEach((patientBlocks) => {
        const col = document.createElement('div');
        col.className = 'chain-column';

        const firstBlock  = patientBlocks[0];
        const displayName = firstBlock.patientName || `Pasien #${firstBlock.patientId}`;
        const idBadge     = firstBlock.patientId
            ? `<span class="patient-id-badge">ID: ${firstBlock.patientId}</span>`
            : '';

        const header = document.createElement('div');
        header.className = 'chain-column-header';
        header.innerHTML = `${displayName} ${idBadge}`;
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

function buildBlockElement(block) {
    const el = document.createElement('div');
    el.className = `block ${block.blockValid === false ? 'is-invalid' : ''} ${block.isPrivate ? 'is-private' : ''}`;

    const tamperBtn = (block.isLocal && currentRole === 'admin' && block.localIndex > 0)
        ? `<button class="tamper-btn" onclick="tamperData(${block.localIndex})">⚠️ Edit (Simulasi Tamper)</button>`
        : '';

    let privacyBtn = '';
    if (currentRole === 'patient' && block.patientId === currentPatientId && !block.isLocal) {
        const label = block.isPrivate ? '🔓 Privat — Klik untuk Publik' : '🔒 Publik — Klik untuk Privat';
        privacyBtn = `<button class="privacy-btn ${block.isPrivate ? 'is-private-btn' : ''}"
            onclick="togglePrivacy(${block.recordIndex})">${label}</button>`;
    }

    let editSection = '';
    if (currentRole === 'patient' && block.patientId === currentPatientId && !block.isLocal) {
        editSection = `
            <div class="edit-section">
                <button class="edit-toggle-btn" onclick="toggleEditForm(${block.recordIndex})">
                    ✏️ Koreksi Diagnosis
                </button>
                <div class="edit-form hidden" id="edit-form-${block.recordIndex}">
                    <input type="text" class="edit-input" id="edit-input-${block.recordIndex}"
                        placeholder="Masukkan diagnosis yang benar..." />
                    <div class="edit-form-actions">
                        <button class="edit-save-btn" onclick="submitEdit(${block.recordIndex})">Simpan</button>
                        <button class="edit-cancel-btn" onclick="toggleEditForm(${block.recordIndex})">Batal</button>
                    </div>
                </div>
            </div>`;
    }

    let historySection = '';
    if (block.history && block.history.length > 0) {
        const historyItems = [...block.history].reverse().map((h, i) => `
            <div class="history-item">
                <span class="history-label">Entri #${block.history.length - i}</span>
                <span class="history-diagnosis">${h.diagnosis}</span>
                <span class="history-time">${new Date(h.timestamp).toLocaleString()}</span>
            </div>`).join('');

        historySection = `
            <button class="history-toggle-btn" onclick="toggleHistory(${block.recordIndex})" id="history-btn-${block.recordIndex}">
                📋 Tampilkan Riwayat (${block.history.length} perubahan)
            </button>
            <div class="history-panel hidden" id="history-${block.recordIndex}">
                ${historyItems}
            </div>`;
    }

    const privacyIndicator = ((currentRole === 'doctor' || currentRole === 'admin') && block.isPrivate)
        ? `<span class="privacy-indicator">🔒 Privat</span>`
        : '';

    const addedByHtml = block.addedBy
        ? `<small>DITAMBAHKAN OLEH:</small><span class="hash-label">${block.addedBy}</span>`
        : '';

    el.innerHTML = `
        <div class="block-header">
            <span class="block-timestamp">${new Date(block.timestamp).toLocaleString()}</span>
            ${privacyIndicator}
            ${tamperBtn}
        </div>
        <div class="block-data">
            <span class="block-patient-id">#${block.patientId}</span> ${block.patientName}:
            <span class="block-diagnosis">${block.diagnosis}</span>
        </div>
        ${addedByHtml}
        ${historySection}
        ${editSection}
        ${privacyBtn}
    `;
    return el;
}

// ─── Toggle helpers ──────────────────────────────────────────
function toggleEditForm(recordIndex) {
    const form = document.getElementById(`edit-form-${recordIndex}`);
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) {
        document.getElementById(`edit-input-${recordIndex}`).focus();
    }
}

function toggleHistory(recordIndex) {
    const panel = document.getElementById(`history-${recordIndex}`);
    const btn   = document.getElementById(`history-btn-${recordIndex}`);
    const isHidden = panel.classList.toggle('hidden');
    btn.innerText = isHidden
        ? btn.innerText.replace('Sembunyikan', 'Tampilkan')
        : btn.innerText.replace('Tampilkan', 'Sembunyikan');
}

// ============================================================
// SUBMIT EDIT (patient only)
// ============================================================

async function submitEdit(recordIndex) {
    if (currentRole !== 'patient') return;
    const input   = document.getElementById(`edit-input-${recordIndex}`);
    const newDiag = input.value.trim();
    if (!newDiag) { alert("Harap isi diagnosis yang benar!"); return; }

    try {
        document.getElementById('status').innerText = "⏳ Menyimpan koreksi ke blockchain...";
        const tx = await contract.editRecord(recordIndex, newDiag);
        await tx.wait();
        input.value = '';
        await renderChain();
    } catch (err) {
        if (err.code === 4001) { alert("Transaksi dibatalkan."); }
        else { alert("Gagal menyimpan koreksi:\n" + (err.reason || err.message)); }
        await renderChain();
    }
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
        if (err.code === 4001) { alert("Transaksi dibatalkan."); }
        else { alert("Gagal mengubah privasi:\n" + (err.reason || err.message)); }
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

    const pidInput    = document.getElementById('patientId');
    const nameDisplay = document.getElementById('patientNameDisplay');
    const diag        = document.getElementById('diagnosis');
    const pid         = parseInt(pidInput.value.trim());

    if (!pid || isNaN(pid) || !diag.value.trim()) {
        alert("Harap isi ID Pasien dan Diagnosa!");
        return;
    }

    // Save to blockchain
    if (contract) {
        try {
            document.getElementById('status').innerText = "⏳ Mengirim transaksi ke Ethereum...";
            const tx = await contract.addRecord(pid, diag.value.trim());
            document.getElementById('status').innerText = "⏳ Menunggu konfirmasi blok...";
            await tx.wait();
            pidInput.value = ''; diag.value = '';
            if (nameDisplay) nameDisplay.value = '';
            await renderChain();
        } catch (err) {
            if (err.code === 4001) { alert("Transaksi dibatalkan oleh pengguna."); }
            else { alert("Transaksi gagal: " + (err.reason || err.message)); }
            await renderChain();
        }
        return;
    }

    // Fallback local
    localChain.addBlock(pid, `Pasien #${pid}`, diag.value.trim());
    pidInput.value = ''; diag.value = '';
    if (nameDisplay) nameDisplay.value = '';
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
// INIT
// ============================================================
document.getElementById('chain').innerHTML =
    '<div class="loading">Hubungkan MetaMask untuk melihat data.</div>';
document.getElementById('status').innerText = "Tidak terhubung — Hubungkan MetaMask";
document.getElementById('status').className = "status-bar invalid";
updateRoleUI();