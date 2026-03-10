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
        constructor() {
            this.chain = [this.createGenesisBlock()];
        }

        createGenesisBlock() {
            return new Block(0, new Date().toISOString(), "Genesis Block", "System Initialization", "0");
        }

        getLatestBlock() {
            return this.chain[this.chain.length - 1];
        }

        addBlock(patientName, diagnosis) {
            const newBlock = new Block(
                this.chain.length,
                new Date().toISOString(),
                patientName,
                diagnosis,
                this.getLatestBlock().hash
            );
            this.chain.push(newBlock);
        }

        isChainValid() {
            for (let i = 1; i < this.chain.length; i++) {
                const currentBlock = this.chain[i];
                const previousBlock = this.chain[i - 1];

                if (currentBlock.hash !== currentBlock.calculateHash()) return false;
                if (currentBlock.previousHash !== previousBlock.hash) return false;
            }
            return true;
        }
    }

    // FRONTEND
    const medChain = new Blockchain();

    // Fungsi untuk mengatur tampilan berdasarkan peran
    function updateUIByRole() {
        const role = document.getElementById('currentRole').value;
        const inputForm = document.getElementById('inputForm');
        
        if (role === 'doctor') {
            inputForm.classList.remove('hidden');
        } else {
            inputForm.classList.add('hidden');
        }

        renderChain();
    }

    function renderChain() {
        const chainEl = document.getElementById('chain');
        const statusBar = document.getElementById('status');
        const role = document.getElementById('currentRole').value;
        const isValid = medChain.isChainValid();

        chainEl.innerHTML = '';
        
        medChain.chain.forEach((block, index) => {
            let blockValid = true;
            if (index > 0) {
                const prev = medChain.chain[index-1];
                blockValid = (block.hash === block.calculateHash() && block.previousHash === prev.hash);
            }

            const blockEl = document.createElement('div');
            blockEl.className = `block ${!blockValid ? 'is-invalid' : ''}`;
            
            // Logika memunculkan tombol tamper HANYA untuk Admin di blok selain Genesis
            const showTamperBtn = (role === 'admin' && index > 0) 
                ? `<button class="tamper-btn" onclick="tamperData(${index})">Edit (Akses Admin)</button>` 
                : '';

            blockEl.innerHTML = `
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
                <span class="hash-label" style="color: #0f172a">${block.hash}</span>
                ${showTamperBtn}
            `;
            chainEl.appendChild(blockEl);
        });

        if (isValid) {
            statusBar.innerText = "SISTEM AMAN: Integritas Data Terverifikasi";
            statusBar.className = "status-bar valid";
        } else {
            statusBar.innerText = "PERINGATAN: Terdeteksi Manipulasi Data pada Ledger!";
            statusBar.className = "status-bar invalid";
        }
    }

    function addNewBlock() {
        // Keamanan tambahan
        if (document.getElementById('currentRole').value !== 'doctor') {
            alert("Akses Ditolak: Hanya Dokter yang dapat menambahkan rekam medis.");
            return;
        }

        const pName = document.getElementById('patientName');
        const diag = document.getElementById('diagnosis');

        if (pName.value && diag.value) {
            medChain.addBlock(pName.value, diag.value);
            pName.value = '';
            diag.value = '';
            renderChain();
        } else {
            alert("Harap isi semua data!");
        }
    }

    function tamperData(index) {
        if (document.getElementById('currentRole').value !== 'admin') {
            alert("Akses Ditolak!");
            return;
        }

        const newData = prompt("Ubah Diagnosa Pasien secara paksa di Database:", "Sehat Walafiat");
        if (newData && newData !== null) {
            medChain.chain[index].diagnosis = newData;
            renderChain();
        }
    }
    updateUIByRole();