# 🔥 Hygiene Guard — Firebase Realtime Database Integration Guide

This guide explains how to connect your **ESP32 hardware** and **React Web Dashboard** directly to **Firebase Realtime Database** for real-time cloud monitoring from anywhere in the world.

---

## 1. Create your Free Firebase Project (2 Minutes)

1. Open the [Firebase Console](https://console.firebase.google.com/) and sign in with your Google account.
2. Click **Add project** (or **Create a project**).
   - Enter a project name, e.g., `hygiene-guard-demo`.
   - Google Analytics is optional (you can disable it for now).
   - Click **Create project**.
3. Once created, in the left navigation menu:
   - Click **Build** → **Realtime Database**.
   - Click **Create Database**.
   - Select a database location (e.g., `United States (us-central1)` or `Singapore (asia-southeast1)`).
   - Under Security rules, choose **Start in test mode** (this allows read/write access during setup).
   - Click **Enable**.
4. At the top of the Realtime Database page, copy your database URL:
   ```
   https://YOUR-PROJECT-ID-default-rtdb.firebaseio.com
   ```

---

## 2. Connect the React Web Dashboard

You can connect Firebase in two easy ways:

### Option A: Using the in-app Web Modal (Fastest)
1. Open the dashboard at [http://localhost:3000](http://localhost:3000).
2. In the top navigation bar, click the **Connect Firebase** (or **Firebase RTDB**) button.
3. Paste your **Firebase Realtime Database URL** (e.g. `https://your-project-id-default-rtdb.firebaseio.com`).
4. Click **Save & Connect**.
5. Click **"Seed Starter Restroom Data"** to automatically populate your Firebase database with an initial washroom, thresholds, and attendant.
6. The status badge will turn green: **🟢 Firebase RTDB Live**.

### Option B: Using an `.env` file
Create `frontend/.env`:
```env
VITE_FIREBASE_DATABASE_URL=https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
```

---

## 3. Flash the ESP32 Hardware

The Arduino sketch has been updated to stream sensor telemetry directly to Firebase Realtime Database using the built-in HTTPS client.

1. Open [esp32_connection/hygiene_guard_esp32.ino](file:///d:/AITD_IDEAS/HYGIENE_GUARD/esp32_connection/hygiene_guard_esp32.ino) in Arduino IDE.
2. Edit lines 29–39:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_NAME";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

   // Enable direct Firebase cloud mode
   #define USE_FIREBASE              true

   // Paste your Firebase Database URL here (no trailing slash):
   const char* FIREBASE_DATABASE_URL = "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com";
   const char* FIREBASE_AUTH_SECRET  = ""; // Leave empty "" for test mode
   const char* WASHROOM_ID           = "washroom-1";
   ```
3. Connect your ESP32 via USB and click **Upload**.
4. Open the Serial Monitor at **115200 baud**. You will see:
   ```text
   [WiFi] Connected successfully!
   [Firebase RTDB] PATCHing: {"id":"washroom-1","gasPpm":185.0,...}
   [Firebase RTDB] Telemetry Success! HTTP Code: 200
   ```
5. Watch your Web Dashboard update instantly in real time!

---

## 4. Firebase Realtime Database Rules (Production Security)

When you are ready to secure your database:
In Firebase Console → **Realtime Database** → **Rules**:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
*(For production, you can restrict write permissions using Firebase Authentication tokens or Database Secrets).*
