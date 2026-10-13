/*
 * =========================================================================================
 * HYGIENE GUARD - SMART RESTROOM HYGIENE & ODOR MONITORING SYSTEM
 * =========================================================================================
 * Hardware: ESP32 Development Board (ESP32-WROOM-32)
 * Features:
 *   - MQ-135 Gas / Ammonia (NH3) / Air Quality Sensor (GPIO 34 - ADC1)
 *   - HC-SR04 Ultrasonic Distance Sensor for Visitor Count & Occupancy (TRIG 5, ECHO 18)
 *   - Physical Push Button for Cleaning Staff Reset (GPIO 4 with INPUT_PULLUP)
 *   - Green LED: Good Condition / Clean (GPIO 2)
 *   - Red LED: Cleaning Required / Odor Alert (GPIO 15)
 *   - Active Buzzer for Critical Odor Alarm (GPIO 13)
 *   - WiFi Client sending telemetry via HTTP POST to Node.js Backend (/api/telemetry)
 * =========================================================================================
 * WIRING GUIDE:
 *   - MQ-135 VCC -> 5V (VIN), GND -> GND, AOUT -> GPIO 34
 *   - HC-SR04 VCC -> 5V, GND -> GND, TRIG -> GPIO 5, ECHO -> GPIO 18 (use 1k/2k divider for 3.3V)
 *   - Push Button -> GPIO 4 and GND (one side to GPIO 4, other to GND)
 *   - Green LED -> GPIO 2 (with 220 ohm resistor to GND)
 *   - Red LED   -> GPIO 15 (with 220 ohm resistor to GND)
 *   - Buzzer    -> GPIO 13 (and GND)
 * =========================================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ----------------- CONFIGURATION -----------------
const char* WIFI_SSID     = "Pixel_5190";             // Your WiFi Name
const char* WIFI_PASSWORD = "dell@123";               // Your WiFi Password

// Set to true to stream directly to Firebase Cloud Realtime Database!
// Set to false to stream to local Node.js backend.
#define USE_FIREBASE              true

// 1. Firebase Cloud RTDB Settings (When USE_FIREBASE is true)
const char* FIREBASE_DATABASE_URL = "https://hygieneguard-default-rtdb.firebaseio.com";
const char* FIREBASE_API_KEY      = "AIzaSyBU1GP6GXYWQFr5P4A_gnzT5LsMRUfXdTk";
// Optional Database Secret / Auth Token (leave "" if Realtime Database rules allow read/write in test mode)
const char* FIREBASE_AUTH_SECRET  = ""; 
const char* WASHROOM_ID           = "washroom-1";

// 2. Local Node.js Backend Settings (When USE_FIREBASE is false)
const char* LOCAL_SERVER_URL      = "http://192.168.1.100:5000/api/telemetry";

// ----------------- PIN DEFINITIONS -----------------
#define PIN_MQ135         34    // Analog Input for Air Quality / Ammonia
#define PIN_TRIG           5    // Ultrasonic Trigger
#define PIN_ECHO          18    // Ultrasonic Echo
#define PIN_CLEAN_BTN      4    // Cleaning Reset Push Button
#define PIN_LED_GREEN      2    // Normal / Clean Indicator LED
#define PIN_LED_RED       15    // Alert / Clean Needed LED
#define PIN_BUZZER        13    // Alert Buzzer

// ----------------- CONSTANTS & THRESHOLDS ----------
#define OCCUPANCY_DIST_CM  100  // Distance below which stall is considered occupied
#define TELEMETRY_INTERVAL 3000 // Send telemetry every 3 seconds

// ----------------- STATE VARIABLES -----------------
bool isCurrentlyOccupied = false;
bool wasOccupied = false;
bool visitorEntered = false;
bool cleaningBtnPressed = false;

unsigned long lastTelemetryTime = 0;
unsigned long lastButtonPressTime = 0;

// Simple R0 Calibration baseline for MQ-135 in clean air (~3.6V divider on ESP32 3.3V)
const float RLOAD = 10.0;     // Load resistance in KOhms
const float R0    = 76.63;    // Sensor resistance in clean air (standard baseline)

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n==============================================");
  Serial.println("  HYGIENE GUARD - RESTROOM SENSOR NODE (ESP32) ");
  Serial.println("==============================================");

  // Pin Modes
  pinMode(PIN_MQ135, INPUT);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_CLEAN_BTN, INPUT_PULLUP);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  // Initial LED & Buzzer Test
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED, HIGH);
  digitalWrite(PIN_BUZZER, HIGH);
  delay(300);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_BUZZER, LOW);

  connectToWiFi();
}

void loop() {
  // 1. Maintain WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_RED, HIGH);
    Serial.println("[WiFi] Lost connection, reconnecting...");
    WiFi.reconnect();
    delay(2000);
    return;
  }

  // 2. Read Sensors
  float gasPpm = readMQ135PPM();
  float ammoniaPpm = gasPpm * 0.12; // Approximation of NH3 ratio from total PPM
  float distanceCm = readDistanceCM();

  // 3. Occupancy & Visitor Detection Logic
  bool occupiedNow = (distanceCm > 5 && distanceCm <= OCCUPANCY_DIST_CM);
  if (occupiedNow && !wasOccupied) {
    visitorEntered = true; // Visitor entered transition
    Serial.println(">> [EVENT] Visitor entered stall!");
  }
  wasOccupied = occupiedNow;
  isCurrentlyOccupied = occupiedNow;

  // 4. Cleaning Button Check (Active LOW with debounce)
  if (digitalRead(PIN_CLEAN_BTN) == LOW) {
    if (millis() - lastButtonPressTime > 1500) { // 1.5s debounce
      cleaningBtnPressed = true;
      lastButtonPressTime = millis();
      Serial.println(">> [STAFF] Cleaning button pressed! Resetting alert.");
      
      // Feedback beep
      digitalWrite(PIN_BUZZER, HIGH);
      delay(150);
      digitalWrite(PIN_BUZZER, LOW);
    }
  }

  // 5. Send Telemetry to Backend on Interval
  if (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL) {
    lastTelemetryTime = millis();
    sendTelemetry(gasPpm, ammoniaPpm, distanceCm, isCurrentlyOccupied, visitorEntered, cleaningBtnPressed);
    
    // Reset one-time flags after sending
    visitorEntered = false;
    cleaningBtnPressed = false;
  }

  delay(100);
}

// Connect to WiFi
void connectToWiFi() {
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected successfully!");
    Serial.print("[WiFi] IP Address: ");
    Serial.println(WiFi.localIP());
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_RED, LOW);
  } else {
    Serial.println("\n[WiFi] Failed to connect. Will retry during loop.");
  }
}

// Read MQ-135 Gas Sensor and Estimate PPM
float readMQ135PPM() {
  int rawADC = analogRead(PIN_MQ135);
  // ESP32 ADC: 0-4095 (12-bit)
  float voltage = (rawADC / 4095.0) * 3.3;
  if (voltage <= 0.1) voltage = 0.1;

  // Calculate sensor resistance Rs = ((Vc - V) * RLOAD) / V
  float rs = ((3.3 - voltage) * RLOAD) / voltage;
  float ratio = rs / R0;

  // MQ-135 Power-law formula for CO2/Air pollutants: PPM = a * (Rs/Ro)^b
  // Approximated curves for ambient air quality
  float ppm = 116.6020682 * pow(ratio, -2.769034857);

  if (ppm < 50.0) ppm = 50.0;
  if (ppm > 2000.0) ppm = 2000.0;
  return ppm;
}

// Measure Distance using HC-SR04
float readDistanceCM() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long duration = pulseIn(PIN_ECHO, HIGH, 25000); // 25ms timeout (~4m max)
  if (duration == 0) {
    return 200.0; // Default clear distance if timeout
  }
  float distance = (duration * 0.0343) / 2.0;
  return distance;
}

// Send Telemetry to Firebase RTDB or Local Node.js Backend
void sendTelemetry(float gasPpm, float ammoniaPpm, float distCm, bool occupied, bool entered, bool cleanPressed) {
  if (WiFi.status() != WL_CONNECTED) return;

  // Approximate temperature & humidity if DHT sensor is not connected
  float temp = 25.0;
  float hum = 60.0;
  int rssi = WiFi.RSSI();
  String ipStr = WiFi.localIP().toString();

  // 1. Build Payload
  String json = "{";
  json += "\"id\":\"" + String(WASHROOM_ID) + "\",";
  json += "\"gasPpm\":" + String(gasPpm, 1) + ",";
  json += "\"ammoniaPpm\":" + String(ammoniaPpm, 1) + ",";
  json += "\"distanceCm\":" + String(distCm, 1) + ",";
  json += "\"occupied\":" + String(occupied ? "true" : "false") + ",";
  json += "\"temperature\":" + String(temp, 1) + ",";
  json += "\"humidity\":" + String(hum, 1) + ",";
  json += "\"rssi\":" + String(rssi) + ",";
  json += "\"deviceIp\":\"" + ipStr + "\",";
  json += "\"esp32Connected\":true";

  if (cleanPressed) {
    json += ",\"cleaningAlert\":false";
  } else if (gasPpm > 350.0) {
    json += ",\"cleaningAlert\":true";
    json += ",\"alertReason\":\"Elevated Odor Detected (" + String((int)gasPpm) + " PPM)\"";
  }
  json += "}";

  if (USE_FIREBASE) {
    // ---------------- DIRECT FIREBASE REALTIME DATABASE (HTTPS REST) ----------------
    WiFiClientSecure client;
    client.setInsecure(); // Skip certificate verification for ESP32

    HTTPClient https;
    String firebaseUrl = String(FIREBASE_DATABASE_URL) + "/washrooms/" + String(WASHROOM_ID) + ".json";
    if (strlen(FIREBASE_AUTH_SECRET) > 0) {
      firebaseUrl += "?auth=" + String(FIREBASE_AUTH_SECRET);
    }

    if (https.begin(client, firebaseUrl)) {
      https.addHeader("Content-Type", "application/json");
      Serial.print("[Firebase RTDB] PATCHing: ");
      Serial.println(json);

      int httpCode = https.PATCH(json);
      if (httpCode > 0) {
        Serial.printf("[Firebase RTDB] Telemetry Success! HTTP Code: %d\n", httpCode);
      } else {
        Serial.printf("[Firebase RTDB] PATCH failed, error: %s\n", https.errorToString(httpCode).c_str());
      }
      https.end();
    }

    // Append to live telemetry history in Firebase
    HTTPClient histHttp;
    String histUrl = String(FIREBASE_DATABASE_URL) + "/telemetryHistory.json";
    if (strlen(FIREBASE_AUTH_SECRET) > 0) histUrl += "?auth=" + String(FIREBASE_AUTH_SECRET);
    if (histHttp.begin(client, histUrl)) {
      histHttp.addHeader("Content-Type", "application/json");
      String histJson = "{\"washroomId\":\"" + String(WASHROOM_ID) + "\",\"gasPpm\":" + String(gasPpm, 1) + ",\"ammoniaPpm\":" + String(ammoniaPpm, 1) + ",\"occupied\":" + String(occupied ? "true" : "false") + "}";
      histHttp.POST(histJson);
      histHttp.end();
    }
  } else {
    // ---------------- LOCAL NODE.JS BACKEND ----------------
    HTTPClient http;
    http.begin(LOCAL_SERVER_URL);
    http.addHeader("Content-Type", "application/json");

    String localJson = "{";
    localJson += "\"gasPpm\":" + String(gasPpm, 1) + ",";
    localJson += "\"ammoniaPpm\":" + String(ammoniaPpm, 1) + ",";
    localJson += "\"distanceCm\":" + String(distCm, 1) + ",";
    localJson += "\"occupied\":" + String(occupied ? "true" : "false") + ",";
    localJson += "\"visitorEntered\":" + String(entered ? "true" : "false") + ",";
    localJson += "\"cleaningButtonPressed\":" + String(cleanPressed ? "true" : "false") + ",";
    localJson += "\"temperature\":" + String(temp, 1) + ",";
    localJson += "\"humidity\":" + String(hum, 1) + ",";
    localJson += "\"rssi\":" + String(rssi) + ",";
    localJson += "\"deviceIp\":\"" + ipStr + "\"";
    localJson += "}";

    Serial.print("[HTTP Local] Sending: ");
    Serial.println(localJson);

    int httpCode = http.POST(localJson);
    if (httpCode > 0) {
      Serial.printf("[HTTP Local] Response code: %d\n", httpCode);
    } else {
      Serial.printf("[HTTP Local] POST failed, error: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  }

  // Update Local LEDs based on gas level & occupancy
  if (gasPpm > 350.0) {
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_RED, HIGH);
    digitalWrite(PIN_BUZZER, HIGH);
    delay(50);
    digitalWrite(PIN_BUZZER, LOW);
  } else {
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_RED, LOW);
  }
}
