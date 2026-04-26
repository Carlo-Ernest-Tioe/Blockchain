// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MedicalChain {

    // ─── Structs ───────────────────────────────────────────────
    struct Record {
        uint256 patientId;
        string  patientName;
        string  diagnosis;
        uint256 timestamp;
        address addedBy;
        bool    isPrivate;
        // Edit history — previous diagnoses before patient corrections
        string[]  diagnosisHistory;
        uint256[] historyTimestamps;
    }

    struct Patient {
        string  displayName;
        uint256 patientId;
        bool    exists;
    }

    // ─── Storage ───────────────────────────────────────────────
    Record[]  public records;

    address   public admin;
    mapping(address => bool)    public authorizedDoctors;

    // Patient wallet → Patient struct
    mapping(address => Patient) public patients;
    // patientId → wallet address (for reverse lookup)
    mapping(uint256 => address) public patientIdToWallet;
    // patientId → display name (for frontend display)
    mapping(uint256 => string)  public patientIdToName;

    uint256 private nextPatientId = 1;

    // ─── Constructor ───────────────────────────────────────────
    constructor() {
        admin = msg.sender;
    }

    // ─── Modifiers ─────────────────────────────────────────────
    modifier onlyAdmin() {
        require(msg.sender == admin, "Bukan Admin");
        _;
    }

    modifier onlyDoctor() {
        require(authorizedDoctors[msg.sender], "Akses Ditolak: Bukan Dokter");
        _;
    }

    // ─── Admin Functions ───────────────────────────────────────

    function authorizeDoctor(address _doc) public onlyAdmin {
        authorizedDoctors[_doc] = true;
    }

    function revokeDoctor(address _doc) public onlyAdmin {
        authorizedDoctors[_doc] = false;
    }

    // Register a patient — auto-assigns a numeric ID, name is optional
    function authorizePatient(address _patient, string memory _name) public onlyAdmin {
        require(!patients[_patient].exists, "Pasien sudah terdaftar");
        uint256 id = nextPatientId++;
        patients[_patient] = Patient(_name, id, true);
        patientIdToWallet[id] = _patient;
        patientIdToName[id]   = _name; // can be empty string ""
    }

    // Register a patient with no name (ID only)
    function authorizePatientById(address _patient) public onlyAdmin {
        require(!patients[_patient].exists, "Pasien sudah terdaftar");
        uint256 id = nextPatientId++;
        patients[_patient] = Patient("", id, true);
        patientIdToWallet[id] = _patient;
        patientIdToName[id]   = "";
    }

    function revokePatient(address _patient) public onlyAdmin {
        require(patients[_patient].exists, "Pasien tidak ditemukan");
        uint256 id = patients[_patient].patientId;
        patientIdToWallet[id] = address(0);
        patientIdToName[id]   = "";
        delete patients[_patient];
    }

    // ─── Doctor Functions ──────────────────────────────────────

    // Doctor adds a record using patient ID and their chosen name
    function addRecord(uint256 _patientId, string memory _patientName, string memory _diagnosis) public onlyDoctor {
        string[]  memory emptyHistory     = new string[](0);
        uint256[] memory emptyTimestamps  = new uint256[](0);
        records.push(Record(
            _patientId,
            _patientName,
            _diagnosis,
            block.timestamp,
            msg.sender,
            false,
            emptyHistory,
            emptyTimestamps
        ));
    }

    // ─── Patient Functions ─────────────────────────────────────

    // Patient edits their own record — old diagnosis pushed to history
    function editRecord(uint256 _recordIndex, string memory _newDiagnosis) public {
        require(_recordIndex < records.length, "Record tidak ditemukan");
        require(patients[msg.sender].exists, "Bukan pasien terdaftar");
        require(
            records[_recordIndex].patientId == patients[msg.sender].patientId,
            "Bukan rekam medis Anda"
        );
        // Push current diagnosis to history before overwriting
        records[_recordIndex].diagnosisHistory.push(records[_recordIndex].diagnosis);
        records[_recordIndex].historyTimestamps.push(records[_recordIndex].timestamp);
        // Update to new diagnosis
        records[_recordIndex].diagnosis = _newDiagnosis;
        records[_recordIndex].timestamp = block.timestamp;
    }

    // Patient toggles privacy
    function togglePrivacy(uint256 _recordIndex) public {
        require(_recordIndex < records.length, "Record tidak ditemukan");
        require(patients[msg.sender].exists, "Bukan pasien terdaftar");
        require(
            records[_recordIndex].patientId == patients[msg.sender].patientId,
            "Bukan rekam medis Anda"
        );
        records[_recordIndex].isPrivate = !records[_recordIndex].isPrivate;
    }

    // ─── Read Functions ────────────────────────────────────────

    function totalRecords() public view returns (uint256) {
        return records.length;
    }

    // Returns main record fields
    function getRecord(uint256 _index) public view returns (
        uint256 patientId,
        string memory patientName,
        string memory diagnosis,
        uint256 timestamp,
        address addedBy,
        bool isPrivate
    ) {
        Record storage r = records[_index];
        return (r.patientId, r.patientName, r.diagnosis, r.timestamp, r.addedBy, r.isPrivate);
    }

    // Returns edit history for a record
    function getRecordHistory(uint256 _index) public view returns (
        string[] memory diagnosisHistory,
        uint256[] memory historyTimestamps
    ) {
        Record storage r = records[_index];
        return (r.diagnosisHistory, r.historyTimestamps);
    }

    // Helper: get patient info from wallet
    function getPatientInfo(address _wallet) public view returns (
        uint256 patientId,
        string memory displayName,
        bool exists
    ) {
        Patient storage p = patients[_wallet];
        return (p.patientId, p.displayName, p.exists);
    }

    // Helper: get next patient ID (for admin reference)
    function getNextPatientId() public view returns (uint256) {
        return nextPatientId;
    }
}
