// ============================================================
// CONFIGURATION & CONTRACT ABI
// ============================================================
const CONTRACT_ADDRESS = "0x42E13cF748687a035ab79D3FBeB1a2ADE8f89Bf0";

const CONTRACT_ABI = [
    "function addRecord(uint256 _patientId, string memory _patientName, string memory _diagnosis) public",
    "function editRecord(uint256 _recordIndex, string memory _newDiagnosis) public",
    "function togglePrivacy(uint256 _recordIndex) public",
    "function authorizeDoctor(address _doc) public",
    "function revokeDoctor(address _doc) public",
    "function authorizePatient(address _patient, string memory _name) public",
    "function revokePatient(address _patient) public",
    "function getRecord(uint256 _index) public view returns (uint256, string, string, uint256, address, bool)",
    "function getRecordHistory(uint256 _index) public view returns (string[], uint256[])",
    "function totalRecords() public view returns (uint256)",
    "function authorizedDoctors(address) public view returns (bool)",
    "function getPatientInfo(address _wallet) public view returns (uint256, string, bool)",
    "function patientIdToName(uint256) public view returns (string)",
    "function admin() public view returns (address)"
];

// ─── App State ─────────────────────────────────────────────
let provider = null;
let signer   = null;
let contract  = null;
let connectedAddress = null;

let currentRole      = 'none';
let currentPatientId = null;
let currentPatientName = null;

const patientNameCache = new Map();

