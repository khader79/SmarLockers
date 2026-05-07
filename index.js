import mqtt from "https://unpkg.com/mqtt/dist/mqtt.esm.js";

const brokerUrl =
  "wss://65383d8e53254f37ba31f4d9e40f7226.s1.eu.hivemq.cloud:8884/mqtt";
const options = {
  username: "ILLProject",
  password: "ILL2026KBR.lab",
  clientId: `panel-${Math.random().toString(16).slice(2, 10)}`,
  clean: true,
  reconnectPeriod: 2000,
  connectTimeout: 15000,
};

// DOM Elements
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const connectBtn = document.getElementById("connectBtn");
const feedContainer = document.getElementById("feedContainer");
const pinInput = document.getElementById("pinInput");
const setPinBtn = document.getElementById("setPinBtn");
const pinSetIndicator = document.getElementById("pinSetIndicator");
const pinStepTitle = document.getElementById("pinStepTitle");
const pinStepDesc =
  document.getElementById("pinStepDesc") || document.createElement("p");
const pinInfo = document.getElementById("pinInfo");
const actionDisabledHint = document.getElementById("actionDisabledHint");
const alertModal = document.getElementById("alertModal");
const alertBox = document.getElementById("alertBox");
const alertIcon = document.getElementById("alertIcon");
const alertTitle = document.getElementById("alertTitle");
const alertMessage = document.getElementById("alertMessage");
const alertButton = document.getElementById("alertButton");

const closeBtn = document.getElementById("closeBtn");
const releaseBtn = document.getElementById("releaseBtn");

// Locker buttons and status badges
const lockerSelectBtns = {
  1: document.querySelector('[data-locker-select="1"]'),
  2: document.querySelector('[data-locker-select="2"]'),
  3: document.querySelector('[data-locker-select="3"]'),
};

const lockerStateBadges = {
  1: document.getElementById("locker1StateBadge"),
  2: document.getElementById("locker2StateBadge"),
  3: document.getElementById("locker3StateBadge"),
};

const lockerPosBadges = {
  1: document.getElementById("locker1PosBadge"),
  2: document.getElementById("locker2PosBadge"),
  3: document.getElementById("locker3PosBadge"),
};

// State
let client = null;
let selectedLocker = 1;
let pinAuthenticated = false;
let lastPinAttempt = null;

// Store which lockers have PINs saved
const lockerPINStatus = {
  1: localStorage.getItem("locker1_has_pin") === "true",
  2: localStorage.getItem("locker2_has_pin") === "true",
  3: localStorage.getItem("locker3_has_pin") === "true",
};

// ===== UTILITY FUNCTIONS =====
function timeLabel() {
  return new Date().toLocaleTimeString("ar-SA");
}

function addFeed(text) {
  if (feedContainer.querySelector(".feed-empty")) {
    feedContainer.innerHTML = "";
  }
  const item = document.createElement("div");
  item.className = "feed-item";
  item.innerHTML = `<div class="feed-time">${timeLabel()}</div><div class="feed-text">${text}</div>`;
  feedContainer.prepend(item);
}

function setStatus(online, text) {
  statusDot.classList.toggle("online", online);
  statusText.textContent = text;
}

// ===== ALERT SYSTEM =====
function showAlert(type, title, message) {
  alertBox.className = `alert-box ${type}`;

  if (type === "success") {
    alertIcon.textContent = "✅";
  } else if (type === "error") {
    alertIcon.textContent = "❌";
  } else if (type === "warning") {
    alertIcon.textContent = "⚠️";
  }

  alertTitle.textContent = title;
  alertMessage.textContent = message;
  alertModal.classList.add("visible");
}

function closeAlert() {
  alertModal.classList.remove("visible");
}

alertButton.addEventListener("click", closeAlert);
alertModal.addEventListener("click", (e) => {
  if (e.target === alertModal) closeAlert();
});

