/*
  HygieneGuard - sensor display test with Wi-Fi & Firebase
  Board : ESP32S NodeMCU
*/

#include <Wire.h>
#include <WiFi.h>
#include <LiquidCrystal_I2C.h>
#include <Firebase_ESP_Client.h> // NEW: Firebase Library
#include "addons/TokenHelper.h"  // NEW: Firebase
#include "addons/RTDBHelper.h"   // NEW: Firebase

// ---------- Wi-Fi & Firebase Credentials ----------
const char *WIFI_SSID     = "Pixel_5190";
const char *WIFI_PASSWORD = "dell@123";
#define API_KEY "AIzaSyBU1GP6GXYWQFr5P4A_gnzT5LsMRUfXdTk"
#define DATABASE_URL "https://hygieneguard-default-rtdb.firebaseio.com"

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
bool signupOK = false;
unsigned long lastFirebaseSend = 0;

// ---------- Pins ----------
#define MQ135_PIN   36   
#define TRIG_PIN    18
#define ECHO_PIN    19
#define I2C_SDA     21
#define I2C_SCL     22

// ---------- LCD ----------
#define LCD_ADDR    0x27   
#define LCD_COLS    16
#define LCD_ROWS    2
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);

// ---------- Settings ----------
const float DIVIDER_FACTOR = 1.5;    
const float BIN_EMPTY_CM   = 30.0;   
const float BIN_FULL_CM    = 5.0;    
const int   AQ_GOOD_MAX    = 1500;   
const int   AQ_MODERATE_MAX = 2500;

const unsigned long READ_INTERVAL_MS = 1000;
const unsigned long PAGE_INTERVAL_MS = 2500;
const unsigned long WIFI_RETRY_MS    = 10000;
const int NUM_PAGES = 5;

// ---------- Data ----------
struct RealData {
  int mq135Raw;
  float aoVolts;
  const char *airLabel;
  float distCm;     
  int fillPct;
  bool binFull;
} real;

struct DummyData {
  float nh3, co, no2;
  int wetPct;
  bool presence;
  float tempC, humidity;
  bool cardTapped;
} dummy;

unsigned long lastRead = 0;
unsigned long lastPage = 0;
unsigned long lastWifiTry = 0;
int page = 0;

// ---------- Helpers ----------
void lcdPrintLine(uint8_t row, const char *text) {
  char buf[LCD_COLS + 1];
  snprintf(buf, sizeof(buf), "%-16s", text);   
  lcd.setCursor(0, row);
  lcd.print(buf);
}

// ---------- Wi-Fi ----------
void connectWiFi() {
  lcdPrintLine(0, "Connecting WiFi");
  lcdPrintLine(1, WIFI_SSID);
  Serial.printf("Connecting to Wi-Fi: %s ", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWi-Fi connected\n");
    lcdPrintLine(0, "WiFi connected");
    
    // NEW: Initialize Firebase after WiFi connects!
    config.api_key = API_KEY;
    config.database_url = DATABASE_URL;
    if (Firebase.signUp(&config, &auth, "", "")) {
      signupOK = true;
      Serial.println("Firebase Connected!");
    }
    config.token_status_callback = tokenStatusCallback;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
    
  } else {
    Serial.println("\nWi-Fi failed");
  }
  delay(2000);
}

void checkWiFi() {
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry >= WIFI_RETRY_MS) {
    lastWifiTry = millis();
    WiFi.disconnect();
    connectWiFi(); // Try reconnecting
  }
}

// ---------- Real sensors ----------
int readMQ135Raw() {
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(MQ135_PIN);
    delay(2);
  }
  return sum / 16;
}

float readDistanceOnceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);   
  if (duration == 0) return -1;
  return duration * 0.0343f / 2.0f;
}

float readDistanceCm() {
  float sum = 0;
  int valid = 0;
  for (int i = 0; i < 3; i++) {
    float d = readDistanceOnceCm();
    if (d > 0) {
      sum += d;
      valid++;
    }
    delay(30);
  }
  if (valid == 0) return -1;
  return sum / valid;
}