// ─── Local Simulation Classes (Fallback) ──────────────────
class Block {
    constructor(index, timestamp, patientId, patientName, diagnosis, previousHash = '') {
        this.index       = index;
        this.timestamp   = timestamp;
        this.patientId   = patientId;
        this.patientName = patientName;
        this.diagnosis   = diagnosis;
        this.previousHash = previousHash;
        this.hash        = this.calculateHash();
        this.isPrivate   = false;
        this.history     = [];
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
// TOAST NOTIFICATION SYSTEM  (replaces all alert() calls)
// ============================================================

function showToast(type, title, message, duration = 5000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    toast.innerHTML = `
        <div class="toast-accent"></div>
        <div class="toast-body">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="dismissToast(this.closest('.toast'))">✕</button>
        <div class="toast-progress">
            <div class="toast-progress-bar" style="animation-duration: ${duration}ms"></div>
        </div>
    `;

    container.appendChild(toast);

    const timer = setTimeout(() => dismissToast(toast), duration);
    toast._timer = timer;
    return toast;
}

function dismissToast(toast) {
    if (!toast || toast._dismissed) return;
    toast._dismissed = true;
    clearTimeout(toast._timer);
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

// Convenience wrappers
const toast = {
    success: (title, msg, dur) => showToast('success', title, msg, dur),
    error:   (title, msg, dur) => showToast('error',   title, msg, dur),
    warning: (title, msg, dur) => showToast('warning', title, msg, dur),
    info:    (title, msg, dur) => showToast('info',    title, msg, dur),
};


// ============================================================
// MODAL PROMPT SYSTEM  (replaces prompt() and confirm())
// ============================================================

function showModal({ title, subtitle, icon, iconType = 'warning', placeholder, confirmLabel = 'Konfirmasi', confirmClass = 'modal-btn-confirm' }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal-box">
                <div class="modal-header">
                    <div class="modal-icon ${iconType}">${icon}</div>
                    <div>
                        <div class="modal-title">${title}</div>
                        ${subtitle ? `<div class="modal-subtitle">${subtitle}</div>` : ''}
                    </div>
                </div>
                <div class="modal-body">
                    <div class="modal-label">Masukkan diagnosis baru</div>
                    <input class="modal-input" id="modal-input-field" type="text" placeholder="${placeholder || ''}" />
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-cancel" id="modal-cancel">Batal</button>
                    <button class="modal-btn ${confirmClass}" id="modal-confirm">${confirmLabel}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const input   = overlay.querySelector('#modal-input-field');
        const cancelBtn  = overlay.querySelector('#modal-cancel');
        const confirmBtn = overlay.querySelector('#modal-confirm');

        input.focus();

        const cleanup = (val) => {
            overlay.style.animation = 'fadeIn 0.15s ease reverse';
            setTimeout(() => overlay.remove(), 140);
            resolve(val);
        };

        cancelBtn.onclick = () => cleanup(null);
        confirmBtn.onclick = () => {
            const val = input.value.trim();
            if (!val) { input.focus(); input.style.borderColor = '#ef4444'; return; }
            cleanup(val);
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') confirmBtn.click();
            if (e.key === 'Escape') cleanup(null);
        };
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    });
}


// ============================================================
// METAMASK CONNECTION
// ============================================================

async function connectMetaMask() {
    if (!window.ethereum) {
        toast.error('MetaMask Tidak Ditemukan', 'Silakan install ekstensi MetaMask di browser Anda terlebih dahulu.', 7000);
        return;
    }
    try {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer   = provider.getSigner();
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
        if (err.code !== 4001) {
            toast.error('Koneksi Gagal', 'Tidak dapat terhubung ke MetaMask. Coba lagi.');
        }
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
                currentRole       = 'patient';
                currentPatientId  = pid.toNumber();
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
        'none':         { text: 'Tidak Terhubung',                                     cls: 'role-none' },
        'unrecognized': { text: 'Tamu (Wallet Tidak Dikenal)',                          cls: 'role-guest' },
        'patient':      { text: `Pasien: ${currentPatientName} [ID: ${currentPatientId}]`, cls: 'role-patient' },
        'doctor':       { text: 'Dokter',                                               cls: 'role-doctor' },
        'admin':        { text: 'Admin IT',                                             cls: 'role-admin' },
    };
    const info = labels[currentRole] || labels['none'];
    if (roleBadge) {
        roleBadge.innerText  = info.text;
        roleBadge.className  = `role-badge ${info.cls}`;
    }
}


// ============================================================
// CORE RENDERING ENGINE
// ============================================================

async function renderChain() {
    const chainEl = document.getElementById('chain');
    const status  = document.getElementById('status');
    if (currentRole === 'none') return;

    chainEl.innerHTML = '<div class="loading">Memuat data dari blockchain...</div>';

    try {
        const total     = await contract.totalRecords();
        const allBlocks = [];

        for (let i = 0; i < total; i++) {
            const [pId, patientName, diagnosis, timestamp, addedBy, isPrivate] = await contract.getRecord(i);
            const [historyDiag, historyTime] = await contract.getRecordHistory(i);

            const pid          = pId.toNumber();
            const resolvedName = (patientName && patientName.trim() !== '')
                ? patientName.trim()
                : `Pasien #${pid}`;
            patientNameCache.set(pid, resolvedName);

            allBlocks.push({
                recordIndex: i, patientId: pid, patientName: resolvedName,
                diagnosis, isPrivate, addedBy,
                timestamp: new Date(Number(timestamp) * 1000).toISOString(),
                history: historyDiag.map((d, idx) => ({
                    diagnosis: d,
                    timestamp: new Date(Number(historyTime[idx]) * 1000).toISOString()
                }))
            });
        }

        computeBlockHashes(allBlocks);
        const visible = filterBlocksByRole(allBlocks);
        renderGroupedChain(chainEl, visible);
        status.innerText  = "SISTEM AMAN: Data Terverifikasi di Jaringan Ethereum";
        status.className  = "status-bar valid";
    } catch (err) {
        console.error("Render failed, using local fallback", err);
        renderLocalFallback(chainEl, status);
    }
}


// ============================================================
// HASH CHAIN COMPUTATION
// ============================================================
function computeBlockHashes(blocks) {
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

    const sortedIds = Array.from(groups.keys()).sort((a, b) => a - b);
    const grid = document.createElement('div');
    grid.className = 'chain-grid';

    sortedIds.forEach((pid) => {
        const patientBlocks = groups.get(pid);
        const col = document.createElement('div');
        col.className = 'chain-column';

        const header = document.createElement('div');
        header.className = 'chain-column-header';
        const latestBlock = [...patientBlocks].sort((a, b) => b.recordIndex - a.recordIndex)[0];
        const columnName  = latestBlock.patientName || `Pasien #${pid}`;
        header.innerHTML  = `${columnName} <span class="patient-id-badge">ID: ${pid}</span>`;
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

    const privacyBadge = ((currentRole === 'doctor' || currentRole === 'admin') && block.isPrivate)
        ? `<span class="privacy-indicator">🔒 Privat</span>` : '';

    const addedByHtml = block.addedBy
        ? `<small>DITAMBAHKAN OLEH</small><span class="hash-label">${block.addedBy}</span>` : '';

    let historySection = '';
    if (block.history && block.history.length > 0) {
        const items = [...block.history].reverse().map((h, i) => `
            <div class="history-item">
                <span class="history-label">Entri #${block.history.length - i}</span>
                <span class="history-diagnosis">${h.diagnosis}</span>
                <span class="history-time">${new Date(h.timestamp).toLocaleString('id-ID')}</span>
            </div>`).join('');

        historySection = `
            <button class="history-toggle-btn" onclick="toggleHistory(${block.recordIndex})" id="history-btn-${block.recordIndex}">
                📋 Tampilkan Riwayat (${block.history.length})
            </button>
            <div class="history-panel hidden" id="history-${block.recordIndex}">${items}</div>`;
    }

    let actions = '';
    if (currentRole === 'patient' && block.patientId === currentPatientId) {
        actions = `
            <div class="edit-section">
                <button class="edit-toggle-btn" onclick="toggleEditForm(${block.recordIndex})">✏️ Koreksi Diagnosis</button>
                <div class="edit-form hidden" id="edit-form-${block.recordIndex}">
                    <input type="text" class="edit-input" id="edit-input-${block.recordIndex}" placeholder="Diagnosis baru..." />
                    <div class="edit-form-actions">
                        <button class="edit-save-btn" onclick="submitEdit(${block.recordIndex})">Simpan</button>
                        <button class="edit-cancel-btn" onclick="toggleEditForm(${block.recordIndex})">Batal</button>
                    </div>
                </div>
            </div>
            <button class="privacy-btn ${block.isPrivate ? 'is-private-btn' : ''}" onclick="togglePrivacy(${block.recordIndex})">
                ${block.isPrivate ? '🔓 Set Publik' : '🔒 Set Privat'}
            </button>`;
    } else if (currentRole === 'admin') {
        const isTampered = block.isTampered || tamperState.has(block.recordIndex);
        actions = `
            <div class="admin-actions">
                <button class="tamper-btn ${isTampered ? 'tamper-active' : ''}"
                    onclick="tamperOnChain(${block.recordIndex})">
                    ${isTampered ? '⚠️ Ditamper' : '🔧 Simulasi Tamper'}
                </button>
                ${isTampered
                    ? `<button class="reset-tamper-btn" onclick="resetTamper(${block.recordIndex})">↩ Reset</button>`
                    : ''}
            </div>`;
    }

    const hashSection = (currentRole === 'admin' && block.previousHash)
        ? `<small>PREVIOUS HASH</small>
           <span class="hash-label">${block.previousHash}</span>
           <small>CURRENT HASH</small>
           <span class="hash-label ${block.isTampered ? 'hash-invalid' : ''}">${block.isTampered ? block.tamperedHash : block.currentHash}</span>`
        : '';

    el.innerHTML = `
        <div class="block-header">
            <span class="block-timestamp">${new Date(block.timestamp).toLocaleString('id-ID')}</span>
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
    const p   = document.getElementById(`history-${idx}`);
    const btn = document.getElementById(`history-btn-${idx}`);
    p.classList.toggle('hidden');
    const count = btn.dataset.count || btn.innerText.match(/\d+/)?.[0] || '';
    btn.innerText = p.classList.contains('hidden')
        ? `📋 Tampilkan Riwayat (${count})`
        : `📋 Sembunyikan Riwayat`;
    btn.classList.toggle('active', !p.classList.contains('hidden'));
}

async function submitEdit(idx) {
    const input = document.getElementById(`edit-input-${idx}`);
    const val   = input.value.trim();
    if (!val) {
        toast.warning('Input Kosong', 'Masukkan diagnosis baru terlebih dahulu.');
        input.focus();
        return;
    }
    try {
        toast.info('Mengirim Transaksi', 'Menunggu konfirmasi dari MetaMask...');
        const tx = await contract.editRecord(idx, val);
        toast.info('Memproses', 'Menunggu konfirmasi blok Ethereum...');
        await tx.wait();
        toast.success('Berhasil Disimpan', 'Diagnosis berhasil dikoreksi dan tersimpan di blockchain.');
        renderChain();
    } catch (e) {
        if (e.code === 4001) {
            toast.warning('Dibatalkan', 'Transaksi dibatalkan oleh pengguna.');
        } else {
            toast.error('Gagal Mengedit', e.reason || e.message);
        }
    }
}

async function togglePrivacy(idx) {
    try {
        toast.info('Memproses', 'Mengubah pengaturan privasi...');
        const tx = await contract.togglePrivacy(idx);
        await tx.wait();
        toast.success('Privasi Diperbarui', 'Pengaturan privasi rekam medis berhasil diubah.');
        renderChain();
    } catch (e) {
        if (e.code === 4001) {
            toast.warning('Dibatalkan', 'Transaksi dibatalkan oleh pengguna.');
        } else {
            toast.error('Gagal Mengubah Privasi', e.reason || e.message);
        }
    }
}


// ============================================================
// TAMPER SIMULATION (admin only)
// ============================================================
const tamperState = new Map();

function resetTamper(recordIndex) {
    tamperState.delete(recordIndex);
    toast.success('Reset Berhasil', `Simulasi tamper pada record #${recordIndex} telah dikembalikan.`);
    if (tamperState.size === 0) renderChain();
    else renderChainWithTamper();
}

async function tamperOnChain(recordIndex) {
    if (currentRole !== 'admin') {
        toast.error('Akses Ditolak', 'Hanya Admin yang dapat menggunakan fitur ini.');
        return;
    }

    const newDiag = await showModal({
        title:        'Simulasi Tamper Data',
        subtitle:     `Record #${recordIndex} — Hanya demonstrasi, tidak mengubah blockchain`,
        icon:         '⚠️',
        iconType:     'danger',
        placeholder:  'Masukkan diagnosis palsu...',
        confirmLabel: 'Terapkan Tamper',
    });

    if (!newDiag) return;

    tamperState.set(recordIndex, newDiag);
    toast.warning('Tamper Diterapkan', `Record #${recordIndex} telah dimanipulasi secara lokal. Rantai hash akan rusak.`, 6000);
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
                    diagnosis: d,
                    timestamp: new Date(Number(historyTime[idx]) * 1000).toISOString()
                }))
            });
        }

        computeBlockHashes(allBlocks);

        let chainBroken = false;
        const groups    = new Map();
        allBlocks.forEach(b => {
            if (!groups.has(b.patientId)) groups.set(b.patientId, []);
            groups.get(b.patientId).push(b);
        });

        groups.forEach(chain => {
            chain.sort((a, b) => a.recordIndex - b.recordIndex);
            let prevHash     = '0000000000000000';
            let breakDetected = false;

            chain.forEach(block => {
                if (tamperState.has(block.recordIndex)) {
                    block.isTampered        = true;
                    block.tamperedDiagnosis = tamperState.get(block.recordIndex);
                    block.tamperedHash      = CryptoJS.SHA256(
                        block.recordIndex + prevHash + block.timestamp +
                        block.patientId + block.patientName + block.tamperedDiagnosis
                    ).toString();
                    prevHash      = block.tamperedHash;
                    breakDetected = true;
                    chainBroken   = true;
                } else if (breakDetected) {
                    block.isInvalidated = true;
                    chainBroken = true;
                    prevHash    = block.currentHash;
                }
            });
        });

        const visible = filterBlocksByRole(allBlocks);
        renderGroupedChainTampered(chainEl, visible);

        if (chainBroken) {
            status.innerText  = "⚠️ PERINGATAN: Terdeteksi Manipulasi Data pada Ledger!";
            status.className  = "status-bar invalid";
        } else {
            status.innerText  = "SISTEM AMAN: Data Terverifikasi di Jaringan Ethereum";
            status.className  = "status-bar valid";
        }
    } catch (err) {
        console.error("Tamper render failed:", err);
    }
}