// ===== LOCKER SELECTION =====
function selectLocker(lockerId) {
  selectedLocker = lockerId;
  pinAuthenticated = false;
  pinInput.value = "";

  // Update UI - highlight selected locker
  for (const [id, btn] of Object.entries(lockerSelectBtns)) {
    btn.classList.toggle("active", Number(id) === lockerId);
  }

  // Check if this locker has a PIN already saved
  const hasPIN = lockerPINStatus[lockerId];

  if (hasPIN) {
    // Locker already has PIN → Ask for PIN to unlock
    pinStepTitle.textContent = `الخزنة ${lockerId} - أدخل كلمة السر`;
    pinStepDesc.textContent = "✓ الرمز محفوظ بالفعل - أدخل الرمز الصحيح للفتح";
    pinInfo.textContent = "الرمز موجود - تحقق منه الآن";
    setPinBtn.textContent = "فتح الخزنة";
    pinSetIndicator.className = "pin-set-indicator";
    pinSetIndicator.textContent = "";
    addFeed(`✓ الخزنة ${lockerId} لها رمز محفوظ - أدخل الرمز للفتح`);
  } else {
    // New locker → Ask to create new PIN
    pinStepTitle.textContent = `الخزنة ${lockerId} - أنشئ رمز جديد`;
    pinStepDesc.textContent = "🆕 هذه الخزنة جديدة - أنشئ رمز حماية لها الآن";
    pinInfo.textContent = "اختر رمزًا قويًا تتذكره جيدًا";
    setPinBtn.textContent = "إنشاء الرمز";
    pinSetIndicator.className = "pin-set-indicator";
    pinSetIndicator.textContent = "";
    addFeed(`الخزنة ${lockerId} جديدة - أنشئ رمز حماية لها`);
  }

  updateActionButtons();
}

// ===== PIN MANAGEMENT =====
function updateActionButtons() {
  const buttonsDisabled = !pinAuthenticated;
  closeBtn.disabled = buttonsDisabled;
  releaseBtn.disabled = buttonsDisabled;

  if (buttonsDisabled) {
    actionDisabledHint.classList.add("visible");
  } else {
    actionDisabledHint.classList.remove("visible");
  }
}

function handlePinInput() {
  const pin = pinInput.value.trim();
  if (!pin) {
    showAlert("warning", "رمز فارغ", "يجب أن تدخل الرمز أولاً قبل المتابعة");
    addFeed("⚠️ أدخل الرمز أولًا");
    return;
  }

  if (!client || !client.connected) {
    showAlert("error", "غير متصل", "يجب الاتصال بالنظام أولاً قبل المتابعة");
    addFeed("⚠️ يجب الاتصال بالنظام أولًا");
    return;
  }

  const hasPIN = lockerPINStatus[selectedLocker];

  if (hasPIN) {
    // User entered PIN for existing locker
    lastPinAttempt = pin;
    sendCommand(`open${selectedLocker} ${pin}`);
    addFeed(`⏳ التحقق من الرمز للخزنة ${selectedLocker}...`);
  } else {
    // New locker - save the new PIN first
    sendCommand(`set${selectedLocker}`);
    sendCommand(pin);
    lockerPINStatus[selectedLocker] = true;
    localStorage.setItem(`locker${selectedLocker}_has_pin`, "true");

    pinAuthenticated = true;
    pinSetIndicator.className = "pin-set-indicator visible";
    pinSetIndicator.textContent = "✓ تم إنشاء الرمز بنجاح";
    addFeed(`✓ تم حفظ الرمز الجديد للخزنة ${selectedLocker}`);
    showAlert(
      "success",
      "تم بنجاح! ✅",
      `تم إنشاء رمز جديد للخزنة ${selectedLocker}`,
    );
  }

  updateActionButtons();
}

// ===== MQTT COMMANDS =====
function sendCommand(command) {
  if (!client || !client.connected) {
    showAlert("error", "خطأ الاتصال", "لا يوجد اتصال بالنظام");
    addFeed("⚠️ لا يوجد اتصال");
    return;
  }

  client.publish("smartlocker/command", command, { qos: 0 }, (error) => {
    if (error) {
      showAlert("error", "خطأ في الإرسال", error.message);
      addFeed(`❌ خطأ: ${error.message}`);
      return;
    }
  });
}