void updateRealData() {
  real.mq135Raw = readMQ135Raw();
  real.aoVolts = analogReadMilliVolts(MQ135_PIN) / 1000.0f * DIVIDER_FACTOR;

  if (real.mq135Raw < AQ_GOOD_MAX) real.airLabel = "Good";
  else if (real.mq135Raw < AQ_MODERATE_MAX) real.airLabel = "Moderate";
  else real.airLabel = "Poor";

  real.distCm = readDistanceCm();
  if (real.distCm < 0) {
    real.fillPct = 0;
    real.binFull = false;
  } else {
    float pct = (BIN_EMPTY_CM - real.distCm) / (BIN_EMPTY_CM - BIN_FULL_CM) * 100.0f;
    real.fillPct = constrain((int)pct, 0, 100);
    real.binFull = real.distCm <= BIN_FULL_CM + 3.0f;
  }
}

// ---------- Dummy sensors ----------
void updateDummyData() {
  dummy.nh3 = random(50, 250) / 10.0;     
  dummy.co = random(10, 50) / 10.0;       
  dummy.no2 = random(1, 10) / 10.0;       
  dummy.wetPct = random(0, 100);          
  dummy.presence = random(0, 2);          
  dummy.tempC = random(260, 300) / 10.0;  
  dummy.humidity = random(500, 700) / 10.0;  
  dummy.cardTapped = (random(0, 4) == 0);
}

// ---------- Display ----------
void showPage(int p) {
  char l1[32], l2[32];
  switch (p) {
    case 0: snprintf(l1, sizeof(l1), "MQ135: %d", real.mq135Raw); snprintf(l2, sizeof(l2), "Air: %s", real.airLabel); break;
    case 1: 
      if (real.distCm < 0) { snprintf(l1, sizeof(l1), "Bin: no echo"); snprintf(l2, sizeof(l2), "Check HC-SR04"); } 
      else { snprintf(l1, sizeof(l1), "Bin: %.1f cm", real.distCm); snprintf(l2, sizeof(l2), "Fill:%d%% %s", real.fillPct, real.binFull ? "FULL" : "OK"); }
      break;
    case 2: snprintf(l1, sizeof(l1), "NH3:%.0f CO:%.0fppm", dummy.nh3, dummy.co); snprintf(l2, sizeof(l2), "NO2:%.1fppm *", dummy.no2); break;
    case 3: snprintf(l1, sizeof(l1), "Wet:%d%% %s *", dummy.wetPct, dummy.wetPct > 50 ? "WET" : "DRY"); snprintf(l2, sizeof(l2), "Presence: %s *", dummy.presence ? "YES" : "NO"); break;
    default: snprintf(l1, sizeof(l1), "T:%.1fC H:%.0f%% *", dummy.tempC, dummy.humidity); snprintf(l2, sizeof(l2), "NFC: %s *", dummy.cardTapped ? "Tapped" : "No card"); break;
  }
  lcdPrintLine(0, l1);
  lcdPrintLine(1, l2);
}

// ---------- Arduino ----------
void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(MQ135_PIN, ADC_11db);

  Wire.begin(I2C_SDA, I2C_SCL);
  lcd.init();
  lcd.backlight();
  lcdPrintLine(0, "HygieneGuard");
  
  connectWiFi();
  randomSeed(esp_random());
  delay(1000);   
}

void loop() {
  unsigned long now = millis();
  checkWiFi();

  if (now - lastRead >= READ_INTERVAL_MS) {
    lastRead = now;
    updateRealData();
    updateDummyData();
    showPage(page);
  }

  if (now - lastPage >= PAGE_INTERVAL_MS) {
    lastPage = now;
    page = (page + 1) % NUM_PAGES;
    showPage(page);
  }
  
  // NEW: FIREBASE CLOUD SYNC EVERY 3 SECONDS
  if (Firebase.ready() && signupOK && (now - lastFirebaseSend > 3000)) {
    lastFirebaseSend = now;
    
    // Map Raw MQ135 to a rough PPM for the website 
    int ammoniaPPM = real.mq135Raw / 40; 
    
    // Sending REAL data
    if (Firebase.RTDB.setInt(&fbdo, "washrooms/washroom01/sensors/ammonia", ammoniaPPM)) {
      Firebase.RTDB.setInt(&fbdo, "washrooms/washroom01/sensors/dustbin", real.fillPct);
      Firebase.RTDB.setBool(&fbdo, "washrooms/washroom01/esp32Connected", true);
      Serial.printf("[Firebase RTDB] Success! Sent Ammonia: %d PPM | Dustbin: %d%%\n", ammoniaPPM, real.fillPct);
    } else {
      Serial.printf("[Firebase RTDB] Failed: %s\n", fbdo.errorReason().c_str());
    }
  }
}