function renderGroupedChainTampered(chainEl, blocks) {
    blocks.forEach(b => { if (b.isInvalidated) b.isTampered = true; });
    renderGroupedChain(chainEl, blocks);
}


// ============================================================
// ADD NEW BLOCK
// ============================================================
async function addNewBlock() {
    const pid    = parseInt(document.getElementById('patientId').value);
    const nameEl = document.getElementById('patientNameDisplay');
    const diag   = document.getElementById('diagnosis').value.trim();
    const nameVal = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : `Pasien #${pid}`;

    if (!pid || isNaN(pid) || !diag) {
        toast.warning('Form Tidak Lengkap', 'Harap isi ID Pasien dan Diagnosa Medis terlebih dahulu.');
        return;
    }

    try {
        document.getElementById('status').innerText  = "Mengirim transaksi ke Ethereum...";
        document.getElementById('status').className  = "status-bar invalid";
        toast.info('Mengirim Transaksi', 'Harap konfirmasi di MetaMask...');

        const tx = await contract.addRecord(pid, nameVal, diag);

        document.getElementById('status').innerText = "Menunggu konfirmasi blok...";
        toast.info('Memproses', 'Menunggu konfirmasi blok Ethereum. Mohon tunggu...');
        await tx.wait();

        document.getElementById('patientId').value  = '';
        document.getElementById('diagnosis').value  = '';
        if (nameEl) nameEl.value = '';

        toast.success('Record Tersimpan', `Rekam medis untuk Pasien #${pid} berhasil ditambahkan ke blockchain.`);
        renderChain();
    } catch (e) {
        if (e.code === 4001) {
            toast.warning('Transaksi Dibatalkan', 'Kamu membatalkan transaksi di MetaMask.');
        } else {
            toast.error('Transaksi Gagal', e.reason || e.message);
        }
        document.getElementById('status').innerText = "SISTEM AMAN: Data Terverifikasi di Jaringan Ethereum";
        document.getElementById('status').className = "status-bar valid";
    }
}

function renderLocalFallback(chainEl, status) {
    const localBlocks = localChain.chain.map(b => ({ ...b, isLocal: true }));
    renderGroupedChain(chainEl, localBlocks);
    status.innerText = "MODE SIMULASI: Menggunakan data lokal — Ethereum tidak tersedia.";
    status.className = "status-bar invalid";
}

// ─── Initial State ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const chainEl = document.getElementById('chain');
    if (chainEl) chainEl.innerHTML = '<div class="loading">Hubungkan MetaMask untuk melihat data.</div>';
    updateRoleUI();
});