function sendAction(action) {
  if (!pinAuthenticated) {
    addFeed("⚠️ يجب التحقق من الرمز أولًا");
    return;
  }

  const pin = pinInput.value.trim();
  const command =
    action === "open"
      ? `open${selectedLocker} ${pin}`
      : `${action}${selectedLocker}`;

  sendCommand(command);
  const actionText =
    action === "open" ? "فتح" : action === "close" ? "إغلاق" : "تحرير";
  addFeed(`⏳ ${actionText} الخزنة ${selectedLocker}...`);

  if (action === "close") {
    pinAuthenticated = false;
    pinSetIndicator.className = "pin-set-indicator";
    pinSetIndicator.textContent = "";
    showAlert(
      "warning",
      "تم إغلاق الخزنة",
      "لإعادة فتح الخزنة يجب إدخال الرمز مرة أخرى",
    );
    updateActionButtons();
  }
}

// ===== MQTT CONNECTION =====
function connect() {
  if (client && client.connected) {
    addFeed("✓ متصل بالفعل");
    return;
  }

  addFeed("⏳ جاري الاتصال...");
  client = mqtt.connect(brokerUrl, options);

  client.on("connect", () => {
    setStatus(true, "متصل");
    addFeed("✓ تم الاتصال بنجاح");
    client.subscribe("smartlocker/#", { qos: 0 }, (error) => {
      if (error) {
        addFeed(`❌ خطأ الاشتراك: ${error.message}`);
        return;
      }
      addFeed("✓ جاهز للعمل");
    });
  });

  client.on("reconnect", () => {
    setStatus(false, "إعادة الاتصال");
    addFeed("⏳ إعادة الاتصال...");
  });

  client.on("close", () => {
    setStatus(false, "غير متصل");
    addFeed("⚠️ تم قطع الاتصال");
  });

  client.on("error", (error) => {
    setStatus(false, "خطأ");
    addFeed(`❌ خطأ: ${error.message}`);
  });

  client.on("message", (topic, payload) => {
    const message = payload.toString();

    if (topic === "smartlocker/state") {
      parseLockerState(message);
      addFeed(`📊 تحديث حالة الخزائن`);
    } else if (topic === "smartlocker/input") {
      addFeed(`📝 ${message}`);

      // Detect wrong PIN error
      if (
        message.toLowerCase().includes("خطأ") ||
        message.toLowerCase().includes("error") ||
        message.toLowerCase().includes("wrong")
      ) {
        showAlert(
          "error",
          "❌ رمز خاطئ",
          "الرمز الذي أدخلته غير صحيح. حاول مرة أخرى.",
        );
        pinAuthenticated = false;
        pinSetIndicator.className = "pin-set-indicator";
        updateActionButtons();
      } else if (
        message.toLowerCase().includes("نجح") ||
        message.toLowerCase().includes("success") ||
        message.toLowerCase().includes("opened")
      ) {
        showAlert("success", "✅ نجحت العملية", message);
        pinAuthenticated = true;
        pinSetIndicator.className = "pin-set-indicator visible";
        pinSetIndicator.textContent = "✓ تم التحقق من الرمز";
        updateActionButtons();
      }
    } else if (topic === "smartlocker/status") {
      addFeed(`ℹ️ ${message}`);
    }
  });
}

function parseLockerState(message) {
  const matches = [...message.matchAll(/L([123]):([^|,]+)\|([^,]+)/g)];
  for (const match of matches) {
    const lockerId = Number(match[1]);
    const state = match[2].trim();
    const position = match[3].trim();

    const isAvailable = /AVAILABLE/i.test(state);
    const isOpen = /OPEN/i.test(position);

    lockerStateBadges[lockerId].textContent = isAvailable ? "متاحة" : "مشغولة";
    lockerStateBadges[lockerId].className =
      `status-badge ${isAvailable ? "free" : "occupied"}`;

    lockerPosBadges[lockerId].textContent = isOpen ? "مفتوحة" : "مغلقة";
    lockerPosBadges[lockerId].className =
      `status-badge ${isOpen ? "open" : "closed"}`;
  }
}

// ===== EVENT LISTENERS =====
connectBtn.addEventListener("click", connect);
setPinBtn.addEventListener("click", handlePinInput);

closeBtn.addEventListener("click", () => sendAction("close"));
releaseBtn.addEventListener("click", () => sendAction("release"));

for (const [id, btn] of Object.entries(lockerSelectBtns)) {
  btn.addEventListener("click", () => selectLocker(Number(id)));
}

pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    setPinBtn.click();
  }
});

// ===== INITIAL STATE =====
setStatus(false, "غير متصل");
selectLocker(1);
addFeed("مرحبًا بك - اختر خزنة وأدخل رمزك");
